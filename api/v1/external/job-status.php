<?php
/**
 * External API — Job Status
 *
 * Returns the status of an ad generation job plus the creatives once complete.
 *
 * Auth: Authorization: Bearer cf_xxx  OR  ?api_key=cf_xxx
 */

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(15);
ini_set('memory_limit', '64M');

include __DIR__ . '/../../db.php';

// ── Auth ───────────────────────────────────────────────────────────────────

function extjs_resolve_api_key(): string {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $headerAuth = '';
    if (is_array($headers)) {
        foreach ($headers as $name => $value) {
            if (strtolower((string)$name) === 'authorization') {
                $headerAuth = (string)$value;
                break;
            }
        }
    }
    $authHeader = trim(
        $_SERVER['HTTP_AUTHORIZATION'] ??
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ??
        $headerAuth
    );
    if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        return trim($m[1]);
    }
    return trim((string)($_GET['api_key'] ?? $_POST['api_key'] ?? ''));
}

function extjs_auth(mysqli $conn, string $apiKey): ?int {
    if ($apiKey === '') return null;
    $stmt = $conn->prepare(
        "SELECT user_id FROM api_keys WHERE api_key = ? AND is_active = 1 LIMIT 1"
    );
    if (!$stmt) return null;
    $stmt->bind_param('s', $apiKey);
    $stmt->execute();
    $stmt->bind_result($userId);
    $found = $stmt->fetch();
    $stmt->close();
    return ($found && $userId) ? (int)$userId : null;
}

function extjs_absolute_public_url(?string $path): ?string {
    $path = trim((string)$path);
    if ($path === '') return null;
    if (preg_match('~^https?://~i', $path)) return $path;
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host === '') return $path;
    return $scheme . '://' . $host . '/' . ltrim($path, '/');
}

function extjs_public_file_exists(?string $path): bool {
    $path = trim((string)$path);
    if ($path === '') return false;
    $relative = parse_url($path, PHP_URL_PATH) ?: $path;
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($root === '') return false;
    return is_file($root . '/' . ltrim($relative, '/'));
}

// ── Main ───────────────────────────────────────────────────────────────────

$apiKey = extjs_resolve_api_key();
$jobId  = (int)($_GET['job_id'] ?? $_POST['job_id'] ?? 0);

try {
    $userId = extjs_auth($conn, $apiKey);
    if (!$userId) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or inactive API key']);
        exit;
    }

    if ($jobId <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'job_id is required']);
        exit;
    }

    // Fetch job
    $jStmt = $conn->prepare(
        "SELECT id, company_project_id, campaign_id, project_id, status,
                total_batches, completed_batches, failed_batches, error, generate_as_image,
                created_at, updated_at
         FROM ad_generation_jobs
         WHERE id = ? AND user_id = ? LIMIT 1"
    );
    if (!$jStmt) throw new RuntimeException($conn->error);
    $jStmt->bind_param('ii', $jobId, $userId);
    $jStmt->execute();
    $jStmt->bind_result(
        $jId, $jCompanyId, $jCampaignId, $jProjectId, $jStatus,
        $jTotal, $jCompleted, $jFailed, $jError, $jGenerateAsImage, $jCreatedAt, $jUpdatedAt
    );
    if (!$jStmt->fetch()) {
        $jStmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Job not found']);
        exit;
    }
    $jStmt->close();

    // Fetch batches
    $bStmt = $conn->prepare(
        "SELECT batch_index, status, label, formats_json, error, attempts, saved_count
         FROM ad_generation_job_batches WHERE job_id = ? ORDER BY batch_index ASC"
    );
    if (!$bStmt) throw new RuntimeException($conn->error);
    $bStmt->bind_param('i', $jobId);
    $bStmt->execute();
    $bStmt->bind_result($bIdx, $bStatus, $bLabel, $bFmtsJson, $bErr, $bAttempts, $bSaved);
    $batchRows = [];
    while ($bStmt->fetch()) {
        $batchRows[] = [
            'batch_index' => (int)$bIdx,
            'status'      => $bStatus,
            'label'       => $bLabel,
            'formats'     => json_decode($bFmtsJson ?: '[]', true) ?: [],
            'error'       => $bErr,
            'attempts'    => (int)$bAttempts,
            'saved_count' => (int)$bSaved,
        ];
    }
    $bStmt->close();

    // Fetch creatives as soon as they exist. A job can finish partially when
    // some batches fail, and callers should still receive the saved creatives.
    $creatives = [];
    if ($jProjectId) {
        $cStmt = $conn->prepare(
            "SELECT id, platform, format, label, width, height, public_url
             FROM ads_creatives
             WHERE campaign_id = ?
             ORDER BY sort_order ASC"
        );
        if ($cStmt) {
            $cStmt->bind_param('i', $jCampaignId);
            $cStmt->execute();
            $cStmt->bind_result($cId, $cPlat, $cFmt, $cLabel, $cW, $cH, $cPublicUrl);
            while ($cStmt->fetch()) {
                $htmlUrl  = $cPublicUrl ?: null;
                $imageUrl = null;
                if ($htmlUrl) {
                    // Derive PNG path from HTML path
                    $pngUrl = preg_replace('/\/index\.html$/', '/banner.png', $htmlUrl);
                    if ($pngUrl !== $htmlUrl && extjs_public_file_exists($pngUrl)) $imageUrl = $pngUrl;
                }
                $creatives[] = [
                    'id'        => (int)$cId,
                    'platform'  => $cPlat,
                    'format'    => $cFmt,
                    'label'     => $cLabel,
                    'width'     => (int)$cW,
                    'height'    => (int)$cH,
                    'image_url' => extjs_absolute_public_url($imageUrl),
                    'html_url'  => extjs_absolute_public_url($htmlUrl),
                ];
            }
            $cStmt->close();
        }
    }

    echo json_encode([
        'job_id'         => (int)$jId,
        'status'         => $jStatus,
        'generation_type' => ((int)$jGenerateAsImage === 1 ? 'image' : 'html'),
        'company_id'     => (int)$jCompanyId,
        'campaign_id'    => (int)$jCampaignId,
        'total_batches'  => (int)$jTotal,
        'completed'      => (int)$jCompleted,
        'failed'         => (int)$jFailed,
        'error'          => $jError,
        'creatives'      => $creatives,
        'creative_count' => count($creatives),
        'batches'        => $batchRows,
        'created_at'     => $jCreatedAt,
        'updated_at'     => $jUpdatedAt,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[external/job-status] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
