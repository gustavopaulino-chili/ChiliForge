<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(30);
ini_set('memory_limit', '128M');

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

    // 2. Load ADS_AGENT config
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

    // 3. Determine account type + user API key
    $emailStmt = $conn->prepare("SELECT email, gemini_api_key FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail, $userGeminiKey);
    $emailStmt->fetch();
    $emailStmt->close();

    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];
    $userKey = is_string($userGeminiKey) ? trim($userGeminiKey) : '';
    $geminiApiKey = $userKey !== '' ? $userKey : agents_env_value('GEMINI_API_KEY_PRODUCTION');

    // 4. Enrich form data with company profile (injects brand colors, tone, etc.)
    $formData = agents_enrich_ad_form_with_company_data($formData, $companyFormData);

    // 5. Return edgePayload — browser calls agents-ads directly (avoids PHP timeout)
    echo json_encode([
        'success'     => true,
        'edgePayload' => [
            'mode'        => 'copy',
            'agentConfig' => [
                'systemPrompt' => $systemPrompt,
                'model'        => $model,
                'temperature'  => (float)$temperature,
                'maxTokens'    => (int)$maxTokens,
                'version'      => (int)$agentVersion,
            ],
            'companyStoreName' => is_string($geminiStoreName) ? trim($geminiStoreName) : '',
            'campaignData'     => $formData,
            'accountType'      => $accountType,
            'geminiApiKey'     => $geminiApiKey ?: null,
        ],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/generate-copy] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
