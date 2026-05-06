<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

if (!isset($_GET['user_id'])) {
    http_response_code(400);
    echo json_encode(["error" => "user_id is required"]);
    exit;
}

$userId = (int)$_GET['user_id'];
if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid user_id"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "SELECT id, label, host, port, username, target_dir, created_at
     FROM ftp_servers
     WHERE user_id = ?
     ORDER BY id DESC"
);
$stmt->bind_param("i", $userId);
$stmt->execute();
$result = $stmt->get_result();

$servers = [];
while ($row = $result->fetch_assoc()) {
    $servers[] = [
        "id"         => (int)$row['id'],
        "label"      => $row['label'],
        "host"       => $row['host'],
        "port"       => (int)$row['port'],
        "username"   => $row['username'],
        "target_dir" => $row['target_dir'],
        "created_at" => $row['created_at'],
    ];
}

$stmt->close();
$conn->close();

echo json_encode($servers);
