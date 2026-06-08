<?php
// Lists ClickUp Docs (wikis) of the connected user's workspace, so the user can
// pick one to attach to a company's knowledge store. Optional ?q= filters by name.
// Uses the Docs API v3.
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId = isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0;
$q      = trim((string)($_REQUEST['q'] ?? ''));
if ($userId <= 0) { http_response_code(400); echo json_encode(["error" => "user_id is required"]); exit; }

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

$docsRes = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs?limit=100", null, 'v3');
if (($docsRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
if (($docsRes['code'] ?? 0) !== 200) {
    http_response_code(502);
    echo json_encode(["error" => "docs_fetch_failed", "message" => $docsRes['error'] ?: 'Could not list ClickUp docs.']);
    exit;
}
$rawDocs = is_array($docsRes['data']['docs'] ?? null) ? $docsRes['data']['docs'] : (is_array($docsRes['data']) ? $docsRes['data'] : []);

$needle = mb_strtolower($q);
$docs = [];
foreach ($rawDocs as $d) {
    if (!is_array($d)) continue;
    $name = (string)($d['name'] ?? '');
    if ($q !== '' && mb_strpos(mb_strtolower($name), $needle) === false) continue;
    $docs[] = ['id' => (string)($d['id'] ?? ''), 'name' => $name];
}

echo json_encode(["success" => true, "docs" => $docs]);
$conn->close();
