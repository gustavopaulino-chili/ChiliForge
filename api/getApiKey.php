<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

include "db.php";

$body = json_decode(file_get_contents('php://input'), true);
$userId = isset($body['user_id']) ? (int)$body['user_id'] : 0;

if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id is required']);
    exit;
}

// Return existing active key for this user
$stmt = $conn->prepare(
    "SELECT api_key, label, created_at, requests_count, last_used_at
     FROM api_keys
     WHERE user_id = ? AND is_active = 1
     ORDER BY created_at DESC
     LIMIT 1"
);
$stmt->bind_param('i', $userId);
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($existingKey, $existingLabel, $createdAt, $requestsCount, $lastUsedAt);

if ($stmt->fetch()) {
    $stmt->close();
    echo json_encode([
        'api_key'        => $existingKey,
        'label'          => $existingLabel,
        'created_at'     => $createdAt,
        'requests_count' => $requestsCount,
        'last_used_at'   => $lastUsedAt,
        'created'        => false,
    ]);
    exit;
}
$stmt->close();

// Generate new key
$newKey = 'cf_' . bin2hex(random_bytes(20));
$label  = 'My API Key';

$ins = $conn->prepare(
    "INSERT INTO api_keys (api_key, label, user_id, is_active, created_at)
     VALUES (?, ?, ?, 1, NOW())"
);
$ins->bind_param('ssi', $newKey, $label, $userId);
if (!$ins->execute()) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to create API key', 'details' => $ins->error]);
    exit;
}
$ins->close();

echo json_encode([
    'api_key'        => $newKey,
    'label'          => $label,
    'created_at'     => date('Y-m-d H:i:s'),
    'requests_count' => 0,
    'last_used_at'   => null,
    'created'        => true,
]);
