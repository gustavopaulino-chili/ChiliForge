<?php
/**
 * Shared brand-visual-brief job logic for company-assets.
 *
 * Included by BOTH company-assets.php (enqueue + optional inline run) and
 * company-assets-worker.php (detached CLI run). Defines functions only — no top-level
 * side effects — so it is safe to include from either entry point.
 *
 * The heavy work (Gemini vision over ~16 Instagram posts → 300-400 word brief) is what
 * used to block the caller for up to 3 min and trip n8n's execution ceiling. It now runs
 * out-of-band via caa_run_brief_job(), keyed off a company_asset_jobs row + the company's
 * stored form_data, so it depends on NOTHING from the original HTTP request state.
 *
 * Requires: db.php ($conn), agents/helpers.php (agents_* helpers), site_helpers.php.
 */

if (!function_exists('caa_ensure_job_table')) {
    function caa_ensure_job_table(mysqli $conn): void {
        $conn->query(
            "CREATE TABLE IF NOT EXISTS company_asset_jobs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                company_project_id INT NOT NULL,
                account_type VARCHAR(20) NOT NULL DEFAULT 'testing',
                gemini_api_key VARCHAR(255) NULL,
                payload_json MEDIUMTEXT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'processing',
                error TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_caj_company (company_project_id),
                INDEX idx_caj_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    }
}

if (!function_exists('caa_spawn_worker')) {
    /**
     * Spawn the detached CLI worker (LiteSpeed path). Mirrors generate-ads.php: PHP_BINARY is
     * lsphp under LSAPI and fatals when exec'd, so we hunt for a real CLI php first.
     *
     * Returns false when the worker demonstrably could not be launched (exec disabled — common on
     * cPanel/LiteSpeed — no worker script, no usable CLI php, or a non-zero exec). The caller must
     * act on false: a silently un-spawned job leaves the company stuck on 'processing' with a
     * brief that never arrives, which is invisible until a customer doesn't get their brief.
     * A true return only means the shell accepted the command, not that the job succeeded.
     */
    function caa_spawn_worker(int $jobId): bool {
        $workerPath = __DIR__ . '/company-assets-worker.php';
        if (!is_file($workerPath)) {
            error_log('[company-assets] worker script missing at ' . $workerPath);
            return false;
        }
        $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
        if (!function_exists('exec') || in_array('exec', $disabled, true)) {
            error_log('[company-assets] exec() unavailable (disable_functions) — cannot spawn worker for job ' . $jobId);
            return false;
        }
        $cliPhp = '';
        foreach (['/usr/bin/php', '/usr/local/bin/php', '/opt/cpanel/ea-php81/root/usr/bin/php'] as $cand) {
            if (@is_executable($cand)) { $cliPhp = $cand; break; }
        }
        if ($cliPhp === '') $cliPhp = 'php';
        $rc = 1;
        @exec(escapeshellarg($cliPhp) . ' ' . escapeshellarg($workerPath) . ' ' . $jobId . ' > /dev/null 2>&1 &', $out, $rc);
        if ($rc !== 0) {
            error_log('[company-assets] worker spawn returned ' . $rc . ' for job ' . $jobId . ' (php=' . $cliPhp . ')');
            return false;
        }
        return true;
    }
}

if (!function_exists('caa_run_brief_job')) {
    /**
     * Execute one brand-visual-brief job end-to-end: Gemini vision → brief + palette → persist on
     * the company → re-sync the Gemini store → finalize the job row (and drop the stored key).
     * Non-fatal throughout: any failure leaves a previously stored brief in place and marks the
     * company brandVisualStatus='failed' so a poll can surface it.
     */
    function caa_run_brief_job(mysqli $conn, int $jobId): void {
        // ── Load job ──────────────────────────────────────────────────────────
        $st = $conn->prepare(
            "SELECT user_id, company_project_id, account_type, gemini_api_key, payload_json
             FROM company_asset_jobs WHERE id = ? LIMIT 1"
        );
        if (!$st) { error_log('[company-assets-worker] DB error loading job'); return; }
        $st->bind_param('i', $jobId);
        $st->execute();
        $st->bind_result($userId, $companyId, $accountType, $geminiApiKey, $payloadJson);
        if (!$st->fetch()) { $st->close(); error_log('[company-assets-worker] job not found: ' . $jobId); return; }
        $st->close();

        $userId       = (int)$userId;
        $companyId    = (int)$companyId;
        $accountType  = ($accountType === 'admin') ? 'admin' : 'testing';
        $geminiApiKey = trim((string)$geminiApiKey);
        $payload      = json_decode((string)$payloadJson, true) ?: [];
        $brandImageUrls      = is_array($payload['brandImageUrls'] ?? null) ? $payload['brandImageUrls'] : [];
        $competitorImageUrls = is_array($payload['competitorImageUrls'] ?? null) ? $payload['competitorImageUrls'] : [];
        // The stored brand_posts are market reference, not the client's own profile.
        $brandPostsAreProxy  = !empty($payload['brandPostsAreProxy']);

        // ── Load company (store name + form data) ─────────────────────────────
        agents_reconnect_mysqli_if_needed($conn);
        $cs = $conn->prepare("SELECT gemini_store_name, company_form_data FROM projects WHERE id = ? LIMIT 1");
        if (!$cs) { error_log('[company-assets-worker] DB error loading company'); return; }
        $cs->bind_param('i', $companyId);
        $cs->execute();
        $cs->bind_result($storeName, $formDataJson);
        if (!$cs->fetch()) { $cs->close(); error_log('[company-assets-worker] company not found: ' . $companyId); return; }
        $cs->close();
        $formData = json_decode((string)$formDataJson, true) ?: [];
        if (!is_array($formData)) $formData = [];

        // ── Generate the brief (the slow Gemini-vision step) ──────────────────
        $briefOk = false;
        $err     = null;
        try {
            $bvRes = agents_call_edge_function('agents-ads', [
                'mode'                => 'brand_visual',
                'geminiApiKey'        => $geminiApiKey,
                'brandImageUrls'      => $brandImageUrls,
                'competitorImageUrls' => $competitorImageUrls,
                'brandPostsAreProxy'  => $brandPostsAreProxy,
            ], $geminiApiKey ?: null);
            agents_reconnect_mysqli_if_needed($conn);

            $newBrief = trim((string)($bvRes['brief'] ?? ''));
            if ($newBrief !== '') {
                $formData['brandVisualBrief']     = $newBrief;
                $formData['brandVisualBriefHash'] = 'instagram-profile'; // sentinel → generate-ads worker won't regenerate
                $formData['brandVisualStatus']    = 'ready';
                $formData['brandVisualStatusAt']  = gmdate('c');
                unset($formData['brandVisualError']);

                // pt-BR rendering for the client-facing WhatsApp deliverable. Kept SEPARATE from
                // brandVisualBrief on purpose: that one stays English because it feeds the image
                // model and the Gemini store. Empty when the edge's translation step failed —
                // callers fall back to the English brief rather than sending nothing.
                $newBriefPt = trim((string)($bvRes['brief_pt'] ?? ''));
                if ($newBriefPt !== '') $formData['brandVisualBriefPt'] = $newBriefPt;

                // Merge extracted hex palette (only fills fields the caller hasn't set).
                // Never for proxy posts — that palette belongs to the reference, not this brand,
                // and the empty() guard below would make the wrong colour permanent.
                $palette = (is_array($bvRes['palette'] ?? null) && !$brandPostsAreProxy)
                    ? $bvRes['palette'] : [];
                foreach (['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor'] as $colorKey) {
                    $hex = trim((string)($palette[$colorKey] ?? ''));
                    if ($hex !== '' && preg_match('/^#[0-9a-fA-F]{3,8}$/', $hex) && empty($formData[$colorKey])) {
                        $formData[$colorKey] = $hex;
                    }
                }
                $briefOk = true;
            } else {
                $err = trim((string)($bvRes['gemini_error'] ?? '')) ?: (trim((string)($bvRes['reason'] ?? '')) ?: 'empty_response');
                $formData['brandVisualStatus'] = 'failed';
                $formData['brandVisualError']  = $err;
                error_log('[company-assets-worker] brand_visual empty brief for job ' . $jobId . ', reason=' . $err);
            }
        } catch (Throwable $e) {
            $err = substr($e->getMessage(), 0, 500);
            $formData['brandVisualStatus'] = 'failed';
            $formData['brandVisualError']  = $err;
            error_log('[company-assets-worker] brand_visual failed for job ' . $jobId . ': ' . $e->getMessage());
        }

        // ── Persist brief/status onto the company ─────────────────────────────
        agents_reconnect_mysqli_if_needed($conn);
        $fj = json_encode($formData, JSON_UNESCAPED_UNICODE);
        if ($fj && ($u = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?"))) {
            $u->bind_param('si', $fj, $companyId); $u->execute(); $u->close();
        }

        // ── Re-sync the Gemini company store (best effort) ────────────────────
        // Use the server's paid PRODUCTION key for the store (embeddings), falling back to the
        // caller key — matches the inline path and avoids free-tier limits on the store sync.
        try {
            $passKey = agents_env_value('GEMINI_API_KEY_PRODUCTION')
                ?: (agents_env_value('GEMINI_API_KEY_TESTING') ?: ($geminiApiKey ?: null));
            agents_reconnect_mysqli_if_needed($conn);
            agents_sync_company_store($conn, $companyId, $formData, $accountType, $userId, ($storeName ?: null), $passKey);
        } catch (Throwable $se) {
            error_log('[company-assets-worker] store sync failed for job ' . $jobId . ': ' . $se->getMessage());
        }

        // ── Finalize the job row (drop the stored key for hygiene) ────────────
        agents_reconnect_mysqli_if_needed($conn);
        $finalStatus = $briefOk ? 'completed' : 'failed';
        if ($uj = $conn->prepare("UPDATE company_asset_jobs SET status = ?, error = ?, gemini_api_key = NULL WHERE id = ?")) {
            $uj->bind_param('ssi', $finalStatus, $err, $jobId); $uj->execute(); $uj->close();
        }
    }
}
