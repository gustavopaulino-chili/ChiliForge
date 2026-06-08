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

// Fetch the page tree of the Wiki Doc. Mirror the proven v1 call (no max_page_depth,
// which ClickUp can reject). Try a couple of shapes and surface the real error.
$pagesRes = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}/pages?content_format=text/md", null, 'v3');
if (($pagesRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }

// Fallback A: plain /pages (no query).
if (($pagesRes['code'] ?? 0) !== 200) {
    $pagesRes = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}/pages", null, 'v3');
}
// Fallback B: fetch the Doc itself and read its embedded pages.
$d = is_array($pagesRes['data'] ?? null) ? $pagesRes['data'] : [];
$rawPages = is_array($d['pages'] ?? null) ? $d['pages'] : (isset($d[0]) ? $d : []);
if (($pagesRes['code'] ?? 0) !== 200 || empty($rawPages)) {
    $docRes = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}", null, 'v3');
    if (($docRes['code'] ?? 0) === 200) {
        $dd = is_array($docRes['data'] ?? null) ? $docRes['data'] : [];
        $rawPages = is_array($dd['pages'] ?? null) ? $dd['pages'] : $rawPages;
        if (!empty($rawPages)) $pagesRes = $docRes;
    }
    if (($pagesRes['code'] ?? 0) !== 200 && ($docRes['code'] ?? 0) !== 200) {
        $cuCode = (int)($pagesRes['code'] ?? 0);
        $cuMsg  = $pagesRes['error'] ?: ($docRes['error'] ?? 'Could not load the Wiki pages.');
        http_response_code(502);
        echo json_encode([
            "error"        => "wiki_fetch_failed",
            "message"      => "ClickUp respondeu {$cuCode} para o doc {$docId} (ws {$workspaceId}): {$cuMsg}",
            "doc_id"       => $docId,
            "workspace_id" => $workspaceId,
            "clickup_code" => $cuCode,
        ]);
        exit;
    }
}
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
