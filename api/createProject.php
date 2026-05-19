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
$context = isset($data["context"]) ? trim((string)$data["context"]) : '';
$company_project_id = isset($data["company_project_id"]) && (int)$data["company_project_id"] > 0
    ? (int)$data["company_project_id"] : null;

function create_project_context_from_form(array $formData): string {
    $lines = [];
    $pairs = [
        'Company' => $formData['businessName'] ?? $formData['brandName'] ?? '',
        'Industry' => $formData['businessCategory'] ?? $formData['industry'] ?? '',
        'Description' => $formData['businessDescription'] ?? '',
        'Audience' => $formData['targetAudience'] ?? '',
        'Value proposition' => $formData['valueProposition'] ?? '',
        'Tone' => $formData['toneOfVoice'] ?? '',
        'Design notes' => $formData['designNotes'] ?? '',
    ];

    foreach ($pairs as $label => $value) {
        $value = is_string($value) ? trim($value) : '';
        if ($value !== '') {
            $lines[] = $label . ': ' . $value;
        }
    }

    foreach (['services' => 'Services/products', 'differentiators' => 'Differentiators'] as $key => $label) {
        if (isset($formData[$key]) && is_array($formData[$key])) {
            $items = array_values(array_filter(array_map('strval', $formData[$key]), fn($item) => trim($item) !== ''));
            if (!empty($items)) {
                $lines[] = $label . ': ' . implode(', ', $items);
            }
        }
    }

    return implode("\n", $lines);
}

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
    return project_public_prefix_from_folder_path($folderPath, $publicUrl);
}

