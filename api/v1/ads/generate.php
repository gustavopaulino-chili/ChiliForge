<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

set_time_limit(600);
ini_set('memory_limit', '512M');

require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/../../_render.php';
include   __DIR__ . '/../../db.php'; // provides $conn

// ---------------------------------------------------------------------------
// Helper: call a Supabase edge function via HTTP
// ---------------------------------------------------------------------------
function call_edge_function(string $name, array $payload): array {
    $baseUrl = rtrim(getenv('SUPABASE_URL') ?: 'https://vehowvyqxhelyfdesmog.supabase.co', '/');
    $key     = getenv('SUPABASE_SERVICE_ROLE_KEY') ?: (getenv('SUPABASE_PUBLISHABLE_KEY') ?: '');
    $url     = $baseUrl . '/functions/v1/' . $name;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 300,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
        ],
    ]);

    $body     = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException("curl error calling {$name}: {$curlErr}");
    }
    if ($httpCode >= 400) {
        throw new RuntimeException("Edge function {$name} returned HTTP {$httpCode}: " . substr((string)$body, 0, 500));
    }

    $decoded = json_decode((string)$body, true);
    if ($decoded === null) {
        throw new RuntimeException("Invalid JSON from {$name}: " . substr((string)$body, 0, 200));
    }

    return $decoded;
}

// ---------------------------------------------------------------------------
// Helper: extract individual .ad-banner elements from combined HTML
// ---------------------------------------------------------------------------
function extract_ad_banners(string $html, array $formats): array {
    libxml_use_internal_errors(true);
    $doc = new DOMDocument('1.0', 'UTF-8');
    @$doc->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();

    $xpath = new DOMXPath($doc);

    $globalStyles = '';
    foreach ($xpath->query('//style') as $sn) {
        $globalStyles .= $sn->textContent . "\n";
    }

    $fontLinks = '';
    foreach ($xpath->query('//link[@rel="stylesheet"]') as $ln) {
        /** @var \DOMElement $ln */
        if (stripos((string)$ln->getAttribute('href'), 'fonts.googleapis.com') !== false) {
            $fontLinks .= $doc->saveHTML($ln) . "\n";
        }
    }

    $nodes = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " ad-banner ")]');

    $countByKey    = [];
    $variantLetters = ['A', 'B', 'C'];
    $banners        = [];

    foreach ($nodes as $node) {
        /** @var \DOMElement $node */
        $platform = $node->getAttribute('data-platform') ?: '';
        $format   = $node->getAttribute('data-format')   ?: '';
        $variant  = $node->getAttribute('data-variant')  ?: '';

        // Match format entry by platform+format (case-insensitive), then format only, then first
        $platformLower = strtolower($platform);
        $formatLower   = strtolower($format);
        $matched = null;
        foreach ($formats as $f) {
            if (strtolower($f['platform'] ?? '') === $platformLower &&
                strtolower($f['format']   ?? '') === $formatLower) {
                $matched = $f;
                break;
            }
        }
        if (!$matched) {
            foreach ($formats as $f) {
                if (strtolower($f['format'] ?? '') === $formatLower) { $matched = $f; break; }
            }
        }
        if (!$matched && !empty($formats)) {
            $matched = $formats[0];
        }

        $variantWasExplicit = ($variant !== '');
        $key                = ($matched['platform'] ?? 'x') . ':' . ($matched['format'] ?? 'x');
        $countByKey[$key]   = ($countByKey[$key] ?? 0) + 1;

        if (!$variantWasExplicit) {
            $variant = $variantLetters[($countByKey[$key] - 1) % 3];
        }

        $w     = (int)($matched['width']  ?? 1080);
        $h     = (int)($matched['height'] ?? 1080);
        $label = ($matched['label'] ?? 'Banner');
        // Only append variant suffix when A/B is active (edge function sets data-variant explicitly)
        if ($variantWasExplicit) {
            $label .= ' - Variant ' . $variant;
        }

        $bannerDiv = $doc->saveHTML($node);

        $fullHtml = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">\n"
            . $fontLinks
            . "<style>\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n"
            . "html,body{width:{$w}px;height:{$h}px;overflow:hidden;background:transparent}\n"
            . $globalStyles
            . "</style></head><body>{$bannerDiv}</body></html>";

        $banners[] = [
            'platform' => $matched['platform'] ?? $platform,
            'format'   => $matched['format']   ?? $format,
            'label'    => $label,
            'width'    => $w,
            'height'   => $h,
            'variant'  => $variant,
            'html'     => $fullHtml,
        ];
    }

    return $banners;
}

