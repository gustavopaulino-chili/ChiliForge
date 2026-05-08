<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
include "db.php";

$projectId = isset($_POST['project_id']) ? (int)$_POST['project_id'] : 0;
$userId = isset($_POST['user_id']) ? (int)$_POST['user_id'] : 0;
$replaceExisting = isset($_POST['replace_existing'])
    && in_array(strtolower((string)$_POST['replace_existing']), ['1', 'true', 'yes', 'on'], true);

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project/user id"]);
    exit;
}

$stmt = $conn->prepare("SELECT folder_path, public_url FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
$stmt->bind_param("ii", $projectId, $userId);
$stmt->execute();
$stmt->store_result();

if ($stmt->num_rows === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $stmt->close();
    $conn->close();
    exit;
}

$folderPath = '';
$publicUrl = '';
$stmt->bind_result($folderPath, $publicUrl);
$stmt->fetch();
$stmt->close();

if (!isset($_FILES['files'])) {
    // Allow source URLs for server-side downloads (useful when browser CORS blocks direct fetch)
    // `source_urls` can be sent as an array in multipart form-data.
    if (!isset($_POST['source_urls'])) {
        http_response_code(400);
        echo json_encode(["error" => "No files or source_urls sent"]);
        $conn->close();
        exit;
    }
}

try {
    // Resolve the project directory; create it if it does not yet exist on disk.
    try {
        $projectDir = resolve_project_directory_from_folder_path((string)$folderPath, (string)$publicUrl);
    } catch (RuntimeException $notFoundErr) {
        $sitesBasePath = resolve_sites_base_path();
        $slug = '';
        if (trim((string)$folderPath) !== '') {
            $segments = array_values(array_filter(explode('/', trim(str_replace('\\', '/', (string)$folderPath), '/')), 'strlen'));
            if (!empty($segments)) {
                $slug = sanitize_slug((string)end($segments));
            }
        }
        if ($slug === '' || $slug === 'site') {
            $slug = extract_slug_from_public_url((string)$publicUrl);
        }
        if ($slug === '') {
            $slug = 'project-' . $projectId;
        }
        $projectDir = $sitesBasePath . DIRECTORY_SEPARATOR . sanitize_slug($slug);
        ensure_directory($projectDir);
    }
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

    $files = $_FILES['files'] ?? null;
    $count = ($files && is_array($files['name'])) ? count($files['name']) : 0;
    $uploaded = [];
    $skipped = [];

    $reserveCandidateName = function (string $originalName) use ($assetsDir): string {
        $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)$originalName);
        $safeName = trim((string)$safeName, '-_. ');
        if ($safeName === '') {
            $safeName = 'asset';
        }

        $pathInfo = pathinfo($safeName);
        $base = $pathInfo['filename'] ?? 'asset';
        $ext = isset($pathInfo['extension']) && $pathInfo['extension'] !== '' ? '.' . $pathInfo['extension'] : '';

        // Keep filenames filesystem-safe and avoid "file name too long" errors.
        if (strlen($base) > 80) {
            $base = substr($base, 0, 80);
        }

        if (strlen($ext) > 10) {
            $ext = '.bin';
        }

        $candidate = $base . $ext;
        $suffix = 1;

        while (file_exists($assetsDir . DIRECTORY_SEPARATOR . $candidate)) {
            $candidate = $base . '-' . $suffix . $ext;
            $suffix++;
        }

        return $candidate;
    };

    $sanitizeProvidedName = function (string $rawName, ?string $contentType = null, string $sourceUrl = ''): string {
        $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)$rawName);
        $safeName = trim((string)$safeName, '-_. ');
        if ($safeName === '') {
            $safeName = 'asset';
        }

        $pathInfo = pathinfo($safeName);
        $base = $pathInfo['filename'] ?? 'asset';
        $ext = isset($pathInfo['extension']) && $pathInfo['extension'] !== ''
            ? preg_replace('/[^a-z0-9]+/i', '', (string)$pathInfo['extension'])
            : '';

        if (strlen($base) > 80) {
            $base = substr($base, 0, 80);
        }

        if ($ext === '') {
            $ext = extract_extension_from_url($sourceUrl, $contentType);
        }

        if ($ext === '') {
            $ext = 'bin';
        }

        if (strlen($ext) > 10) {
            $ext = 'bin';
        }

        return $base . '.' . strtolower($ext);
    };

    $removeStemVariants = function (string $fileName) use ($assetsDir): void {
        $pathInfo = pathinfo($fileName);
        $base = $pathInfo['filename'] ?? '';
        if ($base === '') {
            return;
        }

        foreach (glob($assetsDir . DIRECTORY_SEPARATOR . $base . '.*') ?: [] as $existingPath) {
            if (is_file($existingPath)) {
                @unlink($existingPath);
            }
        }
    };

    $uploadErrorReason = function (int $errorCode): string {
        switch ($errorCode) {
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                return 'File exceeds server upload size limit.';
            case UPLOAD_ERR_PARTIAL:
                return 'File upload was partial. Please try again.';
            case UPLOAD_ERR_NO_FILE:
                return 'No file data received.';
            case UPLOAD_ERR_NO_TMP_DIR:
                return 'Server temporary folder is missing.';
            case UPLOAD_ERR_CANT_WRITE:
                return 'Server failed to write uploaded file.';
            case UPLOAD_ERR_EXTENSION:
                return 'A server extension blocked this upload.';
            default:
                return 'Unknown upload error.';
        }
    };

    for ($i = 0; $i < $count; $i++) {
        $errorCode = isset($files['error'][$i]) ? (int)$files['error'][$i] : UPLOAD_ERR_NO_FILE;
        $originalName = (string)($files['name'][$i] ?? ('file-' . ($i + 1)));
        if ($errorCode !== UPLOAD_ERR_OK) {
            $skipped[] = [
                'name' => $originalName,
                'reason' => $uploadErrorReason($errorCode),
            ];
            continue;
        }

        $tmpName = $files['tmp_name'][$i] ?? '';
        if (!is_string($tmpName) || $tmpName === '' || !is_uploaded_file($tmpName)) {
            $skipped[] = [
                'name' => $originalName,
                'reason' => 'Uploaded file is not available in temporary storage.',
            ];
            continue;
        }

        $candidate = $reserveCandidateName((string)$originalName);

        $targetPath = $assetsDir . DIRECTORY_SEPARATOR . $candidate;
        if (!move_uploaded_file($tmpName, $targetPath)) {
            $skipped[] = [
                'name' => $originalName,
                'reason' => 'Failed to move uploaded file into project assets folder.',
            ];
            continue;
        }

        $uploaded[] = [
            'name' => $candidate,
            'url' => $publicBase . 'assets/' . rawurlencode($candidate),
            'size' => @filesize($targetPath) ?: 0,
            'modifiedAt' => @filemtime($targetPath) ?: 0,
        ];
    }

    // Optional: ingest remote/generated image URLs server-side.
    $sourceUrlsRaw = $_POST['source_urls'] ?? [];
    $sourceNamesRaw = $_POST['source_names'] ?? [];
    $sourceUrls = is_array($sourceUrlsRaw) ? $sourceUrlsRaw : [$sourceUrlsRaw];
    $sourceNames = is_array($sourceNamesRaw) ? $sourceNamesRaw : [$sourceNamesRaw];

    foreach ($sourceUrls as $index => $rawUrl) {
        $normalizedUrl = normalize_asset_url((string)$rawUrl);
        if ($normalizedUrl === '' || !is_supported_asset_url($normalizedUrl)) {
            $skipped[] = [
                'url' => (string)$rawUrl,
                'reason' => 'URL is invalid or unsupported. Use a direct file URL (jpg, png, webp, svg, avif, gif).',
            ];
            continue;
        }

        $downloaded = download_remote_asset($normalizedUrl);
        if ($downloaded === null || !isset($downloaded['body'])) {
            $skipped[] = [
                'url' => (string)$rawUrl,
                'reason' => 'Source blocked download or returned no file data.',
            ];
            continue;
        }

        $providedName = isset($sourceNames[$index]) ? (string)$sourceNames[$index] : '';
        if ($replaceExisting && trim($providedName) !== '') {
            $candidate = $sanitizeProvidedName($providedName, $downloaded['content_type'] ?? null, $normalizedUrl);
            $removeStemVariants($candidate);
        } else {
            $candidateBaseName = trim($providedName) !== ''
                ? $sanitizeProvidedName($providedName, $downloaded['content_type'] ?? null, $normalizedUrl)
                : ('generated-' . date('Ymd-His') . '-' . ($index + 1) . '.' . extract_extension_from_url($normalizedUrl, $downloaded['content_type'] ?? null));
            $candidate = $reserveCandidateName($candidateBaseName);
        }
        $targetPath = $assetsDir . DIRECTORY_SEPARATOR . $candidate;

        if (@file_put_contents($targetPath, $downloaded['body']) === false) {
            $skipped[] = [
                'url' => (string)$rawUrl,
                'reason' => 'Failed to write file on server.',
            ];
            continue;
        }

        $uploaded[] = [
            'name' => $candidate,
            'url' => $publicBase . 'assets/' . rawurlencode($candidate),
            'size' => @filesize($targetPath) ?: 0,
            'modifiedAt' => @filemtime($targetPath) ?: 0,
        ];
    }

    echo json_encode([
        'success' => true,
        'uploaded' => $uploaded,
        'skipped' => $skipped,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to upload assets',
        'details' => $error->getMessage(),
    ]);
}

$conn->close();
?>
