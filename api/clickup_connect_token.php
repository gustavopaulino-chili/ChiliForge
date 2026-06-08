<?php
// Connect ClickUp with a PERSONAL API token (pk_...). Simpler than OAuth:
// no app registration / redirect. Validates the token against GET /user, then
// stores it encrypted as the user's connection (same row OAuth would use), so
// clickup_list_companies.php / clickup_import_companies.php work unchanged.
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$data   = json_decode(file_get_contents("php://input"), true);
$userId = isset($data['user_id'])   ? (int)$data['user_id'] : 0;
$token  = isset($data['api_token']) ? trim((string)$data['api_token']) : '';
if ($userId <= 0 || $token === '') {
    http_response_code(400);
    echo json_encode(["error" => "user_id and api_token are required"]);
    exit;
}

clickup_ensure_schema($conn);

// Validate the token (ClickUp v2 takes the token RAW in Authorization).
$userRes = clickup_api_request($token, 'GET', '/user');
if (($userRes['code'] ?? 0) === 401 || empty($userRes['data']['user']['id'])) {
    http_response_code(401);
    echo json_encode(["error" => "invalid_token", "message" => "Token inválido ou sem permissão. Verifique a API key do ClickUp."]);
    exit;
}
$clickupUserId = (string)$userRes['data']['user']['id'];

// Resolve the first authorized workspace (team).
$workspaceId = null;
$teamRes = clickup_api_request($token, 'GET', '/team');
if (($teamRes['code'] ?? 0) === 200 && !empty($teamRes['data']['teams'][0]['id'])) {
    $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}

// Personal tokens don't expire and have no refresh token.
$saved = clickup_save_connection($conn, $userId, $token, null, null, $clickupUserId, $workspaceId);
if (!$saved) {
    http_response_code(500);
    echo json_encode(["error" => "save_failed", "message" => "Não foi possível salvar a conexão."]);
    exit;
}

echo json_encode([
    "success"      => true,
    "connected"    => true,
    "workspace_id" => $workspaceId,
]);
$conn->close();
