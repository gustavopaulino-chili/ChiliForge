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

$select = $conn->prepare("SELECT folder_path, public_url FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
$select->bind_param("ii", $projectId, $userId);
$select->execute();
$select->store_result();

if ($select->num_rows === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $select->close();
    $conn->close();
    exit;
}

$folderPath = '';
$publicUrl = '';
$select->bind_result($folderPath, $publicUrl);
$select->fetch();
$select->close();

$update = $conn->prepare("UPDATE projects SET generated_html = ? WHERE id = ? AND user_id = ?");
$update->bind_param("sii", $generatedHtml, $projectId, $userId);

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
