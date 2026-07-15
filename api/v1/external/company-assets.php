<?php
/**
 * External API — add/replace COMPANY assets & info (reference images + logo + brand fields).
 *
 * POST {
 *   api_key | Authorization: Bearer,
 *   phone,
 *   company?,
 *   logo_url?,
 *   font_family?,              — font family name to use in ads (e.g. "Poppins", "Montserrat") — Google Fonts URL built automatically
 *   reference_images?[],      — generic reference images (legacy)
 *   brand_posts?[],           — Instagram posts from the brand's own profile (up to 12)
 *   competitor_posts?[],      — Instagram posts from a competitor's profile (up to 8)
 *   gemini_api_key?,          — required when brand_posts or competitor_posts are provided
 * }
 *
 * - Finds/creates the company (project_type='project') by (user_id, phone).
 * - Mirrors all images to the company's assets folder (URLs OR data: URIs → hosted files).
 *   Anti-base64: NO base64 is ever stored or forwarded to Gemini.
 * - brand_posts are analyzed by Gemini (brand_visual mode) → produces a rich 300-400 word
 *   visual identity brief stored as brandVisualBrief in company_form_data. This brief drives
 *   every future compose generation, giving the image model the brand's real aesthetic DNA
 *   (motifs, depth treatment, color system, design devices) from the Instagram profile.
 * - competitor_posts are analyzed for LAYOUT PATTERNS ONLY — competitor brand identity never
 *   bleeds into the brand's ads.
 * - brandVisualBrief accumulates across calls (new posts merged with existing).
 * - Re-syncs the company Gemini File Search store once per call (cost-aware).
 */
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

set_time_limit(180);
ini_set('memory_limit', '256M');

include __DIR__ . '/../../db.php';
include __DIR__ . '/../agents/helpers.php';
include __DIR__ . '/../../site_helpers.php';
include __DIR__ . '/company-assets-brief.php';

const CAA_MAX_IMAGES        = 12;   // per request (reference_images)
const CAA_MAX_BRAND_POSTS   = 12;   // brand_posts per request
const CAA_MAX_COMP_POSTS    = 8;    // competitor_posts per request
const CAA_MAX_BYTES         = 8000000; // 8 MB per image (decoded)
const CAA_MAX_STORED        = 24;   // cap referenceImages kept on the company
const CAA_MAX_BRAND_STORED  = 20;   // cap brandPostImages accumulated on the company
const CAA_MAX_COMP_STORED   = 12;   // cap competitorPostImages accumulated on the company
// Curl budget for edge calls made while the HTTP request is still live. set_time_limit(180) above
// is NOT the real ceiling — the front-end proxy cuts at ~120s and hands the caller a 500/503, so a
// blocking upstream call must fail (and be reported as a warning) well before that.
const CAA_WEB_EDGE_TIMEOUT  = 60;   // seconds
// How long brandVisualStatus='processing' is believed before it is treated as a dead worker.
// The brief takes 1-3 min; past this the worker is gone and the caller must stop polling.
const CAA_PROCESSING_TTL    = 600;  // seconds (10 min)
// No custom request rate limit: the only upstream cost here is the Gemini store sync, which
// already handles Gemini's own 429/rate-limit gracefully (kept as a warning, never fatal).

