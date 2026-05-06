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

$stmt = $conn->prepare("SELECT name, folder_path, public_url FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
$stmt->bind_param("ii", $projectId, $userId);
$stmt->execute();
$stmt->bind_result($projectName, $folderPath, $publicUrl);
$found = $stmt->fetch();
$stmt->close();
$conn->close();

if (!$found) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(["error" => "Projeto nao encontrado"]);
    exit;
}

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