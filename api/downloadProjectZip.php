<?php
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
    header('Content-Type: application/json');
    echo json_encode(["error" => "project_id e user_id sao obrigatorios"]);
    exit;
}

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.name, p.folder_path, p.public_url');
$conn->close();

if (!$projectRow) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(["error" => "Projeto nao encontrado"]);
    exit;
}

$projectName = (string)($projectRow['name'] ?? '');
$folderPath = (string)($projectRow['folder_path'] ?? '');
$publicUrl = (string)($projectRow['public_url'] ?? '');

try {
    $projectPath = resolve_project_directory_from_folder_path($folderPath, $publicUrl);
    $zipArchive = build_project_zip_archive($projectPath, $projectName ?: basename($projectPath));
    $zipPath = $zipArchive['path'];
    $downloadName = $zipArchive['filename'];

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . addslashes($downloadName) . '"');
    header('Content-Length: ' . filesize($zipPath));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

    readfile($zipPath);
    @unlink($zipPath);
    exit;
} catch (Throwable $error) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        "error" => "Falha ao gerar zip do projeto",
        "details" => $error->getMessage(),
    ]);
    exit;
}
?>
