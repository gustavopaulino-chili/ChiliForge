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

$userId  = (int)($body['user_id'] ?? 0);
$message = trim($body['message'] ?? '');
$history = is_array($body['history'] ?? null) ? $body['history'] : [];

if ($userId <= 0 || $message === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and message are required']);
    exit;
}

// Load or auto-seed a knowledge store from a local text file.
// Returns the store name on success, empty string if unavailable.
$loadOrSeedKnowledgeStore = function (
    string $settingKey,
    string $filePath,
    string $storeDisplayName,
    string $documentLabel
) use ($conn): string {
    // 1. Check system_settings for existing store name
    $storeName = '';
    $stmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1");
    if ($stmt) {
        $stmt->bind_param('s', $settingKey);
        $stmt->execute();
        $stmt->bind_result($storeName);
        $stmt->fetch();
        $stmt->close();
    }
    if (trim((string)$storeName) !== '') {
        return $storeName;
    }

    // 2. Read local guidelines file
    $realPath = realpath($filePath) ?: $filePath;
    if (!file_exists($realPath)) {
        return '';
    }
    $content = file_get_contents($realPath);
    if (!$content || trim($content) === '') {
        return '';
    }

    // 3. Create Gemini File Search store via agents-store edge function
    try {
        $result = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'displayName'   => $storeDisplayName,
            'documentText'  => $content,
            'documentLabel' => $documentLabel,
            'accountType'   => 'admin',
        ]);
        $newStoreName = $result['storeName'] ?? '';
        if (trim($newStoreName) === '') {
            return '';
        }

        // 4. Persist to system_settings
        $upsert = $conn->prepare(
            "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)"
        );
        if ($upsert) {
            $upsert->bind_param('ss', $settingKey, $newStoreName);
            $upsert->execute();
            $upsert->close();
        }

        return $newStoreName;
    } catch (Throwable $e) {
        error_log('[global-chat] seed store error (' . $settingKey . '): ' . $e->getMessage());
        return '';
    }
};

