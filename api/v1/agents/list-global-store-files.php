<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/../../accountType.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$userId = (int)($body['user_id'] ?? 0);
$storeType = (string)($body['store_type'] ?? '');

if ($userId <= 0 || !in_array($storeType, ['lp', 'ads', 'ads_reference', 'ads_image_reference'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and store_type are required']);
    exit;
}

$authorized = false;
$userStmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1");
if ($userStmt) {
    $userStmt->bind_param('i', $userId);
    $userStmt->execute();
    $userStmt->bind_result($userEmail, $storedAccountType);
    $userStmt->fetch();
    $userStmt->close();
    $result = resolve_account_type_by_domain($userEmail ?? '', $storedAccountType ?? 'user');
    $authorized = ($result['accountType'] === 'admin');
}

if (!$authorized) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

try {
    $conn->query("CREATE TABLE IF NOT EXISTS global_store_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_type ENUM('lp', 'ads', 'ads_reference', 'ads_image_reference') NOT NULL,
        store_name VARCHAR(255) NOT NULL,
        document_name VARCHAR(500) NULL,
        display_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NULL,
        mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
        file_size_bytes INT NULL,
        storage_path VARCHAR(500) NOT NULL,
        uploaded_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_global_store_type (store_type),
        INDEX idx_global_store_name (store_name)
    )");
    $conn->query("ALTER TABLE global_store_files MODIFY store_type ENUM('lp', 'ads', 'ads_reference', 'ads_image_reference') NOT NULL");

    $stmt = $conn->prepare(
        "SELECT id, store_name, document_name, display_name, original_name, mime_type, file_size_bytes, storage_path, created_at
         FROM global_store_files
         WHERE store_type = ?
         ORDER BY created_at DESC"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('s', $storeType);
    $stmt->execute();
    $stmt->bind_result($id, $storeName, $documentName, $displayName, $originalName, $mimeType, $fileSize, $storagePath, $createdAt);

    $files = [];
    while ($stmt->fetch()) {
        $files[] = [
            'id' => (int)$id,
            'store_name' => $storeName,
            'document_name' => $documentName,
            'display_name' => $displayName,
            'original_name' => $originalName,
            'mime_type' => $mimeType,
            'file_size_bytes' => $fileSize === null ? null : (int)$fileSize,
            'storage_path' => $storagePath,
            'created_at' => $createdAt,
        ];
    }
    $stmt->close();

    echo json_encode(['success' => true, 'files' => $files], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('[agents/list-global-store-files] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
