<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required fields: id, user_id"]);
    exit;
}

$projectId  = (int)$data['id'];
$userId     = (int)$data['user_id'];
$name       = isset($data['name']) ? trim((string)$data['name']) : '';
$formData   = isset($data['company_form_data']) && is_array($data['company_form_data'])
    ? json_encode($data['company_form_data'], JSON_UNESCAPED_UNICODE)
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
    http_response_code(404);
    echo json_encode(["error" => "Company project not found or not owned by user"]);
    $stmt->close();
    $conn->close();
    exit;
}

echo json_encode(["success" => true, "id" => $projectId]);
$stmt->close();
$conn->close();
?>
