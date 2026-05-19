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
$stateType = isset($data['project_type']) ? preg_replace('/[^a-z_]/', '', strtolower((string)$data['project_type'])) : '';

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

if ($currentStep < 0) {
    $currentStep = 0;
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
$publicUrl = (string)($projectRow['public_url'] ?? '');
$folderPath = (string)($projectRow['folder_path'] ?? '');
$isAdCreative = (($projectRow['project_type'] ?? '') === 'ad_creative') || $stateType === 'ad_creative';

if ($isAdCreative) {
    $campaign = find_latest_ad_campaign_for_project($conn, $projectId);
    if ($campaign) {
        $campaignId = (int)$campaign['id'];
        $update = $conn->prepare(
            "UPDATE ads_campaign ac
             INNER JOIN projects p ON p.id = ac.project_id
             SET ac.current_step = ?, ac.updated_at = NOW()
             WHERE ac.id = ? AND ac.project_id = ? AND p.user_id = ?"
        );
        if (!$update) {
            http_response_code(500);
            echo json_encode(["error" => "Failed to prepare AD campaign step update", "details" => $conn->error]);
            $conn->close();
            exit;
        }
        $update->bind_param("iiii", $currentStep, $campaignId, $projectId, $effectiveUserId);
    } else {
        $status = 'draft';
        $metadata = '{}';
        $adPublicUrl = project_public_prefix_from_folder_path($folderPath, $publicUrl);
        if ($adPublicUrl === '') {
            $adPublicUrl = '/projects/project-' . $projectId . '/';
        }
        $update = $conn->prepare(
            "INSERT INTO ads_campaign (project_id, name, form_data, public_url, current_step, status, metadata, created_at, updated_at)
             SELECT p.id, p.name, '{}', ?, ?, ?, ?, NOW(), NOW()
             FROM projects p
             WHERE p.id = ? AND p.user_id = ?"
        );
        if (!$update) {
            http_response_code(500);
            echo json_encode(["error" => "Failed to prepare AD campaign step insert", "details" => $conn->error]);
            $conn->close();
            exit;
        }
        $update->bind_param("sissii", $adPublicUrl, $currentStep, $status, $metadata, $projectId, $effectiveUserId);
    }
} else {
    $update = $conn->prepare(
        "INSERT INTO lps (project_id, public_url, folder_path, form_data, current_step)
         SELECT p.id, ?, ?, COALESCE(l.form_data, '{}'), ?
         FROM projects p
         LEFT JOIN lps l ON l.project_id = p.id
         WHERE p.id = ? AND p.user_id = ?
         ON DUPLICATE KEY UPDATE
           current_step = VALUES(current_step)"
    );
    if (!$update) {
        http_response_code(500);
        echo json_encode(["error" => "Failed to prepare LP step update", "details" => $conn->error]);
        $conn->close();
        exit;
    }
    $update->bind_param("ssiii", $publicUrl, $folderPath, $currentStep, $projectId, $effectiveUserId);
}

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
