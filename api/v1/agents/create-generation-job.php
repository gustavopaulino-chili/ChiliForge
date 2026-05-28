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

$userId           = (int)($body['user_id']            ?? 0);
$companyProjectId = (int)($body['company_project_id'] ?? 0);
$campaignId       = (int)($body['campaign_id']        ?? 0);
$projectId        = (int)($body['project_id']         ?? 0);
$batches          = is_array($body['batches'] ?? null) ? $body['batches'] : [];
$creativePlan     = trim((string)($body['creative_plan'] ?? ''));

if ($userId <= 0 || $companyProjectId <= 0 || empty($batches)) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id and batches are required']);
    exit;
}

try {
    $conn->begin_transaction();

    $jobStmt = $conn->prepare(
        "INSERT INTO ad_generation_jobs
           (user_id, company_project_id, campaign_id, project_id, status, creative_plan, total_batches)
         VALUES (?, ?, ?, ?, 'running', ?, ?)"
    );
    if (!$jobStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);

    $totalBatches  = count($batches);
    $nullCampaign  = $campaignId > 0 ? $campaignId : null;
    $nullProject   = $projectId  > 0 ? $projectId  : null;
    $nullPlan      = $creativePlan !== '' ? $creativePlan : null;

    $jobStmt->bind_param('iiissi', $userId, $companyProjectId, $nullCampaign, $nullProject, $nullPlan, $totalBatches);
    $jobStmt->execute();
    $jobId = (int)$conn->insert_id;
    $jobStmt->close();

    $batchStmt = $conn->prepare(
        "INSERT INTO ad_generation_job_batches (job_id, batch_index, status, label, formats_json)
         VALUES (?, ?, 'queued', ?, ?)"
    );
    if (!$batchStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);

    $batchRows = [];
    foreach ($batches as $index => $batch) {
        $label       = (string)($batch['label']   ?? 'Batch ' . ($index + 1));
        $formatsJson = json_encode($batch['formats'] ?? [], JSON_UNESCAPED_UNICODE);
        $batchStmt->bind_param('iiss', $jobId, $index, $label, $formatsJson);
        $batchStmt->execute();
        $batchRows[] = [
            'id'          => (int)$conn->insert_id,
            'batch_index' => $index,
            'label'       => $label,
            'status'      => 'queued',
            'formats'     => $batch['formats'] ?? [],
        ];
    }
    $batchStmt->close();

    $conn->commit();

    echo json_encode([
        'success' => true,
        'job_id'  => $jobId,
        'batches' => $batchRows,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    $conn->rollback();
    error_log('[create-generation-job] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
