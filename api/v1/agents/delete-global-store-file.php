<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
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
$fileId = (int)($body['file_id'] ?? 0);

if ($userId <= 0 || $fileId <= 0 || !in_array($storeType, ['lp', 'ads'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, store_type and file_id are required']);
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
    $stmt = $conn->prepare(
        "SELECT document_name, storage_path
         FROM global_store_files
         WHERE id = ? AND store_type = ?
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('is', $fileId, $storeType);
    $stmt->execute();
    $stmt->bind_result($documentName, $storagePath);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'File not found']);
        exit;
    }
    $stmt->close();

    $deletedDocument = false;
    $deleteWarning = null;
    if (is_string($documentName) && trim($documentName) !== '') {
        try {
            $deletedDocument = agents_delete_gemini_file_search_document($documentName);
        } catch (Throwable $deleteError) {
            $deleteWarning = $deleteError->getMessage();
            error_log('[agents/delete-global-store-file] Gemini delete warning: ' . $deleteWarning);
        }
    }

    if (is_string($storagePath) && trim($storagePath) !== '') {
        $baseDir = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');
        $absolutePath = realpath($baseDir . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $storagePath));
        $allowedRoot = realpath($baseDir . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'agents-global');
        if ($absolutePath && $allowedRoot && agents_starts_with($absolutePath, $allowedRoot) && is_file($absolutePath)) {
            @unlink($absolutePath);
        }
    }

    $delStmt = $conn->prepare("DELETE FROM global_store_files WHERE id = ? AND store_type = ?");
    if (!$delStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $delStmt->bind_param('is', $fileId, $storeType);
    $delStmt->execute();
    $affected = $delStmt->affected_rows;
    $delStmt->close();

    echo json_encode([
        'success' => true,
        'deletedDocument' => $deletedDocument,
        'deletedRecord' => $affected > 0,
        'warning' => $deleteWarning,
    ]);
} catch (Throwable $e) {
    error_log('[agents/delete-global-store-file] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
