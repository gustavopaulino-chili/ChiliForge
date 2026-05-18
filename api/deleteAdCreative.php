<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

function resolve_ad_creative_directory_from_public_url($publicUrl) {
    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $path = parse_url((string)$publicUrl, PHP_URL_PATH);
    $path = trim(str_replace('\\', '/', (string)$path), '/');
    $segments = array_values(array_filter(explode('/', $path), 'strlen'));
    if (count($segments) < 3 || strtolower($segments[0]) !== 'projects') {
        return '';
    }

    $relative = array_slice($segments, 1);
    foreach ($relative as $segment) {
        if ($segment === '..' || $segment === '.' || preg_match('/[^a-zA-Z0-9._-]/', $segment)) {
            return '';
        }
    }

    return $sitesBasePath . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $relative);
}

function remove_directory_tree($path) {
    if (!is_string($path) || trim($path) === '' || !is_dir($path)) return;

    $sitesBasePath = realpath(resolve_sites_base_path());
    $target = realpath($path);
    if ($sitesBasePath === false || $target === false || strpos($target, $sitesBasePath) !== 0) {
        return;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($target, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($target);
}

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["id"]) || !isset($data["user_id"])) {
    http_response_code(400);
    echo json_encode(["error" => "Creative ID and user_id are required"]);
    exit;
}

$creativeId = (int)$data["id"];
$userId = (int)$data["user_id"];

if ($creativeId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid creative/user ID"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "SELECT c.public_url
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     WHERE c.id = ? AND p.user_id = ?
     LIMIT 1"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Tabela ads_creatives nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("ii", $creativeId, $userId);
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($publicUrl);

if (!$stmt->fetch()) {
    http_response_code(404);
    echo json_encode(["error" => "Creative not found"]);
    $stmt->close();
    $conn->close();
    exit;
}
$stmt->close();

$delete = $conn->prepare("DELETE FROM ads_creatives WHERE id = ?");
$delete->bind_param("i", $creativeId);
if (!$delete->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to delete creative", "details" => $delete->error]);
    $delete->close();
    $conn->close();
    exit;
}
$delete->close();

$creativeDir = resolve_ad_creative_directory_from_public_url((string)$publicUrl);
remove_directory_tree($creativeDir);

echo json_encode(["success" => true, "id" => $creativeId]);
$conn->close();
?>
