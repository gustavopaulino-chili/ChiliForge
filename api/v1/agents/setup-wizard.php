<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(90);
ini_set('memory_limit', '128M');

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

$userId           = (int)($body['user_id']           ?? 0);
$companyProjectId = (int)($body['company_project_id'] ?? 0);
$message          = trim($body['message']             ?? '');
$history          = is_array($body['history']  ?? null) ? $body['history']  : [];
$currentForm      = is_array($body['current_form'] ?? null) ? $body['current_form'] : [];

if ($userId <= 0 || $message === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and message are required']);
    exit;
}

// Resolve stores: company store + global ads store (model retrieves from them as needed)
$companyStoreName = '';
if ($companyProjectId > 0) {
    $storeStmt = $conn->prepare(
        "SELECT gemini_store_name FROM projects WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if ($storeStmt) {
        $storeStmt->bind_param('ii', $companyProjectId, $userId);
        $storeStmt->execute();
        $storeStmt->bind_result($companyStoreName);
        $storeStmt->fetch();
        $storeStmt->close();
        $companyStoreName = is_string($companyStoreName) ? trim($companyStoreName) : '';
    }
}

$globalAdsStore = '';
$globalStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_ads_store' LIMIT 1");
if ($globalStmt) {
    $globalStmt->execute();
    $globalStmt->bind_result($globalAdsStore);
    $globalStmt->fetch();
    $globalStmt->close();
    $globalAdsStore = is_string($globalAdsStore) ? trim($globalAdsStore) : '';
}

$fileSearchStores = array_values(array_filter(
    [$globalAdsStore ?: null, $companyStoreName ?: null],
    fn($s) => is_string($s) && $s !== ''
));

// Build a compact snapshot of what fields are already filled
$fieldMap = [
    'campaignName'      => 'Campaign name',
    'campaignObjective' => 'Objective',
    'funnelStage'       => 'Funnel stage',
    'brandName'         => 'Brand name',
    'industry'          => 'Industry',
    'productName'       => 'Product/service',
    'targetAudience'    => 'Target audience',
    'offer'             => 'Offer',
    'valueProposition'  => 'Value proposition',
    'ctaText'           => 'CTA text',
    'toneOfVoice'       => 'Tone of voice',
    'urgencyLevel'      => 'Urgency',
    'creativeStrategy'  => 'Creative strategy',
    'painPoints'        => 'Pain points',
    'desires'           => 'Desires',
];
$filledFields = [];
foreach ($fieldMap as $key => $label) {
    $val = trim((string)($currentForm[$key] ?? ''));
    if ($val !== '' && $val !== '0') {
        $filledFields[] = "$label: $val";
    }
}
$formContext = !empty($filledFields)
    ? "Fields already filled in the form:\n" . implode("\n", $filledFields)
    : "The campaign form is currently empty — guide the user from scratch.";

$storeInstruction = !empty($fileSearchStores)
    ? "STORES AVAILABLE: You have access to File Search stores. Query them intelligently:\n" .
      "- Company store: contains brand identity (tone, audience, value prop, colors). Query it when the user asks about their brand or when filling brand-related fields.\n" .
      "- Global ads store: contains creative strategy guidelines, objective definitions, funnel stages, format specs, copy principles. Query it when the user asks about strategy, objectives, or best practices.\n" .
      "Only retrieve what's relevant to the current question — do not load everything at once."
    : "No File Search stores available — answer from conversation context only.";

$systemPrompt = <<<PROMPT
You are a friendly campaign setup wizard for ChiliForge, an AI-powered ad creative platform.
Your job: guide non-marketing users through setting up their ad campaign conversationally.

$storeInstruction

RULES:
- Ask ONE short question at a time. Never ask two questions in the same message.
- Be brief and warm — 1-2 short sentences before the question, nothing more.
- Detect the user's language and always reply in the same language.
- Never explain ad theory at length. Ask smart, direct questions.
- Do not ask for fields that are already filled (see CURRENT FORM STATE below).
- If company store has brand data (tone, audience), use it to pre-fill those fields without asking.
- After you have enough information to fill at least 5 meaningful fields, produce suggestions.

COLLECTION ORDER (skip already-filled fields and fields inferable from stores):
1. What product or service are they advertising?
2. Campaign objective (awareness / lead generation / sales / retargeting / engagement)
3. Target audience (who they are, age range, key problem they solve)
4. Main offer or value proposition (discount, trial, guarantee, unique benefit)
5. Tone of voice (casual, formal, inspirational, urgent, empathetic)
6. Urgency level (none / low / medium / high)
7. CTA text (e.g., "Get started", "Buy now", "Learn more")

VALID VALUES for structured fields — use ONLY these exact strings:
- campaignObjective: awareness | lead-generation | sales | product-launch | retargeting | engagement | traffic | event
- funnelStage: awareness | consideration | conversion
- toneOfVoice: formal | casual | inspirational | authoritative | conversational | urgent | empathetic
- urgencyLevel: none | low | medium | high
- creativeStrategy: problem-solution | before-after | testimonial | educational | emotional | direct-response | product-showcase | lifestyle | authority | comparison

WHEN TO OUTPUT SUGGESTIONS:
When you have enough info to fill at least 5 fields meaningfully, prepend a structured block to your reply using this exact format (the JSON must be on one single line):

---SUGGESTIONS---
{"campaignName":"...","campaignObjective":"sales","funnelStage":"conversion","productName":"...","targetAudience":"...","offer":"...","valueProposition":"...","ctaText":"...","toneOfVoice":"casual","urgencyLevel":"medium","creativeStrategy":"direct-response","painPoints":"...","desires":"..."}
---END SUGGESTIONS---

After the block, write a short friendly message and ask if anything should be adjusted.
Only output the suggestions block when you have enough data — not on every turn.

CURRENT FORM STATE:
$formContext
PROMPT;

try {
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
        'generationConfig'  => ['temperature' => 0.75, 'maxOutputTokens' => 600],
    ];

    if (!empty($fileSearchStores)) {
        $geminiPayload['tools'] = [[
            'file_search' => ['file_search_store_names' => $fileSearchStores],
        ]];
    }

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . rawurlencode($apiKey);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($geminiPayload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    ]);
    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new RuntimeException('Gemini returned HTTP ' . $httpCode . ': ' . mb_substr($raw ?: '', 0, 400));
    }

    $geminiResponse = json_decode($raw, true);
    $replyText = trim($geminiResponse['candidates'][0]['content']['parts'][0]['text'] ?? '');
    if ($replyText === '') {
        throw new RuntimeException('Gemini returned empty response');
    }

    // Parse and extract suggestions block
    $suggestions = null;
    if (preg_match('/---SUGGESTIONS---\s*(.*?)\s*---END SUGGESTIONS---/s', $replyText, $m)) {
        $parsed = json_decode(trim($m[1]), true);
        if (is_array($parsed) && !empty($parsed)) {
            $suggestions = $parsed;
        }
        $replyText = trim(preg_replace('/---SUGGESTIONS---.*?---END SUGGESTIONS---/s', '', $replyText));
    }

    if ($suggestions !== null) {
        echo json_encode([
            'type'        => 'suggestions',
            'message'     => $replyText,
            'suggestions' => $suggestions,
        ], JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode([
            'type'    => 'text',
            'message' => $replyText,
        ], JSON_UNESCAPED_UNICODE);
    }

} catch (Throwable $e) {
    error_log('[agents/setup-wizard] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
