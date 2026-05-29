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

WHEN TO OUTPUT A PREVIEW (as soon as you have 2+ fields):
Present the collected data as a human-readable bullet list, ask "Posso aplicar isso no formulário?" (or in the user's language), then include a hidden data block.

Example format — reply looks like:

Aqui está o que coletei até agora:

• **Produto:** VitaGlow Sérum
• **Objetivo:** Lançamento de produto
• **Audiência:** Mulheres, 35–55 anos
• **Oferta:** 20% de desconto nos primeiros 7 dias
• **CTA:** Garantir meu desconto
• **Tom:** Inspiracional | Urgência: Média

Posso aplicar isso no formulário?

---DATA---
{"campaignObjective":"product-launch","productName":"VitaGlow Sérum","targetAudience":"Mulheres, 35-55 anos","offer":"20% de desconto nos primeiros 7 dias","ctaText":"Garantir meu desconto","toneOfVoice":"inspirational","urgencyLevel":"medium"}
---END DATA---

RULES for the DATA block:
- JSON must be on ONE single line between ---DATA--- and ---END DATA---
- Leave unknown fields as empty string "" — never invent data
- Update and re-output the DATA block every turn as you collect more info
- After the user CONFIRMS (says yes/sim/ok/confirmar), reply briefly ("Ótimo, aplicado!") with NO data block

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
        'generationConfig'  => ['temperature' => 0.75, 'maxOutputTokens' => 1500],
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

    // Parse and strip the hidden data block — displayed text stays clean
    $pendingData = null;
    if (preg_match('/---DATA---\s*(.*?)\s*---END DATA---/s', $replyText, $m)) {
        $parsed = json_decode(trim($m[1]), true);
        if (is_array($parsed) && !empty($parsed)) {
            $pendingData = $parsed;
        }
        $replyText = trim(preg_replace('/---DATA---.*?---END DATA---/s', '', $replyText));
    }

    if ($pendingData !== null) {
        echo json_encode([
            'type'        => 'preview',
            'message'     => $replyText,
            'pending_data' => $pendingData,
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
