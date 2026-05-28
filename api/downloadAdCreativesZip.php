<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . '_render.php';
include "db.php";

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


$rawIds  = isset($_GET['ids'])     ? explode(',', (string)$_GET['ids']) : [];
$userId  = isset($_GET['user_id']) ? (int)$_GET['user_id']             : 0;

$projectIds = array_values(array_filter(array_map('intval', $rawIds)));

if (empty($projectIds) || $userId <= 0) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(["error" => "ids e user_id sao obrigatorios"]);
    exit;
}

if (!class_exists('ZipArchive')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(["error" => "ZipArchive extension is not available on this server"]);
    exit;
}

try {
    $tempBase = tempnam(sys_get_temp_dir(), 'chiliforge_ad_');
    if ($tempBase === false) throw new RuntimeException('Could not create temp file');
    $zipPath = $tempBase . '.zip';
    if (file_exists($zipPath)) @unlink($zipPath);

    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('Could not create zip archive');
    }

    $tempPngFiles = [];
    $browserBinary = null; // resolved lazily when first HTML banner is encountered
    $addedCount = 0;
    foreach ($projectIds as $pid) {
        $stmt = $conn->prepare(
            "SELECT c.name, c.public_url, c.width, c.height
             FROM ads_creatives c
             INNER JOIN projects p ON p.id = c.project_id
             WHERE c.id = ? AND p.user_id = ?
             LIMIT 1"
        );
        if (!$stmt) {
            throw new RuntimeException('Tabela ads_creatives nao encontrada. Execute o SQL de migracao.');
        }
        $stmt->bind_param("ii", $pid, $userId);
        $stmt->execute();
        $stmt->store_result();
        $stmt->bind_result($rowName, $publicUrl, $creativeWidth, $creativeHeight);
        if (!$stmt->fetch()) {
            $stmt->close();
            continue;
        }
        $stmt->close();

        $publicUrl  = (string)($publicUrl  ?? '');
        $rowName    = (string)($rowName    ?? "Banner {$pid}");

        $label = sanitize_filename_component(basename($rowName));
        if ($label === '') $label = "banner-{$pid}";

        // Image-mode banners: public_url points directly to the image file
        $isImageCreative = (bool)preg_match('/\.(png|jpe?g|webp)$/i', rtrim($publicUrl, '/'));

        if ($isImageCreative) {
            try {
                $imagePath = resolve_ad_creative_directory_from_public_url($publicUrl);
            } catch (Throwable $e) {
                error_log("[ChiliForge] downloadAdCreativesZip: could not resolve image path for {$pid}: " . $e->getMessage());
                continue;
            }

            if (!file_exists($imagePath) || !is_file($imagePath)) continue;

            $imgExt   = strtolower(pathinfo($imagePath, PATHINFO_EXTENSION)) ?: 'png';
            $fileName = $label . '.' . $imgExt;
            $suffix   = 1;
            while ($zip->locateName($fileName) !== false) {
                $fileName = $label . '-' . $suffix . '.' . $imgExt;
                $suffix++;
            }

            $zip->addFile($imagePath, $fileName);
            $addedCount++;
            continue;
        }

        // HTML banners: render via headless browser (resolved lazily)
        if ($browserBinary === null) {
            $browserBinary = find_browser_binary();
            if ($browserBinary === '') {
                throw new RuntimeException('No headless browser found. Install Chrome, Chromium, or Edge on the server to export creatives as PNG images.');
            }
        }

        try {
            $bannerPath = resolve_ad_creative_directory_from_public_url($publicUrl);
        } catch (Throwable $e) {
            error_log("[ChiliForge] downloadAdCreativesZip: could not resolve path for project {$pid}: " . $e->getMessage());
            continue;
        }

        $indexFile = $bannerPath . DIRECTORY_SEPARATOR . 'index.html';
        if (!file_exists($indexFile) || !is_file($indexFile)) continue;

        $pngPath = tempnam(sys_get_temp_dir(), 'chiliforge_ad_png_');
        if ($pngPath === false) throw new RuntimeException('Could not create temp PNG file');
        $pngOutputPath = $pngPath . '.png';
        @unlink($pngOutputPath);
        @unlink($pngPath);

        $renderUrl = normalize_public_render_url($publicUrl);
        if ($renderUrl !== '') {
            render_url_to_png($browserBinary, $renderUrl, $pngOutputPath, (int)$creativeWidth ?: 1080, (int)$creativeHeight ?: 1080);
        } else {
            render_html_to_png($browserBinary, $indexFile, $pngOutputPath, (int)$creativeWidth ?: 1080, (int)$creativeHeight ?: 1080);
        }
        $tempPngFiles[] = $pngOutputPath;

        // Ensure unique file name in case of label collision
        $fileName = $label . '.png';
        $suffix = 1;
        while ($zip->locateName($fileName) !== false) {
            $fileName = $label . '-' . $suffix . '.png';
            $suffix++;
        }

        $zip->addFile($pngOutputPath, $fileName);
        $addedCount++;
    }

    $conn->close();
    $zip->close();
    @unlink($tempBase);
    foreach ($tempPngFiles as $tempPngFile) {
        @unlink($tempPngFile);
    }

    if ($addedCount === 0) {
        @unlink($zipPath);
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(["error" => "Nenhum criativo encontrado para os IDs fornecidos"]);
        exit;
    }

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="ad-creatives-images.zip"');
    header('Content-Length: ' . filesize($zipPath));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    readfile($zipPath);
    @unlink($zipPath);
    exit;
} catch (Throwable $error) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        "error"   => "Falha ao gerar ZIP dos criativos",
        "details" => $error->getMessage(),
    ]);
    exit;
}
?>
