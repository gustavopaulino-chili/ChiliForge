<?php
// Registers (idempotently) a ClickUp `listCreated` webhook scoped to the chosen
// Folder (or folderless Space via "space:<id>"), so new companies are detected in
// near real-time. Stores webhook_id + secret (encrypted) in clickup_webhooks.
// POST { user_id, folder_id }.
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$body     = json_decode((string)file_get_contents('php://input'), true);
$userId   = isset($body['user_id'])   ? (int)$body['user_id'] : (isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0);
$folderId = isset($body['folder_id']) ? trim((string)$body['folder_id']) : trim((string)($_REQUEST['folder_id'] ?? ''));
if ($userId <= 0 || $folderId === '') {
    http_response_code(400);
    echo json_encode(["error" => "user_id and folder_id are required"]);
    exit;
}

clickup_ensure_schema($conn);

$conn_row = clickup_get_connection($conn, $userId);
if (!$conn_row || $conn_row['access_token'] === '') {
    http_response_code(409);
    echo json_encode(["error" => "not_connected", "message" => "Connect your ClickUp account first."]);
    exit;
}
$token = $conn_row['access_token'];

// Resolve workspace (team).
$workspaceId = (string)($conn_row['workspace_id'] ?? '');
if ($workspaceId === '') {
    $teamRes = clickup_api_request($token, 'GET', '/team');
    if (($teamRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
    if (!empty($teamRes['data']['teams'][0]['id'])) $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}
if ($workspaceId === '') {
    http_response_code(502);
    echo json_encode(["error" => "no_workspace", "message" => "No ClickUp workspace found."]);
    exit;
}

// Already monitoring this folder for this user? Idempotent — don't double-register.
$exists = false;
if ($st = $conn->prepare("SELECT webhook_id FROM clickup_webhooks WHERE user_id = ? AND folder_id = ? AND status = 'active' LIMIT 1")) {
    $st->bind_param('is', $userId, $folderId);
    $st->execute();
    $st->store_result();
    $exists = $st->num_rows > 0;
    $st->close();
}
if ($exists) {
    echo json_encode(["success" => true, "already_active" => true, "message" => "Detection already active for this folder."]);
    $conn->close();
    exit;
}

// Public receiver URL — derived from the OAuth redirect host.
$endpoint = str_replace('clickup_callback.php', 'clickup_webhook_receiver.php', clickup_redirect_uri());

// Scope: "space:<id>" → folderless space; otherwise a Folder.
$payload = ['endpoint' => $endpoint, 'events' => ['listCreated']];
if (strncmp($folderId, 'space:', 6) === 0) {
    $payload['space_id'] = substr($folderId, 6);
} else {
    $payload['folder_id'] = $folderId;
}

$res = clickup_api_request($token, 'POST', "/team/{$workspaceId}/webhook", $payload);
if (($res['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
$wh = is_array($res['data']['webhook'] ?? null) ? $res['data']['webhook'] : [];
$webhookId = (string)($wh['id'] ?? ($res['data']['id'] ?? ''));
$secret    = (string)($wh['secret'] ?? '');
if (($res['code'] ?? 0) >= 400 || $webhookId === '' || $secret === '') {
    http_response_code(502);
    echo json_encode(["error" => "webhook_register_failed", "message" => $res['error'] ?: 'ClickUp did not return a webhook id/secret.']);
    exit;
}

$encSecret = clickup_encrypt($secret);
$ins = $conn->prepare(
    "INSERT INTO clickup_webhooks (user_id, webhook_id, folder_id, endpoint, secret, status, fail_count)
     VALUES (?, ?, ?, ?, ?, 'active', 0)
     ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), endpoint = VALUES(endpoint),
        secret = VALUES(secret), status = 'active', fail_count = 0, updated_at = NOW()"
);
$ins->bind_param('issss', $userId, $webhookId, $folderId, $endpoint, $encSecret);
$ins->execute();
$ins->close();

echo json_encode(["success" => true, "webhook_id" => $webhookId, "endpoint" => $endpoint]);
$conn->close();
