<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
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
        throw new RuntimeException('Creative public URL is invalid.');
    }

    $relative = array_slice($segments, 1);
    foreach ($relative as $segment) {
        if ($segment === '..' || $segment === '.' || preg_match('/[^a-zA-Z0-9._-]/', $segment)) {
            throw new RuntimeException('Creative public URL contains invalid path segments.');
        }
    }

    return $sitesBasePath . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $relative);
}

function rewrite_project_asset_refs_for_ad_creative(string $content, string $projectPublicUrl, string $relativePrefix): string {
    $projectPrefix = preg_replace('/\/index\.html$/i', '/', trim($projectPublicUrl));
    if ($projectPrefix === '') {
        return $content;
    }
    if (!str_ends_with($projectPrefix, '/')) {
        $projectPrefix .= '/';
    }

    $projectPath = parse_url($projectPrefix, PHP_URL_PATH);
    $projectPath = is_string($projectPath) && $projectPath !== '' ? $projectPath : $projectPrefix;
    if (!str_starts_with($projectPath, '/')) {
        $projectPath = '/' . $projectPath;
    }
    if (!str_ends_with($projectPath, '/')) {
        $projectPath .= '/';
    }

    $target = $relativePrefix . 'assets/';
    $assetPath = preg_quote(ltrim($projectPath, '/') . 'assets/', '/');
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/' . $assetPath . '/i', $target, $content);
    $content = str_replace([
        $projectPath . 'assets/',
        ltrim($projectPath, '/') . 'assets/',
    ], $target, $content);
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/projects\/(?:[^\/"\'\s)]+\/)+assets\//i', $target, $content);
    $content = preg_replace('/(?<![\w:])\/?projects\/(?:[^\/"\'\s)]+\/)+assets\//i', $target, $content);

    if ($relativePrefix !== '') {
        $content = preg_replace('/((?:src|data-src|poster)=["\'])assets\//i', '$1' . $target, $content);
        $content = preg_replace('/(url\((["\']?))assets\//i', '$1' . $target, $content);
        $content = preg_replace('/(srcset=["\'][^"\']*?)(?<!\.\.\/)assets\//i', '$1' . $target, $content);
    }

    return is_string($content) ? $content : '';
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['id']) || !isset($data['user_id']) || !isset($data['html'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$creativeId = (int)$data['id'];
$userId = (int)$data['user_id'];
$html = strip_editor_bridge_artifacts((string)$data['html']);

if ($creativeId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "SELECT c.public_url,
        (SELECT ac.public_url FROM ads_campaign ac WHERE ac.project_id = c.project_id ORDER BY ac.id DESC LIMIT 1) AS project_public_url
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
$stmt->bind_result($publicUrl, $projectPublicUrl); // project_public_url from ads_campaign

if (!$stmt->fetch()) {
    http_response_code(404);
    echo json_encode(["error" => "Criativo nao encontrado"]);
    $stmt->close();
    $conn->close();
    exit;
}
$stmt->close();

$html = rewrite_project_asset_refs_for_ad_creative($html, (string)$projectPublicUrl, '../');

$update = $conn->prepare("UPDATE ads_creatives SET generated_html = ?, updated_at = NOW() WHERE id = ?");
$update->bind_param("si", $html, $creativeId);
if (!$update->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to update creative", "details" => $update->error]);
    $update->close();
    $conn->close();
    exit;
}
$update->close();

$writeWarning = null;
if (is_string($publicUrl) && trim($publicUrl) !== '') {
    try {
        $creativeDir = resolve_ad_creative_directory_from_public_url((string)$publicUrl);
        ensure_directory($creativeDir);
        file_put_contents($creativeDir . DIRECTORY_SEPARATOR . 'index.html', $html);
    } catch (Throwable $error) {
        $writeWarning = $error->getMessage();
    }
}

echo json_encode([
    "success" => true,
    "id" => $creativeId,
    "url" => $publicUrl,
    "warning" => $writeWarning,
]);

$conn->close();
?>