// ---------------------------------------------------------------------------
// Helper: mirror external assets to /assets/ folder (from publishAdCreative)
// ---------------------------------------------------------------------------
function ads_mirror_assets(array $assetUrls, string $projectPath): array {
    $assetsPath = $projectPath . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsPath);

    $assetMap   = [];
    $assetIndex = 1;

    foreach ($assetUrls as $assetUrl) {
        if (!is_string($assetUrl) || trim($assetUrl) === '' || !is_supported_asset_url($assetUrl)) {
            continue;
        }

        $normalized = normalize_asset_url($assetUrl);
        if ($normalized === '' || isset($assetMap[$normalized])) {
            continue;
        }

        $downloaded = download_remote_asset($normalized);
        if ($downloaded === null || !isset($downloaded['body'])) {
            continue;
        }

        $ext      = extract_extension_from_url($normalized, $downloaded['content_type'] ?? null);
        $fileName = 'ad-asset-' . $assetIndex . '.' . $ext;
        while (file_exists($assetsPath . DIRECTORY_SEPARATOR . $fileName)) {
            $assetIndex++;
            $fileName = 'ad-asset-' . $assetIndex . '.' . $ext;
        }

        file_put_contents($assetsPath . DIRECTORY_SEPARATOR . $fileName, $downloaded['body']);
        $assetMap[$normalized] = 'assets/' . rawurlencode($fileName);
        $assetIndex++;
    }

    return $assetMap;
}

// Prefix all map values with $prefix (e.g. '../' for banner sub-folders)
function ads_with_prefix(array $map, string $prefix): array {
    if ($prefix === '') return $map;
    $out = [];
    foreach ($map as $k => $v) {
        $out[$k] = str_starts_with((string)$v, 'assets/') ? $prefix . $v : $v;
    }
    return $out;
}

