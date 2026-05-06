<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$projectId = isset($_GET['project_id']) ? (int)$_GET['project_id'] : 0;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare("SELECT id, name, public_url, folder_path, generated_html FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
$stmt->bind_param("ii", $projectId, $userId);
$stmt->execute();
$stmt->store_result();

if ($stmt->num_rows === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $stmt->close();
    $conn->close();
    exit;
}

$name = '';
$publicUrl = '';
$folderPath = '';
$generatedHtml = '';
$stmt->bind_result($id, $name, $publicUrl, $folderPath, $generatedHtml);
$stmt->fetch();
$stmt->close();

$html = (string)$generatedHtml;
$source = 'database';

try {
    $projectDir = resolve_project_directory_from_folder_path((string)$folderPath, (string)$publicUrl);
    $fromProject = build_editor_document_from_project($projectDir, (string)$generatedHtml);
    if (trim($fromProject) !== '') {
        $html = $fromProject;
        $source = 'published-files';
    }
} catch (Throwable $error) {
    // Fall back to generated_html from the database.
}

echo json_encode([
    "success" => true,
    "project" => [
        "id" => $projectId,
        "name" => $name,
        "public_url" => $publicUrl,
        "folder_path" => $folderPath,
    ],
    "html" => $html,
    "source" => $source,
]);

$conn->close();
?>