function caa_fail(int $code, string $msg, string $errCode = ''): void {
    http_response_code($code);
    echo json_encode(array_filter(['success' => false, 'error' => $msg, 'code' => $errCode]), JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
$hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if ($hdr === '' && function_exists('getallheaders')) { $h = getallheaders(); $hdr = $h['Authorization'] ?? $h['authorization'] ?? ''; }
$apiKey = '';
if (preg_match('/Bearer\s+(.+)/i', (string)$hdr, $m)) $apiKey = trim($m[1]);

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) caa_fail(400, 'Invalid JSON body.');
if ($apiKey === '') $apiKey = trim((string)($body['api_key'] ?? ''));
if ($apiKey === '') caa_fail(401, 'Missing API key.', 'auth');

$authStmt = $conn->prepare("SELECT k.user_id, u.account_type FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.api_key = ? AND k.is_active = 1 LIMIT 1");
$authStmt->bind_param('s', $apiKey);
$authStmt->execute();
$authStmt->bind_result($userId, $accountType);
if (!$authStmt->fetch()) { $authStmt->close(); caa_fail(401, 'Invalid or inactive API key.', 'auth'); }
$authStmt->close();
$userId = (int)$userId;
$accountType = ($accountType === 'admin') ? 'admin' : 'testing';
if ($uu = $conn->prepare("UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = NOW() WHERE api_key = ?")) {
    $uu->bind_param('s', $apiKey); $uu->execute(); $uu->close();
}

// ── Validate input ───────────────────────────────────────────────────────────
$phone = trim((string)($body['phone'] ?? ''));
if ($phone === '') caa_fail(400, 'phone is required (company identifier).', 'missing_phone');

$company = is_array($body['company'] ?? null) ? $body['company'] : [];
$refInputs = [];
if (is_array($body['reference_images'] ?? null)) $refInputs = $body['reference_images'];
$logoInput    = trim((string)($body['logo_url'] ?? ($company['logo_url'] ?? ($company['logo'] ?? ''))));
$fontFamilyInput = trim((string)($body['font_family'] ?? ($company['font_family'] ?? '')));

// Instagram post images — processed separately from generic reference_images.
// brand_posts: scraped from the brand's OWN Instagram profile. Gemini analyzes them
//   and produces a rich 300-400 word visual identity brief (brandVisualBrief) stored in
//   company_form_data. This brief drives every future compose generation.
// competitor_posts: scraped from a COMPETITOR's Instagram profile. Analyzed for layout
//   and composition patterns only — brand identity is never extracted from competitor content.
$brandPostInputs = is_array($body['brand_posts'] ?? null) ? array_values($body['brand_posts']) : [];
$compPostInputs  = is_array($body['competitor_posts'] ?? null) ? array_values($body['competitor_posts']) : [];
$geminiApiKey    = trim((string)($body['gemini_api_key'] ?? ''));

// Legacy text description fields (kept for backwards-compat; image-based analysis is preferred).
$brandVisualGuidelines = trim((string)($body['brand_visual_guidelines'] ?? ($company['brand_visual_guidelines'] ?? '')));
$competitorExamples    = trim((string)($body['competitor_examples']     ?? ($company['competitor_examples']     ?? '')));

if (count($refInputs) > CAA_MAX_IMAGES)
    caa_fail(400, 'Too many reference_images (max ' . CAA_MAX_IMAGES . ' per call).', 'too_many');
if (count($brandPostInputs) > CAA_MAX_BRAND_POSTS)
    caa_fail(400, 'Too many brand_posts (max ' . CAA_MAX_BRAND_POSTS . ' per call).', 'too_many_brand');
if (count($compPostInputs) > CAA_MAX_COMP_POSTS)
    caa_fail(400, 'Too many competitor_posts (max ' . CAA_MAX_COMP_POSTS . ' per call).', 'too_many_comp');
if ((!empty($brandPostInputs) || !empty($compPostInputs)) && $geminiApiKey === '')
    caa_fail(400, 'gemini_api_key is required when brand_posts or competitor_posts are provided.', 'missing_gemini_key');

try {
    // ── Find/create company (project_type='project') by (user_id, phone) ──────
    $compStmt = $conn->prepare(
        "SELECT id, gemini_store_name, company_form_data, folder_path, public_url
         FROM projects WHERE user_id = ? AND phone = ? AND project_type = 'project' LIMIT 1"
    );
    $compStmt->bind_param('is', $userId, $phone);
    $compStmt->execute();
    $compStmt->bind_result($companyId, $storeName, $formDataJson, $folderPath, $publicUrl);
    $found = $compStmt->fetch();
    $compStmt->close();

    $formData = $found ? (json_decode((string)$formDataJson, true) ?: []) : [];
    if (!is_array($formData)) $formData = [];

    if (!$found) {
        $companyName = trim((string)($company['name'] ?? 'Company')) ?: 'Company';
        $ctx = trim((string)($company['description'] ?? ''));
        $ins = $conn->prepare("INSERT INTO projects (user_id, name, project_type, phone, company_form_data, context) VALUES (?, ?, 'project', ?, ?, ?)");
        $emptyJson = '{}';
        $ins->bind_param('issss', $userId, $companyName, $phone, $emptyJson, $ctx);
        $ins->execute();
        $companyId = (int)$conn->insert_id;
        $ins->close();
        $storeName = '';
        $folderPath = ''; $publicUrl = '';
    }
    $companyId = (int)$companyId;

    // ── Merge incoming brand fields (only non-empty) ──────────────────────────
    $fieldMap = [
        'name' => 'businessName', 'industry' => 'businessCategory', 'description' => 'businessDescription',
        'language' => 'language', 'tone_of_voice' => 'toneOfVoice', 'brand_personality' => 'brandPersonality',
        'brand_keywords' => 'brandKeywords', 'forbidden_words' => 'forbiddenWords', 'target_audience' => 'targetAudience',
        'value_proposition' => 'valueProposition', 'primary_color' => 'primaryColor', 'secondary_color' => 'secondaryColor',
        'accent_color' => 'accentColor', 'background_color' => 'backgroundColor', 'text_color' => 'textColor',
        'heading_font' => 'headingFont', 'body_font' => 'bodyFont', 'website' => 'sourceWebsite',
    ];
    foreach ($fieldMap as $in => $out) {
        $v = trim((string)($company[$in] ?? ''));
        if ($v !== '') $formData[$out] = $v;
    }
    if (!is_array($formData['images'] ?? null)) $formData['images'] = [];

    // Brand visual guidelines from Instagram scraping — always overwrite (caller owns this).
    if ($brandVisualGuidelines !== '') $formData['brandVisualGuidelines']    = $brandVisualGuidelines;
    if ($competitorExamples    !== '') $formData['competitorLayoutExamples'] = $competitorExamples;

    // ── Company folder on disk ────────────────────────────────────────────────
    $companyRelPath = extract_project_relative_path_from_folder_path((string)$folderPath);
    if ($companyRelPath === '') $companyRelPath = extract_project_relative_path_from_public_url((string)$publicUrl);
    if ($companyRelPath === '') {
        $companyRelPath = ensure_unique_slug(sanitize_slug((string)($company['name'] ?? ('company-' . $companyId))), resolve_sites_base_path());
        $newFolder = project_folder_path_from_relative($companyRelPath);
        $newPublic = project_public_url_from_relative($companyRelPath);
        if ($u = $conn->prepare("UPDATE projects SET folder_path = ?, public_url = ? WHERE id = ?")) {
            $u->bind_param('ssi', $newFolder, $newPublic, $companyId); $u->execute(); $u->close();
        }
    }
    $companyDir = project_directory_from_relative($companyRelPath);
    $assetsDir  = $companyDir . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsDir);
    $publicBase = rtrim(preg_replace('/\/index\.html$/i', '/', project_public_url_from_relative($companyRelPath)), '/') . '/';

    // ── Store ONE image (URL or data: URI) to the company assets → hosted URL ─
    // Anti-base64: data: URIs are decoded to a real file; NOTHING base64 is persisted.
    $storeImage = function ($input, string $slot, int $idx) use ($assetsDir, $publicBase): ?array {
        $input = trim((string)$input);
        if ($input === '') return null;
        $bytes = ''; $ctHint = null;
        if (preg_match('~^data:([^;,]+)?;base64,(.+)$~is', $input, $mm)) {
            $ctHint = $mm[1] ?? null;
            $bytes = base64_decode(preg_replace('/\s+/', '', $mm[2]), true) ?: '';
        } elseif (preg_match('~^https?://~i', $input)) {
            $norm = normalize_asset_url($input);
            if ($norm === '' || !is_supported_asset_url($norm)) return ['skip' => $input, 'reason' => 'unsupported url'];
            $d = download_remote_asset($norm);
            if ($d === null || !isset($d['body'])) return ['skip' => $input, 'reason' => 'download blocked'];
            $bytes = (string)$d['body']; $ctHint = $d['content_type'] ?? null;
        } else {
            return ['skip' => $input, 'reason' => 'not a url or data uri'];
        }
        if ($bytes === '' || strlen($bytes) > CAA_MAX_BYTES) return ['skip' => $input, 'reason' => 'empty or > ' . CAA_MAX_BYTES . ' bytes'];
        $type = detect_asset_content_type($bytes, $ctHint);
        if (!is_safe_asset_content_type($type)) return ['skip' => $input, 'reason' => 'not a supported image'];
        $ext = extract_extension_from_url('x', $type);
        if ($ext === 'bin' || $ext === '') return ['skip' => $input, 'reason' => 'unknown image type'];
        // Idempotent storage: if a same-slot file with identical content already exists, reuse it
        // instead of spawning a new numbered file. Re-sending the same logo every call used to bump
        // the stored URL to logo-2/logo-3/… — and a number whose file later went missing rendered
        // as a broken image. Dedup by content hash keeps the URL stable on the first written file.
        $wantHash = md5($bytes);
        foreach ((@glob($assetsDir . DIRECTORY_SEPARATOR . $slot . '-*.*') ?: []) as $existing) {
            if (@md5_file($existing) === $wantHash) {
                return ['url' => $publicBase . 'assets/' . rawurlencode(basename($existing))];
            }
        }
        $name = $slot . '-' . $idx . '.' . $ext;
        $i = $idx;
        while (file_exists($assetsDir . DIRECTORY_SEPARATOR . $name)) { $i++; $name = $slot . '-' . $i . '.' . $ext; }
        if (@file_put_contents($assetsDir . DIRECTORY_SEPARATOR . $name, $bytes) === false) return ['skip' => $input, 'reason' => 'write failed'];
        return ['url' => $publicBase . 'assets/' . rawurlencode($name)];
    };

    $skipped = [];

    // ── Logo (main logo on the company) ───────────────────────────────────────
    $logoUrl = '';
    if ($logoInput !== '') {
        $r = $storeImage($logoInput, 'logo', 1);
        if (isset($r['url'])) {
            $logoUrl = $r['url'];
            $formData['logoUrl'] = $logoUrl;
            $formData['images']['logo'] = $logoUrl;
        } elseif (isset($r['skip'])) {
            $skipped[] = ['type' => 'logo', 'reason' => $r['reason']];
        }
    }

    // ── Font family (optional) ────────────────────────────────────────────────
    if ($fontFamilyInput !== '') {
        $formData['headingFont'] = $fontFamilyInput;
    }

    // ── Reference images (legacy / generic) ──────────────────────────────────
    $newRefs = [];
    $n = 1;
    foreach ($refInputs as $ref) {
        $r = $storeImage($ref, 'ref', $n++);
        if (isset($r['url'])) $newRefs[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'reference', 'reason' => $r['reason']];
    }

    $existingRefs = is_array($formData['referenceImages'] ?? null) ? $formData['referenceImages'] : [];
    $allRefs = array_values(array_unique(array_filter(array_merge($existingRefs, $newRefs), 'strlen')));
    if (count($allRefs) > CAA_MAX_STORED) $allRefs = array_slice($allRefs, -CAA_MAX_STORED);
    if (!empty($allRefs)) {
        $formData['referenceImages'] = $allRefs;
        $existingProd = is_array($formData['images']['productImages'] ?? null) ? $formData['images']['productImages'] : [];
        $formData['images']['productImages'] = array_values(array_unique(array_filter(array_merge($existingProd, $newRefs), 'strlen')));
    }

    // ── Brand Instagram posts ─────────────────────────────────────────────────
    // Mirror brand post images to the company assets folder, accumulate with existing,
    // then call brand_visual to generate (or update) the visual identity brief.
    $newBrandUrls = [];
    $nb = 1;
    foreach ($brandPostInputs as $bp) {
        $r = $storeImage($bp, 'brand-post', $nb++);
        if (isset($r['url'])) $newBrandUrls[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'brand_post', 'reason' => $r['reason']];
    }

    $existingBrandPosts = is_array($formData['brandPostImages'] ?? null) ? $formData['brandPostImages'] : [];
    $allBrandPosts = array_values(array_unique(array_filter(array_merge($existingBrandPosts, $newBrandUrls), 'strlen')));
    if (count($allBrandPosts) > CAA_MAX_BRAND_STORED) $allBrandPosts = array_slice($allBrandPosts, -CAA_MAX_BRAND_STORED);
    if (!empty($allBrandPosts)) $formData['brandPostImages'] = $allBrandPosts;

    // ── Competitor Instagram posts ────────────────────────────────────────────
    $newCompUrls = [];
    $nc = 1;
    foreach ($compPostInputs as $cp) {
        $r = $storeImage($cp, 'comp-post', $nc++);
        if (isset($r['url'])) $newCompUrls[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'competitor_post', 'reason' => $r['reason']];
    }

    $existingCompPosts = is_array($formData['competitorPostImages'] ?? null) ? $formData['competitorPostImages'] : [];
    $allCompPosts = array_values(array_unique(array_filter(array_merge($existingCompPosts, $newCompUrls), 'strlen')));
    if (count($allCompPosts) > CAA_MAX_COMP_STORED) $allCompPosts = array_slice($allCompPosts, -CAA_MAX_COMP_STORED);
    if (!empty($allCompPosts)) $formData['competitorPostImages'] = $allCompPosts;

    // ── Persist company_form_data ─────────────────────────────────────────────
    $formJson = json_encode($formData, JSON_UNESCAPED_UNICODE);
    if ($u = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?")) {
        $u->bind_param('si', $formJson, $companyId); $u->execute(); $u->close();
    }

    // Absolute-URL helper — the edge function only accepts http(s) URLs, so mirrored
    // root-relative /projects/... assets are absolutized before being sent (or enqueued).
    $absBase = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http')
        . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    $toAbsolute = function (array $urls) use ($absBase): array {
        return array_values(array_filter(array_map(function ($u) use ($absBase) {
            $u = trim((string)$u);
            if ($u === '') return '';
            if (preg_match('~^https?://~i', $u)) return $u;
            return $absBase !== '' ? $absBase . $u : $u;
        }, $urls), 'strlen'));
    };

    // Did THIS request carry any new content? A bare poll ({api_key, phone}) carries none — in
    // that case we skip the (upstream, cost-bearing) Gemini store re-sync entirely so the n8n
    // polling loop stays cheap and instant.
    $brandFieldsProvided = false;
    foreach ($fieldMap as $in => $out) {
        if (trim((string)($company[$in] ?? '')) !== '') { $brandFieldsProvided = true; break; }
    }
    $hasNewContent = $logoInput !== '' || $fontFamilyInput !== ''
        || !empty($refInputs) || !empty($brandPostInputs) || !empty($compPostInputs)
        || $brandVisualGuidelines !== '' || $competitorExamples !== '' || $brandFieldsProvided;

    // ── Brand visual brief — ASYNC by default ────────────────────────────────
    // Generating the brief means Gemini vision over up to ~16 Instagram images, which can take
    // 1–3 min. Doing it inline blocks the caller (n8n) long enough to trip its ~180s execution
    // ceiling (exactly the onboarding timeout we hit). So when brand_posts + a Gemini key are
    // present we hand the heavy work to a detached background worker and return immediately with
    // brand_visual_status:"processing". The caller then polls the cheap re-read ({api_key, phone})
    // until brand_visual_status becomes "generated"/"cached" (done) or "failed".
    //
    // Escape hatch: body.sync:true forces the old inline behaviour (handy for debugging/tests).
    $wantBrief      = (!empty($allBrandPosts) && $geminiApiKey !== '');
    $forceSyncBrief = !empty($body['sync']);

    if ($wantBrief && !$forceSyncBrief) {
        caa_ensure_job_table($conn);

        // Mark the brief in-flight so a concurrent poll returns "processing".
        $formData['brandVisualStatus']   = 'processing';
        $formData['brandVisualStatusAt'] = gmdate('c');
        unset($formData['brandVisualError']);
        $fjP = json_encode($formData, JSON_UNESCAPED_UNICODE);
        if ($fjP && ($up = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?"))) {
            $up->bind_param('si', $fjP, $companyId); $up->execute(); $up->close();
        }

        // Persist everything the worker needs: absolute image URLs + the caller's Gemini key.
        $jobPayload = json_encode([
            'brandImageUrls'      => $toAbsolute(array_slice($allBrandPosts, -10)),
            'competitorImageUrls' => $toAbsolute(array_slice($allCompPosts, -6)),
        ], JSON_UNESCAPED_UNICODE);

        $jobId = 0;
        if ($ij = $conn->prepare(
            "INSERT INTO company_asset_jobs (user_id, company_project_id, account_type, gemini_api_key, payload_json, status)
             VALUES (?, ?, ?, ?, ?, 'processing')"
        )) {
            $ij->bind_param('iisss', $userId, $companyId, $accountType, $geminiApiKey, $jobPayload);
            $ij->execute();
            $jobId = (int)$conn->insert_id;
            $ij->close();
        }

        if ($jobId > 0) {
            $resp = json_encode([
                'success'                  => true,
                'company_id'               => $companyId,
                'job_id'                   => $jobId,
                'store_name'               => (string)$storeName,
                'logo_url'                 => $logoUrl ?: ($formData['logoUrl'] ?? ''),
                'font_family'              => $formData['headingFont'] ?? '',
                'reference_images'         => $allRefs,
                'reference_count'          => count($allRefs),
                'added'                    => count($newRefs),
                'brand_posts_stored'       => count($allBrandPosts),
                'brand_posts_added'        => count($newBrandUrls),
                'competitor_posts_stored'  => count($allCompPosts),
                'competitor_posts_added'   => count($newCompUrls),
                'brand_visual_status'      => 'processing',
                'brand_visual_brief'       => $formData['brandVisualBrief'] ?? null,
                'brand_visual_brief_pt'    => $formData['brandVisualBriefPt'] ?? ($formData['brandVisualBrief'] ?? null),
                'brief_empty_reason'       => null,
                'brief_warning'            => null,
                'store_warning'            => null,
                'skipped'                  => $skipped,
                // How to collect the result: poll this same endpoint with just {api_key, phone}
                // until brand_visual_status is "generated"/"cached" (done) or "failed".
                'poll' => [
                    'method' => 'POST',
                    'url'    => rtrim($absBase, '/') . '/api/v1/external/company-assets.php',
                    'body'   => ['api_key' => '<api_key>', 'phone' => $phone],
                    'until'  => ['generated', 'cached', 'failed'],
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            http_response_code(202);
            header('Content-Type: application/json');
            header('Content-Length: ' . strlen($resp));
            echo $resp;

            // Detach and run the heavy brief job out-of-band (same pattern as generate-ads.php).
            @ignore_user_abort(true);
            @set_time_limit(0);
            if (function_exists('fastcgi_finish_request')) {
                fastcgi_finish_request();     // PHP-FPM: flush the 202, keep running inline.
                caa_run_brief_job($conn, $jobId);
                exit;
            }
            while (ob_get_level() > 0) { @ob_end_flush(); }
            @flush();
            // LiteSpeed: exec a detached CLI worker. If the spawn is impossible (exec disabled, no
            // CLI php), run the job inline anyway — the 202 is already on the wire and the caller
            // polls for the result, so a held-open connection is a far better failure than a job
            // that silently never runs and a company parked on 'processing' forever.
            if (!caa_spawn_worker($jobId)) {
                error_log('[company-assets] worker spawn failed for job ' . $jobId . ' — running brief inline');
                caa_run_brief_job($conn, $jobId);
            }
            exit;
        }
        // Enqueue failed → fall through to inline generation rather than losing the brief.
        error_log('[company-assets] job insert failed, falling back to inline brief');
    }

    // ── SYNC path (inline brief when forced / enqueue failed; else cache + store sync) ─
    $brandBriefResult = null;
    $briefWarning     = null;
    $briefEdgeCalled  = false; // true when the edge was invoked (even if brief came back empty)
    $briefEmptyReason = null;  // reason code returned by edge when brief is empty
    if ($wantBrief) {
        try {
            // Send up to 10 brand posts + up to 6 competitor posts to the edge function.
            $briefPayload = [
                'mode'                => 'brand_visual',
                'geminiApiKey'        => $geminiApiKey,
                'brandImageUrls'      => $toAbsolute(array_slice($allBrandPosts, -10)),
                'competitorImageUrls' => $toAbsolute(array_slice($allCompPosts, -6)),
            ];
            $bvRes = agents_call_edge_function('agents-ads', $briefPayload, $geminiApiKey);
            $briefEdgeCalled = true;
            $newBrief = trim((string)($bvRes['brief'] ?? ''));
            if ($newBrief !== '') {
                $formData['brandVisualBrief']     = $newBrief;
                $formData['brandVisualBriefHash'] = 'instagram-profile'; // sentinel → worker won't regenerate
                $formData['brandVisualStatus']    = 'ready';

                // pt-BR rendering for the client (WhatsApp). brandVisualBrief stays English —
                // it feeds the image model and the Gemini store. See company-assets-brief.php.
                $newBriefPt = trim((string)($bvRes['brief_pt'] ?? ''));
                if ($newBriefPt !== '') $formData['brandVisualBriefPt'] = $newBriefPt;

                // Merge extracted hex palette into brand fields (only non-empty values).
                // Only fills fields the caller hasn't already set — existing explicit values win.
                $palette = is_array($bvRes['palette'] ?? null) ? $bvRes['palette'] : [];
                foreach (['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor'] as $colorKey) {
                    $hex = trim((string)($palette[$colorKey] ?? ''));
                    if ($hex !== '' && preg_match('/^#[0-9a-fA-F]{3,8}$/', $hex) && empty($formData[$colorKey])) {
                        $formData[$colorKey] = $hex;
                    }
                }

                $fj2 = json_encode($formData, JSON_UNESCAPED_UNICODE);
                if ($fj2 && ($ub2 = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?"))) {
                    $ub2->bind_param('si', $fj2, $companyId); $ub2->execute(); $ub2->close();
                }
                $brandBriefResult = $newBrief;
            } else {
                $briefEmptyReason = trim((string)($bvRes['reason'] ?? '')) ?: 'empty_response';
                $briefWarning     = trim((string)($bvRes['gemini_error'] ?? '')) ?: null;
                error_log('[company-assets] brand_visual returned empty brief, reason=' . $briefEmptyReason . ($briefWarning ? ', gemini_error=' . $briefWarning : ''));
            }
        } catch (Throwable $bvErr) {
            $briefEdgeCalled = true;
            $briefWarning = $bvErr->getMessage();
            error_log('[company-assets] brand_visual failed (non-fatal): ' . $bvErr->getMessage());
        }
    }

    // ── Re-sync the Gemini company store — NEVER on a bare poll ──────────────
    // A bare poll ({api_key, phone}) carries no new content, so there is nothing to sync and it
    // must stay a pure read: the n8n loop polls this up to 10x and any upstream call here is
    // charged 10x in both latency and cost.
    //
    // This used to also run whenever $storeName was empty ("heal the missing store"), which was
    // the exact opposite of a heal: if the store could not be created (e.g. the stored name
    // belongs to a rotated-out Gemini project, so get_or_create has to build one from scratch and
    // is slow), the sync throws, $storeName stays empty — and every subsequent poll retries the
    // same slow call. Each retry burned ~120s until the proxy cut it, turning a missing store into
    // a hung endpoint and starving the brief the caller was polling for. The store is created by
    // the brief worker and by any content-bearing call; a poll has no business touching it.
    $storeWarning = null;
    if ($hasNewContent) {
        $passKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING') ?: null;
        try {
            $storeName = agents_sync_company_store(
                $conn, $companyId, $formData, $accountType, $userId, ($storeName ?: null), $passKey,
                CAA_WEB_EDGE_TIMEOUT
            );
        } catch (Throwable $se) {
            $storeWarning = $se->getMessage();
            error_log('[company-assets] store sync failed: ' . $se->getMessage());
        }
    }

    // Surface the async job lifecycle (processing/ready/failed) stored on the company.
    // 'processing' EXPIRES: it is written when the job is enqueued, but nothing guarantees the
    // worker ever ran (exec can be disabled, the CLI php can be missing, the process can die), and
    // a status nobody ever clears pins the caller in a poll loop against a job that no longer
    // exists. brandVisualStatusAt is the enqueue timestamp — past the TTL we call it what it is.
    $bvStatusStored = (string)($formData['brandVisualStatus'] ?? '');
    if ($bvStatusStored === 'processing') {
        $startedAt = strtotime((string)($formData['brandVisualStatusAt'] ?? '')) ?: 0;
        if ($startedAt > 0 && (time() - $startedAt) > CAA_PROCESSING_TTL) {
            $bvStatusStored = 'failed';
            $formData['brandVisualStatus'] = 'failed';
            $formData['brandVisualError']  = 'brief worker did not finish within ' . CAA_PROCESSING_TTL . 's (worker never started or died)';
            $fjS = json_encode($formData, JSON_UNESCAPED_UNICODE);
            if ($fjS && ($us = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?"))) {
                $us->bind_param('si', $fjS, $companyId); $us->execute(); $us->close();
            }
            if ($uj = $conn->prepare(
                "UPDATE company_asset_jobs SET status = 'failed', error = 'stale: no worker result', gemini_api_key = NULL
                 WHERE company_project_id = ? AND status = 'processing'"
            )) {
                $uj->bind_param('i', $companyId); $uj->execute(); $uj->close();
            }
            error_log('[company-assets] stale processing brief for company ' . $companyId . ' → marked failed');
        }
    }
    if ($briefWarning === null && $bvStatusStored === 'failed') {
        $briefWarning = trim((string)($formData['brandVisualError'] ?? '')) ?: null;
    }

    echo json_encode([
        'success'                  => true,
        'company_id'               => $companyId,
        'store_name'               => (string)$storeName,
        'logo_url'                 => $logoUrl ?: ($formData['logoUrl'] ?? ''),
        'font_family'              => $formData['headingFont'] ?? '',
        'reference_images'         => $allRefs,
        'reference_count'          => count($allRefs),
        'added'                    => count($newRefs),
        'brand_posts_stored'       => count($allBrandPosts),
        'brand_posts_added'        => count($newBrandUrls),
        'competitor_posts_stored'  => count($allCompPosts),
        'competitor_posts_added'   => count($newCompUrls),
        'brand_visual_brief'       => $brandBriefResult !== null
                                        ? $brandBriefResult
                                        : ($formData['brandVisualBrief'] ?? null),
        // Client-facing pt-BR rendering (what n8n sends over WhatsApp). Falls back to the English
        // brief so the caller always has something to send rather than an empty message.
        'brand_visual_brief_pt'    => trim((string)($formData['brandVisualBriefPt'] ?? '')) !== ''
                                        ? $formData['brandVisualBriefPt']
                                        : ($brandBriefResult !== null
                                            ? $brandBriefResult
                                            : ($formData['brandVisualBrief'] ?? null)),
        // 'cached' keys off a brief that is actually THERE, not merely set: the worker writes
        // status 'ready' (never 'processing'/'cached'), so a stored-'ready' company lands here and
        // an isset() check would have reported 'cached' for an empty-string brief.
        'brand_visual_status'      => $brandBriefResult !== null
                                        ? 'generated'
                                        : ($bvStatusStored === 'processing'
                                            ? 'processing'
                                            : ($briefWarning !== null
                                                ? 'failed'
                                                : ($briefEdgeCalled
                                                    ? 'empty_response'  // edge called but brief came back empty
                                                    : (trim((string)($formData['brandVisualBrief'] ?? '')) !== ''
                                                        ? 'cached'
                                                        : 'not_requested')))),
        'brief_empty_reason'       => $briefEmptyReason,
        'skipped'                  => $skipped,
        'brief_warning'            => $briefWarning,
        'store_warning'            => $storeWarning,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    error_log('[company-assets] ' . $e->getMessage());
    caa_fail(500, $e->getMessage());
}
