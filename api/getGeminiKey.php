<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

include "db.php";

$body   = json_decode(file_get_contents('php://input'), true);
$userId = isset($body['user_id']) ? (int)$body['user_id'] : 0;

if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id is required']);
    exit;
}

$stmt = $conn->prepare("SELECT gemini_api_key, generate_as_image FROM users WHERE id = ? LIMIT 1");
if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'DB prepare error']);
    exit;
}
$stmt->bind_param('i', $userId);
$stmt->execute();
$stmt->bind_result($key, $generateAsImage);
$stmt->fetch();
$stmt->close();

echo json_encode([
    'gemini_api_key'    => is_string($key) && trim($key) !== '' ? $key : null,
    'generate_as_image' => (bool)$generateAsImage,
]);
