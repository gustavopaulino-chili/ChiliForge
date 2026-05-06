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
    if (!isset($_POST['source_urls'])) {
        http_response_code(400);
        echo json_encode(["error" => "No files or source_urls sent"]);
        $conn->close();
        exit;
    }
}

try {
    $projectDir = resolve_project_directory_from_folder_path((string)$folderPath, (string)$publicUrl);
    $filesDir = $projectDir . DIRECTORY_SEPARATOR . 'files';
    ensure_directory($filesDir);

    $publicBase = trim((string)$publicUrl);
    if ($publicBase === '') {
        $slug = basename(trim((string)$folderPath, " \/\\"));
        $publicBase = '/projects/' . sanitize_slug($slug) . '/';
    }
    if (!str_ends_with($publicBase, '/')) {
        $publicBase .= '/';
    }

    $files = $_FILES['files'] ?? null;
    $count = ($files && is_array($files['name'])) ? count($files['name']) : 0;
    $uploaded = [];

    $reserveCandidateName = function (string $originalName) use ($filesDir): string {
        $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)$originalName);
        $safeName = trim((string)$safeName, '-_. ');
        if ($safeName === '') {
            $safeName = 'file';
        }

        $pathInfo = pathinfo($safeName);
        $base = $pathInfo['filename'] ?? 'file';
        $ext = isset($pathInfo['extension']) && $pathInfo['extension'] !== '' ? '.' . $pathInfo['extension'] : '';
        $candidate = $base . $ext;
        $suffix = 1;

        while (file_exists($filesDir . DIRECTORY_SEPARATOR . $candidate)) {
            $candidate = $base . '-' . $suffix . $ext;
            $suffix++;
        }

        return $candidate;
    };

    for ($i = 0; $i < $count; $i++) {
        if (!isset($files['error'][$i]) || $files['error'][$i] !== UPLOAD_ERR_OK) {
            continue;
        }

        $tmpName = $files['tmp_name'][$i] ?? '';
        $originalName = $files['name'][$i] ?? '';
        if (!is_string($tmpName) || $tmpName === '' || !is_uploaded_file($tmpName)) {
            continue;
        }

        $candidate = $reserveCandidateName((string)$originalName);

        $targetPath = $filesDir . DIRECTORY_SEPARATOR . $candidate;
        if (!move_uploaded_file($tmpName, $targetPath)) {
            continue;
        }

        $uploaded[] = [
            'name' => $candidate,
            'url' => $publicBase . 'files/' . rawurlencode($candidate),
            'size' => @filesize($targetPath) ?: 0,
            'modifiedAt' => @filemtime($targetPath) ?: 0,
        ];
    }

    // Optional: ingest remote URLs server-side.
    $sourceUrlsRaw = $_POST['source_urls'] ?? [];
    $sourceNamesRaw = $_POST['source_names'] ?? [];
    $sourceUrls = is_array($sourceUrlsRaw) ? $sourceUrlsRaw : [$sourceUrlsRaw];
    $sourceNames = is_array($sourceNamesRaw) ? $sourceNamesRaw : [$sourceNamesRaw];

    foreach ($sourceUrls as $index => $rawUrl) {
        $normalizedUrl = normalize_asset_url((string)$rawUrl);
        if ($normalizedUrl === '' || !is_supported_asset_url($normalizedUrl)) {
            continue;
        }

        $downloaded = download_remote_asset($normalizedUrl);
        if ($downloaded === null || !isset($downloaded['body'])) {
            continue;
        }

        $providedName = isset($sourceNames[$index]) ? (string)$sourceNames[$index] : '';
        $candidateBaseName = trim($providedName) !== ''
            ? $providedName
            : ('downloaded-' . date('Ymd-His') . '-' . ($index + 1) . '.' . extract_extension_from_url($normalizedUrl, $downloaded['content_type'] ?? null));

        $candidate = $reserveCandidateName($candidateBaseName);
        $targetPath = $filesDir . DIRECTORY_SEPARATOR . $candidate;

        if (@file_put_contents($targetPath, $downloaded['body']) === false) {
            continue;
        }

        $uploaded[] = [
            'name' => $candidate,
            'url' => $publicBase . 'files/' . rawurlencode($candidate),
            'size' => @filesize($targetPath) ?: 0,
            'modifiedAt' => @filemtime($targetPath) ?: 0,
        ];
    }

    echo json_encode([
        'success' => true,
        'uploaded' => $uploaded,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to upload files',
        'details' => $error->getMessage(),
    ]);
}

$conn->close();
?>
