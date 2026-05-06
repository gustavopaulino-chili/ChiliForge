<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON body"]);
    exit;
}

$userId   = isset($data['user_id'])                          ? (int)$data['user_id']                          : 0;
$serverId = isset($data['server_id']) ? (int)$data['server_id'] : (isset($data['id']) ? (int)$data['id'] : 0);

if ($userId <= 0 || $serverId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "user_id and server_id are required"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "DELETE FROM ftp_servers WHERE id=? AND user_id=?"
);
$stmt->bind_param("ii", $serverId, $userId);
$stmt->execute();
$affected = $stmt->affected_rows;
$stmt->close();
$conn->close();

if ($affected === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Server not found or not owned by this user"]);
    exit;
}

echo json_encode(["success" => true]);
