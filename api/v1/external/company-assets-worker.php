<?php
/**
 * Background worker — generates the brand-visual brief out-of-band.
 * Called via exec() from company-assets.php on hosts without fastcgi_finish_request()
 * (LiteSpeed / this host).  Usage: php company-assets-worker.php <job_id>
 *
 * Reads a company_asset_jobs row and runs the slow Gemini-vision brief + store sync.
 */

$jobId = (int)($argv[1] ?? 0);
if ($jobId <= 0) {
    error_log('[company-assets-worker] No job_id provided');
    exit(1);
}

set_time_limit(0);
ignore_user_abort(true);

include __DIR__ . '/../../db.php';
include __DIR__ . '/../agents/helpers.php';
include __DIR__ . '/../../site_helpers.php';
include __DIR__ . '/company-assets-brief.php';

try {
    caa_run_brief_job($conn, $jobId);
} catch (Throwable $e) {
    error_log('[company-assets-worker] Job ' . $jobId . ': ' . $e->getMessage());
    try {
        if (isset($conn) && $conn instanceof mysqli) {
            agents_reconnect_mysqli_if_needed($conn);
            $errMsg = substr($e->getMessage(), 0, 500);
            if ($uj = $conn->prepare("UPDATE company_asset_jobs SET status = 'failed', error = ? WHERE id = ?")) {
                $uj->bind_param('si', $errMsg, $jobId); $uj->execute(); $uj->close();
            }
        }
    } catch (Throwable $inner) {
        error_log('[company-assets-worker] failed to mark job failed: ' . $inner->getMessage());
    }
    exit(1);
}
