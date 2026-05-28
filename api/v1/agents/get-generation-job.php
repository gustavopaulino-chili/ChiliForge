<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(15);
ini_set('memory_limit', '64M');

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

$userId     = (int)($body['user_id']     ?? 0);
$jobId      = (int)($body['job_id']      ?? 0);
$campaignId = (int)($body['campaign_id'] ?? 0);

if ($userId <= 0 || ($jobId <= 0 && $campaignId <= 0)) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id + (job_id or campaign_id) are required']);
    exit;
}

try {
    // Fetch the job — either by id or by latest job for a campaign
    if ($jobId > 0) {
        $jStmt = $conn->prepare(
            "SELECT id, user_id, company_project_id, campaign_id, project_id, status,
                    creative_plan, total_batches, completed_batches, failed_batches, error,
                    created_at, updated_at
             FROM ad_generation_jobs WHERE id = ? AND user_id = ? LIMIT 1"
        );
        if (!$jStmt) throw new RuntimeException($conn->error);
        $jStmt->bind_param('ii', $jobId, $userId);
    } else {
        $jStmt = $conn->prepare(
            "SELECT id, user_id, company_project_id, campaign_id, project_id, status,
                    creative_plan, total_batches, completed_batches, failed_batches, error,
                    created_at, updated_at
             FROM ad_generation_jobs
             WHERE campaign_id = ? AND user_id = ?
             ORDER BY created_at DESC LIMIT 1"
        );
        if (!$jStmt) throw new RuntimeException($conn->error);
        $jStmt->bind_param('ii', $campaignId, $userId);
    }

    $jStmt->execute();
    $jStmt->bind_result(
        $resId, $resUserId, $resCompanyId, $resCampaignId, $resProjectId, $resStatus,
        $resCreativePlan, $resTotalBatches, $resCompletedBatches, $resFailedBatches, $resError,
        $resCreatedAt, $resUpdatedAt
    );

    if (!$jStmt->fetch()) {
        $jStmt->close();
        echo json_encode(['job' => null]);
        exit;
    }
    $jStmt->close();

    $job = [
        'id'                => $resId,
        'user_id'           => $resUserId,
        'company_project_id'=> $resCompanyId,
        'campaign_id'       => $resCampaignId,
        'project_id'        => $resProjectId,
        'status'            => $resStatus,
        'creative_plan'     => $resCreativePlan,
        'total_batches'     => (int)$resTotalBatches,
        'completed_batches' => (int)$resCompletedBatches,
        'failed_batches'    => (int)$resFailedBatches,
        'error'             => $resError,
        'created_at'        => $resCreatedAt,
        'updated_at'        => $resUpdatedAt,
    ];

    // Fetch batches
    $bStmt = $conn->prepare(
        "SELECT id, batch_index, status, label, formats_json, error, attempts, saved_count
         FROM ad_generation_job_batches WHERE job_id = ? ORDER BY batch_index ASC"
    );
    if (!$bStmt) throw new RuntimeException($conn->error);
    $bStmt->bind_param('i', $resId);
    $bStmt->execute();
    $bStmt->bind_result($bId, $bIndex, $bStatus, $bLabel, $bFormatsJson, $bError, $bAttempts, $bSavedCount);

    $batchRows = [];
    while ($bStmt->fetch()) {
        $batchRows[] = [
            'id'          => $bId,
            'batch_index' => (int)$bIndex,
            'status'      => $bStatus,
            'label'       => $bLabel,
            'formats'     => json_decode($bFormatsJson ?: '[]', true) ?: [],
            'error'       => $bError,
            'attempts'    => (int)$bAttempts,
            'saved_count' => (int)$bSavedCount,
        ];
    }
    $bStmt->close();

    echo json_encode(['job' => $job, 'batches' => $batchRows], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[get-generation-job] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
