<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

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
$formData         = is_array($body['form_data']       ?? null) ? $body['form_data'] : [];
$creativePlanText = trim((string)($body['creative_plan'] ?? ''));
$source           = trim((string)($body['source'] ?? 'campaign_direct_edge'));

if ($userId <= 0 || $companyProjectId <= 0 || $campaignId <= 0 || $creativePlanText === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id, campaign_id and creative_plan are required']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);

    $stmt = $conn->prepare(
        "SELECT c.id
         FROM ads_campaign c
         INNER JOIN projects p ON p.id = c.project_id
         INNER JOIN projects company ON company.id = ?
         WHERE c.id = ?
           AND company.user_id = ?
           AND company.project_type = 'project'
           AND (p.id = company.id OR p.company_project_id = company.id)
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('iii', $companyProjectId, $campaignId, $userId);
    $stmt->execute();
    $stmt->bind_result($foundCampaignId);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Campaign not found or access denied']);
        exit;
    }
    $stmt->close();

    agents_save_campaign_creative_plan($conn, $campaignId, $formData, $creativePlanText, $source ?: 'campaign_direct_edge');

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/record-campaign-generation] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
