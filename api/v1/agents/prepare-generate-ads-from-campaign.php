<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(60);
ini_set('memory_limit', '256M');

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
$formOverrides    = is_array($body['form_overrides'] ?? null) ? $body['form_overrides'] : [];

if ($userId <= 0 || $companyProjectId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and company_project_id are required']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);

    $stmt = $conn->prepare(
        "SELECT id, company_form_data, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $companyFormDataJson, $companyStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

    $campaignMemoryStore     = null;
    $campaignGoodExamplesStore = null;
    $creativePlansJson       = '[]';
    $formData                = $formOverrides;

    if ($campaignId > 0) {
        $camStmt = $conn->prepare(
            "SELECT c.form_data, c.gemini_memory_store, c.gemini_good_examples_store, c.creative_plans
             FROM ads_campaign c
             INNER JOIN projects p ON p.id = c.project_id
             WHERE c.id = ? AND (p.id = ? OR p.company_project_id = ?) LIMIT 1"
        );
        if (!$camStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $camStmt->bind_param('iii', $campaignId, $companyProjectId, $companyProjectId);
        $camStmt->execute();
        $camStmt->bind_result($campaignFormDataJson, $campaignMemoryStore, $campaignGoodExamplesStore, $creativePlansJson);
        if (!$camStmt->fetch()) {
            $camStmt->close();
            http_response_code(404);
            echo json_encode(['error' => 'Campaign not found or access denied']);
            exit;
        }
        $camStmt->close();

        $formData = array_merge(
            json_decode($campaignFormDataJson ?: '{}', true) ?: [],
            $formOverrides
        );
    }

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
        echo json_encode(['error' => 'ADS_AGENT not found.']);
        exit;
    }
    $agentStmt->close();

    $globalStore = '';
    $settingStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_ads_store' LIMIT 1");
    if ($settingStmt) {
        $settingStmt->execute();
        $settingStmt->bind_result($globalStore);
        $settingStmt->fetch();
        $settingStmt->close();
    }
    $globalReferenceStore = '';
    $refStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_ads_reference_store' LIMIT 1");
    if ($refStmt) {
        $refStmt->execute();
        $refStmt->bind_result($globalReferenceStore);
        $refStmt->fetch();
        $refStmt->close();
    }
    $globalImageReferenceStore = '';
    $imgRefStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_ads_image_reference_store' LIMIT 1");
    if ($imgRefStmt) {
        $imgRefStmt->execute();
        $imgRefStmt->bind_result($globalImageReferenceStore);
        $imgRefStmt->fetch();
        $imgRefStmt->close();
    }

    if (trim((string)$globalStore) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Global Ads Store is missing. Upload/sync the global ads guidelines first.',
            'code'  => 'GLOBAL_ADS_STORE_MISSING',
        ]);
        exit;
    }

    if (trim((string)$companyStoreName) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Company store is missing. Sync company knowledge before generating more campaign creatives.',
            'code'  => 'COMPANY_STORE_MISSING',
        ]);
        exit;
    }

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

    // Keep core company facts in the direct payload. File Search remains useful
    // for brand books/docs, but colors/assets/facts should be deterministic.
    $formData = agents_enrich_ad_form_with_company_data($formData, $companyFormData);

    if ($campaignId > 0) {
        $creativePlans = json_decode($creativePlansJson ?: '[]', true);
        if (is_array($creativePlans) && !empty($creativePlans)) {
            $planContext = [];
            foreach (array_slice($creativePlans, 0, 3) as $plan) {
                if (!empty($plan['plan'])) {
                    $planContext[] = '[' . ($plan['date'] ?? 'previous') . '] ' . mb_substr((string)$plan['plan'], 0, 700);
                }
            }
            if (!empty($planContext)) {
                $existingContext = isset($formData['context']) ? (string)$formData['context'] : '';
                $formData['context'] = trim($existingContext . "\n\nPrevious campaign creative plans:\n" . implode("\n\n", $planContext));
            }
        }

        $exampleSummaries = [];
        $exampleStmt = $conn->prepare(
            "SELECT ac.platform, ac.format, ac.label, ac.width, ac.height, e.created_at
             FROM ads_campaign_examples e
             INNER JOIN ads_creatives ac ON ac.id = e.creative_id
             WHERE e.campaign_id = ?
             ORDER BY e.created_at DESC
             LIMIT 8"
        );
        if ($exampleStmt) {
            $exampleStmt->bind_param('i', $campaignId);
            $exampleStmt->execute();
            $exampleStmt->bind_result($exPlatform, $exFormat, $exLabel, $exWidth, $exHeight, $exCreatedAt);
            while ($exampleStmt->fetch()) {
                $exampleSummaries[] = trim(($exLabel ?: 'Creative') . ' | ' . ($exPlatform ?: 'ad') . ' | ' . ($exFormat ?: 'format') . ' | ' . ((int)$exWidth ?: 0) . 'x' . ((int)$exHeight ?: 0) . ' | added ' . ($exCreatedAt ?: ''));
            }
            $exampleStmt->close();
        }
        if (!empty($exampleSummaries)) {
            $existingContext = isset($formData['context']) ? (string)$formData['context'] : '';
            $formData['context'] = trim($existingContext . "\n\nApproved user examples exist for this campaign and MUST be analyzed through the campaign examples store before planning. Example inventory:\n- " . implode("\n- ", $exampleSummaries) . "\nUse these as performance references and remix their winning principles into fresh layouts.");
        }
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
            'globalReferenceStoreName'  => $globalReferenceStore ?: null,
            'imageReferenceStoreName'   => $globalImageReferenceStore ?: null,
            'companyStoreName'          => $companyStoreName,
            'campaignGoodExamplesStore' => $campaignGoodExamplesStore ?: null,
            'campaignMemoryStore'       => $campaignMemoryStore ?: null,
            'useCampaignMemory'         => $campaignId > 0,
            'campaignData'              => $formData,
            'accountType'               => $accountType,
            'geminiApiKey'              => $geminiApiKey ?: null,
        ],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/prepare-generate-ads-from-campaign] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
