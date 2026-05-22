<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(120);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$storeType   = $_POST['store_type']  ?? '';
$displayName = trim($_POST['display_name'] ?? '');
$textContent = trim($_POST['text'] ?? '');

// Auth: accept either admin_key (CLI/server) or user_id (frontend, validates via DB)
$adminKey = $_POST['admin_key'] ?? '';
$userId   = (int)($_POST['user_id'] ?? 0);

$authorized = false;

if ($adminKey !== '') {
    $expectedKey = getenv('AGENTS_ADMIN_KEY') ?: '';
    $authorized  = $expectedKey !== '' && $adminKey === $expectedKey;
} elseif ($userId > 0) {
    $userStmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1");
    if ($userStmt) {
        $userStmt->bind_param('i', $userId);
        $userStmt->execute();
        $userStmt->bind_result($userEmail, $storedAccountType);
        $userStmt->fetch();
        $userStmt->close();
        $result     = resolve_account_type_by_domain($userEmail ?? '', $storedAccountType ?? 'user');
        $authorized = ($result['accountType'] === 'admin');
    } else {
        // Backward compatibility for older DBs that do not have users.account_type yet.
        $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
        if ($emailStmt) {
            $emailStmt->bind_param('i', $userId);
            $emailStmt->execute();
            $emailStmt->bind_result($userEmail);
            $emailStmt->fetch();
            $emailStmt->close();
            $result     = resolve_account_type_by_domain($userEmail ?? '', 'user');
            $authorized = ($result['accountType'] === 'admin');
        }
    }
}

if (!$authorized) {
    http_response_code(403);
    echo json_encode([
        'error' => 'Forbidden: this user is not authorized as admin on the server. Check users.account_type or ADMIN_EMAILS/ADMIN_EMAIL_DOMAINS.',
    ]);
    exit;
}

if (!in_array($storeType, ['lp', 'ads'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'store_type must be "lp" or "ads"']);
    exit;
}

$settingKey = 'gemini_global_' . $storeType . '_store';

$hasFile = !empty($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK;
if (!$hasFile && $textContent === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Either a file upload or text content is required']);
    exit;
}

$ensureGlobalFilesTable = function () use ($conn): void {
    $sql = "CREATE TABLE IF NOT EXISTS global_store_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_type ENUM('lp', 'ads') NOT NULL,
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
    )";
    if (!$conn->query($sql)) {
        throw new RuntimeException('Failed to ensure global_store_files table: ' . $conn->error);
    }
};

$safeFileName = function (string $name): string {
    $name = preg_replace('/[^a-zA-Z0-9._-]+/', '-', $name);
    $name = trim((string)$name, '.-');
    return $name !== '' ? substr($name, 0, 160) : 'global-store-file';
};

$savePermanentFile = function (string $sourcePath, string $originalName, string $storeType, ?string $contents = null) use ($safeFileName): array {
    $baseDir = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');
    $storageRoot = $baseDir . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'agents-global' . DIRECTORY_SEPARATOR . $storeType;
    if (!is_dir($storageRoot) && !mkdir($storageRoot, 0755, true)) {
        throw new RuntimeException('Failed to create permanent global store upload directory');
    }

    $ext = pathinfo($originalName, PATHINFO_EXTENSION);
    $baseName = pathinfo($originalName, PATHINFO_FILENAME);
    $fileName = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '-' . $safeFileName($baseName);
    if ($ext !== '') {
        $fileName .= '.' . $safeFileName($ext);
    }

    $targetPath = $storageRoot . DIRECTORY_SEPARATOR . $fileName;
    if ($contents !== null) {
        if (file_put_contents($targetPath, $contents) === false) {
            throw new RuntimeException('Failed to permanently save global store text file');
        }
    } elseif (!move_uploaded_file($sourcePath, $targetPath)) {
        throw new RuntimeException('Failed to permanently save global store uploaded file');
    }

    $relativePath = 'uploads/agents-global/' . $storeType . '/' . $fileName;
    return [$targetPath, $relativePath, filesize($targetPath) ?: null];
};