function create_project_find_company(mysqli $conn, int $companyProjectId, int $userId): ?array {
    if ($companyProjectId <= 0 || $userId <= 0) {
        return null;
    }

    $stmt = $conn->prepare(
        "SELECT id, name, public_url, folder_path, company_form_data
         FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project'
         LIMIT 1"
    );
    if (!$stmt) {
        return null;
    }

    $stmt->bind_param("ii", $companyProjectId, $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = ($result !== false) ? $result->fetch_assoc() : null;
    $stmt->close();

    return $row ?: null;
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
$companyFormData = $project_type === 'project' ? $form_data : '{}';
$projectContext = $context !== '' ? $context : create_project_context_from_form($formDataDecoded);
$stmt = $conn->prepare("INSERT INTO projects (user_id, company_project_id, name, public_url, folder_path, company_form_data, context, project_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())");
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Falha ao preparar query de criação de projeto", "details" => $conn->error]);
    $conn->close();
    exit;
}
$stmt->bind_param("iissssss", $user_id, $company_project_id, $name, $public_url, $folder_path, $companyFormData, $projectContext, $project_type);

if ($stmt->execute()) {
    $project_id = $conn->insert_id;

    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $companyRelativePath = '';
    $companyProject = ($company_project_id !== null && $project_type !== 'project')
        ? create_project_find_company($conn, $company_project_id, $user_id)
        : null;

    if ($companyProject) {
        $companyRelativePath = extract_project_relative_path_from_folder_path((string)($companyProject['folder_path'] ?? ''));
        if ($companyRelativePath === '') {
            $companyRelativePath = extract_project_relative_path_from_public_url((string)($companyProject['public_url'] ?? ''));
        }
        if ($companyRelativePath === '') {
            $companyData = json_decode((string)($companyProject['company_form_data'] ?? '{}'), true);
            $companyData = is_array($companyData) ? $companyData : [];
            $companySlugSource = (string)($companyData['projectSlug'] ?? $companyData['customSlug'] ?? $companyProject['name'] ?? ('company-' . $company_project_id));
            $companyRelativePath = ensure_unique_slug($companySlugSource, $sitesBasePath);
            $companyPublicUrl = project_public_url_from_relative($companyRelativePath);
            $companyFolderPath = project_folder_path_from_relative($companyRelativePath);
            $companyUpdate = $conn->prepare("UPDATE projects SET public_url = ?, folder_path = ? WHERE id = ? AND user_id = ?");
            if ($companyUpdate) {
                $companyUpdate->bind_param("ssii", $companyPublicUrl, $companyFolderPath, $company_project_id, $user_id);
                $companyUpdate->execute();
                $companyUpdate->close();
            }
        }

        $companyPath = project_directory_from_relative($companyRelativePath);
        ensure_directory($companyPath);
    }

    $rawCustomSlug = isset($formDataDecoded['projectSlug'])
        ? (string)$formDataDecoded['projectSlug']
        : (isset($formDataDecoded['customSlug']) ? (string)$formDataDecoded['customSlug'] : '');
    if (trim($rawCustomSlug) === '' && $project_type !== 'project') {
        $rawCustomSlug = $name;
    }
    $sanitizedCustom = sanitize_slug($rawCustomSlug);

    if ($companyRelativePath !== '') {
        $companyPath = project_directory_from_relative($companyRelativePath);
        $slug = ($sanitizedCustom !== '' && $sanitizedCustom !== 'site')
            ? ensure_unique_slug($sanitizedCustom, $companyPath)
            : 'site-' . $project_id;
        if (is_dir($companyPath . DIRECTORY_SEPARATOR . $slug)) {
            $slug = ensure_unique_slug($slug, $companyPath);
        }
        $relativePath = trim($companyRelativePath, '/') . '/' . $slug;
    } elseif ($sanitizedCustom !== '' && $sanitizedCustom !== 'site') {
        $slug = ensure_unique_slug($sanitizedCustom, $sitesBasePath);
        $relativePath = $slug;
    } else {
        $slug = 'site-' . $project_id;
        $relativePath = $slug;
    }

    $public_url  = ($draft_only && $project_type !== 'ad_creative') ? "" : project_public_url_from_relative($relativePath);
    $folder_path = project_folder_path_from_relative($relativePath);

    $projectPath = project_directory_from_relative($relativePath);
    ensure_directory($projectPath);

    $projectUpdate = $conn->prepare("UPDATE projects SET public_url = ?, folder_path = ?, company_form_data = ?, context = ? WHERE id = ?");
    if ($projectUpdate !== false) {
        $projectUpdate->bind_param("ssssi", $public_url, $folder_path, $companyFormData, $projectContext, $project_id);
        $projectUpdate->execute();
        $projectUpdate->close();
    }

    if ($source_project_id > 0 && $project_type === 'ad_creative') {
        try {
            $sourceProject = find_project_for_user($conn, $source_project_id, $user_id, 'p.id');
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
                $newPrefix = project_public_url_from_relative($relativePath);
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

    if ($project_type === 'project') {
        $update = null;
    } elseif ($project_type === 'ad_creative') {
        $campaignName = $name;
        $campaignStatus = 'draft';
        $campaignMeta = json_encode(["slug" => $slug, "relative_path" => $relativePath], JSON_UNESCAPED_UNICODE);
        $update = $conn->prepare(
            "INSERT INTO ads_campaign (project_id, name, form_data, public_url, current_step, status, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
        );
        if (!$update) {
            http_response_code(500);
            echo json_encode(["error" => "Tabela ads_campaign nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
            $conn->close();
            exit;
        }
        $update->bind_param("isssiss", $project_id, $campaignName, $form_data, $public_url, $current_step, $campaignStatus, $campaignMeta);
    } else {
        $update = $conn->prepare(
            "INSERT INTO lps (project_id, public_url, folder_path, form_data, generated_html, current_step)
             VALUES (?, ?, ?, ?, ?, ?)"
        );
        if (!$update) {
            http_response_code(500);
            echo json_encode(["error" => "Tabela lps nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
            $conn->close();
            exit;
        }
        $update->bind_param("issssi", $project_id, $public_url, $folder_path, $form_data, $generated_html, $current_step);
    }
    if ($update && !$update->execute()) {
        http_response_code(500);
        error_log("Project state insert failed: " . $update->error);
        echo json_encode([
            "error" => "Erro ao salvar estado do projeto",
            "details" => $update->error
        ]);
        $update->close();
        $conn->close();
        exit;
    }
    if ($update) {
        $update->close();
    }

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
