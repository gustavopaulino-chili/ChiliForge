<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(60);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/../../accountType.php';
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
$formData         = is_array($body['form_data'] ?? null) ? $body['form_data'] : [];

if ($userId <= 0 || $companyProjectId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and company_project_id are required']);
    exit;
}

if (empty($formData)) {
    http_response_code(400);
    echo json_encode(['error' => 'form_data is required']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);

    // 1. Load company project + verify ownership
    $stmt = $conn->prepare(
        "SELECT id, company_form_data, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $companyFormDataJson, $geminiStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

    // 2. Load campaign stores if campaign_id provided
    $campaignMemoryStore      = null;
    $campaignGoodExamplesStore = null;
    if ($campaignId > 0) {
        $camStmt = $conn->prepare(
            "SELECT c.gemini_memory_store, c.gemini_good_examples_store FROM ads_campaign c
             INNER JOIN projects p ON p.id = c.project_id
             WHERE c.id = ? AND (p.id = ? OR p.company_project_id = ?) LIMIT 1"
        );
        if ($camStmt) {
            $camStmt->bind_param('iii', $campaignId, $companyProjectId, $companyProjectId);
            $camStmt->execute();
            $camStmt->bind_result($campaignMemoryStore, $campaignGoodExamplesStore);
            $camStmt->fetch();
            $camStmt->close();
        }
    }

    // 3. Load ADS_AGENT config
    $agentStmt = $conn->prepare(
        "SELECT system_prompt, model, temperature, max_tokens, version
         FROM agents WHERE name = 'ADS_AGENT' AND is_active = 1 LIMIT 1"
    );
    if (!$agentStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $agentStmt->execute();
    $agentStmt->bind_result($systemPrompt, $model, $temperature, $maxTokens, $agentVersion);
    if (!$agentStmt->fetch()) {
        $agentStmt->close();
        http_response_code(500);
        echo json_encode(['error' => 'ADS_AGENT not found. Run the agents seed SQL first.']);
        exit;
    }
    $agentStmt->close();

    // 4. Read global Ads store
    $globalStore = '';
    $settingStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_ads_store' LIMIT 1");
    if ($settingStmt) {
        $settingStmt->execute();
        $settingStmt->bind_result($globalStore);
        $settingStmt->fetch();
        $settingStmt->close();
    }

    // 5. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 6. Inject company logo into form_data if missing
    $images = is_array($companyFormData['images'] ?? null) ? $companyFormData['images'] : [];
    if (empty($formData['logoUrl']) && !empty($images['logo'])) {
        $formData['logoUrl'] = $images['logo'];
    }

    // 7. Company store is created/updated when the user saves the company form
    // (updateCompanyProject.php / createProject.php). Generation only reads it.
    if (empty($geminiStoreName)) {
        http_response_code(409);
        echo json_encode([
            'error' => 'Company brand store not found. Save the company profile first to generate the brand guide.',
            'code'  => 'COMPANY_STORE_MISSING',
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'edgePayload' => [
            'agentConfig' => [
                'systemPrompt' => $systemPrompt,
                'model'        => $model,
                'temperature'  => (float)$temperature,
                'maxTokens'    => (int)$maxTokens,
                'version'      => (int)$agentVersion,
            ],
            'globalStoreName'           => $globalStore ?: null,
            'companyStoreName'          => $geminiStoreName ?? '',
            'campaignGoodExamplesStore' => $campaignGoodExamplesStore ?: null,
            'campaignMemoryStore'       => $campaignMemoryStore ?: null,
            'useCampaignMemory'         => $campaignId > 0,
            'campaignData'              => $formData,
            'accountType'               => $accountType,
        ],
        'campaignId'          => $campaignId > 0 ? $campaignId : null,
        'campaignMemoryStore' => $campaignMemoryStore ?: null,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/prepare-generate-ads] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
