<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/../../site_helpers.php';
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

$userId           = (int)($body['user_id']            ?? 0);
$companyProjectId = (int)($body['company_project_id'] ?? 0);

if ($userId <= 0 || $companyProjectId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and company_project_id are required']);
    exit;
}

try {
    agents_ensure_company_store_files_table($conn);

    // Verify ownership
    $ownerStmt = $conn->prepare(
        "SELECT id FROM projects WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$ownerStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $ownerStmt->bind_param('ii', $companyProjectId, $userId);
    $ownerStmt->execute();
    $ownerStmt->bind_result($projId);
    if (!$ownerStmt->fetch()) {
        $ownerStmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $ownerStmt->close();

    $listStmt = $conn->prepare(
        "SELECT id, record_type, display_name, original_name, mime_type, file_size_bytes, gemini_store_name, gemini_file_uri, created_at
         FROM company_store_files
         WHERE company_project_id = ?
         ORDER BY created_at DESC"
    );
    if (!$listStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $listStmt->bind_param('i', $companyProjectId);
    $listStmt->execute();
    $listStmt->bind_result($fId, $fRecordType, $fName, $fOriginalName, $fMime, $fSize, $fStoreName, $fUri, $fCreated);

    $files = [];
    while ($listStmt->fetch()) {
        $files[] = [
            'id'              => $fId,
            'record_type'     => $fRecordType,
            'display_name'    => $fName,
            'original_name'   => $fOriginalName,
            'mime_type'       => $fMime,
            'file_size_bytes' => $fSize,
            'gemini_store_name' => $fStoreName,
            'gemini_file_uri' => $fUri,
            'created_at'      => $fCreated,
        ];
    }
    $listStmt->close();

    echo json_encode(['success' => true, 'files' => $files], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/list-company-files] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
