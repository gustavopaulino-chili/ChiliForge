<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(120);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../../accountType.php';
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

$userId     = (int)($body['user_id']     ?? 0);
$campaignId = (int)($body['campaign_id'] ?? 0);
$message    = trim($body['message']      ?? '');
$history    = is_array($body['history']  ?? null) ? $body['history'] : [];

if ($userId <= 0 || $campaignId <= 0 || $message === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, campaign_id and message are required']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);

    $stmt = $conn->prepare(
        "SELECT
            c.name,
            c.form_data,
            c.creative_plans,
            c.gemini_memory_store,
            c.gemini_good_examples_store,
            company.id,
            company.company_form_data,
            company.gemini_store_name,
            u.email
         FROM ads_campaign c
         INNER JOIN projects p ON p.id = c.project_id
         INNER JOIN projects company ON company.id = COALESCE(p.company_project_id, p.id)
         INNER JOIN users u ON u.id = company.user_id
         WHERE c.id = ?
           AND company.user_id = ?
           AND company.project_type = 'project'
           AND (p.id = company.id OR p.company_project_id = company.id)
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $campaignId, $userId);
    $stmt->execute();
    $stmt->bind_result(
        $campaignName,
        $formDataJson,
        $creativePlansJson,
        $campaignMemoryStore,
        $campaignGoodExamplesStore,
        $companyProjectId,
        $companyFormDataJson,
        $companyStoreName,
        $userEmail
    );
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Campaign not found']);
        exit;
    }
    $stmt->close();

    $formData = json_decode($formDataJson ?: '{}', true) ?: [];
    $creativePlans = json_decode($creativePlansJson ?: '[]', true) ?: [];
    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $chatAccountType = $accountTypeResult['accountType'];

    $isGenerateRequest = (bool)preg_match(
        '/\b(gerar|generate|criar|make.*ad|mais criativos?|new creatives?|criar mais|make more)\b/ui',
        $message
    );

    if ($isGenerateRequest) {
        $formOverrides = [];

        if (preg_match('/\b(story|stories|stories?)\b/ui', $message)) {
            $formOverrides['formatHint'] = 'story';
        } elseif (preg_match('/\b(banner|leaderboard)\b/ui', $message)) {
            $formOverrides['formatHint'] = 'banner';
        } elseif (preg_match('/\b(square|quadrado)\b/ui', $message)) {
            $formOverrides['formatHint'] = 'square';
        }

        if (preg_match('/\b(urgente|urgent|promo|promotional)\b/ui', $message)) {
            $formOverrides['urgencyLevel'] = 'high';
        } elseif (preg_match('/\b(suave|soft|gentle|calm)\b/ui', $message)) {
            $formOverrides['urgencyLevel'] = 'low';
        }

        echo json_encode([
            'type'          => 'generate',
            'message'       => 'Got it. Generating new creatives for this campaign using the campaign history and approved examples...',
            'formOverrides' => $formOverrides,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

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

    if (trim((string)$globalStore) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Global Ads Store is missing. Upload/sync the global ads guidelines first.',
            'code'  => 'GLOBAL_ADS_STORE_MISSING',
        ]);
        exit;
    }

    if (trim((string)$globalReferenceStore) === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Global Ads Reference Store is missing. Upload at least one ad example via "Send to Store" first.',
            'code'  => 'GLOBAL_ADS_REFERENCE_STORE_MISSING',
        ]);
        exit;
    }

    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];
    // Chat should not re-index company knowledge on every message. It can use
    // the existing store when available plus the explicit DB context below.
    $companyStoreName = is_string($companyStoreName ?? null) ? trim($companyStoreName) : '';

    if ($companyStoreName === '') {
        http_response_code(409);
        echo json_encode([
            'error' => 'Company store is missing. Sync company knowledge before using campaign chat.',
            'code'  => 'COMPANY_STORE_MISSING',
        ]);
        exit;
    }

    $fileSearchStores = array_values(array_filter([
        $globalStore ?: null,
        $globalReferenceStore ?: null,
        $companyStoreName ?: null,
        $campaignMemoryStore ?: null,
        $campaignGoodExamplesStore ?: null,
    ], fn($store) => is_string($store) && trim($store) !== ''));

    $companyName = $companyFormData['businessName'] ?? $companyFormData['brandName'] ?? '';
    $companyContext  = "Company: " . ($companyName ?: 'Not defined') . "\n";
    $companyContext .= "Industry: " . ($companyFormData['businessCategory'] ?? $companyFormData['industry'] ?? 'Not defined') . "\n";
    $companyContext .= "Description: " . ($companyFormData['businessDescription'] ?? 'Not defined') . "\n";
    $companyContext .= "Audience: " . ($companyFormData['targetAudience'] ?? 'Not defined') . "\n";
    $companyContext .= "Value proposition: " . ($companyFormData['valueProposition'] ?? 'Not defined') . "\n";
    $companyContext .= "Tone: " . ($companyFormData['toneOfVoice'] ?? 'Not defined') . "\n";

    $campaignContext  = "Campaign: " . ($campaignName ?? '') . "\n";
    $campaignContext .= "Objective: " . ($formData['campaignObjective'] ?? 'Not defined') . "\n";
    $campaignContext .= "Funnel: " . ($formData['funnelStage'] ?? 'Not defined') . "\n";
    $campaignContext .= "Offer: " . ($formData['offer'] ?? 'Not defined') . "\n";
    $campaignContext .= "Audience: " . ($formData['targetAudience'] ?? 'Not defined') . "\n";
    $campaignContext .= "Tone: " . ($formData['toneOfVoice'] ?? 'Not defined') . "\n";
    $campaignContext .= "Urgency: " . ($formData['urgencyLevel'] ?? 'Not defined') . "\n";

    if (!empty($creativePlans)) {
        $campaignContext .= "\nLatest creative plans:\n";
        foreach (array_slice($creativePlans, 0, 3) as $plan) {
            $campaignContext .= "- [" . ($plan['date'] ?? '') . "]: " . mb_substr($plan['plan'] ?? '', 0, 300) . "...\n";
        }
    }

    $storeInstruction = !empty($fileSearchStores)
        ? "Before answering, consult File Search in this hierarchy: global ads rules, company knowledge, then campaign memory/examples. Campaign facts override company knowledge when they conflict; company knowledge overrides global rules."
        : "No File Search stores are available; answer only from the explicit context below.";

    $systemPrompt = "You are a digital marketing and ad creative specialist. " .
        "Answer only about the company and campaign in context. Be concise, practical, and direct. " .
        "Reply in the same language as the user's message. " .
        "If the user wants new creatives, they should ask to generate or create more creatives; do not generate HTML in chat.\n\n" .
        $storeInstruction . "\n\n" .
        "=== COMPANY CONTEXT ===\n" . $companyContext . "\n\n" .
        "=== CAMPAIGN CONTEXT ===\n" . $campaignContext;

    $apiKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING');
    if (!$apiKey) throw new RuntimeException('Gemini API key not configured');

    $contents = [];
    foreach ($history as $h) {
        $role = ($h['role'] ?? '') === 'user' ? 'user' : 'model';
        $contents[] = ['role' => $role, 'parts' => [['text' => $h['content'] ?? '']]];
    }
    $contents[] = ['role' => 'user', 'parts' => [['text' => $message]]];

    $geminiPayload = [
        'systemInstruction' => ['parts' => [['text' => $systemPrompt]]],
        'contents'          => $contents,
        'generationConfig'  => ['temperature' => 0.7, 'maxOutputTokens' => 1024],
    ];

    if (!empty($fileSearchStores)) {
        $geminiPayload['tools'] = [[
            'file_search' => [
                'file_search_store_names' => $fileSearchStores,
            ],
        ]];
    }

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . rawurlencode($apiKey);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($geminiPayload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 90,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    ]);
    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new RuntimeException('Gemini returned HTTP ' . $httpCode . ': ' . $raw);
    }

    $geminiResponse = json_decode($raw, true);
    $replyText = $geminiResponse['candidates'][0]['content']['parts'][0]['text'] ?? 'Unable to generate a response.';

    echo json_encode([
        'type'       => 'text',
        'message'    => $replyText,
        'usedStores' => $fileSearchStores,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/campaign-chat] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
