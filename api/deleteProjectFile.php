<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
include "db.php";

$data = json_decode(file_get_contents("php://input"), true);
$projectId = isset($data['project_id']) ? (int)$data['project_id'] : 0;
$userId = isset($data['user_id']) ? (int)$data['user_id'] : 0;
$fileName = isset($data['file_name']) ? (string)$data['file_name'] : '';

if ($projectId <= 0 || $userId <= 0 || trim($fileName) === '') {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$safeFileName = basename($fileName);
if ($safeFileName === '' || $safeFileName === '.' || $safeFileName === '..') {
    http_response_code(400);
    echo json_encode(["error" => "Invalid file name"]);
    exit;
}

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.folder_path, p.public_url');
if (!$projectRow) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}

$folderPath = (string)($projectRow['folder_path'] ?? '');
$publicUrl = (string)($projectRow['public_url'] ?? '');

try {
    $projectDir = resolve_project_directory_from_folder_path((string)$folderPath, (string)$publicUrl);
    $filesDir = $projectDir . DIRECTORY_SEPARATOR . 'files';
    ensure_directory($filesDir);

    $target = $filesDir . DIRECTORY_SEPARATOR . $safeFileName;
    if (!file_exists($target) || !is_file($target)) {
        http_response_code(404);
        echo json_encode(['error' => 'File not found']);
        $conn->close();
        exit;
    }

    if (!@unlink($target)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to delete file']);
        $conn->close();
        exit;
    }

    echo json_encode([
        'success' => true,
        'deleted' => $safeFileName,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to delete file',
        'details' => $error->getMessage(),
    ]);
}

$conn->close();
?>