try {
    // 1. Fetch user info
    $userStmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1");
    if (!$userStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $userStmt->bind_param('i', $userId);
    $userStmt->execute();
    $userStmt->bind_result($userEmail, $storedAccountType);
    if (!$userStmt->fetch()) {
        $userStmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'User not found']);
        exit;
    }
    $userStmt->close();

    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', $storedAccountType ?? 'user');
    $accountType = $accountTypeResult['accountType'];

    // 2. Load standard global stores (all optional)
    $globalSettingKeys = [
        'gemini_global_ads_store',
        'gemini_global_ads_reference_store',
        'gemini_global_lp_store',
    ];

    $globalStores = [];
    if (!empty($globalSettingKeys)) {
        $placeholders = implode(',', array_fill(0, count($globalSettingKeys), '?'));
        $settingsStmt = $conn->prepare(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ($placeholders)"
        );
        if ($settingsStmt) {
            $types = str_repeat('s', count($globalSettingKeys));
            $settingsStmt->bind_param($types, ...$globalSettingKeys);
            $settingsStmt->execute();
            $result = $settingsStmt->get_result();
            while ($row = $result->fetch_assoc()) {
                $val = trim((string)($row['setting_value'] ?? ''));
                if ($val !== '') {
                    $globalStores[] = $val;
                }
            }
            $settingsStmt->close();
        }
    }

    // 3. Auto-seed knowledge stores (app knowledge + form decisions)
    $guidelinesBase = realpath(__DIR__ . '/../../../guidelines') ?: (__DIR__ . '/../../../guidelines');

    $appKnowledgeStore = $loadOrSeedKnowledgeStore(
        'gemini_global_app_knowledge_store',
        $guidelinesBase . DIRECTORY_SEPARATOR . 'app-knowledge-store.txt',
        'global-app-knowledge-store',
        'ChiliForge App Knowledge Base'
    );
    if ($appKnowledgeStore !== '') {
        $globalStores[] = $appKnowledgeStore;
    }

    $formDecisionsStore = $loadOrSeedKnowledgeStore(
        'gemini_global_form_decisions_store',
        $guidelinesBase . DIRECTORY_SEPARATOR . 'form-decisions-store.txt',
        'global-form-decisions-store',
        'ChiliForge Form Decisions Guide'
    );
    if ($formDecisionsStore !== '') {
        $globalStores[] = $formDecisionsStore;
    }

    // 4. Load the user's company stores with project name for relevance scoring
    $userStoresStmt = $conn->prepare(
        "SELECT gemini_store_name, name FROM projects
         WHERE user_id = ? AND project_type = 'project'
           AND gemini_store_name IS NOT NULL AND gemini_store_name != ''
         LIMIT 10"
    );
    $userCompanyStores = [];
    if ($userStoresStmt) {
        $userStoresStmt->bind_param('i', $userId);
        $userStoresStmt->execute();
        $userStoresStmt->bind_result($userStoreName, $projectName);
        while ($userStoresStmt->fetch()) {
            if (trim((string)$userStoreName) !== '') {
                $userCompanyStores[] = ['store' => (string)$userStoreName, 'name' => (string)$projectName];
            }
        }
        $userStoresStmt->close();
    }

    // 5. Rank user stores by keyword relevance to the user's message, then cap total at 5
    $msgWords = preg_split('/\W+/u', mb_strtolower($message), -1, PREG_SPLIT_NO_EMPTY);
    foreach ($userCompanyStores as &$entry) {
        $nameWords = preg_split('/\W+/u', mb_strtolower($entry['name']), -1, PREG_SPLIT_NO_EMPTY);
        $entry['score'] = count(array_intersect($nameWords, $msgWords));
    }
    unset($entry);
    usort($userCompanyStores, fn($a, $b) => $b['score'] <=> $a['score']);
    $rankedUserStores = array_column($userCompanyStores, 'store');

    $maxTotal  = 5;
    $maxUser   = 3; // reserve at least 2 slots for global platform knowledge
    $topUser   = array_slice($rankedUserStores, 0, $maxUser);
    $remaining = $maxTotal - count($topUser);
    $topGlobal = array_slice($globalStores, 0, $remaining);
    $fileSearchStores = array_values(array_unique(array_merge($topUser, $topGlobal)));

    // 6. Build system prompt
    $systemPrompt  = "You are a helpful AI assistant for ChiliForge, an AI-powered platform for generating ad creatives (HTML banners) and landing pages.\n";
    $systemPrompt .= "Answer in the same language as the user's message.\n";
    $systemPrompt .= "You can help with:\n";
    $systemPrompt .= "- Understanding and filling in the ad creative or landing page forms\n";
    $systemPrompt .= "- Campaign strategy, objectives, funnel stages, audience targeting\n";
    $systemPrompt .= "- Ad format selection and best practices\n";
    $systemPrompt .= "- Copywriting: headlines, CTAs, value propositions\n";
    $systemPrompt .= "- General digital marketing advice\n";
    $systemPrompt .= "- Understanding ChiliForge features and workflow\n\n";
    $systemPrompt .= "Do NOT generate raw HTML code in the chat. Direct users to use the generators for that.\n";
    $systemPrompt .= "Keep answers concise and practical. Provide examples when helpful.\n";

    if (!empty($fileSearchStores)) {
        $systemPrompt .= "\nBefore answering, consult the File Search knowledge base, which contains ChiliForge documentation, form guides, and the user's brand information.";
    }

    // 7. Resolve Gemini API key
    $apiKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING');
    if (!$apiKey) throw new RuntimeException('Gemini API key not configured');

    // 8. Build contents array
    $contents = [];
    foreach ($history as $h) {
        $role = ($h['role'] ?? '') === 'user' ? 'user' : 'model';
        $contents[] = ['role' => $role, 'parts' => [['text' => $h['content'] ?? '']]];
    }
    $contents[] = ['role' => 'user', 'parts' => [['text' => $message]]];

    // 9. Build Gemini payload
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

    // 10. Call Gemini API
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
    error_log('[agents/global-chat] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
