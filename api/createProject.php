<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["user_id"]) || !isset($data["name"]) || !isset($data["form_data"])) {
    http_response_code(400);
    echo json_encode(["error" => "Dados obrigatórios faltando"]);
    exit;
}

$user_id = (int)$data["user_id"];
$name = trim($data["name"]);
$formDataDecoded = is_array($data["form_data"]) ? $data["form_data"] : [];
$form_data = json_encode($formDataDecoded, JSON_UNESCAPED_UNICODE);
$generated_html = isset($data["generated_html"]) ? $data["generated_html"] : "";
$project_type = isset($data["project_type"]) ? preg_replace('/[^a-z_]/', '', strtolower((string)$data["project_type"])) : 'landing_page';
if ($project_type === '') $project_type = 'landing_page';
$draft_only = isset($data["draft_only"]) && in_array(strtolower((string)$data["draft_only"]), ['1', 'true', 'yes', 'on'], true);
$source_project_id = isset($data["source_project_id"]) ? (int)$data["source_project_id"] : 0;

function create_project_copy_directory_contents($sourceDir, $targetDir) {
    if (!is_dir($sourceDir)) {
        return;
    }

    ensure_directory($targetDir);

    $sourceRoot = realpath($sourceDir);
    $targetRoot = realpath($targetDir);
    if ($sourceRoot === false || $targetRoot === false || $sourceRoot === $targetRoot) {
        return;
    }

    $baseLen = strlen(rtrim($sourceRoot, DIRECTORY_SEPARATOR)) + 1;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($sourceRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $item) {
        $relative = substr($item->getPathname(), $baseLen);
        $relative = str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $relative);
        if ($relative === '' || strpos($relative, '..') !== false) {
            continue;
        }

        $target = $targetRoot . DIRECTORY_SEPARATOR . $relative;
        if ($item->isDir()) {
            ensure_directory($target);
            continue;
        }

        ensure_directory(dirname($target));
        @copy($item->getPathname(), $target);
    }
}

function create_project_prefix_from_folder_path($folderPath, $publicUrl = '') {
    $slug = extract_slug_from_public_url($publicUrl);
    if ($slug === '') {
        $normalized = trim(str_replace('\\', '/', (string)$folderPath), '/');
        $normalized = preg_replace('#/index\.html$#i', '', (string)$normalized);
        $segments = array_values(array_filter(explode('/', (string)$normalized), 'strlen'));
        if (!empty($segments)) {
            $slug = sanitize_slug((string)end($segments));
        }
    }

    return $slug !== '' ? '/projects/' . $slug . '/' : '';
}

function create_project_rewrite_asset_paths($value, array $oldPrefixes, $newPrefix) {
    if (is_array($value)) {
        $rewritten = [];
        foreach ($value as $key => $item) {
            $rewritten[$key] = create_project_rewrite_asset_paths($item, $oldPrefixes, $newPrefix);
        }
        return $rewritten;
    }

    if (!is_string($value) || trim($value) === '') {
        return $value;
    }

    $normalized = normalize_asset_url($value);
    if ($normalized === '') {
        return $value;
    }

    foreach ($oldPrefixes as $prefix) {
        $prefix = rtrim((string)$prefix, '/') . '/';
        if ($prefix !== '/' && str_starts_with($normalized, $prefix)) {
            return rtrim($newPrefix, '/') . '/' . ltrim(substr($normalized, strlen($prefix)), '/');
        }
    }

    if (preg_match('#^(?:\./|\../)*assets/#i', $normalized)) {
        $assetPath = preg_replace('#^(?:\./|\../)*#', '', $normalized);
        return rtrim($newPrefix, '/') . '/' . ltrim((string)$assetPath, '/');
    }

    return $value;
}

if ($user_id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuário inválido"]);
    exit;
}

if (strlen($name) < 1 || strlen($name) > 255) {
    http_response_code(400);
    echo json_encode(["error" => "Nome deve ter entre 1 e 255 caracteres"]);
    exit;
}

if (!$form_data) {
    http_response_code(400);
    echo json_encode(["error" => "Dados do formulário inválidos"]);
    exit;
}

include "db.php";

$public_url = "";
$folder_path = "";
$current_step = isset($data["current_step"]) ? (int)$data["current_step"] : 0;
$stmt = $conn->prepare("INSERT INTO projects (user_id, name, public_url, folder_path, form_data, generated_html, current_step, project_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())");
$stmt->bind_param("isssssis", $user_id, $name, $public_url, $folder_path, $form_data, $generated_html, $current_step, $project_type);

if ($stmt->execute()) {
    $project_id = $conn->insert_id;

    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $rawCustomSlug   = isset($formDataDecoded['customSlug']) ? (string)$formDataDecoded['customSlug'] : '';
    $sanitizedCustom = sanitize_slug($rawCustomSlug);

    if ($sanitizedCustom !== '' && $sanitizedCustom !== 'site') {
        $slug = ensure_unique_slug($sanitizedCustom, $sitesBasePath);
    } else {
        $slug = 'site-' . $project_id;
    }

    $public_url  = $draft_only ? "" : "/projects/" . $slug . "/";
    $folder_path = "/public/projects/" . $slug;

    $projectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $slug;
    ensure_directory($projectPath);

    if ($source_project_id > 0 && $project_type === 'ad_creative') {
        try {
            $sourceProject = find_project_for_user($conn, $source_project_id, $user_id, 'p.folder_path, p.public_url');
            if ($sourceProject) {
                $sourcePath = resolve_project_directory_from_folder_path(
                    $sourceProject['folder_path'] ?? '',
                    $sourceProject['public_url'] ?? ''
                );
                $sourceAssets = $sourcePath . DIRECTORY_SEPARATOR . 'assets';
                $targetAssets = $projectPath . DIRECTORY_SEPARATOR . 'assets';
                create_project_copy_directory_contents($sourceAssets, $targetAssets);

                $oldPrefixes = array_values(array_unique(array_filter([
                    create_project_prefix_from_folder_path($sourceProject['folder_path'] ?? '', $sourceProject['public_url'] ?? ''),
                    isset($sourceProject['public_url']) ? (string)$sourceProject['public_url'] : '',
                ], 'strlen')));
                $newPrefix = '/projects/' . $slug . '/';
                $formDataDecoded = create_project_rewrite_asset_paths($formDataDecoded, $oldPrefixes, $newPrefix);
                $form_data = json_encode($formDataDecoded, JSON_UNESCAPED_UNICODE);
            }
        } catch (Throwable $e) {
            error_log("Could not copy restored ad campaign assets: " . $e->getMessage());
        }
    }

    if (is_string($generated_html) && trim($generated_html) !== '') {
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', (string)$generated_html);
    }

    $update = $conn->prepare("UPDATE projects SET public_url = ?, folder_path = ?, form_data = ? WHERE id = ?");
    $update->bind_param("sssi", $public_url, $folder_path, $form_data, $project_id);
    if (!$update->execute()) {
        error_log("UPDATE failed: " . $update->error);
    }
    $update->close();

    echo json_encode([
        "success" => true,
        "id" => $project_id,
        "public_url" => $public_url,
        "folder_path" => $folder_path,
        "form_data" => $formDataDecoded,
        "message" => "Projeto salvo com sucesso"
    ]);
} else {
    http_response_code(500);
    error_log("INSERT failed: " . $stmt->error);
    echo json_encode([
        "error" => "Erro ao salvar projeto",
        "details" => $stmt->error
    ]);
}

$stmt->close();
$conn->close();
?>
