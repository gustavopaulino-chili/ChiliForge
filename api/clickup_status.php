<?php
// Connection state for the UI: is this user connected to ClickUp?
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId = isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0;
if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "user_id is required"]);
    exit;
}

clickup_ensure_schema($conn);
$row = clickup_get_connection($conn, $userId);

echo json_encode([
    "success"         => true,
    "connected"       => $row !== null && ($row['access_token'] ?? '') !== '',
    "clickup_user_id" => $row['clickup_user_id'] ?? null,
    "workspace_id"    => $row['workspace_id'] ?? null,
    "configured"      => clickup_client_id() !== '',
]);
$conn->close();
