<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
include "db.php";

$projectId = isset($_GET['project_id']) ? (int)$_GET['project_id'] : 0;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project/user id"]);
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
    $assetsDir = $projectDir . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsDir);

    $folderSlug = sanitize_slug((string)basename(trim((string)$folderPath, " \/\\")));
    $publicBase = $folderSlug !== ''
        ? '/projects/' . $folderSlug . '/'
        : trim((string)$publicUrl);
    if ($publicBase === '') {
        $slug = basename(trim((string)$folderPath, " \/\\"));
        $publicBase = '/projects/' . sanitize_slug($slug) . '/';
    }

    $publicBase = preg_replace('/\/index\.html$/i', '/', $publicBase);
    $publicBase = is_string($publicBase) ? $publicBase : '';

    if (!preg_match('/^https?:\/\//i', $publicBase) && !str_starts_with($publicBase, '/')) {
        $publicBase = '/' . $publicBase;
    }

    if (!str_ends_with($publicBase, '/')) {
        $publicBase .= '/';
    }

    $assets = [];
    $entries = @scandir($assetsDir);
    if (is_array($entries)) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $fullPath = $assetsDir . DIRECTORY_SEPARATOR . $entry;
            if (!is_file($fullPath)) {
                continue;
            }

            $assets[] = [
                'name' => $entry,
                'url' => $publicBase . 'assets/' . rawurlencode($entry),
                'size' => @filesize($fullPath) ?: 0,
                'modifiedAt' => @filemtime($fullPath) ?: 0,
            ];
        }
    }

    usort($assets, function ($a, $b) {
        return ($b['modifiedAt'] <=> $a['modifiedAt']);
    });

    echo json_encode([
        'success' => true,
        'assets' => $assets,
        'assetsPublicUrl' => $publicBase . 'assets/',
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to load project assets',
        'details' => $error->getMessage(),
    ]);
}

$conn->close();
?>
