<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id']) || !isset($data['generated_html'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$projectId = (int)$data['id'];
$userId = (int)$data['user_id'];
$generatedHtml = strip_editor_bridge_artifacts((string)$data['generated_html']);

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

include "db.php";

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.id');

if (!$projectRow) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}

$folderPath = (string)($projectRow['folder_path'] ?? '');
$publicUrl  = (string)($projectRow['public_url']  ?? '');
$effectiveUserId = (int)($projectRow['actual_user_id'] ?? $userId);

if (($projectRow['project_type'] ?? '') === 'ad_creative') {
    echo json_encode([
        "success" => true,
        "id" => $projectId,
        "url" => $publicUrl,
        "skipped" => true,
        "message" => "AD creative content is saved through ad-specific endpoints.",
    ]);
    $conn->close();
    exit;
}

$update = $conn->prepare(
    "INSERT INTO lps (project_id, public_url, folder_path, form_data, generated_html, current_step)
     SELECT p.id, ?, ?, COALESCE(l.form_data, '{}'), ?, COALESCE(l.current_step, 0)
     FROM projects p
     LEFT JOIN lps l ON l.project_id = p.id
     WHERE p.id = ? AND p.user_id = ?
     ON DUPLICATE KEY UPDATE
       generated_html = VALUES(generated_html)"
);
if (!$update) {
    http_response_code(500);
    echo json_encode(["error" => "Query preparation failed", "details" => $conn->error]);
    $conn->close();
    exit;
}
$update->bind_param("sssii", $publicUrl, $folderPath, $generatedHtml, $projectId, $effectiveUserId);

if (!$update->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to update project", "details" => $update->error]);
    $update->close();
    $conn->close();
    exit;
}
$update->close();

$writeWarning = null;
if (is_string($folderPath) && trim($folderPath) !== '') {
    try {
        $projectDir = resolve_project_directory_from_folder_path((string)$folderPath, (string)$publicUrl);
        ensure_directory($projectDir);
        file_put_contents($projectDir . DIRECTORY_SEPARATOR . 'index.html', $generatedHtml);
    } catch (Throwable $error) {
        $writeWarning = $error->getMessage();
    }
}

echo json_encode([
    "success" => true,
    "id" => $projectId,
    "url" => $publicUrl,
    "warning" => $writeWarning,
]);

$conn->close();
?>
