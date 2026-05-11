<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id']) || !array_key_exists('current_step', $data) || !isset($data['form_data'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$projectId = (int)$data['id'];
$userId = (int)$data['user_id'];
$currentStep = (int)$data['current_step'];
$formData = json_encode($data['form_data'], JSON_UNESCAPED_UNICODE);

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

if ($currentStep < 0) {
    $currentStep = 0;
}

if ($formData === false) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid form_data payload"]);
    exit;
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
include "db.php";

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.id');
if (!$projectRow) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}
$effectiveUserId = (int)($projectRow['actual_user_id'] ?? $userId);

$update = $conn->prepare("UPDATE projects SET form_data = ?, current_step = ? WHERE id = ? AND user_id = ?");
$update->bind_param("siii", $formData, $currentStep, $projectId, $effectiveUserId);

if (!$update->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to update project form state", "details" => $update->error]);
    $update->close();
    $conn->close();
    exit;
}

echo json_encode([
    "success" => true,
    "id" => $projectId,
    "current_step" => $currentStep,
]);

$update->close();
$conn->close();
?>
