<?php
// Returns the ClickUp authorization URL for the given Forge user.
// The frontend opens this URL (redirect/popup); ClickUp sends the user back to
// clickup_callback.php with ?code=...&state=...
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
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

$clientId    = clickup_client_id();
$redirectUri = clickup_redirect_uri();
if ($clientId === '') {
    http_response_code(500);
    echo json_encode(["error" => "ClickUp app not configured on the server (missing CLICKUP_CLIENT_ID)."]);
    exit;
}

clickup_ensure_schema($conn);

$state = clickup_make_state($userId);
$authorizeUrl = 'https://app.clickup.com/api?' . http_build_query([
    'client_id'    => $clientId,
    'redirect_uri' => $redirectUri,
    'state'        => $state,
]);

echo json_encode([
    "success"       => true,
    "authorize_url" => $authorizeUrl,
]);
$conn->close();
