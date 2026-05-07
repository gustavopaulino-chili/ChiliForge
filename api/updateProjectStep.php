<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id']) || !isset($data['current_step'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$projectId = (int)$data['id'];
$userId = (int)$data['user_id'];
$currentStep = (int)$data['current_step'];

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

if ($currentStep < 0) {
    $currentStep = 0;
}

include "db.php";

$update = $conn->prepare("UPDATE projects SET current_step = ? WHERE id = ? AND user_id = ?");
$update->bind_param("iii", $currentStep, $projectId, $userId);

if (!$update->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to update project step", "details" => $update->error]);
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