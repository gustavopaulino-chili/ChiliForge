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

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["user_id"]) || !isset($data["name"])) {
    http_response_code(400);
    echo json_encode(["error" => "Dados obrigatorios faltando"]);
    exit;
}

$user_id      = (int)$data["user_id"];
$project_id   = isset($data["project_id"]) ? (int)$data["project_id"] : 0;
$name         = trim((string)$data["name"]);
$formDataRaw  = isset($data["form_data"]) && is_array($data["form_data"]) ? $data["form_data"] : [];
$slug_request = isset($data["slug"]) ? (string)$data["slug"] : $name;
$current_step = isset($data["current_step"]) ? (int)$data["current_step"] : 0;
$project_type = 'ad_creative';

$raw_html = isset($data["html"]) ? (string)$data["html"] : '';
$html = strip_editor_bridge_artifacts($raw_html);
$projectGeneratedHtml = '';

function replace_url_prefix_recursive($value, string $oldPrefix, string $newPrefix) {
    if ($oldPrefix === '' || $oldPrefix === $newPrefix) {
        return $value;
    }

    if (is_string($value)) {
        return str_replace($oldPrefix, $newPrefix, $value);
    }

    if (is_array($value)) {
        foreach ($value as $key => $item) {
            $value[$key] = replace_url_prefix_recursive($item, $oldPrefix, $newPrefix);
        }
    }

    return $value;
}

function normalize_project_public_prefix(string $value): string {
    $value = preg_replace('/\/index\.html$/i', '/', trim($value));
    if ($value === '') return '';
    if (!str_ends_with($value, '/')) $value .= '/';
    return $value;
}

function public_prefix_from_folder_path(string $folderPath): string {
    $segments = array_values(array_filter(explode('/', trim(str_replace('\\', '/', $folderPath), '/')), 'strlen'));
    if (empty($segments)) {
        return '';
    }

    $slug = sanitize_slug((string)end($segments));
    return $slug !== '' ? '/projects/' . $slug . '/' : '';
}

function collect_project_asset_reference_map(string $projectPath, array $publicPrefixes, string $relativePrefix): array {
    $assetsPath = $projectPath . DIRECTORY_SEPARATOR . 'assets';
    if (!is_dir($assetsPath)) {
        return [];
    }

    $prefixes = [];
    foreach ($publicPrefixes as $prefix) {
        $normalized = normalize_project_public_prefix((string)$prefix);
        if ($normalized !== '') {
            $prefixes[] = $normalized;
        }
    }
    $prefixes = array_values(array_unique($prefixes));

    $map = [];
    $entries = @scandir($assetsPath);
    if (!is_array($entries)) {
        return [];
    }

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..' || !is_file($assetsPath . DIRECTORY_SEPARATOR . $entry)) {
            continue;
        }

        $encoded = rawurlencode($entry);
        $relativePath = $relativePrefix . 'assets/' . $encoded;
        foreach ($prefixes as $prefix) {
            foreach ([$entry, $encoded] as $name) {
                $map[$prefix . 'assets/' . $name] = $relativePath;
                $map[ltrim($prefix, '/') . 'assets/' . $name] = $relativePath;
            }
        }
    }

    return $map;
}

function mirror_ad_creative_assets(array $assetUrls, string $projectPath): array {
    $assetsPath = $projectPath . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsPath);

    $assetMap = [];
    $assetIndex = 1;

    foreach ($assetUrls as $assetUrl) {
        if (!is_string($assetUrl) || trim($assetUrl) === '' || !is_supported_asset_url($assetUrl)) {
            continue;
        }

        $normalizedAssetUrl = normalize_asset_url($assetUrl);
        if ($normalizedAssetUrl === '') {
            continue;
        }

        if (isset($assetMap[$normalizedAssetUrl])) {
            continue;
        }

        $downloaded = download_remote_asset($normalizedAssetUrl);
        if ($downloaded === null || !isset($downloaded['body'])) {
            continue;
        }

        $extension = extract_extension_from_url($normalizedAssetUrl, $downloaded['content_type'] ?? null);
        $fileName = 'ad-asset-' . $assetIndex . '.' . $extension;
        while (file_exists($assetsPath . DIRECTORY_SEPARATOR . $fileName)) {
            $assetIndex++;
            $fileName = 'ad-asset-' . $assetIndex . '.' . $extension;
        }

        $relativePath = 'assets/' . rawurlencode($fileName);
        file_put_contents($assetsPath . DIRECTORY_SEPARATOR . $fileName, $downloaded['body']);
        $assetMap[$normalizedAssetUrl] = $relativePath;
        $assetIndex++;
    }

    return $assetMap;
}

