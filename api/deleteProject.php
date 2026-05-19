<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["id"]) || !isset($data["user_id"])) {
    http_response_code(400);
    echo json_encode(["error" => "Project ID and user_id are required"]);
    exit;
}

$id     = (int)$data["id"];
$userId = isset($data["user_id"]) ? (int)$data["user_id"] : 0;

if ($id <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project/user ID"]);
    exit;
}

include "db.php";

// Determine the folder to clean up and resolve the effective owner user_id.
$folderPath      = '';
$effectiveUserId = 0;

$row = find_project_for_user($conn, $id, $userId, 'p.id');
if (!$row) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}
$folderPath      = (string)($row['folder_path'] ?? '');
$effectiveUserId = (int)($row['actual_user_id'] ?? $userId);

$stmt = $conn->prepare("DELETE FROM projects WHERE id = ? AND user_id = ?");
$stmt->bind_param("ii", $id, $effectiveUserId);

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to delete project: " . $conn->error]);
    $stmt->close();
    $conn->close();
    exit;
}

if ($stmt->affected_rows === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $stmt->close();
    $conn->close();
    exit;
}

$stmt->close();

// Remove published files from disk.
if ($folderPath !== '') {
    $projectRoot      = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
    $normalizedFolder = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($folderPath, '/\\'));
    $absoluteFolder   = $projectRoot . DIRECTORY_SEPARATOR . $normalizedFolder;

    if ($absoluteFolder !== false && is_dir($absoluteFolder)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($absoluteFolder, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($absoluteFolder);
    }
}

echo json_encode(["success" => true]);
$conn->close();
?>

