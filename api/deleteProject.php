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

// Helper: recursively delete a project's published folder from disk (path is relative to repo root).
$projectRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
$deleteFolder = function (string $folderPath) use ($projectRoot) {
    $folderPath = trim($folderPath);
    if ($folderPath === '' || $projectRoot === false) return;
    $normalized     = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($folderPath, '/\\'));
    $absoluteFolder = $projectRoot . DIRECTORY_SEPARATOR . $normalized;
    // Safety: never escape the repo root.
    $real = realpath($absoluteFolder);
    if ($real === false || strpos($real, $projectRoot) !== 0 || !is_dir($real)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($real);
};

// If this is a COMPANY project, its child projects (LPs / ad campaigns) reference it via
// company_project_id (FK is ON DELETE SET NULL, so they would be orphaned — rows AND server
// folders left behind). Cascade them explicitly: collect children, delete their folders + rows
// (their lps/ads_campaign/ads_creatives cascade via FK), and clean the company-scoped tables
// that have no FK cascade (company_store_files, ad_generation_jobs).
$childIds     = [];
$childFolders = [];
$childStmt = $conn->prepare("SELECT id, folder_path FROM projects WHERE company_project_id = ?");
if ($childStmt) {
    $childStmt->bind_param("i", $id);
    $childStmt->execute();
    $childRes = $childStmt->get_result();
    while ($childRes && ($r = $childRes->fetch_assoc())) {
        $childIds[] = (int)$r['id'];
        if (!empty($r['folder_path'])) $childFolders[] = (string)$r['folder_path'];
    }
    $childStmt->close();
}

if (!empty($childIds)) {
    $placeholders = implode(',', array_fill(0, count($childIds), '?'));
    $types        = str_repeat('i', count($childIds));
    $delChildren  = $conn->prepare("DELETE FROM projects WHERE id IN ($placeholders)");
    if ($delChildren) {
        $delChildren->bind_param($types, ...$childIds);
        $delChildren->execute();
        $delChildren->close();
    }
}

// Non-cascading, company-scoped tables.
foreach (['company_store_files', 'ad_generation_jobs'] as $tbl) {
    $c = $conn->prepare("DELETE FROM {$tbl} WHERE company_project_id = ?");
    if ($c) { $c->bind_param("i", $id); $c->execute(); $c->close(); }
}

// Delete the project (company or standalone) itself.
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

// Remove published files from disk — the project's own folder + all child folders.
$deleteFolder($folderPath);
foreach ($childFolders as $cf) {
    $deleteFolder($cf);
}

echo json_encode(["success" => true, "deletedChildren" => count($childIds)]);
$conn->close();
?>

