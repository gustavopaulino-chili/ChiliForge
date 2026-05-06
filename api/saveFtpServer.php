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

$userId    = isset($data['user_id'])    ? (int)$data['user_id']            : 0;
$label     = isset($data['label'])      ? trim((string)$data['label'])      : '';
$ftpHost   = isset($data['host'])       ? preg_replace('#^ftps?://#i', '', trim((string)$data['host'])) : '';
$port      = isset($data['port'])       ? (int)$data['port']                : 21;
$username  = isset($data['username'])   ? trim((string)$data['username'])   : '';
$targetDir = isset($data['target_dir']) ? trim((string)$data['target_dir']) : '/';
$serverId  = isset($data['id'])         ? (int)$data['id']                  : 0;

if ($userId <= 0 || $ftpHost === '' || $username === '') {
    http_response_code(400);
    echo json_encode(["error" => "user_id, host, and username are required"]);
    exit;
}

if (preg_match('/^(localhost|127\.\d+\.\d+\.\d+|::1)$/i', $ftpHost)) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid FTP host — please enter the address of the destination server, not localhost"]);
    exit;
}

if ($port < 1 || $port > 65535) $port = 21;
if ($targetDir !== '/') $targetDir = rtrim($targetDir, '/') . '/';

include "db.php";

if ($serverId > 0) {
    $stmt = $conn->prepare(
        "UPDATE ftp_servers SET label=?, host=?, port=?, username=?, target_dir=?
         WHERE id=? AND user_id=?"
    );
    $stmt->bind_param("ssissii", $label, $ftpHost, $port, $username, $targetDir, $serverId, $userId);
    $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    $conn->close();

    if ($affected === 0) {
        http_response_code(404);
        echo json_encode(["error" => "Server not found or not owned by this user"]);
        exit;
    }
    echo json_encode(["success" => true, "id" => $serverId]);
} else {
    // Check for existing record with same user + host + username to prevent duplicates
    $check = $conn->prepare(
        "SELECT id FROM ftp_servers WHERE user_id=? AND host=? AND username=? LIMIT 1"
    );
    $check->bind_param("iss", $userId, $ftpHost, $username);
    $check->execute();
    $check->bind_result($existingId);
    $check->fetch();
    $check->close();

    if ($existingId) {
        // Update the existing record instead of inserting a duplicate
        $upd = $conn->prepare(
            "UPDATE ftp_servers SET label=?, port=?, target_dir=? WHERE id=? AND user_id=?"
        );
        $upd->bind_param("sisii", $label, $port, $targetDir, $existingId, $userId);
        $upd->execute();
        $upd->close();
        $conn->close();
        echo json_encode(["success" => true, "id" => $existingId]);
    } else {
        $stmt = $conn->prepare(
            "INSERT INTO ftp_servers (user_id, label, host, port, username, target_dir)
             VALUES (?, ?, ?, ?, ?, ?)"
        );
        $stmt->bind_param("ississ", $userId, $label, $ftpHost, $port, $username, $targetDir);
        $stmt->execute();
        $newId = (int)$conn->insert_id;
        $stmt->close();
        $conn->close();
        echo json_encode(["success" => true, "id" => $newId]);
    }
}
