<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(30);
ini_set('memory_limit', '128M');

include __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$jobId   = (int)($body['job_id']   ?? 0);
$userId  = (int)($body['user_id']  ?? 0);
$action  = (string)($body['action'] ?? '');

if ($jobId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'job_id and user_id are required']);
    exit;
}

// Verify ownership
$ownerStmt = $conn->prepare("SELECT id FROM ad_generation_jobs WHERE id = ? AND user_id = ? LIMIT 1");
if (!$ownerStmt) { http_response_code(500); echo json_encode(['error' => $conn->error]); exit; }
$ownerStmt->bind_param('ii', $jobId, $userId);
$ownerStmt->execute();
$ownerStmt->bind_result($foundId);
if (!$ownerStmt->fetch()) {
    $ownerStmt->close();
    http_response_code(404);
    echo json_encode(['error' => 'Job not found']);
    exit;
}
$ownerStmt->close();

try {
    switch ($action) {
        // ----------------------------------------------------------------
        // save_batch: mark a batch as completed, increment job counter
        // ----------------------------------------------------------------
        case 'save_batch': {
            $batchIndex = (int)($body['batch_index'] ?? -1);
            $savedCount = (int)($body['saved_count'] ?? 0);
            if ($batchIndex < 0) { http_response_code(400); echo json_encode(['error' => 'batch_index is required']); exit; }

            $conn->begin_transaction();

            $bStmt = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'completed', saved_count = ?, attempts = attempts + 1, updated_at = NOW()
                 WHERE job_id = ? AND batch_index = ?"
            );
            if (!$bStmt) throw new RuntimeException($conn->error);
            $bStmt->bind_param('iii', $savedCount, $jobId, $batchIndex);
            $bStmt->execute();
            $bStmt->close();

            $jStmt = $conn->prepare(
                "UPDATE ad_generation_jobs
                 SET completed_batches = completed_batches + 1, updated_at = NOW()
                 WHERE id = ?"
            );
            if (!$jStmt) throw new RuntimeException($conn->error);
            $jStmt->bind_param('i', $jobId);
            $jStmt->execute();
            $jStmt->close();

            $conn->commit();
            break;
        }

        // ----------------------------------------------------------------
        // fail_batch: mark a batch as failed, increment job counter
        // ----------------------------------------------------------------
        case 'fail_batch': {
            $batchIndex = (int)($body['batch_index'] ?? -1);
            $error      = mb_substr((string)($body['error'] ?? ''), 0, 500);
            if ($batchIndex < 0) { http_response_code(400); echo json_encode(['error' => 'batch_index is required']); exit; }

            $conn->begin_transaction();

            $bStmt = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'failed', error = ?, attempts = attempts + 1, updated_at = NOW()
                 WHERE job_id = ? AND batch_index = ?"
            );
            if (!$bStmt) throw new RuntimeException($conn->error);
            $bStmt->bind_param('sii', $error, $jobId, $batchIndex);
            $bStmt->execute();
            $bStmt->close();

            $jStmt = $conn->prepare(
                "UPDATE ad_generation_jobs
                 SET failed_batches = failed_batches + 1, updated_at = NOW()
                 WHERE id = ?"
            );
            if (!$jStmt) throw new RuntimeException($conn->error);
            $jStmt->bind_param('i', $jobId);
            $jStmt->execute();
            $jStmt->close();

            $conn->commit();
            break;
        }

        // ----------------------------------------------------------------
        // retry_batch: reset a failed batch back to queued
        // ----------------------------------------------------------------
        case 'retry_batch': {
            $batchIndex = (int)($body['batch_index'] ?? -1);
            if ($batchIndex < 0) { http_response_code(400); echo json_encode(['error' => 'batch_index is required']); exit; }

            $conn->begin_transaction();

            $bStmt = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'queued', error = NULL, updated_at = NOW()
                 WHERE job_id = ? AND batch_index = ? AND status = 'failed'"
            );
            if (!$bStmt) throw new RuntimeException($conn->error);
            $bStmt->bind_param('ii', $jobId, $batchIndex);
            $bStmt->execute();
            $affected = $conn->affected_rows;
            $bStmt->close();

            if ($affected > 0) {
                $jStmt = $conn->prepare(
                    "UPDATE ad_generation_jobs
                     SET status = 'running', failed_batches = GREATEST(0, failed_batches - 1), updated_at = NOW()
                     WHERE id = ?"
                );
                if (!$jStmt) throw new RuntimeException($conn->error);
                $jStmt->bind_param('i', $jobId);
                $jStmt->execute();
                $jStmt->close();
            }

            $conn->commit();
            break;
        }

        // ----------------------------------------------------------------
        // complete: mark job as completed (or failed if any batches failed)
        // ----------------------------------------------------------------
        case 'complete': {
            $statusRow = $conn->query(
                "SELECT total_batches, completed_batches, failed_batches FROM ad_generation_jobs WHERE id = {$jobId} LIMIT 1"
            );
            $row = $statusRow ? $statusRow->fetch_assoc() : null;
            $finalStatus = (!$row || (int)$row['failed_batches'] === 0) ? 'completed' : 'failed';

            $jStmt = $conn->prepare(
                "UPDATE ad_generation_jobs SET status = ?, updated_at = NOW() WHERE id = ?"
            );
            if (!$jStmt) throw new RuntimeException($conn->error);
            $jStmt->bind_param('si', $finalStatus, $jobId);
            $jStmt->execute();
            $jStmt->close();
            break;
        }

        // ----------------------------------------------------------------
        // cancel: mark job and all queued batches as cancelled
        // ----------------------------------------------------------------
        case 'cancel': {
            $conn->begin_transaction();
            $conn->query(
                "UPDATE ad_generation_job_batches SET status = 'failed', error = 'Cancelled'
                 WHERE job_id = {$jobId} AND status IN ('queued','running')"
            );
            $conn->query(
                "UPDATE ad_generation_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = {$jobId}"
            );
            $conn->commit();
            break;
        }

        default:
            http_response_code(400);
            echo json_encode(['error' => "Unknown action: {$action}"]);
            exit;
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    if ($conn->inTransaction()) $conn->rollback();
    error_log('[update-generation-job] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
