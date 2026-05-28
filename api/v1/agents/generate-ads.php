<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(600);
ini_set('memory_limit', '512M');

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
$generateAsImage  = !empty($formData['generate_as_image']);

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

    // 2. Load campaign stores (memory + good examples) if campaign_id provided
    $campaignMemoryStore = null;
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

    // 3. Load ADS_AGENT
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

    // 4. Read global Ads store from system_settings
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

    if (!$generateAsImage && trim((string)$globalReferenceStore) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Global Ads Reference Store is missing. Upload at least one ad example via "Send to Store" first.',
            'code'  => 'GLOBAL_ADS_REFERENCE_STORE_MISSING',
        ]);
        exit;
    }

    if ($generateAsImage && trim((string)$globalImageReferenceStore) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Global Ads Image Reference Store is missing. Upload at least one image ad example first.',
            'code'  => 'GLOBAL_ADS_IMAGE_REFERENCE_STORE_MISSING',
        ]);
        exit;
    }

    // 5. Determine account type + load user Gemini key
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 6. Inject structured company facts directly. Stores remain for long-form
    // brand docs instead of basic colors/assets/facts.
    $formData = agents_enrich_ad_form_with_company_data($formData, $companyFormData);

    // 8. Create the company store only if it is missing. Avoid re-indexing on
    // every generation; company saves are responsible for refreshing knowledge.
    $companyDocument = buildCompanyDocument($companyFormData);
    $passKey = null; // Internal generation always uses the platform's Gemini key
    agents_lazy_init_store($conn, $companyProjectId, $geminiStoreName, $companyDocument, $accountType, $userId, $passKey);

    if (trim((string)$geminiStoreName) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Company brand store not found. Save the company profile first to generate the brand guide.',
            'code'  => 'COMPANY_STORE_MISSING',
        ]);
        exit;
    }

    // 9. Call agents-ads edge function
    $edgePayload = [
        'agentConfig' => [
            'systemPrompt' => $systemPrompt,
            'model'        => $model,
            'temperature'  => (float)$temperature,
            'maxTokens'    => (int)$maxTokens,
            'version'      => (int)$agentVersion,
        ],
        'globalStoreName'            => $globalStore ?: null,
        'globalReferenceStoreName'   => $globalReferenceStore ?: null,
        'imageReferenceStoreName'    => $globalImageReferenceStore ?: null,
        'companyStoreName'           => $geminiStoreName ?? '',
        'campaignGoodExamplesStore'  => $campaignGoodExamplesStore ?: null,
        'campaignMemoryStore'        => $campaignMemoryStore ?: null,
        'useCampaignMemory'          => $campaignId > 0,
        'campaignData'               => $formData,
        'accountType'                => $accountType,
    ];

    if ($generateAsImage) {
        $edgePayload['generateAsImage'] = true;
        $edgePayload['mode']            = 'image';
        if (!empty($formData['creative_plan'])) {
            $edgePayload['creativePlan'] = (string)$formData['creative_plan'];
        }
    }

    $result = agents_call_edge_function('agents-ads', $edgePayload, $passKey);

    if (!empty($result['error'])) {
        throw new RuntimeException('agents-ads error: ' . $result['error']);
    }

    // IMAGE MODE: return images immediately, no background indexing needed
    if ($generateAsImage) {
        header('Content-Type: application/json');
        echo json_encode([
            'success' => true,
            'mode'    => 'image',
            'images'  => $result['images'] ?? [],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Reconnect if connection dropped during long generation
    // Use try/catch because PHP may throw mysqli_sql_exception instead of returning false
    try { $conn->query('SELECT 1'); } catch (Throwable $_reconnectCheck) {
        try { $conn->close(); } catch (Throwable $__) {}
        include __DIR__ . '/../../db.php';
    }

    $creativePlanText = $result['creativePlan'] ?? '';

    // Fast DB save (creative_plans column) — keep before response so UI loads plans immediately
    if ($campaignId > 0 && !empty($creativePlanText)) {
        agents_save_campaign_creative_plan($conn, $campaignId, $formData, $creativePlanText, 'form_generation');
    }

    // Send response to client immediately — do NOT wait for slow File Search indexing
    $responseBody = json_encode([
        'success'       => true,
        'html'          => $result['html']          ?? '',
        'assets'        => $result['assets']        ?? [],
        'slug'          => $result['slug']          ?? '',
        'creativeCount' => $result['creativeCount'] ?? 0,
        'formats'       => $result['formats']       ?? [],
        'creativePlan'  => $creativePlanText,
        'agentVersion'  => (int)$agentVersion,
        'usedStores'    => $result['usedStores']    ?? [],
        'groundingMetadata' => $result['groundingMetadata'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    header('Content-Type: application/json');
    header('Content-Length: ' . strlen($responseBody));
    echo $responseBody;

    // Close HTTP connection; PHP continues running in background
    ignore_user_abort(true);
    set_time_limit(120);
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    }

    // Background: index brief + plan in campaign File Search store
    if ($campaignId > 0 && !empty($creativePlanText)) {
        $brief  = "# Campaign Brief — " . date('Y-m-d') . "\n\n";
        $brief .= "## Objective\nCampaign: " . ($formData['campaignName'] ?? '') . "\nObjective: " . ($formData['campaignObjective'] ?? '') . "\nFunnel: " . ($formData['funnelStage'] ?? '') . "\n\n";
        $brief .= "## Audience\nTarget: " . ($formData['targetAudience'] ?? '') . "\nAge: " . ($formData['ageRange'] ?? '') . "\nPain points: " . ($formData['painPoints'] ?? '') . "\n\n";
        $brief .= "## Offer\nOffer: " . ($formData['offer'] ?? '') . "\nPrice: " . ($formData['pricing'] ?? '') . "\nDiscount: " . ($formData['discount'] ?? '') . "\nGuarantee: " . ($formData['guarantee'] ?? '') . "\n\n";
        $brief .= "## Design\nVisual style: " . ($formData['preferredStyle'] ?? '') . "\nLogo strategy: " . ($formData['preferredLogoStrategy'] ?? '') . "\nUrgency: " . ($formData['urgencyLevel'] ?? '') . "\nTone: " . ($formData['toneOfVoice'] ?? '') . "\nStrategy: " . ($formData['creativeStrategy'] ?? '') . "\n\n";
        $brief .= "## Assets\n";
        if (!empty($formData['logoUrl']))         $brief .= "Logo: "    . $formData['logoUrl']         . "\n";
        if (!empty($formData['productImageUrl'])) $brief .= "Product: " . $formData['productImageUrl'] . "\n";

        try {
            agents_call_edge_function('agents-store', [
                'action'        => 'get_or_create',
                'storeName'     => $campaignMemoryStore ?: null,
                'displayName'   => "campaign-{$campaignId}-memory",
                'documentText'  => $brief,
                'documentLabel' => 'Campaign Brief ' . date('Y-m-d'),
            ], $passKey);

            $planDoc = "# Creative Plan — " . date('Y-m-d H:i') . "\n\n" . $creativePlanText;
            $storeResult = agents_call_edge_function('agents-store', [
                'action'        => 'get_or_create',
                'storeName'     => $campaignMemoryStore ?: null,
                'displayName'   => "campaign-{$campaignId}-memory",
                'documentText'  => $planDoc,
                'documentLabel' => 'Creative Plan ' . date('Y-m-d H:i'),
            ], $passKey);

            if (!empty($storeResult['storeName']) && $storeResult['storeName'] !== $campaignMemoryStore) {
                $upd = $conn->prepare("UPDATE ads_campaign SET gemini_memory_store = ? WHERE id = ?");
                $upd->bind_param('si', $storeResult['storeName'], $campaignId);
                $upd->execute();
                $upd->close();
            }
        } catch (Throwable $storeError) {
            error_log('[agents/generate-ads] campaign memory sync skipped: ' . $storeError->getMessage());
        }
    }

} catch (Throwable $e) {
    error_log('[agents/generate-ads] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