// Rewrite leftover project-absolute asset paths to relative prefix
function ads_rewrite_asset_refs(string $content, string $prefix): string {
    $target  = $prefix . 'assets/';
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/projects\/[^\/"\'\s)]+\/assets\//i', $target, $content);
    $content = preg_replace('/(?<![\w:])\/?projects\/[^\/"\'\s)]+\/assets\//i', $target, $content);
    return is_string($content) ? $content : '';
}

// ---------------------------------------------------------------------------
// Build absolute base URL for public links
// ---------------------------------------------------------------------------
function ads_base_url(): string {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

// ===========================================================================
// Main
// ===========================================================================
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// 1. Validate API key --------------------------------------------------------
$authHeader = $_SERVER['HTTP_AUTHORIZATION']
    ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');

if (!preg_match('/^Bearer\s+(.+)$/i', trim($authHeader), $m)) {
    http_response_code(401);
    echo json_encode(['error' => 'Authorization header required: Bearer {api_key}']);
    exit;
}
$apiKey = trim($m[1]);

$keyStmt = $conn->prepare(
    "SELECT id, user_id FROM api_keys WHERE api_key = ? AND is_active = 1 LIMIT 1"
);
if (!$keyStmt) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error', 'details' => $conn->error]);
    exit;
}
$keyStmt->bind_param('s', $apiKey);
$keyStmt->execute();
$keyStmt->bind_result($apiKeyId, $apiKeyUserId);
if (!$keyStmt->fetch()) {
    $keyStmt->close();
    http_response_code(401);
    echo json_encode(['error' => 'Invalid or inactive API key']);
    exit;
}
$keyStmt->close();

// 2. Parse body -------------------------------------------------------------
$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$brief    = isset($body['brief'])     ? trim((string)$body['brief'])     : '';
$formData = isset($body['form_data']) && is_array($body['form_data']) ? $body['form_data'] : [];
$accountType = 'admin'; // always use production Gemini key for API calls

// Extract image URLs — these have absolute priority over anything the AI produces
$productImageUrl    = isset($body['product_image_url'])    ? trim((string)$body['product_image_url'])    : '';
$backgroundImageUrl = isset($body['background_image_url']) ? trim((string)$body['background_image_url']) : '';
// image_url is a convenience alias for product_image_url
if ($productImageUrl === '' && isset($body['image_url'])) {
    $productImageUrl = trim((string)$body['image_url']);
}

if ($brief === '' && empty($formData) && $productImageUrl === '' && $backgroundImageUrl === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Provide at least one of: "brief", "form_data", "product_image_url", or "image_url"']);
    exit;
}

try {
    // 3. Build description from any available input ----------------------------
    // If no explicit brief, serialize form_data fields so the AI can interpret them
    if ($brief === '' && !empty($formData)) {
        $bodyParts = [];
        foreach ($formData as $key => $value) {
            if (is_scalar($value) && trim((string)$value) !== '' && $key !== 'selectedFormats') {
                $bodyParts[] = ucfirst(str_replace('_', ' ', (string)$key)) . ': ' . $value;
            }
        }
        $brief = implode('. ', $bodyParts);
    }

    // 4. Analyze → extract structured fields + format suggestions --------------
    // Always call analyze-ad-brief when there's enough description (≥20 chars)
    if (strlen($brief) >= 20) {
        $analyzed  = call_edge_function('analyze-ad-brief', [
            'description' => $brief,
            'currentData' => !empty($formData) ? $formData : null,
            'accountType' => $accountType,
        ]);
        $extracted = $analyzed['extracted'] ?? [];
        // Explicit form_data fields override anything extracted from the brief
        $formData  = array_merge($extracted, $formData);
    }

    if (empty($formData)) {
        throw new RuntimeException('Could not extract campaign data. Please provide more details in "brief".');
    }

    // 5. Inject caller images with absolute priority (MUST be used if provided) -
    if ($productImageUrl !== '') {
        $formData['productImageUrl'] = $productImageUrl;
    }
    if ($backgroundImageUrl !== '') {
        $formData['backgroundImageUrl'] = $backgroundImageUrl;
    }
    // Ensure image keys exist so the edge function always sees them
    $formData['productImageUrl']    = $formData['productImageUrl']    ?? '';
    $formData['backgroundImageUrl'] = $formData['backgroundImageUrl'] ?? '';

    $campaignName = (string)($formData['campaignName'] ?? $formData['brandName'] ?? 'Campaign');

    // 6. Formats: use AI suggestions > caller form_data > hardcoded defaults ---
    if (empty($formData['selectedFormats'])) {
        $formData['selectedFormats'] = [
            ['platform' => 'Instagram', 'format' => 'Feed Square',   'label' => 'Feed Square',   'width' => 1080, 'height' => 1080, 'enabled' => true],
            ['platform' => 'Instagram', 'format' => 'Stories',       'label' => 'Stories',       'width' => 1080, 'height' => 1920, 'enabled' => true],
            ['platform' => 'Facebook',  'format' => 'Feed Landscape','label' => 'Feed Landscape','width' => 1200, 'height' => 628,  'enabled' => true],
        ];
    } else {
        $formData['selectedFormats'] = array_map(function ($f) {
            if (!isset($f['enabled'])) $f['enabled'] = true;
            return $f;
        }, (array)$formData['selectedFormats']);
    }

    $generated = call_edge_function('generate-ad-creatives', [
        'businessName' => (string)($formData['brandName'] ?? $formData['campaignName'] ?? ''),
        'accountType'  => $accountType,
        'adData'       => $formData,
    ]);

    $combinedHtml = (string)($generated['html']    ?? '');
    $genSlug      = (string)($generated['slug']    ?? '');
    $formats      = $generated['formats']           ?? [];
    $assetUrls    = $generated['assets']            ?? [];

    if (trim($combinedHtml) === '') {
        throw new RuntimeException('No HTML received from generation engine.');
    }

    // 5. Create project directory ----------------------------------------------
    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $slug        = ensure_unique_slug($genSlug ?: sanitize_slug($campaignName), $sitesBasePath);
    $projectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $slug;
    $publicUrl   = '/projects/' . $slug . '/';
    $folderPath  = '/public/projects/' . $slug;

    ensure_directory($projectPath);
    ensure_directory($projectPath . DIRECTORY_SEPARATOR . 'assets');

    // 6. Mirror assets ---------------------------------------------------------
    $allAssetUrls = array_unique(array_merge(
        $assetUrls,
        extract_asset_urls_from_content($combinedHtml),
        extract_asset_urls_from_form_data($formData)
    ));
    $rootAssetMap   = ads_mirror_assets($allAssetUrls, $projectPath);
    $bannerAssetMap = ads_with_prefix($rootAssetMap, '../');

    // 7. Write campaign board HTML ---------------------------------------------
    $boardHtml = replace_asset_paths($combinedHtml, $rootAssetMap);
    $boardHtml = ads_rewrite_asset_refs($boardHtml, '');
    file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', $boardHtml);

    // 8. Save project to DB ----------------------------------------------------
    // Reconnect if the edge-function call idled the connection past wait_timeout
    if (!$conn->ping()) {
        $conn->close();
        include __DIR__ . '/../../db.php';
    }
    $formDataJson = json_encode($formData, JSON_UNESCAPED_UNICODE);
    $projectType  = 'ad_creative';
    $currentStep  = 9;
    $emptyHtml    = '';

    $pStmt = $conn->prepare(
        "INSERT INTO projects (user_id, name, project_type, created_at) VALUES (?, ?, ?, NOW())"
    );
    $pStmt->bind_param('iss', $apiKeyUserId, $campaignName, $projectType);
    if (!$pStmt->execute()) {
        throw new RuntimeException('Error saving project: ' . $pStmt->error);
    }
    $projectId = (int)$conn->insert_id;
    $pStmt->close();

    // 9. Save campaign to DB ---------------------------------------------------
    $campaignStatus = 'generated';
    $campaignMeta   = json_encode(['slug' => $slug, 'creative_count' => 0], JSON_UNESCAPED_UNICODE);

    $cStmt = $conn->prepare(
        "INSERT INTO ads_campaign (project_id, name, form_data, public_url, current_step, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
    );
    $cStmt->bind_param('isssiss',
        $projectId, $campaignName, $formDataJson, $publicUrl,
        $currentStep, $campaignStatus, $campaignMeta
    );
    if (!$cStmt->execute()) {
        throw new RuntimeException('Error saving campaign: ' . $cStmt->error);
    }
    $campaignId = (int)$conn->insert_id;
    $cStmt->close();

    // 10. Extract banners, write HTML files, render PNGs -----------------------
    $banners       = extract_ad_banners($combinedHtml, $formats);
    if (empty($banners)) {
        throw new RuntimeException('No .ad-banner elements found in generated HTML.');
    }

    $browserBinary = find_browser_binary();
    $imagesPath    = $projectPath . DIRECTORY_SEPARATOR . 'images';
    ensure_directory($imagesPath);

    $baseUrl      = ads_base_url();
    $savedBanners = [];

    foreach ($banners as $i => $banner) {
        $bHtml      = replace_asset_paths($banner['html'], $bannerAssetMap);
        $bHtml      = ads_rewrite_asset_refs($bHtml, '../');
        $bDirName   = 'b' . $i;
        $bFolder    = $projectPath . DIRECTORY_SEPARATOR . $bDirName;
        $bPublicUrl = $publicUrl . $bDirName . '/';
        $bName      = $campaignName . ' - ' . $banner['label'];
        $bWidth     = $banner['width'];
        $bHeight    = $banner['height'];
        $bMeta      = json_encode(['variant' => $banner['variant'], 'source_index' => $i], JSON_UNESCAPED_UNICODE);
        $bPlatform  = preg_replace('/[^a-z0-9\-]/', '', strtolower($banner['platform']));
        $bFormat    = preg_replace('/[^a-z0-9\-]/', '', strtolower($banner['format']));

        ensure_directory($bFolder);
        file_put_contents($bFolder . DIRECTORY_SEPARATOR . 'index.html', $bHtml);

        // Render PNG -----------------------------------------------------------
        $pngFilename = $bDirName . '.png';
        $pngPath     = $imagesPath . DIRECTORY_SEPARATOR . $pngFilename;
        $imageUrl    = $baseUrl . $publicUrl . 'images/' . $pngFilename;
        $pngReady    = false;

        if ($browserBinary !== '') {
            // Try public URL first (assets load correctly via HTTP)
            $renderUrl = normalize_public_render_url($bPublicUrl);
            try {
                if ($renderUrl !== '') {
                    render_url_to_png($browserBinary, $renderUrl, $pngPath, $bWidth, $bHeight);
                } else {
                    render_html_to_png($browserBinary, $bFolder . DIRECTORY_SEPARATOR . 'index.html', $pngPath, $bWidth, $bHeight);
                }
                $pngReady = is_file($pngPath) && filesize($pngPath) > 0;
            } catch (Throwable $e) {
                error_log("[ChiliForge API] Public URL render failed for banner {$i}: " . $e->getMessage() . " — trying file://");
                try {
                    render_html_to_png($browserBinary, $bFolder . DIRECTORY_SEPARATOR . 'index.html', $pngPath, $bWidth, $bHeight);
                    $pngReady = is_file($pngPath) && filesize($pngPath) > 0;
                } catch (Throwable $e2) {
                    error_log("[ChiliForge API] file:// render also failed for banner {$i}: " . $e2->getMessage());
                }
            }
        }

        // Save creative to DB --------------------------------------------------
        $bStmt = $conn->prepare(
            "INSERT INTO ads_creatives (project_id, campaign_id, name, platform, format, label, width, height, generated_html, public_url, sort_order, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
        );
        $bStmt->bind_param('iissssiissis',
            $projectId, $campaignId, $bName, $bPlatform, $bFormat,
            $banner['label'], $bWidth, $bHeight, $bHtml, $bPublicUrl, $i, $bMeta
        );
        if ($bStmt->execute()) {
            $bId          = (int)$conn->insert_id;
            $savedBanners[] = [
                'id'        => $bId,
                'image_url' => $pngReady ? $imageUrl : null,
                'html_url'  => $baseUrl . $bPublicUrl,
                'platform'  => $bPlatform,
                'format'    => $bFormat,
                'label'     => $banner['label'],
                'width'     => $bWidth,
                'height'    => $bHeight,
                'variant'   => $banner['variant'],
            ];
        }
        $bStmt->close();
    }

    // Update campaign creative_count ------------------------------------------
    $count    = count($savedBanners);
    $updMeta  = json_encode(['slug' => $slug, 'creative_count' => $count], JSON_UNESCAPED_UNICODE);
    $upStmt   = $conn->prepare("UPDATE ads_campaign SET metadata = ? WHERE id = ?");
    $upStmt->bind_param('si', $updMeta, $campaignId);
    $upStmt->execute();
    $upStmt->close();

    // Increment API key usage counter -----------------------------------------
    $usStmt = $conn->prepare(
        "UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = NOW() WHERE id = ?"
    );
    $usStmt->bind_param('i', $apiKeyId);
    $usStmt->execute();
    $usStmt->close();

    $conn->close();

    echo json_encode([
        'success'      => true,
        'campaign_url' => $baseUrl . $publicUrl,
        'project_id'   => $projectId,
        'campaign_id'  => $campaignId,
        'slug'         => $slug,
        'banners'      => $savedBanners,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error'   => 'Generation failed',
        'details' => $e->getMessage(),
    ]);
}
