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
$formOverrides    = is_array($body['form_overrides'] ?? null) ? $body['form_overrides'] : [];

if ($userId <= 0 || $companyProjectId <= 0 || $campaignId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id and campaign_id are required']);
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
    $stmt->bind_result($projId, $companyFormDataJson, $geminiStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

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

    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();

    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    $images = is_array($companyFormData['images'] ?? null) ? $companyFormData['images'] : [];
    if (empty($formData['logoUrl']) && !empty($images['logo'])) {
        $formData['logoUrl'] = $images['logo'];
    }

    // Create the company store only if it does not exist. Re-indexing it here can push Hostinger/proxy into 503.
    $companyDocument = buildCompanyDocument($companyFormData);
    agents_lazy_init_store($conn, $companyProjectId, $geminiStoreName, $companyDocument, $accountType, $userId);

    $result = agents_call_edge_function('agents-ads', [
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
        'useCampaignMemory'         => true,
        'campaignData'              => $formData,
        'accountType'               => $accountType,
    ]);

    if (!empty($result['error'])) {
        throw new RuntimeException('agents-ads error: ' . $result['error']);
    }

    try { $conn->query('SELECT 1'); } catch (Throwable $_reconnectCheck) {
        try { $conn->close(); } catch (Throwable $__) {}
        include __DIR__ . '/../../db.php';
    }

    $creativePlanText = $result['creativePlan'] ?? '';
    $brief = '';
    $planDoc = '';

    if (!empty($creativePlanText)) {
        $brief  = "# Campaign Brief (Chat) - " . date('Y-m-d') . "\n\n";
        $brief .= "## Objective\n";
        $brief .= "Campaign: "  . ($formData['campaignName']      ?? '') . "\n";
        $brief .= "Objective: " . ($formData['campaignObjective'] ?? '') . "\n";
        $brief .= "Funnel: "    . ($formData['funnelStage']       ?? '') . "\n\n";
        $brief .= "## Audience\n";
        $brief .= "Target: "      . ($formData['targetAudience'] ?? '') . "\n";
        $brief .= "Pain points: " . ($formData['painPoints']     ?? '') . "\n\n";
        $brief .= "## Offer\n";
        $brief .= "Offer: " . ($formData['offer'] ?? '') . "\n\n";
        $brief .= "## Design\n";
        $brief .= "Visual style: " . ($formData['preferredStyle'] ?? '') . "\n";
        $brief .= "Urgency: "      . ($formData['urgencyLevel']   ?? '') . "\n";
        $brief .= "Tone: "         . ($formData['toneOfVoice']    ?? '') . "\n";
        if (!empty($formOverrides)) {
            $brief .= "\n## Overrides from chat\n";
            foreach ($formOverrides as $k => $v) {
                if (is_string($v) || is_numeric($v)) $brief .= "$k: $v\n";
            }
        }

        agents_save_campaign_creative_plan($conn, $campaignId, $formData, $creativePlanText, 'campaign_chat');
        $planDoc = "# Creative Plan (Chat) - " . date('Y-m-d H:i') . "\n\n" . $creativePlanText;
    }

    echo json_encode([
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

    // Return JSON before the slow File Search indexing step. If fastcgi is unavailable, skip the slow sync.
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        exit;
    }

    if (!empty($brief) && !empty($planDoc)) {
        try {
            agents_call_edge_function('agents-store', [
                'action'        => 'get_or_create',
                'storeName'     => $campaignMemoryStore ?: null,
                'displayName'   => "campaign-{$campaignId}-memory",
                'documentText'  => $brief,
                'documentLabel' => 'Campaign Brief (Chat) ' . date('Y-m-d'),
            ]);

            $storeResult = agents_call_edge_function('agents-store', [
                'action'        => 'get_or_create',
                'storeName'     => $campaignMemoryStore ?: null,
                'displayName'   => "campaign-{$campaignId}-memory",
                'documentText'  => $planDoc,
                'documentLabel' => 'Creative Plan (Chat) ' . date('Y-m-d H:i'),
            ]);

            if (!empty($storeResult['storeName']) && $storeResult['storeName'] !== $campaignMemoryStore) {
                $upd = $conn->prepare("UPDATE ads_campaign SET gemini_memory_store = ? WHERE id = ?");
                $upd->bind_param('si', $storeResult['storeName'], $campaignId);
                $upd->execute();
                $upd->close();
            }
        } catch (Throwable $storeError) {
            error_log('[agents/generate-ads-from-campaign] campaign memory sync skipped: ' . $storeError->getMessage());
        }
    }

} catch (Throwable $e) {
    error_log('[agents/generate-ads-from-campaign] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
