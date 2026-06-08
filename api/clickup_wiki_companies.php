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
if ($workspaceId === '') { http_response_code(502); echo json_encode(["error" => "no_workspace", "message" => "No ClickUp workspace found."]); exit; }

// Fetch the full page tree of the Wiki Doc (titles only — content is loaded on click).
$pagesRes = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}/pages?max_page_depth=-1", null, 'v3');
if (($pagesRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
if (($pagesRes['code'] ?? 0) !== 200) {
    http_response_code(502);
    echo json_encode(["error" => "wiki_fetch_failed", "message" => $pagesRes['error'] ?: 'Could not load the Wiki pages.', "doc_id" => $docId]);
    exit;
}
$d = $pagesRes['data'];
$rawPages = is_array($d['pages'] ?? null) ? $d['pages'] : (is_array($d) ? $d : []);
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
