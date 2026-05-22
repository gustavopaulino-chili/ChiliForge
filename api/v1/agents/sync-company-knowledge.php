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
    // 1. Load company project + verify ownership
    $stmt = $conn->prepare(
        "SELECT id, company_form_data, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $companyFormDataJson, $existingStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

    // 2. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 3. Build company document
    $companyDocument = buildCompanyDocument($companyFormData);

    // 4. Always (re)upload to store — creates if missing, refreshes if exists
    $storeResult = agents_call_edge_function('agents-store', [
        'action'        => 'get_or_create',
        'storeName'     => $existingStoreName ?: null,
        'displayName'   => 'company-' . $companyProjectId . '-brandguide',
        'documentText'  => $companyDocument,
        'documentLabel' => 'Brand Guidelines',
        'accountType'   => $accountType,
    ]);

    if (empty($storeResult['storeName'])) {
        throw new RuntimeException('agents-store did not return a storeName');
    }

    $storeName = $storeResult['storeName'];

    // 5. Save store name to DB (idempotent)
    $saveStmt = $conn->prepare("UPDATE projects SET gemini_store_name = ? WHERE id = ?");
    $saveStmt->bind_param('si', $storeName, $companyProjectId);
    $saveStmt->execute();
    $saveStmt->close();
    agents_upsert_company_profile_record($conn, $companyProjectId, $storeName, agents_extract_document_name($storeResult), $userId);

    echo json_encode([
        'success'   => true,
        'storeName' => $storeName,
        'refreshed' => !empty($existingStoreName),
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/sync-company-knowledge] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