function with_relative_prefix(array $map, string $relativePrefix): array {
    if ($relativePrefix === '') {
        return $map;
    }

    $prefixed = [];
    foreach ($map as $original => $relativePath) {
        $path = (string)$relativePath;
        $prefixed[$original] = str_starts_with($path, 'assets/') ? $relativePrefix . $path : $path;
    }
    return $prefixed;
}

function rewrite_any_project_asset_refs(string $content, string $relativePrefix): string {
    $target = $relativePrefix . 'assets/';
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/projects\/[^\/"\'\s)]+\/assets\//i', $target, $content);
    $content = preg_replace('/(?<![\w:])\/?projects\/[^\/"\'\s)]+\/assets\//i', $target, $content);
    return is_string($content) ? $content : '';
}

if ($user_id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuario invalido"]);
    exit;
}

if ($name === '') {
    http_response_code(400);
    echo json_encode(["error" => "Nome do projeto obrigatorio"]);
    exit;
}

try {
    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $existingProject = null;
    $effectiveUserId = $user_id;

    if ($project_id > 0) {
        $existingProject = find_project_for_user($conn, $project_id, $user_id, 'p.id, p.public_url, p.folder_path');
        if ($existingProject) {
            $effectiveUserId = (int)($existingProject['actual_user_id'] ?? $user_id);
        }
    }

    if ($existingProject) {
        $public_url  = trim((string)($existingProject['public_url'] ?? ''));
        $folder_path = trim((string)($existingProject['folder_path'] ?? ''));
        $old_public_url = normalize_project_public_prefix($public_url);
        $old_folder_public_url = public_prefix_from_folder_path($folder_path);

        if ($public_url === '' && $folder_path !== '') {
            $folderSlug = sanitize_slug((string)basename(trim($folder_path, " /\\")));
            $public_url = '/projects/' . $folderSlug . '/';
        }

        $projectPath = resolve_project_directory_from_folder_path($folder_path, $public_url);
        $slug        = sanitize_slug((string)basename($projectPath));

        $requestedSlugNorm = sanitize_slug($slug_request);
        if ($requestedSlugNorm !== '' && $requestedSlugNorm !== $slug) {
            $newSlug = !is_dir($sitesBasePath . DIRECTORY_SEPARATOR . $requestedSlugNorm)
                ? $requestedSlugNorm
                : ensure_unique_slug($requestedSlugNorm, $sitesBasePath);

            $newProjectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $newSlug;
            if (@rename($projectPath, $newProjectPath)) {
                $projectPath = $newProjectPath;
                $slug        = $newSlug;
                $public_url  = '/projects/' . $newSlug . '/';
                $folder_path = '/public/projects/' . $newSlug;
            }
        }
    } else {
        $old_public_url = '';
        $old_folder_public_url = '';
        $slug        = ensure_unique_slug($slug_request, $sitesBasePath);
        $projectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $slug;
        $public_url  = '/projects/' . $slug . '/';
        $folder_path = '/public/projects/' . $slug;
    }

    $public_url = normalize_project_public_prefix($public_url);
    $oldPrefixes = array_values(array_unique(array_filter([$old_public_url, $old_folder_public_url], 'strlen')));
    foreach ($oldPrefixes as $oldPrefix) {
        $oldPrefix = normalize_project_public_prefix($oldPrefix);
        if ($oldPrefix !== '' && $oldPrefix !== $public_url) {
            $html = str_replace($oldPrefix, $public_url, $html);
            $formDataRaw = replace_url_prefix_recursive($formDataRaw, $oldPrefix, $public_url);
        }
    }

    ensure_directory($projectPath);
    ensure_directory($projectPath . DIRECTORY_SEPARATOR . 'assets');

    $reqBanners = isset($data["banners"]) && is_array($data["banners"]) ? $data["banners"] : [];
    $bannerHtmlList = [];
    foreach ($reqBanners as $banner) {
        $candidateHtml = isset($banner["html"]) ? strip_editor_bridge_artifacts((string)$banner["html"]) : '';
        foreach ($oldPrefixes as $oldPrefix) {
            $oldPrefix = normalize_project_public_prefix($oldPrefix);
            if ($oldPrefix !== '' && $oldPrefix !== $public_url) {
                $candidateHtml = str_replace($oldPrefix, $public_url, $candidateHtml);
            }
        }
        $bannerHtmlList[] = $candidateHtml;
    }

    $discoveredAssets = array_merge(
        extract_asset_urls_from_form_data($formDataRaw),
        extract_asset_urls_from_content($html)
    );
    foreach ($bannerHtmlList as $candidateHtml) {
        $discoveredAssets = array_merge($discoveredAssets, extract_asset_urls_from_content($candidateHtml));
    }
    $mirroredAssetMap = mirror_ad_creative_assets(array_values(array_unique($discoveredAssets)), $projectPath);
    $localRootAssetMap = collect_project_asset_reference_map($projectPath, array_merge([$public_url], $oldPrefixes), '');
    $rootAssetMap = array_merge($mirroredAssetMap, $localRootAssetMap);
    $bannerAssetMap = with_relative_prefix($rootAssetMap, '../');

    $html = replace_asset_paths($html, $rootAssetMap);
    $html = rewrite_any_project_asset_refs($html, '');

    $form_data = json_encode($formDataRaw, JSON_UNESCAPED_UNICODE);
    if (!$form_data) {
        throw new RuntimeException('Dados do formulario invalidos');
    }

    file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', $html);

    if ($existingProject) {
        $pid = (int)$existingProject['id'];
        $stmt = $conn->prepare(
            "UPDATE projects SET name = ?, public_url = ?, folder_path = ?, form_data = ?, generated_html = ?, current_step = ?, project_type = ? WHERE id = ? AND user_id = ?"
        );
        $stmt->bind_param("sssssisii", $name, $public_url, $folder_path, $form_data, $projectGeneratedHtml, $current_step, $project_type, $pid, $effectiveUserId);
        if (!$stmt->execute()) {
            throw new RuntimeException('Erro ao atualizar projeto: ' . $stmt->error);
        }
        $stmt->close();
        $project_id = $pid;
    } else {
        $stmt = $conn->prepare(
            "INSERT INTO projects (user_id, name, public_url, folder_path, form_data, generated_html, current_step, project_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())"
        );
        $stmt->bind_param("isssssis", $user_id, $name, $public_url, $folder_path, $form_data, $projectGeneratedHtml, $current_step, $project_type);
        if (!$stmt->execute()) {
            throw new RuntimeException('Erro ao salvar projeto: ' . $stmt->error);
        }
        $project_id = $conn->insert_id;
        $stmt->close();
    }

    $campaignName = $name;
    $campaignStatus = 'generated';
    $campaignMeta = json_encode([
        "slug" => $slug,
        "creative_count" => count($reqBanners),
    ], JSON_UNESCAPED_UNICODE);
    $campaignId = 0;

    $findCampaign = $conn->prepare("SELECT id FROM ads_campaign WHERE project_id = ? ORDER BY id DESC LIMIT 1");
    if (!$findCampaign) {
        throw new RuntimeException('Tabela ads_campaign nao encontrada. Execute o SQL de migracao.');
    }
    $findCampaign->bind_param("i", $project_id);
    if (!$findCampaign->execute()) {
        throw new RuntimeException('Erro ao buscar campanha: ' . $findCampaign->error);
    }
    $findCampaign->bind_result($existingCampaignId);
    if ($findCampaign->fetch()) {
        $campaignId = (int)$existingCampaignId;
    }
    $findCampaign->close();

    if ($campaignId > 0) {
        $campStmt = $conn->prepare(
            "UPDATE ads_campaign SET name = ?, form_data = ?, public_url = ?, current_step = ?, status = ?, metadata = ?, updated_at = NOW() WHERE id = ? AND project_id = ?"
        );
        if (!$campStmt) {
            throw new RuntimeException('Erro ao preparar update de campanha: ' . $conn->error);
        }
        $campStmt->bind_param("sssissii", $campaignName, $form_data, $public_url, $current_step, $campaignStatus, $campaignMeta, $campaignId, $project_id);
        if (!$campStmt->execute()) {
            throw new RuntimeException('Erro ao atualizar campanha: ' . $campStmt->error);
        }
        $campStmt->close();

        $deleteOld = $conn->prepare("DELETE FROM ads_creatives WHERE campaign_id = ? AND project_id = ?");
        if (!$deleteOld) {
            throw new RuntimeException('Erro ao preparar limpeza de criativos: ' . $conn->error);
        }
        $deleteOld->bind_param("ii", $campaignId, $project_id);
        if (!$deleteOld->execute()) {
            throw new RuntimeException('Erro ao limpar criativos antigos: ' . $deleteOld->error);
        }
        $deleteOld->close();
    } else {
        $campStmt = $conn->prepare(
            "INSERT INTO ads_campaign (project_id, name, form_data, public_url, current_step, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
        );
        if (!$campStmt) {
            throw new RuntimeException('Erro ao preparar insert de campanha: ' . $conn->error);
        }
        $campStmt->bind_param("isssiss", $project_id, $campaignName, $form_data, $public_url, $current_step, $campaignStatus, $campaignMeta);
        if (!$campStmt->execute()) {
            throw new RuntimeException('Erro ao salvar campanha: ' . $campStmt->error);
        }
        $campaignId = (int)$conn->insert_id;
        $campStmt->close();
    }

    $savedBanners = [];
    foreach ($reqBanners as $i => $banner) {
        $bHtml = $bannerHtmlList[$i] ?? '';
        $bHtml = replace_asset_paths($bHtml, $bannerAssetMap);
        $bHtml = rewrite_any_project_asset_refs($bHtml, '../');
        if (trim($bHtml) === '') continue;

        $bPlatform  = preg_replace('/[^a-z0-9\-]/', '', strtolower((string)($banner["platform"] ?? 'banner')));
        $bFormat    = preg_replace('/[^a-z0-9\-]/', '', strtolower((string)($banner["format"]   ?? 'ad')));
        $bLabel     = (string)($banner["label"]  ?? "Banner " . ($i + 1));
        $bWidth     = (int)($banner["width"]  ?? 1080);
        $bHeight    = (int)($banner["height"] ?? 1080);

        $bDirName    = "b{$i}";
        $bFolder     = $projectPath . DIRECTORY_SEPARATOR . $bDirName;
        $bPublicUrl  = $public_url . $bDirName . '/';
        $bName       = $name . ' - ' . $bLabel;
        $bMetadata   = json_encode([
            "variant" => isset($banner["variant"]) ? (string)$banner["variant"] : "",
            "source_index" => $i,
        ], JSON_UNESCAPED_UNICODE);

        ensure_directory($bFolder);
        file_put_contents($bFolder . DIRECTORY_SEPARATOR . 'index.html', $bHtml);

        $bStmt = $conn->prepare(
            "INSERT INTO ads_creatives (project_id, campaign_id, name, platform, format, label, width, height, generated_html, public_url, sort_order, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
        );
        if (!$bStmt) {
            throw new RuntimeException('Erro ao preparar insert de criativo: ' . $conn->error);
        }
        $bStmt->bind_param("iissssiissis", $project_id, $campaignId, $bName, $bPlatform, $bFormat, $bLabel, $bWidth, $bHeight, $bHtml, $bPublicUrl, $i, $bMetadata);
        if ($bStmt->execute()) {
            $bId = (int)$conn->insert_id;
            $savedBanners[] = [
                "id"       => $bId,
                "creative_id" => $bId,
                "project_id" => $project_id,
                "campaign_id" => $campaignId,
                "url"      => $bPublicUrl,
                "platform" => $bPlatform,
                "format"   => $bFormat,
                "label"    => $bLabel,
                "width"    => $bWidth,
                "height"   => $bHeight,
                "variant"  => isset($banner["variant"]) ? (string)$banner["variant"] : "",
            ];
        }
        $bStmt->close();
    }

    $conn->close();

    echo json_encode([
        "success"     => true,
        "id"          => $project_id,
        "campaign_id" => $campaignId,
        "slug"        => $slug,
        "url"         => $public_url,
        "folder_path" => $folder_path,
        "banners"     => $savedBanners,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        "error"   => "Falha ao publicar AD Creative",
        "details" => $error->getMessage(),
    ]);
}
?>
