<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$projectId = isset($_GET['project_id']) ? (int)$_GET['project_id'] : 0;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "project_id e user_id sao obrigatorios"]);
    exit;
}

include "db.php";

function cf_is_image_url($value) {
    $raw = trim((string)$value);
    if ($raw === '') return false;
    return preg_match('/^(?:https?:\/\/|\/|\.?\/).+\.(?:png|jpe?g|webp|gif|avif)(?:\?.*)?$/i', $raw) === 1;
}

function cf_extract_image_url_from_html($html) {
    $raw = trim((string)$html);
    if ($raw === '') return '';
    if (preg_match('/^data:image\//i', $raw)) return $raw;
    if (cf_is_image_url($raw)) return $raw;
    if (preg_match('/<img\b[^>]*\bsrc=["\']([^"\']+)["\']/i', $raw, $match)) {
        $src = trim((string)$match[1]);
        if ($src !== '' && (preg_match('/^data:image\//i', $src) || cf_is_image_url($src))) {
            return $src;
        }
    }
    return '';
}

function cf_public_url_to_local_path($publicUrl) {
    $path = parse_url((string)$publicUrl, PHP_URL_PATH);
    $path = trim(str_replace('\\', '/', (string)$path), '/');
    if ($path === '') return '';
    $segments = array_values(array_filter(explode('/', $path), 'strlen'));
    if (count($segments) < 2 || strtolower($segments[0]) !== 'projects') return '';
    foreach ($segments as $segment) {
        if ($segment === '.' || $segment === '..' || preg_match('/[^a-zA-Z0-9._-]/', $segment)) return '';
    }
    $base = realpath(__DIR__ . '/../public');
    if (!$base) return '';
    return $base . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments);
}

function cf_derive_folder_image_url($publicUrl) {
    $raw = trim((string)$publicUrl);
    if ($raw === '' || cf_is_image_url($raw)) return '';
    $prefix = preg_replace('/\/index\.html(?:\?.*)?$/i', '/', $raw);
    if ($prefix === $raw) {
        $prefix = rtrim($raw, '/') . '/';
    }
    foreach (['image.png', 'image.jpg', 'image.jpeg', 'image.webp', 'image.gif', 'image.avif', 'banner.png'] as $fileName) {
        $candidate = $prefix . $fileName;
        $localPath = cf_public_url_to_local_path($candidate);
        if ($localPath !== '' && is_file($localPath)) return $candidate;
    }
    return '';
}

$stmt = $conn->prepare(
    "SELECT c.id, c.project_id, c.campaign_id, c.name, c.platform, c.format, c.label, c.width, c.height, c.generated_html, c.public_url, c.sort_order, c.metadata, c.created_at, c.updated_at
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     WHERE c.project_id = ? AND (
        p.user_id = ?
        OR p.company_project_id IN (SELECT id FROM projects WHERE user_id = ? AND project_type = 'project')
     )
     ORDER BY c.campaign_id DESC, c.sort_order ASC, c.id ASC"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Tabela ads_creatives nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("iii", $projectId, $userId, $userId);
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($id, $rowProjectId, $campaignId, $name, $platform, $format, $label, $width, $height, $generatedHtml, $publicUrl, $sortOrder, $metadataJson, $createdAt, $updatedAt);

$creatives = [];
while ($stmt->fetch()) {
    $metadata = json_decode($metadataJson ?: '{}', true);
    if (!is_array($metadata)) $metadata = [];

    $metadataImageUrl = '';
    foreach (['image_url', 'imageUrl', 'png_url', 'pngUrl', 'preview_url', 'previewUrl'] as $key) {
        if (isset($metadata[$key]) && trim((string)$metadata[$key]) !== '') {
            $metadataImageUrl = trim((string)$metadata[$key]);
            break;
        }
    }

    $metadataWantsImage = !empty($metadata['is_image_mode'])
        || strtolower((string)($metadata['mode'] ?? '')) === 'image'
        || strtolower((string)($metadata['type'] ?? '')) === 'image';
    $htmlImageUrl = cf_extract_image_url_from_html($generatedHtml);
    $publicImageUrl = cf_is_image_url($publicUrl) ? (string)$publicUrl : '';
    $folderImageUrl = $metadataWantsImage ? cf_derive_folder_image_url($publicUrl) : '';
    $imageUrl = $metadataImageUrl ?: ($publicImageUrl ?: ($htmlImageUrl ?: $folderImageUrl));
    $isImageMode = $metadataWantsImage || $imageUrl !== '';

    $creatives[] = [
        "id" => (int)$id,
        "creative_id" => (int)$id,
        "project_id" => (int)$rowProjectId,
        "campaign_id" => (int)$campaignId,
        "name" => $name,
        "platform" => $platform,
        "format" => $format,
        "label" => $label,
        "width" => (int)$width,
        "height" => (int)$height,
        "generated_html" => (bool)$isImageMode ? $generatedHtml : "",
        "public_url" => $publicUrl,
        "url" => $publicUrl,
        "image_url" => (bool)$isImageMode ? $imageUrl : "",
        "sort_order" => (int)$sortOrder,
        "created_at" => $createdAt,
        "updated_at" => $updatedAt,
        "is_image_mode" => (bool)$isImageMode,
    ];
}

echo json_encode([
    "success" => true,
    "creatives" => $creatives,
]);

$stmt->close();
$conn->close();
?>
