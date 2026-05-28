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

$body            = json_decode(file_get_contents('php://input'), true);
$userId          = isset($body['user_id']) ? (int)$body['user_id'] : 0;
$key             = isset($body['gemini_api_key']) ? trim((string)$body['gemini_api_key']) : null;
$generateAsImage = array_key_exists('generate_as_image', $body) ? (int)$body['generate_as_image'] : null;

if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id is required']);
    exit;
}

// Ensure columns exist (migration guard)
$conn->query("ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key VARCHAR(255) NULL DEFAULT NULL");
$conn->query("ALTER TABLE users ADD COLUMN IF NOT EXISTS generate_as_image TINYINT(1) NOT NULL DEFAULT 0");

$storeValue = ($key === null || $key === '') ? null : $key;

if ($generateAsImage !== null) {
    $imgVal = $generateAsImage ? 1 : 0;
    $stmt   = $conn->prepare("UPDATE users SET gemini_api_key = ?, generate_as_image = ? WHERE id = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['error' => 'DB prepare error: ' . $conn->error]);
        exit;
    }
    $stmt->bind_param('sii', $storeValue, $imgVal, $userId);
} else {
    $stmt = $conn->prepare("UPDATE users SET gemini_api_key = ? WHERE id = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['error' => 'DB prepare error: ' . $conn->error]);
        exit;
    }
    $stmt->bind_param('si', $storeValue, $userId);
}

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save settings']);
    exit;
}
$stmt->close();

echo json_encode(['success' => true, 'cleared' => $storeValue === null]);
