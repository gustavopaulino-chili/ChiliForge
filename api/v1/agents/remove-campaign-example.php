<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(120);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

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
$exampleId        = (int)($body['example_id']         ?? 0);

if ($userId <= 0 || $companyProjectId <= 0 || $campaignId <= 0 || $exampleId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id, campaign_id and example_id are required']);
    exit;
}

try {
    agents_ensure_campaign_examples_table($conn);

    $stmt = $conn->prepare(
        "SELECT e.gemini_document_name
         FROM ads_campaign_examples e
         INNER JOIN ads_campaign c ON c.id = e.campaign_id
         INNER JOIN projects p ON p.id = c.project_id
         INNER JOIN projects company ON company.id = ?
         WHERE e.id = ?
           AND e.campaign_id = ?
           AND company.user_id = ?
           AND company.project_type = 'project'
           AND (p.id = company.id OR p.company_project_id = company.id)
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('iiii', $companyProjectId, $exampleId, $campaignId, $userId);
    $stmt->execute();
    $stmt->bind_result($documentName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Example not found or access denied']);
        exit;
    }
    $stmt->close();

    $deletedDocument = false;
    if (is_string($documentName) && trim($documentName) !== '') {
        try {
            $deletedDocument = agents_delete_gemini_file_search_document(trim($documentName));
        } catch (Throwable $deleteError) {
            error_log('[agents/remove-campaign-example] Gemini document delete skipped: ' . $deleteError->getMessage());
        }
    }

    $deleteStmt = $conn->prepare("DELETE FROM ads_campaign_examples WHERE id = ? AND campaign_id = ?");
    if (!$deleteStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $deleteStmt->bind_param('ii', $exampleId, $campaignId);
    $deleteStmt->execute();
    $deletedRecord = $deleteStmt->affected_rows > 0;
    $deleteStmt->close();

    echo json_encode([
        'success' => true,
        'deletedRecord' => $deletedRecord,
        'deletedDocument' => $deletedDocument,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/remove-campaign-example] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
