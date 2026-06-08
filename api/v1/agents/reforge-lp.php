<?php
// ReForge — surgical chat editor for an already-generated LP. Resolves the LP's
// brand brief + the global LP store + the company store, then calls the
// agents-lp-reforge edge function to apply ONLY the requested change to the HTML.
// POST { user_id, project_id, instruction, html, history?:[{role,content}] }
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(180);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'Invalid JSON body']); exit; }

$userId      = (int)($body['user_id'] ?? 0);
$projectId   = (int)($body['project_id'] ?? 0);
$instruction = trim((string)($body['instruction'] ?? ''));
$html        = (string)($body['html'] ?? '');
$history     = is_array($body['history'] ?? null) ? $body['history'] : [];

if ($userId <= 0 || $projectId <= 0 || $instruction === '' || trim($html) === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, project_id, instruction and html are required']);
    exit;
}

try {
    // 1. Load the LP project + verify ownership. form_data lives in lps.form_data.
    $stmt = $conn->prepare(
        "SELECT p.id, p.user_id, p.company_project_id, COALESCE(NULLIF(l.form_data,''),'{}') AS form_data
         FROM projects p LEFT JOIN lps l ON l.project_id = p.id
         WHERE p.id = ? AND p.user_id = ? LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $projectId, $userId);
    $stmt->execute();
    $stmt->bind_result($pid, $puid, $companyProjectId, $formDataJson);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Project not found or access denied']);
        exit;
    }
    $stmt->close();
    $formData = json_decode((string)$formDataJson, true) ?: [];
    $companyProjectId = (int)$companyProjectId;

    // 2. Global LP store (HOW: reusable LP guidelines).
    $globalStore = '';
    if ($s = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_lp_store' LIMIT 1")) {
        $s->execute(); $s->bind_result($globalStore); $s->fetch(); $s->close();
    }

    // 3. Company brand store (WHAT: this company's brand facts), via the linked company.
    $companyStore = '';
    $companyName = '';
    if ($companyProjectId > 0 && ($cs = $conn->prepare("SELECT gemini_store_name, name FROM projects WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"))) {
        $cs->bind_param('ii', $companyProjectId, $userId);
        $cs->execute(); $cs->bind_result($gsn, $cname); $cs->fetch(); $cs->close();
        $companyStore = (string)$gsn;
        $companyName = (string)$cname;
    }

    // 4. Compact generation context so edits stay on-brand (brand colors are rules).
    $str = fn($v) => is_string($v) ? trim($v) : '';
    $ctx = [];
    if ($companyName !== '') $ctx[] = "Company: {$companyName}";
    if ($str($formData['businessName'] ?? '') !== '')   $ctx[] = 'Business: ' . $str($formData['businessName']);
    if ($str($formData['businessCategory'] ?? '') !== '') $ctx[] = 'Category: ' . $str($formData['businessCategory']);
    if ($str($formData['valueProposition'] ?? '') !== '') $ctx[] = 'Value proposition: ' . $str($formData['valueProposition']);
    if ($str($formData['toneOfVoice'] ?? '') !== '')      $ctx[] = 'Tone of voice: ' . $str($formData['toneOfVoice']);
    if ($str($formData['language'] ?? '') !== '')         $ctx[] = 'Language: ' . $str($formData['language']);
    $colors = [];
    foreach (['primaryColor' => 'primary', 'secondaryColor' => 'secondary', 'accentColor' => 'accent', 'textColor' => 'text', 'backgroundColor' => 'background'] as $k => $label) {
        if ($str($formData[$k] ?? '') !== '') $colors[] = $label . '=' . $str($formData[$k]);
    }
    if (!empty($colors)) $ctx[] = 'BRAND COLORS (immutable rules — never change unless explicitly asked): ' . implode(', ', $colors);
    foreach (['headingFont' => 'heading', 'bodyFont' => 'body'] as $k => $label) {
        if ($str($formData[$k] ?? '') !== '') $ctx[] = 'Font ' . $label . ': ' . $str($formData[$k]);
    }
    if ($str($formData['designNotes'] ?? '') !== '') $ctx[] = 'Design notes: ' . $str($formData['designNotes']);
    $generationContext = implode("\n", $ctx);

    // 5. Sanitize history (role/content only, cap length).
    $cleanHistory = [];
    foreach ($history as $h) {
        if (!is_array($h)) continue;
        $role = ($h['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
        $content = trim((string)($h['content'] ?? ''));
        if ($content !== '') $cleanHistory[] = ['role' => $role, 'content' => mb_substr($content, 0, 2000)];
    }
    $cleanHistory = array_slice($cleanHistory, -8);

    // 6. Platform Gemini key + call the edge.
    $passKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING') ?: null;

    $result = agents_call_edge_function('agents-lp-reforge', [
        'html'              => $html,
        'instruction'       => $instruction,
        'history'           => $cleanHistory,
        'globalStoreName'   => $globalStore ?: null,
        'companyStoreName'  => $companyStore ?: null,
        'generationContext' => $generationContext,
        'geminiApiKey'      => $passKey,
    ], $passKey);

    if (!empty($result['error'])) throw new RuntimeException('reforge error: ' . $result['error']);

    echo json_encode([
        'success'  => true,
        'reply'    => $result['reply']    ?? '',
        'html'     => $result['html']     ?? $html,
        'changed'  => (bool)($result['changed'] ?? false),
        'applied'  => (int)($result['applied'] ?? 0),
        'unmatched'=> $result['unmatched'] ?? [],
        'reverted' => (bool)($result['reverted'] ?? false),
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/reforge-lp] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
