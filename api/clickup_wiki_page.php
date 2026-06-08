<?php
// Loads the content (markdown) of a single ClickUp Wiki subpage, so the UI can show
// a client's page when the user clicks it. Docs API v3.
// GET ?user_id=&doc_id=&page_id=
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId = isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0;
$docId  = trim((string)($_REQUEST['doc_id'] ?? '')) ?: clickup_wiki_doc_id();
$pageId = trim((string)($_REQUEST['page_id'] ?? ''));
if ($userId <= 0 || $pageId === '') { http_response_code(400); echo json_encode(["error" => "user_id and page_id are required"]); exit; }

clickup_ensure_schema($conn);
$row = clickup_get_connection($conn, $userId);
if (!$row || ($row['access_token'] ?? '') === '') {
    http_response_code(409);
    echo json_encode(["error" => "not_connected", "message" => "Connect your ClickUp account first."]);
    exit;
}
$token = $row['access_token'];

$workspaceId = (string)($row['workspace_id'] ?? '');
if ($workspaceId === '') {
    $teamRes = clickup_api_request($token, 'GET', '/team');
    if (!empty($teamRes['data']['teams'][0]['id'])) $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}
if ($workspaceId === '') { http_response_code(502); echo json_encode(["error" => "no_workspace"]); exit; }

$res = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}/pages/{$pageId}?content_format=text/md", null, 'v3');
if (($res['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
if (($res['code'] ?? 0) !== 200) {
    http_response_code(502);
    echo json_encode(["error" => "page_fetch_failed", "message" => $res['error'] ?: 'Could not load the page.']);
    exit;
}
$data = is_array($res['data']) ? $res['data'] : [];
// The page object may be returned directly or wrapped; handle both.
$page = isset($data['id']) ? $data : (is_array($data['page'] ?? null) ? $data['page'] : $data);

echo json_encode([
    "success" => true,
    "doc_id"  => $docId,
    "page_id" => $pageId,
    "name"    => (string)($page['name'] ?? ''),
    "content" => (string)($page['content'] ?? ''),
]);
$conn->close();
