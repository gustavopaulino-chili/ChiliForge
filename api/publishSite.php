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

if (!$data || !isset($data["user_id"]) || !isset($data["name"]) || !isset($data["form_data"])) {
    http_response_code(400);
    echo json_encode(["error" => "Dados obrigatórios faltando"]);
    exit;
}

$user_id = (int)$data["user_id"];
$project_id = isset($data["project_id"]) ? (int)$data["project_id"] : 0;
$name = trim((string)$data["name"]);
$formDataPayload = is_array($data["form_data"]) ? $data["form_data"] : [];
$form_data = json_encode($data["form_data"], JSON_UNESCAPED_UNICODE);
$requested_slug = isset($data["slug"]) ? $data["slug"] : $name;
$current_step = isset($data["current_step"]) ? (int)$data["current_step"] : 0;

$html = isset($data["html"]) && trim((string)$data["html"]) !== '' ? (string)$data["html"] : '<div>Fallback</div>';
$css = isset($data["css"]) && trim((string)$data["css"]) !== '' ? (string)$data["css"] : 'body { margin: 0; font-family: Arial, sans-serif; }';
$js = isset($data["js"]) ? (string)$data["js"] : "";
$assets = isset($data["assets"]) && is_array($data["assets"]) ? $data["assets"] : [];
// Inline doc: AI returned a complete <!DOCTYPE html> with embedded <style> and <script>.
$isInlineDoc = isset($data["inline_doc"]) ? (bool)$data["inline_doc"] : preg_match('/<!DOCTYPE|<html/i', $html) === 1;

$html = strip_editor_bridge_artifacts($html);

if ($user_id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuário inválido"]);
    exit;
}

if ($name === '' || !$form_data) {
    http_response_code(400);
    echo json_encode(["error" => "Dados inválidos para publicação"]);
    exit;
}

