<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(120);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$userId           = (int)($_POST['user_id']            ?? 0);
$companyProjectId = (int)($_POST['company_project_id'] ?? 0);

if ($userId <= 0 || $companyProjectId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and company_project_id are required']);
    exit;
}

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'File upload failed or missing']);
    exit;
}

$allowedMimes = ['application/pdf', 'text/plain', 'text/html', 'image/jpeg', 'image/png'];
$file         = $_FILES['file'];
$mimeType     = mime_content_type($file['tmp_name']) ?: $file['type'];
$displayName  = pathinfo($file['name'], PATHINFO_FILENAME) ?: 'uploaded-file';
$fileSize     = $file['size'];

if (!in_array($mimeType, $allowedMimes, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Unsupported file type: ' . $mimeType]);
    exit;
}

if ($fileSize > 10 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(['error' => 'File exceeds 10 MB limit']);
    exit;
}

try {
    // 1. Verify ownership + load store name
    $stmt = $conn->prepare(
        "SELECT id, company_form_data, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $companyFormDataJson, $geminiStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    // 2. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 3. Lazy init company store if missing
    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];
    $companyDocument = buildCompanyDocument($companyFormData);
    agents_lazy_init_store($conn, $companyProjectId, $geminiStoreName, $companyDocument, $accountType, $userId);

    // 4. Upload file to store
    $fileBase64 = base64_encode(file_get_contents($file['tmp_name']));
    $storeResult = agents_call_edge_function('agents-store', [
        'action'      => 'upload_file',
        'storeName'   => $geminiStoreName,
        'fileBase64'  => $fileBase64,
        'mimeType'    => $mimeType,
        'displayName' => $displayName,
        'accountType' => $accountType,
    ]);

    if (!empty($storeResult['error'])) {
        throw new RuntimeException('agents-store error: ' . $storeResult['error']);
    }

    $documentName = agents_extract_document_name($storeResult);

    // 5. Persist record in DB
    agents_ensure_company_store_files_table($conn);
    $recordType = 'uploaded_file';
    $originalName = $file['name'];
    $insStmt = $conn->prepare(
        "INSERT INTO company_store_files
         (company_project_id, gemini_file_uri, gemini_store_name, record_type, display_name, original_name, mime_type, file_size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    if (!$insStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $insStmt->bind_param('issssssii', $companyProjectId, $documentName, $geminiStoreName, $recordType, $displayName, $originalName, $mimeType, $fileSize, $userId);
    $insStmt->execute();
    $fileId = (int)$conn->insert_id;
    $insStmt->close();

    echo json_encode([
        'success'     => true,
        'fileId'      => $fileId,
        'displayName' => $displayName,
        'storeName'   => $geminiStoreName,
        'fileUri'     => null,
        'documentName'=> $documentName,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/upload-company-file] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
