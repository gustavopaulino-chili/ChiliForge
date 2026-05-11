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

if (!$data || !isset($data["id"])) {
    http_response_code(400);
    echo json_encode(["error" => "Project ID is required"]);
    exit;
}

$id     = (int)$data["id"];
$userId = isset($data["user_id"]) ? (int)$data["user_id"] : 0;

if ($id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project ID"]);
    exit;
}

include "db.php";

// Determine the folder to clean up and resolve the effective owner user_id.
$folderPath      = '';
$effectiveUserId = 0;

if ($userId > 0) {
    // When user_id is provided, verify ownership (with email fallback for migrated accounts).
    $row = find_project_for_user($conn, $id, $userId, 'p.folder_path');
    if (!$row) {
        http_response_code(404);
        echo json_encode(["error" => "Project not found"]);
        $conn->close();
        exit;
    }
    $folderPath      = (string)($row['folder_path']      ?? '');
    $effectiveUserId = (int)($row['actual_user_id'] ?? $userId);
} else {
    // Legacy path: no user_id supplied (e.g. old API clients). Fetch folder only.
    $sel = $conn->prepare("SELECT folder_path FROM projects WHERE id = ? LIMIT 1");
    if (!$sel) {
        http_response_code(500);
        echo json_encode(["error" => "Query preparation failed"]);
        $conn->close();
        exit;
    }
    $sel->bind_param("i", $id);
    $sel->execute();
    $sel->bind_result($folderPath);
    $fetchOk = $sel->fetch();
    $sel->close();
    if (!$fetchOk) {
        http_response_code(404);
        echo json_encode(["error" => "Project not found"]);
        $conn->close();
        exit;
    }
}

// Delete the database row (use ownership filter when available).
if ($effectiveUserId > 0) {
    $stmt = $conn->prepare("DELETE FROM projects WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ii", $id, $effectiveUserId);
} else {
    $stmt = $conn->prepare("DELETE FROM projects WHERE id = ?");
    $stmt->bind_param("i", $id);
}

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