try {
    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $existingProject = null;
    if ($project_id > 0) {
        $projectLookup = $conn->prepare("SELECT id, public_url, folder_path FROM projects WHERE id = ? AND user_id = ? LIMIT 1");
        $projectLookup->bind_param("ii", $project_id, $user_id);
        $projectLookup->execute();
        $projectResult = $projectLookup->get_result();
        $existingProject = $projectResult ? $projectResult->fetch_assoc() : null;
        $projectLookup->close();
    }

    if ($existingProject) {
        $public_url = trim((string)($existingProject['public_url'] ?? ''));
        $folder_path = trim((string)($existingProject['folder_path'] ?? ''));
        if ($public_url === '' && $folder_path !== '') {
            $folderSlug = sanitize_slug((string)basename(trim($folder_path, " \/\\")));
            $public_url = '/projects/' . $folderSlug . '/';
        }
        $projectPath = resolve_project_directory_from_folder_path($folder_path, $public_url);
        $slug = sanitize_slug((string)basename($projectPath));

        // --- Slug rename: renomeia pasta para o customSlug do formulário ---
        $requestedSlugNorm = sanitize_slug($requested_slug);
        if ($requestedSlugNorm !== '' && $requestedSlugNorm !== $slug) {
            $newSlug = !is_dir($sitesBasePath . DIRECTORY_SEPARATOR . $requestedSlugNorm)
                ? $requestedSlugNorm
                : ensure_unique_slug($requestedSlugNorm, $sitesBasePath);

            $newProjectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $newSlug;

            if (@rename($projectPath, $newProjectPath)) {
                $oldPrefix = '/projects/' . $slug . '/';
                $newPrefix = '/projects/' . $newSlug . '/';
                $html = str_replace($oldPrefix, $newPrefix, $html);
                $css  = str_replace($oldPrefix, $newPrefix, $css);
                $js   = str_replace($oldPrefix, $newPrefix, $js);

                $projectPath = $newProjectPath;
                $slug        = $newSlug;
                $public_url  = '/projects/' . $newSlug . '/';
                $folder_path = '/public/projects/' . $newSlug;
            } else {
                error_log('[ChiliForge] publishSite: could not rename ' . $projectPath . ' → ' . $newProjectPath . '; keeping old slug.');
            }
        }
        // --- End slug rename ---
    } else {
        $slug = ensure_unique_slug($requested_slug, $sitesBasePath);
        $projectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $slug;
        $public_url = '/projects/' . $slug . '/';
        $folder_path = '/public/projects/' . $slug;
    }

    $assetsPath = $projectPath . DIRECTORY_SEPARATOR . 'assets';
    $downloadsPath = $projectPath . DIRECTORY_SEPARATOR . 'files';

    ensure_directory($projectPath);
    ensure_directory($assetsPath);
    ensure_directory($downloadsPath);

    $projectRootPath = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
    $sharedFilesPath = $projectRootPath ? ($projectRootPath . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'files') : null;
    $downloadFileUrlMap = [];

    if (isset($formDataPayload['downloadFiles']) && is_array($formDataPayload['downloadFiles'])) {
        foreach ($formDataPayload['downloadFiles'] as $fileItem) {
            if (!is_array($fileItem)) {
                continue;
            }

            $rawName = isset($fileItem['name']) ? (string)$fileItem['name'] : '';
            $rawUrl = isset($fileItem['url']) ? (string)$fileItem['url'] : '';
            $urlPathName = '';
            if ($rawUrl !== '') {
                $parsedPath = parse_url($rawUrl, PHP_URL_PATH);
                if (is_string($parsedPath) && $parsedPath !== '') {
                    $urlPathName = basename($parsedPath);
                }
            }
            $safeName = basename(trim($rawName !== '' ? $rawName : $urlPathName));
            $safeName = urldecode($safeName);

            if ($safeName === '') {
                continue;
            }

            $sourceFile = $sharedFilesPath ? ($sharedFilesPath . DIRECTORY_SEPARATOR . $safeName) : '';
            $targetRelative = 'files/' . $safeName;
            $targetFile = $downloadsPath . DIRECTORY_SEPARATOR . $safeName;
            $copied = false;

            if ($sourceFile !== '' && file_exists($sourceFile) && is_file($sourceFile)) {
                $copied = @copy($sourceFile, $targetFile) === true;
            }

            if (!$copied && $rawUrl !== '' && preg_match('/^https?:\/\//i', $rawUrl)) {
                $remoteFile = download_remote_asset($rawUrl);
                if (is_array($remoteFile) && isset($remoteFile['body'])) {
                    @file_put_contents($targetFile, $remoteFile['body']);
                    $copied = file_exists($targetFile);
                }
            }

            $downloadFileUrlMap['/files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['/files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['./files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['./files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['public/files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['/public/files/' . $safeName] = $targetRelative;
            if ($rawUrl !== '') {
                $downloadFileUrlMap[$rawUrl] = $targetRelative;
                $trimmedRawUrl = trim($rawUrl);
                if ($trimmedRawUrl !== $rawUrl) {
                    $downloadFileUrlMap[$trimmedRawUrl] = $targetRelative;
                }
                $downloadFileUrlMap[urldecode($rawUrl)] = $targetRelative;
            }
        }
    }

    // Additionally, detect references to files/ in the generated content (HTML/CSS/JS)
    // so AI-generated links like ./files/guide.pdf will be collected and copied/downloaded.
    $allContent = ($html ?? '') . "\n" . ($css ?? '') . "\n" . ($js ?? '');
    if (preg_match_all('/(?:["\'\(])((?:\.\/|\/|)files\/[a-z0-9A-Z_\.\-\%\(\)\,]+)(?:["\'\)])/i', $allContent, $matches)) {
        $found = array_values(array_unique($matches[1]));
        foreach ($found as $rawRef) {
            $rawRef = trim($rawRef);
            if ($rawRef === '') continue;
            // derive safe file name
            $parsedPath = parse_url($rawRef, PHP_URL_PATH);
            $urlPathName = is_string($parsedPath) && $parsedPath !== '' ? basename($parsedPath) : basename($rawRef);
            $safeName = urldecode(basename(trim($urlPathName)));
            if ($safeName === '') continue;

            $targetRelative = 'files/' . $safeName;
            $targetFile = $downloadsPath . DIRECTORY_SEPARATOR . $safeName;

            $copied = false;
            // try copying from shared public/files
            $sourceFile = $sharedFilesPath ? ($sharedFilesPath . DIRECTORY_SEPARATOR . $safeName) : '';
            if ($sourceFile !== '' && file_exists($sourceFile) && is_file($sourceFile)) {
                $copied = @copy($sourceFile, $targetFile) === true;
            }

            // if rawRef looks like an absolute URL, try downloading
            if (!$copied && preg_match('/^https?:\/\//i', $rawRef)) {
                $remoteFile = download_remote_asset($rawRef);
                if (is_array($remoteFile) && isset($remoteFile['body'])) {
                    @file_put_contents($targetFile, $remoteFile['body']);
                    $copied = file_exists($targetFile);
                }
            }

            // register mapping so references are rewritten to local files/
            $downloadFileUrlMap['/files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['/files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['./files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['./files/' . rawurlencode($safeName)] = $targetRelative;
            $downloadFileUrlMap['public/files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap['/public/files/' . $safeName] = $targetRelative;
            $downloadFileUrlMap[$rawRef] = $targetRelative;
            $downloadFileUrlMap[urldecode($rawRef)] = $targetRelative;
        }
    }

    $javascriptReferences = array_values(array_unique(array_filter(array_merge(
        extract_javascript_references_from_content($html),
        extract_javascript_references_from_content($css),
        extract_javascript_references_from_content($js),
        array_filter($assets, 'is_javascript_file_reference')
    ))));

    if ($isInlineDoc) {
        // Inline mode: JS is embedded in HTML. No external script.js needed.
        $js = '';
    } else {
        $js = build_root_script_content($js, $javascriptReferences);
        if (trim($js) === '') {
            throw new RuntimeException('script.js is mandatory and could not be generated.');
        }
        $html = rewrite_javascript_references_to_root_script($html);
        $css = rewrite_javascript_references_to_root_script($css);
    }
    $assets = array_values(array_filter($assets, 'is_supported_asset_url'));

    $formAssets = extract_asset_urls_from_form_data($formDataPayload);
    $discoveredAssets = array_merge(
        $formAssets,
        extract_asset_urls_from_content($html),
        extract_asset_urls_from_content($css),
        extract_asset_urls_from_content($js)
    );
    $assets = array_values(array_unique(array_merge($assets, $discoveredAssets)));

    $userLogoUrl = '';
    if (isset($formDataPayload['images']) && is_array($formDataPayload['images'])) {
        $images = $formDataPayload['images'];
        if (isset($images['logoUrl']) && is_string($images['logoUrl']) && trim($images['logoUrl']) !== '') {
            $userLogoUrl = normalize_asset_url((string)$images['logoUrl']);
        }
    }

    $currentProjectAssetPrefix = trim((string)$public_url);
    $currentProjectAssetPrefix = preg_replace('/\/index\.html$/i', '/', $currentProjectAssetPrefix);
    if (!is_string($currentProjectAssetPrefix)) {
        $currentProjectAssetPrefix = '';
    }
    if ($currentProjectAssetPrefix !== '' && !str_ends_with($currentProjectAssetPrefix, '/')) {
        $currentProjectAssetPrefix .= '/';
    }

    $assetMap = [];
    $failedAssetMirrors = [];
    $failedLogoMirror = false;
    $assetIndex = 1;
    foreach ($assets as $assetUrl) {
        if (!is_string($assetUrl) || trim($assetUrl) === '' || !is_supported_asset_url($assetUrl)) {
            continue;
        }

        $normalizedAssetUrl = normalize_asset_url($assetUrl);
        $assetPath = (string)(parse_url($normalizedAssetUrl, PHP_URL_PATH) ?: '');
        $expectedPrefix = $currentProjectAssetPrefix !== ''
            ? (string)(parse_url($currentProjectAssetPrefix, PHP_URL_PATH) ?: $currentProjectAssetPrefix)
            : '';
        if ($assetPath !== '' && $expectedPrefix !== '' && str_starts_with($assetPath, $expectedPrefix . 'assets/')) {
            $existingFileName = basename($assetPath);
            $existingRelativePath = 'assets/' . $existingFileName;
            $existingFilePath = $assetsPath . DIRECTORY_SEPARATOR . $existingFileName;
            if (is_file($existingFilePath)) {
                $assetMap[$assetUrl] = $existingRelativePath;
                continue;
            }
        }

        $downloaded = download_remote_asset($assetUrl);
        if ($downloaded === null) {
            // Some sources (e.g. protected SVG endpoints) cannot be mirrored reliably.
            // Keep original URL instead of failing the whole publish flow.
            $failedAssetMirrors[] = $assetUrl;
            $normalizedFailed = normalize_asset_url($assetUrl);
            if ($userLogoUrl !== '' && $normalizedFailed === $userLogoUrl) {
                $failedLogoMirror = true;
            }
            continue;
        }

        $extension = extract_extension_from_url($assetUrl, $downloaded['content_type']);
        $fileName = 'asset-' . $assetIndex . '.' . $extension;
        $relativePath = 'assets/' . $fileName;
        $targetFile = $assetsPath . DIRECTORY_SEPARATOR . $fileName;

        file_put_contents($targetFile, $downloaded['body']);
        $assetMap[$assetUrl] = $relativePath;
        $assetIndex++;
    }

    $normalizedAssetMap = [];
    foreach ($assetMap as $originalUrl => $relativePath) {
        $normalizedAsset = normalize_asset_url((string)$originalUrl);
        if ($normalizedAsset !== '') {
            $normalizedAssetMap[$normalizedAsset] = $relativePath;
        }
    }

    $preferredAssetPaths = [];
    if (isset($formDataPayload['images']) && is_array($formDataPayload['images'])) {
        $images = $formDataPayload['images'];
        foreach (['logoUrl', 'heroImage1', 'heroImage2', 'brandImage', 'sectionImage1', 'sectionImage2', 'sectionImage3', 'aboutImage', 'teamImage'] as $imageKey) {
            $rawValue = isset($images[$imageKey]) && is_string($images[$imageKey]) ? normalize_asset_url((string)$images[$imageKey]) : '';
            if ($rawValue !== '' && isset($normalizedAssetMap[$rawValue])) {
                $preferredAssetPaths[] = $normalizedAssetMap[$rawValue];
            }
        }
        if (isset($images['productImages']) && is_array($images['productImages'])) {
            foreach ($images['productImages'] as $productImage) {
                $rawValue = is_string($productImage) ? normalize_asset_url($productImage) : '';
                if ($rawValue !== '' && isset($normalizedAssetMap[$rawValue])) {
                    $preferredAssetPaths[] = $normalizedAssetMap[$rawValue];
                }
            }
        }
    }
    $preferredAssetPaths = array_values(array_unique(array_filter($preferredAssetPaths, 'strlen')));

    $html = replace_asset_paths($html, $assetMap);
    $html = replace_placeholder_asset_paths($html, $preferredAssetPaths);
    if (!empty($downloadFileUrlMap)) {
        $html = str_replace(array_keys($downloadFileUrlMap), array_values($downloadFileUrlMap), $html);
    }
    if (!$isInlineDoc) {
        $css = replace_asset_paths($css, $assetMap);
        $css = replace_placeholder_asset_paths($css, $preferredAssetPaths);
        if (!empty($downloadFileUrlMap)) {
            $css = str_replace(array_keys($downloadFileUrlMap), array_values($downloadFileUrlMap), $css);
        }
        $js = replace_asset_paths($js, $assetMap);
        if (!empty($downloadFileUrlMap)) {
            $js = str_replace(array_keys($downloadFileUrlMap), array_values($downloadFileUrlMap), $js);
        }
    }

    // Enforce strict logo role:
    // - Only the user-provided logo URL can appear as .brand-logo image.
    // - If user logo is missing/unavailable, remove logo image and show text fallback.
    $resolvedLogoPath = '';
    if ($userLogoUrl !== '' && isset($normalizedAssetMap[$userLogoUrl])) {
        $resolvedLogoPath = $normalizedAssetMap[$userLogoUrl];
    }

    $canUseLogoImage = ($userLogoUrl !== '' && !$failedLogoMirror);
    $effectiveLogoSrc = $resolvedLogoPath !== '' ? $resolvedLogoPath : $userLogoUrl;

    if ($canUseLogoImage && $effectiveLogoSrc !== '') {
        $escapedLogo = htmlspecialchars($effectiveLogoSrc, ENT_QUOTES, 'UTF-8');
        $html = preg_replace(
            '/(<img[^>]*class=["\'][^"\']*brand-logo[^"\']*["\'][^>]*)\bsrc=["\']([^"\']+)["\']/i',
            '$1src="' . $escapedLogo . '"',
            $html
        );
    } else {
        // Remove any non-user logo image and ensure text fallback is visible.
        $html = preg_replace('/<img[^>]*class=["\'][^"\']*brand-logo[^"\']*["\'][^>]*>/i', '', $html);
        $html = preg_replace_callback(
            '/(<(?:a|div)[^>]*class=["\'][^"\']*brand-mark[^"\']*["\'][^>]*>)([\s\S]*?)(<\/(?:a|div)>)/i',
            function ($matches) {
                $inner = preg_replace('/\sstyle=["\']display\s*:\s*none\s*;?["\']/i', '', $matches[2]);
                return $matches[1] . $inner . $matches[3];
            },
            $html
        );
    }

    $remainingAssets = array_values(array_unique(array_merge(
        extract_unmirrored_asset_urls_from_content($html),
        $isInlineDoc ? [] : extract_unmirrored_asset_urls_from_content($css),
        $isInlineDoc ? [] : extract_unmirrored_asset_urls_from_content($js)
    )));

    if (!empty($failedAssetMirrors)) {
        $remainingAssets = array_values(array_diff($remainingAssets, $failedAssetMirrors));
    }

    // Remove placeholder asset URLs in the HTML/CSS (placehold.co, etc.) that were never replaced.
    // Keep real external CDN URLs intact — they are functional even if we couldn't mirror them.
    // Never throw on remaining assets; always gracefully continue.
    if (!empty($remainingAssets)) {
        $realRemaining = array_values(array_filter($remainingAssets, 'is_placeholder_asset_url'));
        $externalRemaining = array_values(array_diff($remainingAssets, $realRemaining));
        if (!empty($externalRemaining)) {
            error_log('[ChiliForge] publish info: ' . count($externalRemaining) . ' external asset(s) kept as original URLs (could not mirror): ' . implode(', ', $externalRemaining));
        }
        if (!empty($realRemaining)) {
            error_log('[ChiliForge] publish warning: ' . count($realRemaining) . ' placeholder asset(s) stripped: ' . implode(', ', $realRemaining));
            foreach ($realRemaining as $stuckUrl) {
                $escaped = preg_quote($stuckUrl, '/');
                $html = preg_replace('/\bsrc=["\']' . $escaped . '["\']/', 'src=""', $html);
                $html = preg_replace('/url\(["\']?' . $escaped . '["\']?\)/', 'url()', $html);
                if (!$isInlineDoc) {
                    $css = preg_replace('/url\(["\']?' . $escaped . '["\']?\)/', 'url()', $css ?? '');
                }
            }
        }
    }

    if ($isInlineDoc) {
        // Inline mode: HTML already contains everything. Save as-is.
        $hostedHtml = $html;
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', $hostedHtml);
    } else {
        $hostedHtml = build_hosted_html($name, $html, $css, $js);
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', $hostedHtml);
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'style.css', $css);
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'script.js', $js);
    }

    if ($existingProject) {
        $project_id = (int)$existingProject['id'];
        $update = $conn->prepare("UPDATE projects SET name = ?, public_url = ?, folder_path = ?, form_data = ?, generated_html = ?, current_step = ? WHERE id = ? AND user_id = ?");
        $update->bind_param("sssssiii", $name, $public_url, $folder_path, $form_data, $hostedHtml, $current_step, $project_id, $user_id);
        if (!$update->execute()) {
            throw new RuntimeException('Erro ao atualizar projeto: ' . $update->error);
        }
        $update->close();
    } else {
        $stmt = $conn->prepare("INSERT INTO projects (user_id, name, public_url, folder_path, form_data, generated_html, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
        $stmt->bind_param("isssssi", $user_id, $name, $public_url, $folder_path, $form_data, $hostedHtml, $current_step);

        if (!$stmt->execute()) {
            throw new RuntimeException('Erro ao salvar projeto: ' . $stmt->error);
        }

        $project_id = $conn->insert_id;
        $stmt->close();
    }

    $conn->close();

    echo json_encode([
        "success" => true,
        "id" => $project_id,
        "slug" => $slug,
        "url" => $public_url,
        "folder_path" => $folder_path,
        "html" => $hostedHtml,
        "css" => $css,
        "js" => $js,
        "warning_logo_blocked" => $failedLogoMirror,
        "warning_message" => $failedLogoMirror ? "A logo fornecida nao pode ser usada neste publish. O site vai usar texto no lugar da logo." : "",
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        "error" => "Falha ao publicar site",
        "details" => $error->getMessage(),
    ]);
}
?>