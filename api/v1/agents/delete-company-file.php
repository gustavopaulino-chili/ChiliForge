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
$fileId           = (int)($body['file_id']            ?? 0);

if ($userId <= 0 || $companyProjectId <= 0 || $fileId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id and file_id are required']);
    exit;
}

try {
    agents_ensure_company_store_files_table($conn);

    // Verify ownership of the project
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

    $documentName = '';
    $recordType = '';
    $fileStmt = $conn->prepare(
        "SELECT gemini_file_uri, record_type FROM company_store_files WHERE id = ? AND company_project_id = ? LIMIT 1"
    );
    if (!$fileStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $fileStmt->bind_param('ii', $fileId, $companyProjectId);
    $fileStmt->execute();
    $fileStmt->bind_result($documentName, $recordType);
    if (!$fileStmt->fetch()) {
        $fileStmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'File not found']);
        exit;
    }
    $fileStmt->close();

    $deleteWarning = null;
    if (is_string($documentName) && trim($documentName) !== '') {
        try {
            agents_delete_gemini_file_search_document($documentName);
        } catch (Throwable $e) {
            $deleteWarning = $e->getMessage();
            error_log('[agents/delete-company-file] Gemini delete warning: ' . $deleteWarning);
        }
    }

    $delStmt = $conn->prepare(
        "DELETE FROM company_store_files WHERE id = ? AND company_project_id = ?"
    );
    if (!$delStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $delStmt->bind_param('ii', $fileId, $companyProjectId);
    $delStmt->execute();
    $affected = $delStmt->affected_rows;
    $delStmt->close();

    echo json_encode(['success' => true, 'delete_warning' => $deleteWarning]);

} catch (Throwable $e) {
    error_log('[agents/delete-company-file] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
