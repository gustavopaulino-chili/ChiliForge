<?php
// Loads companies/clients from a ClickUp Wiki (Doc). Each subpage of the Wiki is a
// client, titled "{Company} - {Service} {Region}" (e.g. "Joico - SEO BR"). We fetch
// the Doc's page tree (Docs API v3), parse each title, and return the company list.
// GET ?user_id=&doc_id=(optional, defaults to the main "Chili Wiki")
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId = isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0;
$docId  = trim((string)($_REQUEST['doc_id'] ?? '')) ?: clickup_wiki_doc_id();
if ($userId <= 0) { http_response_code(400); echo json_encode(["error" => "user_id is required"]); exit; }

clickup_ensure_schema($conn);
$row = clickup_get_connection($conn, $userId);
if (!$row || ($row['access_token'] ?? '') === '') {
    http_response_code(409);
    echo json_encode(["error" => "not_connected", "message" => "Connect your ClickUp account first."]);
    exit;
}
$token = $row['access_token'];

// Resolve workspace (team).
$workspaceId = (string)($row['workspace_id'] ?? '');
if ($workspaceId === '') {
    $teamRes = clickup_api_request($token, 'GET', '/team');
    if (($teamRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
    if (!empty($teamRes['data']['teams'][0]['id'])) $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}
// Candidate workspaces: the stored/first one, then every team the user can access
// (the Wiki may live in a different workspace than the default).
$workspaces = [];
if ($workspaceId !== '') $workspaces[] = $workspaceId;
$allTeams = clickup_api_request($token, 'GET', '/team');
if (($allTeams['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
foreach (($allTeams['data']['teams'] ?? []) as $t) {
    $tid = (string)($t['id'] ?? '');
    if ($tid !== '' && !in_array($tid, $workspaces, true)) $workspaces[] = $tid;
}
if (empty($workspaces)) { http_response_code(502); echo json_encode(["error" => "no_workspace", "message" => "No ClickUp workspace found."]); exit; }

// Fetch a doc's page tree. Returns ['code'=>int, 'pages'=>array, 'error'=>string].
$fetchPages = function (string $ws, string $id) use ($token): array {
    $r = clickup_api_request($token, 'GET', "/workspaces/{$ws}/docs/{$id}/pages?content_format=text/md", null, 'v3');
    if (($r['code'] ?? 0) !== 200) {
        $r = clickup_api_request($token, 'GET', "/workspaces/{$ws}/docs/{$id}/pages", null, 'v3');
    }
    $d = is_array($r['data'] ?? null) ? $r['data'] : [];
    $pages = is_array($d['pages'] ?? null) ? $d['pages'] : (isset($d[0]) ? $d : []);
    return ['code' => (int)($r['code'] ?? 0), 'pages' => $pages, 'error' => (string)($r['error'] ?? '')];
};

$rawPages = [];
$resolvedDocId = '';
$resolvedWs = '';
$docsSeen = [];
$lastCode = 0; $lastErr = ''; $listForbidden = false;

foreach ($workspaces as $ws) {
    // 1) Direct attempt with the provided id.
    $pf = $fetchPages($ws, $docId);
    if ($pf['code'] === 200 && !empty($pf['pages'])) { $rawPages = $pf['pages']; $resolvedDocId = $docId; $resolvedWs = $ws; break; }
    $lastCode = $pf['code']; $lastErr = $pf['error'];

    // 2) Resolve by listing docs (match by exact id, then by name "Chili Wiki").
    $docsRes = clickup_api_request($token, 'GET', "/workspaces/{$ws}/docs?limit=100", null, 'v3');
    $dc = (int)($docsRes['code'] ?? 0);
    if ($dc === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
    if ($dc === 403) { $listForbidden = true; $lastCode = 403; $lastErr = (string)($docsRes['error'] ?? ''); continue; }
    if ($dc !== 200) { $lastCode = $dc; $lastErr = (string)($docsRes['error'] ?? ''); continue; }

    $docs = is_array($docsRes['data']['docs'] ?? null) ? $docsRes['data']['docs'] : (is_array($docsRes['data']) ? $docsRes['data'] : []);
    $match = '';
    foreach ($docs as $dd) {
        if (!is_array($dd)) continue;
        $id = (string)($dd['id'] ?? ''); $nm = (string)($dd['name'] ?? '');
        if ($nm !== '') $docsSeen[] = $nm;
        if ($id === $docId || ($nm !== '' && mb_stripos($nm, 'chili wiki') !== false)) { $match = $id; break; }
    }
    if ($match !== '') {
        $pf2 = $fetchPages($ws, $match);
        if ($pf2['code'] === 200 && !empty($pf2['pages'])) { $rawPages = $pf2['pages']; $resolvedDocId = $match; $resolvedWs = $ws; break; }
        $lastCode = $pf2['code']; $lastErr = $pf2['error'];
    }
}

if (empty($rawPages)) {
    http_response_code(502);
    $hint = $listForbidden
        ? "Sem acesso à API de Docs (403). Reconecte o ClickUp e confirme que a conta tem permissão de Docs."
        : "Doc não encontrado nos seus workspaces. Confira o ID do Wiki ou o workspace.";
    echo json_encode([
        "error"        => "wiki_fetch_failed",
        "message"      => "ClickUp {$lastCode} ao carregar o Wiki '{$docId}': {$lastErr}. {$hint}",
        "doc_id"       => $docId,
        "workspaces"   => $workspaces,
        "docs_seen"    => array_values(array_unique($docsSeen)),
        "clickup_code" => $lastCode,
    ]);
    exit;
}

$docId = $resolvedDocId ?: $docId;   // use the resolved id for the page links
$flat = clickup_flatten_doc_pages($rawPages);

$companies = [];
$seen = [];
foreach ($flat as $pg) {
    $parsed = clickup_parse_wiki_title((string)$pg['name']);
    if ($parsed === null) continue;                       // not a "{Company} - ..." page
    $key = mb_strtolower($parsed['company']) . '|' . $pg['id'];
    if (isset($seen[$key])) continue;
    $seen[$key] = true;
    $companies[] = [
        'company'  => $parsed['company'],
        'services' => $parsed['services'],
        'region'   => $parsed['region'],
        'title'    => $parsed['raw'],
        'doc_id'   => $docId,
        'page_id'  => (string)$pg['id'],
    ];
}

echo json_encode([
    "success"   => true,
    "doc_id"    => $docId,
    "count"     => count($companies),
    "companies" => $companies,
]);
$conn->close();