try {
    // 1. Load existing store name
    $storeName = '';
    $settingStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1");
    if ($settingStmt) {
        $settingStmt->bind_param('s', $settingKey);
        $settingStmt->execute();
        $settingStmt->bind_result($storeName);
        $settingStmt->fetch();
        $settingStmt->close();
    }

    // 2. Create store if it doesn't exist (use text placeholder if only file provided)
    if (empty($storeName)) {
        $initText = $textContent ?: ('Global ' . strtoupper($storeType) . ' store initialized.');
        $initLabel = $displayName ?: ('Global ' . strtoupper($storeType) . ' Guidelines');
        $initResult = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'displayName'   => 'global-' . $storeType . '-store',
            'documentText'  => $initText,
            'documentLabel' => $initLabel,
            'accountType'   => 'admin',
        ]);
        if (empty($initResult['storeName'])) {
            throw new RuntimeException('Failed to create global store');
        }
        $storeName = $initResult['storeName'];

        // Save to system_settings
        $upsertStmt = $conn->prepare(
            "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)"
        );
        $upsertStmt->bind_param('ss', $settingKey, $storeName);
        $upsertStmt->execute();
        $upsertStmt->close();
    }

    // 3. If a file was uploaded, upload it to the store
    $documentName = null;
    $permanentPath = null;
    $permanentSize = null;
    $originalName = null;
    $mimeTypeForRecord = 'text/plain';
    $displayNameForRecord = $displayName;
    if ($hasFile) {
        $file        = $_FILES['file'];
        $mimeType    = mime_content_type($file['tmp_name']) ?: $file['type'];
        $fileLabel   = $displayName ?: pathinfo($file['name'], PATHINFO_FILENAME);
        $fileBase64  = base64_encode(file_get_contents($file['tmp_name']));
        $originalName = $file['name'] ?? null;
        $mimeTypeForRecord = $mimeType;
        $displayNameForRecord = $fileLabel;

        $uploadResult = agents_call_edge_function('agents-store', [
            'action'      => 'upload_file',
            'storeName'   => $storeName,
            'fileBase64'  => $fileBase64,
            'mimeType'    => $mimeType,
            'displayName' => $fileLabel,
            'accountType' => 'admin',
        ]);

        if (!empty($uploadResult['error'])) {
            throw new RuntimeException('agents-store upload error: ' . $uploadResult['error']);
        }
        $documentName = $uploadResult['document']['documentName'] ?? $uploadResult['document']['name'] ?? $uploadResult['operationName'] ?? null;
        [, $permanentPath, $permanentSize] = $savePermanentFile($file['tmp_name'], $file['name'], $storeType);
    } elseif ($textContent !== '') {
        // Upload text as plain text file
        $textLabel = $displayName ?: ('Guidelines ' . date('Y-m-d'));
        $textFileName = $safeFileName($textLabel) . '.txt';
        $displayNameForRecord = $textLabel;

        $uploadResult = agents_call_edge_function('agents-store', [
            'action'      => 'upload_file',
            'storeName'   => $storeName,
            'fileBase64'  => base64_encode($textContent),
            'mimeType'    => 'text/plain',
            'displayName' => $textLabel,
            'accountType' => 'admin',
        ]);

        if (!empty($uploadResult['error'])) {
            throw new RuntimeException('agents-store upload error: ' . $uploadResult['error']);
        }
        $documentName = $uploadResult['document']['documentName'] ?? $uploadResult['document']['name'] ?? $uploadResult['operationName'] ?? null;
        [, $permanentPath, $permanentSize] = $savePermanentFile('', $textFileName, $storeType, $textContent);
    }

    if ($permanentPath !== null) {
        $ensureGlobalFilesTable();
        $fileStmt = $conn->prepare(
            "INSERT INTO global_store_files
             (store_type, store_name, document_name, display_name, original_name, mime_type, file_size_bytes, storage_path, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        if (!$fileStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $fileStmt->bind_param(
            'ssssssisi',
            $storeType,
            $storeName,
            $documentName,
            $displayNameForRecord,
            $originalName,
            $mimeTypeForRecord,
            $permanentSize,
            $permanentPath,
            $userId
        );
        $fileStmt->execute();
        $fileStmt->close();
    }

    echo json_encode([
        'success'      => true,
        'storeName'    => $storeName,
        'documentName' => $documentName,
        'fileUri'      => null,
        'storedFile'   => $permanentPath,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/sync-global-store] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
