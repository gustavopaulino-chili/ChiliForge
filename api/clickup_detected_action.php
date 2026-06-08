<?php
// Updates the status of a ClickUp company detection.
// POST { user_id, id, action }  where action = 'dismiss' | 'imported'
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$body   = json_decode((string)file_get_contents('php://input'), true);
$userId = isset($body['user_id']) ? (int)$body['user_id'] : 0;
$id     = isset($body['id'])      ? (int)$body['id'] : 0;
$action = isset($body['action'])  ? trim((string)$body['action']) : '';

if ($userId <= 0 || $id <= 0 || !in_array($action, ['dismiss', 'imported'], true)) {
    http_response_code(400);
    echo json_encode(["error" => "user_id, id and a valid action (dismiss|imported) are required"]);
    exit;
}

clickup_ensure_schema($conn);

$status = $action === 'dismiss' ? 'dismissed' : 'imported';
$ok = false;
if ($st = $conn->prepare("UPDATE clickup_detected_companies SET status = ?, updated_at = NOW() WHERE id = ? AND user_id = ?")) {
    $st->bind_param('sii', $status, $id, $userId);
    $ok = $st->execute();
    $st->close();
}

echo json_encode(["success" => (bool)$ok, "status" => $status]);
$conn->close();
