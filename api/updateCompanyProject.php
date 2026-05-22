<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'accountType.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'v1' . DIRECTORY_SEPARATOR . 'agents' . DIRECTORY_SEPARATOR . 'helpers.php';

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required fields: id, user_id"]);
    exit;
}

$projectId  = (int)$data['id'];
$userId     = (int)$data['user_id'];
$name       = isset($data['name']) ? trim((string)$data['name']) : '';
$formDataArray = isset($data['company_form_data']) && is_array($data['company_form_data'])
    ? $data['company_form_data']
    : [];
$formData   = isset($data['company_form_data']) && is_array($data['company_form_data'])
    ? json_encode($formDataArray, JSON_UNESCAPED_UNICODE)
    : '{}';
$context    = isset($data['context']) ? trim((string)$data['context']) : '';

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid id or user_id"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "UPDATE projects
     SET name = ?, company_form_data = ?, context = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ? AND project_type = 'project'"
);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to prepare statement", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("sssii", $name, $formData, $context, $projectId, $userId);

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to update company project", "details" => $stmt->error]);
    $stmt->close();
    $conn->close();
    exit;
}

if ($stmt->affected_rows === 0) {
    $existsStmt = $conn->prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1");
    if (!$existsStmt) {
        http_response_code(500);
        echo json_encode(["error" => "Failed to verify company project", "details" => $conn->error]);
        $stmt->close();
        $conn->close();
        exit;
    }
    $existsStmt->bind_param("ii", $projectId, $userId);
    $existsStmt->execute();
    $existsStmt->bind_result($existingProjectId);
    $exists = $existsStmt->fetch();
    $existsStmt->close();
    if (!$exists) {
        http_response_code(404);
        echo json_encode(["error" => "Company project not found or not owned by user"]);
        $stmt->close();
        $conn->close();
        exit;
    }
}

$storeWarning = null;
try {
    $email = '';
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    if ($emailStmt) {
        $emailStmt->bind_param("i", $userId);
        $emailStmt->execute();
        $emailStmt->bind_result($email);
        $emailStmt->fetch();
        $emailStmt->close();
    }

    $existingStoreName = null;
    $storeStmt = $conn->prepare("SELECT gemini_store_name FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
    if ($storeStmt) {
        $storeStmt->bind_param("ii", $projectId, $userId);
        $storeStmt->execute();
        $storeStmt->bind_result($existingStoreName);
        $storeStmt->fetch();
        $storeStmt->close();
    }

    $accountTypeResult = resolve_account_type_by_domain($email, 'user');
    agents_sync_company_store(
        $conn,
        $projectId,
        $formDataArray,
        $accountTypeResult['accountType'],
        $userId,
        $existingStoreName ?: null
    );
} catch (Throwable $e) {
    $storeWarning = $e->getMessage();
    error_log("Company store sync failed after updateCompanyProject: " . $storeWarning);
}

echo json_encode(["success" => true, "id" => $projectId, "store_warning" => $storeWarning]);
$stmt->close();
$conn->close();
?>
