<?php
/**
 * Background worker — called via exec() when fastcgi_finish_request() is unavailable.
 * Usage: php generate-ads-worker.php <job_id>
 *
 * Reads job from DB and executes the slow path:
 * store sync → asset mirror → interpret → render → finalize
 */

$jobId = (int)($argv[1] ?? 0);
if ($jobId <= 0) {
    error_log('[generate-ads-worker] No job_id provided');
    exit(1);
}

set_time_limit(0);
ignore_user_abort(true);

include __DIR__ . '/../../db.php';
include __DIR__ . '/../agents/helpers.php';
include __DIR__ . '/../../site_helpers.php';
include __DIR__ . '/../../_render.php';
include __DIR__ . '/../../_browserless.php';
include __DIR__ . '/compose-gd.php';

if (!function_exists('ext_escape_attr')) {
    function ext_escape_attr(string $value): string {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}

if (!function_exists('ext_render_creative_png_like_zip')) {
    function ext_render_creative_png_like_zip(
        string $browserBinary,
        string $publicUrl,
        string $htmlFilePath,
        string $pngFilePath,
        int $width,
        int $height
    ): void {
        if ($browserBinary === '') {
            throw new RuntimeException('No headless browser found. Install Chrome, Chromium, or Edge on the server to export creatives as PNG images.');
        }

        $renderUrl = function_exists('normalize_public_render_url') ? normalize_public_render_url($publicUrl) : '';
        if ($renderUrl !== '' && function_exists('render_url_to_png')) {
            render_url_to_png($browserBinary, $renderUrl, $pngFilePath, $width, $height);
        } else {
            render_html_to_png($browserBinary, $htmlFilePath, $pngFilePath, $width, $height);
        }

        if (!is_file($pngFilePath) || filesize($pngFilePath) <= 0) {
            throw new RuntimeException('Creative PNG was not created.');
        }
    }
}

if (!function_exists('ext_force_visual_assets')) {
    function ext_force_visual_assets(string $html, array $campaignData): string {
        $assetUrl = trim((string)($campaignData['productImageUrl'] ?? $campaignData['backgroundImageUrl'] ?? $campaignData['logoUrl'] ?? ''));
        if ($assetUrl === '' || !preg_match('~^https?://~i', $assetUrl) || strpos($html, $assetUrl) !== false) {
            return $html;
        }

        $safeUrl = ext_escape_attr($assetUrl);
        $isLogoFallback = $assetUrl === trim((string)($campaignData['logoUrl'] ?? ''));
        $img = $isLogoFallback
            ? '<img src="' . $safeUrl . '" alt="" style="position:absolute;left:8%;top:8%;width:32%;height:18%;object-fit:contain;z-index:20;">'
            : '<img src="' . $safeUrl . '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:.88;">'
                . '<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.58),rgba(0,0,0,.10));z-index:1;"></div>';

        return preg_replace('/(<div\b[^>]*class=["\'][^"\']*\bad-banner\b[^"\']*["\'][^>]*>)/i', '$1' . $img, $html, 1) ?: $html;
    }
}

if (!function_exists('ext_force_minimum_copy')) {
    function ext_force_minimum_copy(string $html, array $campaignData, int $width = 1080, int $height = 1080): string {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')));
        if (mb_strlen($plain) >= 18) return $html;

        $headline = ext_escape_attr((string)($campaignData['mainHeadline'] ?? $campaignData['valueProposition'] ?? 'Limited offer'));
        $cta = ext_escape_attr((string)($campaignData['ctaText'] ?? 'Get Started'));
        $isStrip = $height <= 120 || $width > ($height * 3);
        $headlineSize = $isStrip ? max(12, min(20, (int)round($height * 0.24))) : max(22, min(48, (int)round($height * 0.06)));
        $ctaSize = $isStrip ? max(10, min(14, (int)round($height * 0.13))) : max(13, min(20, (int)round($height * 0.028)));
        $ctaPadding = $isStrip ? '5px 10px' : '10px 16px';
        $ctaRadius = $isStrip ? '4px' : '12px';
        $copy = '<div style="position:absolute;left:7%;top:12%;width:72%;z-index:30;color:#fff;font-family:Arial,sans-serif;font-size:' . $headlineSize . 'px;line-height:1.02;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.55);">' . $headline . '</div>'
            . '<div class="ad-cta" style="position:absolute;left:7%;bottom:8%;z-index:40;background:#fff;color:#111;padding:' . $ctaPadding . ';border-radius:' . $ctaRadius . ';font-family:Arial,sans-serif;font-size:' . $ctaSize . 'px;font-weight:800;line-height:1;white-space:nowrap;max-width:44%;">' . $cta . '</div>';

        return preg_replace('/(<div\b[^>]*class=["\'][^"\']*\bad-banner\b[^"\']*["\'][^>]*>)/i', '$1' . $copy, $html, 1) ?: $html;
    }
}

if (!function_exists('ext_collect_asset_urls_from_payload')) {
    function ext_collect_asset_urls_from_payload(array ...$sources): array {
        $urls = [];
        $walk = function ($value) use (&$walk, &$urls): void {
            if (is_array($value)) {
                foreach ($value as $child) $walk($child);
                return;
            }
            if (!is_string($value)) return;
            $value = trim($value);
            if ($value !== '' && preg_match('~^https?://~i', $value) && is_supported_asset_url($value)) {
                $urlHost = strtolower((string)(parse_url($value, PHP_URL_HOST) ?: ''));
                $requestHost = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
                $requestHost = preg_replace('/:\d+$/', '', $requestHost) ?: $requestHost;
                $urlPath = (string)(parse_url($value, PHP_URL_PATH) ?: '');
                if ($requestHost !== '' && $urlHost === $requestHost && preg_match('~^/projects/~i', $urlPath)) {
                    return;
                }
                $urls[] = $value;
            }
        };

        foreach ($sources as $source) $walk($source);
        return array_values(array_unique($urls));
    }
}

if (!function_exists('ext_rewrite_payload_asset_urls')) {
    function ext_rewrite_payload_asset_urls(array $data, array $urlMap): array {
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $data[$key] = ext_rewrite_payload_asset_urls($value, $urlMap);
            } elseif (is_string($value)) {
                $trimmed = trim($value);
                $data[$key] = $urlMap[$trimmed] ?? $value;
            }
        }
        return $data;
    }
}

if (!function_exists('ext_expected_creatives_for_batch')) {
    function ext_expected_creatives_for_batch(array $batchFormats, array $campaignData): int {
        $formatCount = max(1, count($batchFormats));
        $isAb = !empty($campaignData['abTestingEnabled']) || !empty($campaignData['ab_testing_enabled']);
        $rawVariantCount = $campaignData['abVariantCount'] ?? $campaignData['ab_variant_count'] ?? 1;
        $variantCount = $isAb ? min(3, max(2, (int)$rawVariantCount)) : 1;
        return max(1, $formatCount * $variantCount);
    }
}

if (!function_exists('ext_mirror_api_assets_to_company')) {
    function ext_mirror_api_assets_to_company(array $assetUrls, string $companyRelPath): array {
        $report = ['uploaded' => [], 'skipped' => []];
        if ($companyRelPath === '' || empty($assetUrls)) return ['map' => [], 'report' => $report];

        $companyDir = project_directory_from_relative($companyRelPath);
        $assetsDir = $companyDir . DIRECTORY_SEPARATOR . 'assets';
        ensure_directory($assetsDir);

        $publicBase = project_public_url_from_relative($companyRelPath);
        $publicBase = preg_replace('/\/index\.html$/i', '/', $publicBase);
        if (!str_ends_with($publicBase, '/')) $publicBase .= '/';

        $urlMap = [];
        $assetIndex = 1;
        foreach ($assetUrls as $assetUrl) {
            $normalized = normalize_asset_url((string)$assetUrl);
            if ($normalized === '' || isset($urlMap[$normalized]) || !is_supported_asset_url($normalized)) {
                continue;
            }

            $downloaded = download_remote_asset($normalized);
            if ($downloaded === null || !isset($downloaded['body'])) {
                $report['skipped'][] = ['url' => $normalized, 'reason' => 'Source blocked download or returned no file data.'];
                continue;
            }

            $detectedType = detect_asset_content_type((string)$downloaded['body'], $downloaded['content_type'] ?? null);
            if (!is_safe_asset_content_type($detectedType)) {
                $report['skipped'][] = ['url' => $normalized, 'reason' => 'Source did not return a supported image/media file.'];
                continue;
            }

            $ext = extract_extension_from_url($normalized, $detectedType);
            $fileName = 'external-api-asset-' . $assetIndex . '.' . $ext;
            while (file_exists($assetsDir . DIRECTORY_SEPARATOR . $fileName)) {
                $assetIndex++;
                $fileName = 'external-api-asset-' . $assetIndex . '.' . $ext;
            }

            $targetPath = $assetsDir . DIRECTORY_SEPARATOR . $fileName;
            if (@file_put_contents($targetPath, $downloaded['body']) === false) {
                $report['skipped'][] = ['url' => $normalized, 'reason' => 'Failed to write file on server.'];
                continue;
            }

            $localUrl = $publicBase . 'assets/' . rawurlencode($fileName);
            $urlMap[$normalized] = $localUrl;
            $report['uploaded'][] = [
                'name' => $fileName,
                'url' => $localUrl,
                'source_url' => $normalized,
                'size' => @filesize($targetPath) ?: 0,
            ];
            $assetIndex++;
        }

        return ['map' => $urlMap, 'report' => $report];
    }
}

if (!function_exists('ext_repair_logo_url')) {
    /**
     * Guarantee the company logo URL passed to the compose <img> points to a file that actually
     * exists on disk, returned as an absolute, fetchable URL. A stale company_form_data.logoUrl —
     * e.g. /projects/<slug>/assets/logo-2.png whose numbered file was never persisted (only
     * logo-1.png exists) — would otherwise render as a broken image and silently drop the brand.
     * If the exact file is missing but the same assets dir holds other logo-*.* files, the newest
     * sibling is substituted. Returns '' when nothing usable exists on disk, so the compose layer
     * falls back to brand-name text instead of emitting a broken <img>.
     *
     * data: URIs and true external URLs (anything not under our /projects/ mirror) pass through
     * untouched — only our own mirrored assets are disk-verifiable.
     */
    function ext_repair_logo_url(string $logoUrl, string $pubBase): string {
        $logoUrl = trim($logoUrl);
        if ($logoUrl === '' || preg_match('~^data:~i', $logoUrl)) return $logoUrl;

        // Extract the path component whether the URL is absolute (https://host/projects/...) or
        // root-relative (/projects/...).
        $path = $logoUrl;
        if (preg_match('~^https?://~i', $logoUrl)) {
            $p = parse_url($logoUrl, PHP_URL_PATH);
            $path = is_string($p) ? $p : '';
        }
        // Only our mirrored /projects/... assets are disk-verifiable; leave true externals alone.
        if (!preg_match('#/projects/(.+)$#', $path, $mm) || !function_exists('resolve_sites_base_path')) {
            return $logoUrl;
        }

        $relAfter = rawurldecode($mm[1]);                       // <slug>/assets/logo-2.png
        $base     = rtrim(resolve_sites_base_path(), "/\\");    // ...public_html/projects
        $diskPath = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relAfter);

        // Re-absolutize a path relative to the projects dir using the request's public base.
        $abs = function (string $relAfterProjects) use ($pubBase): string {
            $urlPath = '/projects/' . ltrim($relAfterProjects, '/');
            return $pubBase !== '' ? $pubBase . $urlPath : $urlPath;
        };

        if (is_file($diskPath)) return $abs($relAfter);

        // File missing → substitute the newest sibling logo in the same assets dir.
        $dir    = dirname($diskPath);
        $relDir = dirname($relAfter);                           // <slug>/assets
        if (is_dir($dir)) {
            $cands = @glob($dir . DIRECTORY_SEPARATOR . 'logo*.{png,jpg,jpeg,webp,gif,svg}', GLOB_BRACE);
            if (empty($cands)) $cands = @glob($dir . DIRECTORY_SEPARATOR . 'logo*.*') ?: [];
            if (!empty($cands)) {
                usort($cands, fn($a, $b) => @filemtime($b) <=> @filemtime($a));
                $picked = basename($cands[0]);
                error_log('[generate-ads-worker] logo missing (' . basename($diskPath) . ') → substituting existing ' . $picked);
                return $abs(($relDir !== '.' ? $relDir . '/' : '') . $picked);
            }
        }
        error_log('[generate-ads-worker] logo missing and no sibling logo in ' . $dir . ' → dropping logoUrl (brand-name text fallback)');
        return '';
    }
}

if (!function_exists('ext_extract_banners_from_html')) {
    function ext_extract_banners_from_html(string $html, array $formats): array {
        if (trim($html) === '') return [];
        $dom = new DOMDocument('1.0', 'UTF-8');
        @$dom->loadHTML('<?xml encoding="utf-8"?>' . $html, LIBXML_NOWARNING | LIBXML_NOERROR);
        $xpath = new DOMXPath($dom);
        $nodes = $xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " ad-banner ")]');
        $banners = [];
        $idx = 0;
        foreach ($nodes as $node) {
            /** @var DOMElement $node */
            $platform = $node->getAttribute('data-platform') ?: ($formats[$idx]['platform'] ?? '');
            $format   = $node->getAttribute('data-format')   ?: ($formats[$idx]['format']   ?? '');
            $banners[] = [
                'platform' => $platform,
                'format'   => $format,
                'html'     => $dom->saveHTML($node),
            ];
            $idx++;
        }
        return $banners;
    }
}

function extw_generated_image_bytes(string $imageUrl): array {
    $imageUrl = trim($imageUrl);
    if ($imageUrl === '') {
        throw new RuntimeException('Gemini image response is empty.');
    }

    if (preg_match('~^data:(image/[a-z0-9.+-]+);base64,(.+)$~i', $imageUrl, $m)) {
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || $bytes === '') {
            throw new RuntimeException('Gemini image response contains invalid base64 data.');
        }
        return ['bytes' => $bytes, 'mime' => strtolower($m[1])];
    }

    if (preg_match('~^https?://~i', $imageUrl)) {
        $downloaded = download_remote_asset($imageUrl);
        if ($downloaded === null || empty($downloaded['body'])) {
            throw new RuntimeException('Could not download Gemini image URL.');
        }
        $mime = strtolower((string)($downloaded['content_type'] ?? 'image/png'));
        return ['bytes' => $downloaded['body'], 'mime' => $mime ?: 'image/png'];
    }

    throw new RuntimeException('Unsupported Gemini image response format.');
}

function extw_image_preview_html(string $imageFileName, string $label, int $width, int $height): string {
    $safeFile = htmlspecialchars($imageFileName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $safeLabel = htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' . $safeLabel . '</title>'
        . '<style>*{box-sizing:border-box}html,body{margin:0;width:' . $width . 'px;height:' . $height . 'px;overflow:hidden;background:#111}'
        . 'img{display:block;width:' . $width . 'px;height:' . $height . 'px;object-fit:cover}</style></head>'
        . '<body><img src="' . $safeFile . '" alt="' . $safeLabel . '"></body></html>';
}

// ── Load job ──────────────────────────────────────────────────────────────

$jStmt = $conn->prepare(
    "SELECT j.user_id, j.company_project_id, j.campaign_id, j.project_id,
            j.total_batches, u.account_type, j.gemini_api_key, j.generate_as_image
     FROM ad_generation_jobs j
     JOIN users u ON u.id = j.user_id
     WHERE j.id = ? LIMIT 1"
);
if (!$jStmt) { error_log('[generate-ads-worker] DB error: ' . $conn->error); exit(1); }
$jStmt->bind_param('i', $jobId);
$jStmt->execute();
$jStmt->bind_result($userId, $companyId, $campaignId, $campaignProjectId, $totalBatches, $accountType, $workerGeminiKey, $generateAsImageRaw);
if (!$jStmt->fetch()) { error_log('[generate-ads-worker] Job not found: ' . $jobId); exit(1); }
$jStmt->close();
$passKey = (is_string($workerGeminiKey) && trim($workerGeminiKey) !== '') ? trim($workerGeminiKey) : null;
$generateAsImage = (bool)(int)($generateAsImageRaw ?? 0);

// ── Load company ──────────────────────────────────────────────────────────

$cStmt = $conn->prepare(
    "SELECT gemini_store_name, company_form_data, folder_path, public_url
     FROM projects WHERE id = ? LIMIT 1"
);
if (!$cStmt) { error_log('[generate-ads-worker] DB error loading company'); exit(1); }
$cStmt->bind_param('i', $companyId);
$cStmt->execute();
$cStmt->bind_result($existingStoreName, $companyFormDataJson, $companyFolderPath, $companyPublicUrl);
$cStmt->fetch();
$cStmt->close();
$companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

// ── Load campaign ─────────────────────────────────────────────────────────

$campStmt = $conn->prepare("SELECT form_data, metadata FROM ads_campaign WHERE id = ? LIMIT 1");
if (!$campStmt) { error_log('[generate-ads-worker] DB error loading campaign'); exit(1); }
$campStmt->bind_param('i', $campaignId);
$campStmt->execute();
$campStmt->bind_result($campaignFormDataJson, $campaignMetadataJson);
$campStmt->fetch();
$campStmt->close();
$campaignFormData = json_decode($campaignFormDataJson ?: '{}', true) ?: [];
$campaignMetadata = json_decode($campaignMetadataJson ?: '{}', true) ?: [];

// ── Load campaign project paths ───────────────────────────────────────────

$cpStmt = $conn->prepare("SELECT folder_path, public_url FROM projects WHERE id = ? LIMIT 1");
if (!$cpStmt) { error_log('[generate-ads-worker] DB error loading campaign project'); exit(1); }
$cpStmt->bind_param('i', $campaignProjectId);
$cpStmt->execute();
$cpStmt->bind_result($campaignFolderPath, $campaignPublicUrlDb);
$cpStmt->fetch();
$cpStmt->close();

// ── Load batches ──────────────────────────────────────────────────────────

$bStmt = $conn->prepare(
    "SELECT batch_index, label, formats_json FROM ad_generation_job_batches
     WHERE job_id = ? ORDER BY batch_index ASC"
);
if (!$bStmt) { error_log('[generate-ads-worker] DB error loading batches'); exit(1); }
$bStmt->bind_param('i', $jobId);
$bStmt->execute();
$bStmt->bind_result($bIdx, $bLabel, $bFmtsJson);
$batches = [];
while ($bStmt->fetch()) {
    $batches[(int)$bIdx] = [
        'label'   => $bLabel,
        'formats' => json_decode($bFmtsJson ?: '[]', true) ?: [],
    ];
}
$bStmt->close();
$batches = array_values($batches);

// ── Resolve paths ─────────────────────────────────────────────────────────

$sitesBasePath = resolve_sites_base_path();
$browserBin    = function_exists('find_browser_binary') ? find_browser_binary() : null;

$companyRelPath = extract_project_relative_path_from_folder_path((string)$companyFolderPath);
if ($companyRelPath === '') {
    $companyRelPath = extract_project_relative_path_from_public_url((string)$companyPublicUrl);
}

$campaignRelPath = extract_project_relative_path_from_folder_path((string)$campaignFolderPath);
if ($campaignRelPath === '') {
    $campaignRelPath = extract_project_relative_path_from_public_url((string)$campaignPublicUrlDb);
}

// ── Wrap in try so we can mark job failed on exception ───────────────────

try {

    // ── 6. Sync company store ─────────────────────────────────────────────

    if (!$existingStoreName) {
        $existingStoreName = agents_sync_company_store(
            $conn, $companyId, $companyFormData, $accountType, $userId, null, $passKey
        );
        agents_reconnect_mysqli_if_needed($conn);
    }
    $companyStoreName = (string)$existingStoreName;

    // ── 7. Asset mirroring ────────────────────────────────────────────────

    $assetUrlsToMirror = is_array($campaignMetadata['external_asset_urls_to_mirror'] ?? null)
        ? ext_collect_asset_urls_from_payload($campaignMetadata['external_asset_urls_to_mirror'])
        : [];
    $pubBase = rtrim((string)($campaignMetadata['public_base'] ?? ''), '/');
    if (!empty($assetUrlsToMirror) && $companyRelPath !== '') {
        $mirrorResult = ext_mirror_api_assets_to_company($assetUrlsToMirror, $companyRelPath);
        $assetUrlMap  = is_array($mirrorResult['map'] ?? null) ? $mirrorResult['map'] : [];
        if (!empty($assetUrlMap)) {
            $companyFormData  = ext_rewrite_payload_asset_urls($companyFormData, $assetUrlMap);
            $campaignFormData = ext_rewrite_payload_asset_urls($campaignFormData, $assetUrlMap);
            agents_reconnect_mysqli_if_needed($conn);
            $updatedCFJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
            if ($updatedCFJson) {
                $u1 = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
                if ($u1) { $u1->bind_param('si', $updatedCFJson, $companyId); $u1->execute(); $u1->close(); }
            }
            agents_reconnect_mysqli_if_needed($conn);
            $updatedCampJson = json_encode($campaignFormData, JSON_UNESCAPED_UNICODE);
            if ($updatedCampJson) {
                $u2 = $conn->prepare("UPDATE ads_campaign SET form_data = ? WHERE id = ?");
                if ($u2) { $u2->bind_param('si', $updatedCampJson, $campaignId); $u2->execute(); $u2->close(); }
            }
        }
    }
    // composeCompanyRefs must be absolute for the image edge — brand posts are stored as
    // root-relative /projects/... by company-assets. Absolutize always, even when no
    // external assets were mirrored this request (CLI worker has no $_SERVER, uses pubBase from metadata).
    if ($pubBase !== '' && !empty($campaignFormData['composeCompanyRefs']) && is_array($campaignFormData['composeCompanyRefs'])) {
        $campaignFormData['composeCompanyRefs'] = array_values(array_filter(array_map(function ($u) use ($pubBase) {
            $u = trim((string)$u);
            if ($u === '' || preg_match('~^https?://~i', $u)) return $u;
            return ($u[0] === '/') ? $pubBase . $u : $u;
        }, $campaignFormData['composeCompanyRefs']), 'strlen'));
    }

    // Repair a stale/missing company logo URL so the compose <img> resolves to a real, fetchable
    // file. The numbered logo-N.png the URL points at is sometimes never persisted (only logo-1.png
    // exists), which rendered as a broken image and silently dropped the brand. Substitute an
    // existing sibling logo or drop the URL (→ brand-name text) rather than emit a broken <img>.
    $origLogo = trim((string)($campaignFormData['logoUrl'] ?? ''));
    if ($origLogo !== '') {
        $fixedLogo = ext_repair_logo_url($origLogo, $pubBase);
        if ($fixedLogo !== $origLogo) {
            $campaignFormData['logoUrl'] = $fixedLogo;
            // Heal the stored company logo too so future jobs start from the good URL.
            if (trim((string)($companyFormData['logoUrl'] ?? '')) === $origLogo) {
                $companyFormData['logoUrl'] = $fixedLogo;
                if (isset($companyFormData['images']['logo'])) $companyFormData['images']['logo'] = $fixedLogo;
                agents_reconnect_mysqli_if_needed($conn);
                $healJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
                if ($healJson) {
                    $uh = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
                    if ($uh) { $uh->bind_param('si', $healJson, $companyId); $uh->execute(); $uh->close(); }
                }
            }
        }
    }

    // ── 8. Global stores + agent config ──────────────────────────────────

    $globalAdsStore      = '';
    $globalRefStore      = '';
    $globalImageRefStore = '';
    agents_reconnect_mysqli_if_needed($conn);
    $ssStmt = $conn->prepare(
        "SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('gemini_global_ads_store', 'gemini_global_ads_reference_store', 'gemini_global_ads_image_reference_store')"
    );
    if ($ssStmt) {
        $ssStmt->execute();
        $ssStmt->bind_result($ssKey, $ssVal);
        while ($ssStmt->fetch()) {
            if ($ssKey === 'gemini_global_ads_store')                 $globalAdsStore      = (string)$ssVal;
            if ($ssKey === 'gemini_global_ads_reference_store')       $globalRefStore      = (string)$ssVal;
            if ($ssKey === 'gemini_global_ads_image_reference_store') $globalImageRefStore = (string)$ssVal;
        }
        $ssStmt->close();
    }
    if (trim($globalAdsStore) === '') {
        throw new RuntimeException('Global Ads Store is missing.');
    }
    if (!$generateAsImage && trim($globalRefStore) === '') {
        throw new RuntimeException('Global Ads Reference Store is missing. Upload at least one ad example via "Send to Store" first.');
    }
    // generate_as_image now routes through COMPOSE (Gemini background + HTML overlay),
    // which does not query the image reference store — so it is no longer required.

    agents_reconnect_mysqli_if_needed($conn);
    $agentStmt = $conn->prepare(
        "SELECT system_prompt, model, temperature, max_tokens, version
         FROM agents WHERE name = 'ADS_AGENT' AND is_active = 1 LIMIT 1"
    );
    if (!$agentStmt) throw new RuntimeException('DB error loading ADS_AGENT');
    $agentStmt->execute();
    $agentStmt->bind_result($sysPrompt, $agentModel, $agentTemp, $agentTokens, $agentVer);
    if (!$agentStmt->fetch()) throw new RuntimeException('ADS_AGENT not found or inactive');
    $agentStmt->close();
    $agentConfig = [
        'systemPrompt' => $sysPrompt,
        'model'        => $agentModel,
        'temperature'  => (float)$agentTemp,
        'maxTokens'    => (int)$agentTokens,
        'version'      => (int)$agentVer,
    ];

    // ── 8b. AI copy (headline / subheadline / CTA) ───────────────────────────
    // The external flow used to never generate copy — the CTA fell back to a generic
    // hardcoded "Get Started" and the headline to a naive offer-derived string (a top
    // complaint about the ads). When the caller did NOT lock the copy (use_ai_copy !==
    // false), generate conversion copy via the edge 'copy' mode (action-first 2–5 word CTA
    // in the campaign's language) and feed it to BOTH interpret and compose. Generated once
    // per job so all formats share one coherent copy system. Locked copy is left untouched.
    $useAiCopy = !array_key_exists('useAiCopy', $campaignFormData) || $campaignFormData['useAiCopy'] !== false;
    if ($useAiCopy) {
        try {
            $copyRes = agents_call_edge_function('agents-ads', [
                'mode'         => 'copy',
                'agentConfig'  => $agentConfig,
                'campaignData' => $campaignFormData,
                'jobId'        => $jobId,
            ], $passKey);
            $copy = is_array($copyRes['copy'] ?? null) ? $copyRes['copy'] : null;
            if (is_array($copy)) {
                foreach (['mainHeadline', 'subheadline', 'ctaText'] as $f) {
                    if (!empty($copy[$f]) && is_string($copy[$f])) $campaignFormData[$f] = trim($copy[$f]);
                }
                // A/B copy variants → arrays the compose/image variant tasks read.
                if (!empty($copy['abVariants']) && is_array($copy['abVariants'])) {
                    $hv = []; $cv = [];
                    foreach ($copy['abVariants'] as $v) {
                        if (!empty($v['mainHeadline'])) $hv[] = (string)$v['mainHeadline'];
                        if (!empty($v['ctaText']))      $cv[] = (string)$v['ctaText'];
                    }
                    if ($hv) $campaignFormData['headlineVariants'] = $hv;
                    if ($cv) $campaignFormData['ctaVariants'] = $cv;
                }
                error_log('[generate-ads-worker] AI copy applied: cta="' . ($campaignFormData['ctaText'] ?? '') . '"');
            }
        } catch (Throwable $copyErr) {
            error_log('[generate-ads-worker] copy generation failed (non-fatal): ' . $copyErr->getMessage());
        }
        agents_reconnect_mysqli_if_needed($conn);
    }

    // ── 8c. Text layout — ASSORTED, not pinned ──────────────────────────────
    // Previously this picked ONE random layout and the edge FORCED it across every format,
    // so all creatives in a job shared the same text placement ("nada sortido"). We now
    // leave textLayout EMPTY unless the caller explicitly pinned a valid one: the edge then
    // rotates a DIFFERENT layout per aspect ratio (square / story / landscape look distinct)
    // and reserves the matching negative space for each. A pinned layout still wins.
    $VALID_LAYOUTS = [
        'hero-full-bleed', 'top-image-bottom-text', 'bold-headline-first', 'centered-minimal',
        'left-panel-right-image', 'diagonal-split', 'top-left-editorial', 'top-right-editorial',
        'bottom-right-editorial', 'frame-product', 'vertical-story-stack', 'floating-islands',
    ];
    $curLayout = strtolower(trim((string)($campaignFormData['textLayout'] ?? '')));
    if (!in_array($curLayout, $VALID_LAYOUTS, true)) {
        // Not a valid explicit choice → clear it so the edge assorts per aspect ratio.
        unset($campaignFormData['textLayout']);
    } else {
        // Caller pinned a layout — keep it; the edge forces it and the design adapts to it.
        $campaignFormData['textLayout'] = $curLayout;
        error_log('[generate-ads-worker] pinned textLayout=' . $curLayout);
    }

    // ── 8d. Brand visual identity brief (vision → text, cached) ─────────────
    // Priority order:
    //  1. brandVisualBrief with hash='instagram-profile' → pre-generated by company-assets.php
    //     from the brand's Instagram posts. Never regenerated here — the n8n flow owns it.
    //  2. Hash-matched brief in company_form_data → generated from composeCompanyRefs on a
    //     previous job run (still valid because refs haven't changed).
    //  3. On-demand generation from composeCompanyRefs → first time we see this set of refs.
    //
    // brandPostImages from company_form_data are injected into composeCompanyRefs so the edge
    // compose mode sends them as brand reference images alongside the brief text.
    $cachedBrief = trim((string)($companyFormData['brandVisualBrief'] ?? ''));
    $cachedHash  = (string)($companyFormData['brandVisualBriefHash'] ?? '');

    // Inject brand post images into composeCompanyRefs so they reach the image model.
    $storedBrandPosts = is_array($companyFormData['brandPostImages'] ?? null)
        ? array_values(array_filter(array_map('strval', $companyFormData['brandPostImages'])))
        : [];
    if (!empty($storedBrandPosts)) {
        $existingComposeRefs = is_array($campaignFormData['composeCompanyRefs'] ?? null)
            ? $campaignFormData['composeCompanyRefs'] : [];
        // Brand posts prepended — they take priority as the aesthetic reference.
        // Generation-specific images (product/bg/hero) follow in the remaining slots.
        $mergedRefs = array_values(array_unique(array_filter(
            array_merge(array_slice($storedBrandPosts, -8), $existingComposeRefs),
            'strlen'
        )));
        $campaignFormData['composeCompanyRefs'] = array_slice($mergedRefs, 0, 10);
        // Re-absolutize: brand posts were just injected as root-relative /projects/... paths, and
        // the absolutize step earlier ran BEFORE this injection. The image edge (Deno) only fetches
        // http(s) URLs, so without this the freshly-injected brand posts are silently dropped and
        // the ad loses its brand design reference.
        if ($pubBase !== '') {
            $campaignFormData['composeCompanyRefs'] = array_values(array_filter(array_map(function ($u) use ($pubBase) {
                $u = trim((string)$u);
                if ($u === '' || preg_match('~^https?://~i', $u)) return $u;
                return ($u[0] === '/') ? $pubBase . $u : $u;
            }, $campaignFormData['composeCompanyRefs']), 'strlen'));
        }
    }

    $composeRefs = is_array($campaignFormData['composeCompanyRefs'] ?? null)
        ? array_values(array_filter(array_map('strval', $campaignFormData['composeCompanyRefs'])))
        : [];

    // Priority 1: Instagram-profile brief (set by company-assets.php) — use as-is.
    if ($cachedBrief !== '' && $cachedHash === 'instagram-profile') {
        $campaignFormData['brandVisualBrief'] = $cachedBrief;
        error_log('[generate-ads-worker] brand brief: instagram-profile hit (len=' . strlen($cachedBrief) . ')');
    } elseif (!empty($composeRefs)) {
        // Priority 2 & 3: hash-based cache or on-demand generation from composeRefs.
        $refsHash = md5(implode('|', $composeRefs));
        $brandVisualBrief = '';
        if ($cachedBrief !== '' && $cachedHash === $refsHash) {
            $brandVisualBrief = $cachedBrief; // cache hit
        } else {
            try {
                $bvRes = agents_call_edge_function('agents-ads', [
                    'mode'               => 'brand_visual',
                    'jobId'              => $jobId,
                    'referenceImageUrls' => array_slice($composeRefs, 0, 6),
                ], $passKey);
                agents_reconnect_mysqli_if_needed($conn);
                $brandVisualBrief = trim((string)($bvRes['brief'] ?? ''));
                if ($brandVisualBrief !== '') {
                    $companyFormData['brandVisualBrief']     = $brandVisualBrief;
                    $companyFormData['brandVisualBriefHash'] = $refsHash;
                    $cfJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
                    if ($cfJson) {
                        $uB = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
                        if ($uB) { $uB->bind_param('si', $cfJson, $companyId); $uB->execute(); $uB->close(); }
                    }
                    agents_reconnect_mysqli_if_needed($conn);
                }
            } catch (Throwable $bvErr) {
                error_log('[generate-ads-worker] brand_visual failed (non-fatal): ' . $bvErr->getMessage());
                $brandVisualBrief = $cachedBrief;
                agents_reconnect_mysqli_if_needed($conn);
            }
        }
        if ($brandVisualBrief !== '') {
            $campaignFormData['brandVisualBrief'] = $brandVisualBrief;
        }
    }

    // ── 9. Interpret ──────────────────────────────────────────────────────

    // Interpret is a planning aid, not a hard requirement for COMPOSE (image): the
    // compose pipeline derives a brand spec from campaignData when no plan is given,
    // and each batch is a separate edge call. A transient Gemini/edge 503 here must
    // not nuke the whole image job — only the optional per-creative spec is lost.
    // HTML render genuinely needs the spec, so for that path the failure rethrows.
    $batchSpecs = [];
    try {
        $interpretResult = agents_call_edge_function('agents-ads', [
            'mode'                     => 'interpret',
            'jobId'                    => $jobId,
            'agentConfig'              => $agentConfig,
            'globalStoreName'          => $globalAdsStore,
            'globalReferenceStoreName' => $globalRefStore ?: null,
            'imageReferenceStoreName'  => $globalImageRefStore ?: null,
            'companyStoreName'         => $companyStoreName,
            'campaignData'             => $campaignFormData,
        ], $passKey);
        agents_reconnect_mysqli_if_needed($conn);
        $batchSpecs = is_array($interpretResult['batchSpecs'] ?? null) ? $interpretResult['batchSpecs'] : [];
    } catch (Throwable $interpretErr) {
        if (!$generateAsImage) throw $interpretErr;
        error_log('[generate-ads-worker] interpret failed (non-fatal for image/compose): ' . $interpretErr->getMessage());
        agents_reconnect_mysqli_if_needed($conn);
    }

    // ── 10. Render each batch ────────────────────────────────────────────────

    $allCreatives     = [];
    $completedBatches = 0;
    $failedBatches    = 0;
    $batchErrors      = [];

    $resolveBatchSpec = function (array $batch, $batchIdx) use ($batchSpecs): string {
        foreach ($batchSpecs as $bs) {
            if (strcasecmp(trim((string)($bs['label'] ?? '')), (string)$batch['label']) === 0) {
                return (string)($bs['spec'] ?? '');
            }
        }
        return isset($batchSpecs[$batchIdx]['spec']) ? (string)$batchSpecs[$batchIdx]['spec'] : '';
    };

    // Image (compose) path: fire EVERY batch's background generation CONCURRENTLY so the
    // total wait ≈ the slowest batch instead of the sum of all batches. The HTML render
    // path stays sequential in the loop below.
    $composeResults = [];
    if ($generateAsImage) {
        $composePayloads = [];
        foreach ($batches as $bIdx => $b) {
            $composePayloads[$bIdx] = [
                'mode'             => 'compose',
                'jobId'            => $jobId,
                'agentConfig'      => $agentConfig,
                'globalStoreName'  => $globalAdsStore,
                'companyStoreName' => $companyStoreName,
                'batchFormats'     => $b['formats'],
                'batchIndex'       => $bIdx,
                'totalBatches'     => $totalBatches,
                'creativePlan'     => $resolveBatchSpec($b, $bIdx),
                'campaignData'     => $campaignFormData,
            ];
            agents_reconnect_mysqli_if_needed($conn);
            $updR = $conn->prepare("UPDATE ad_generation_job_batches SET status = 'running', attempts = attempts + 1 WHERE job_id = ? AND batch_index = ?");
            if ($updR) { $updR->bind_param('ii', $jobId, $bIdx); $updR->execute(); $updR->close(); }
        }
        $composeResults = agents_call_edge_function_multi('agents-ads', $composePayloads, $passKey);
        agents_reconnect_mysqli_if_needed($conn);
    }

    foreach ($batches as $batchIdx => $batch) {
        $batchLabel = $batch['label'];
        $batchFmts  = $batch['formats'];
        $spec       = $resolveBatchSpec($batch, $batchIdx);

        // Compose marked 'running' in the parallel pre-pass above; only the sequential
        // HTML render path needs to mark it here.
        if (!$generateAsImage) {
            agents_reconnect_mysqli_if_needed($conn);
            $updR = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'running', attempts = attempts + 1
                 WHERE job_id = ? AND batch_index = ?"
            );
            if ($updR) { $updR->bind_param('ii', $jobId, $batchIdx); $updR->execute(); $updR->close(); }
        }

        try {
            if ($generateAsImage) {
                // COMPOSE: Gemini draws ONLY the background scene (no logo, no text); the
                // EXACT logo + typo-free copy live in the returned HTML overlay. The bg call
                // was already fired in parallel above — read its result here.
                $cr = $composeResults[$batchIdx] ?? null;
                if (!$cr || empty($cr['ok'])) {
                    throw new RuntimeException('Compose call failed for batch ' . $batchIdx . ': ' . (string)($cr['error'] ?? 'no result'));
                }
                $composeResult = is_array($cr['data'] ?? null) ? $cr['data'] : [];

                $banners = is_array($composeResult['banners'] ?? null) ? $composeResult['banners'] : [];
                if (empty($banners)) throw new RuntimeException("No compose banners returned for batch {$batchIdx}");
                $expectedCount = ext_expected_creatives_for_batch($batchFmts, $campaignFormData);
                if (count($banners) > $expectedCount) {
                    error_log('[generate-ads-worker] Trimming compose batch ' . $batchIdx . ' from ' . count($banners) . ' to expected ' . $expectedCount);
                    $banners = array_slice($banners, 0, $expectedCount);
                }

                $savedCount = 0;
                foreach ($banners as $sIdx => $banner) {
                    $fmt      = $batchFmts[$sIdx] ?? $batchFmts[0];
                    $platform = $banner['platform'] ?? ($fmt['platform'] ?? '');
                    $fmtName  = $banner['format']   ?? ($fmt['format']   ?? '');
                    $fmtLabel = $banner['label']    ?? ($fmt['label']    ?? $batchLabel);
                    $variant  = trim((string)($banner['variant'] ?? ''));
                    if ($variant !== '' && stripos($fmtLabel, 'variant') === false) {
                        $fmtLabel .= ' - Variant ' . $variant;
                    }
                    $fmtW     = (int)($fmt['width']  ?? ($banner['width']  ?? 1080));
                    $fmtH     = (int)($fmt['height'] ?? ($banner['height'] ?? 1080));
                    $sortOrd  = count($allCreatives);
                    $bannerHtml = (string)($banner['html'] ?? '');
                    if (trim($bannerHtml) === '') continue;

                    agents_reconnect_mysqli_if_needed($conn);
                    $insC = $conn->prepare(
                        "INSERT INTO ads_creatives
                           (project_id, campaign_id, name, platform, format, label, width, height, generated_html, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    );
                    if (!$insC) {
                        throw new RuntimeException('Error preparing creative insert: ' . $conn->error);
                    }
                    $insC->bind_param(
                        'iissssiisi',
                        $campaignProjectId, $campaignId, $fmtLabel,
                        $platform, $fmtName, $fmtLabel,
                        $fmtW, $fmtH, $bannerHtml, $sortOrd
                    );
                    if (!$insC->execute()) {
                        $insertError = $insC->error;
                        $insC->close();
                        throw new RuntimeException('Error saving compose creative: ' . $insertError);
                    }
                    $creativeId = (int)$conn->insert_id;
                    $insC->close();
                    if ($creativeId <= 0) {
                        throw new RuntimeException('Compose creative insert returned no id.');
                    }

                    // debug:true → persist the final image prompt + aspectRatio + refs
                    // returned by the engine into ads_creatives.metadata (surfaced by job-status).
                    if (!empty($banner['debug'])) {
                        $metaJson = json_encode(['debug' => $banner['debug']], JSON_UNESCAPED_UNICODE);
                        agents_reconnect_mysqli_if_needed($conn);
                        $updMeta = $conn->prepare("UPDATE ads_creatives SET metadata = ? WHERE id = ?");
                        if ($updMeta) { $updMeta->bind_param('si', $metaJson, $creativeId); $updMeta->execute(); $updMeta->close(); }
                    }

                    // Save the compose HTML (for reference / html_url) and rasterize it to a
                    // Meta-ready banner.jpg with GD — faithfully reproducing the layout the
                    // background reserved space for (no headless browser needed). public_url
                    // stays index.html so job-status derives the banner.jpg sibling.
                    $htmlUrl = null;
                    $imageUrl = null;
                    if ($creativeId && $campaignRelPath !== '') {
                        $creativeRelPath = $campaignRelPath . '/' . $creativeId;
                        $creativeDir     = $sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $creativeRelPath);
                        $htmlFilePath    = $creativeDir . DIRECTORY_SEPARATOR . 'index.html';
                        $jpgFilePath     = $creativeDir . DIRECTORY_SEPARATOR . 'banner.jpg';
                        ensure_directory($creativeDir);
                        if (file_put_contents($htmlFilePath, $bannerHtml) !== false) {
                            $htmlUrl = '/projects/' . $creativeRelPath . '/index.html';
                            agents_reconnect_mysqli_if_needed($conn);
                            $updUrl = $conn->prepare("UPDATE ads_creatives SET public_url = ? WHERE id = ?");
                            if ($updUrl) { $updUrl->bind_param('si', $htmlUrl, $creativeId); $updUrl->execute(); $updUrl->close(); }
                        }
                        // Prefer Browserless (real headless Chrome → full CSS3) when configured;
                        // fall back to the PHP/GD compositor on any failure so an outage or a
                        // missing token never breaks generation.
                        $rendered = false;
                        if (function_exists('browserless_enabled') && browserless_enabled()) {
                            try {
                                if (browserless_render_html_to_jpeg($bannerHtml, $fmtW, $fmtH, $jpgFilePath)) {
                                    $imageUrl = '/projects/' . $creativeRelPath . '/banner.jpg';
                                    $rendered = true;
                                } else {
                                    error_log('[generate-ads-worker] Browserless render failed for creative ' . $creativeId . ' — falling back to GD');
                                }
                            } catch (Throwable $blErr) {
                                error_log('[generate-ads-worker] Browserless threw for creative ' . $creativeId . ': ' . $blErr->getMessage() . ' — falling back to GD');
                            }
                        }
                        if (!$rendered) {
                            try {
                                if (extgd_compose_html_to_jpeg($bannerHtml, $fmt, $jpgFilePath)) {
                                    $imageUrl = '/projects/' . $creativeRelPath . '/banner.jpg';
                                } else {
                                    error_log('[generate-ads-worker] GD compose returned false for creative ' . $creativeId);
                                }
                            } catch (Throwable $gdErr) {
                                error_log('[generate-ads-worker] GD compose failed for creative ' . $creativeId . ': ' . $gdErr->getMessage());
                            }
                        }
                    }

                    $allCreatives[] = [
                        'id'       => $creativeId,
                        'platform' => $platform,
                        'format'   => $fmtName,
                        'label'    => $fmtLabel,
                        'width'    => $fmtW,
                        'height'   => $fmtH,
                        'html_url' => $htmlUrl,
                        'image_url' => $imageUrl,
                        'type' => ($imageUrl && preg_match('~\.jpe?g$~i', (string)$imageUrl)) ? 'image/jpeg' : ($imageUrl ? 'image/png' : null),
                        'variant' => $variant ?: null,
                    ];
                    $savedCount++;
                }

                if ($savedCount <= 0) {
                    throw new RuntimeException("No compose creatives saved for batch {$batchIdx}");
                }

                agents_reconnect_mysqli_if_needed($conn);
                $updDone = $conn->prepare(
                    "UPDATE ad_generation_job_batches SET status = 'completed', saved_count = ?
                     WHERE job_id = ? AND batch_index = ?"
                );
                if ($updDone) { $updDone->bind_param('iii', $savedCount, $jobId, $batchIdx); $updDone->execute(); $updDone->close(); }
                $completedBatches++;
                continue;
            }

            $renderResult = agents_call_edge_function('agents-ads', [
                'mode'                     => 'render',
                'jobId'                    => $jobId,
                'agentConfig'              => $agentConfig,
                'globalStoreName'          => $globalAdsStore,
                'globalReferenceStoreName' => $globalRefStore ?: null,
                'imageReferenceStoreName'  => $globalImageRefStore ?: null,
                'companyStoreName'         => $companyStoreName,
                'batchFormats'             => $batchFmts,
                'batchIndex'               => $batchIdx,
                'totalBatches'             => $totalBatches,
                'creativePlan'             => $spec,
                'campaignData'             => $campaignFormData,
                'generateAsImage'          => $generateAsImage,
            ], $passKey);
            agents_reconnect_mysqli_if_needed($conn);

            $snippets = is_array($renderResult['snippets'] ?? null) ? $renderResult['snippets'] : [];
            if (empty($snippets)) {
                $banners = ext_extract_banners_from_html((string)($renderResult['html'] ?? ''), $batchFmts);
                foreach ($banners as $b) $snippets[] = $b['html'];
            }
            if (empty($snippets)) throw new RuntimeException("No banners extracted for batch {$batchIdx}");
            $expectedCount = ext_expected_creatives_for_batch($batchFmts, $campaignFormData);
            if (count($snippets) > $expectedCount) {
                error_log('[generate-ads-worker] Trimming HTML batch ' . $batchIdx . ' from ' . count($snippets) . ' to expected ' . $expectedCount);
                $snippets = array_slice($snippets, 0, $expectedCount);
            }

            $savedCount = 0;
            foreach ($snippets as $sIdx => $snippetHtml) {
                $fmt      = $batchFmts[$sIdx] ?? $batchFmts[0];
                $platform = $fmt['platform'] ?? '';
                $fmtName  = $fmt['format']   ?? '';
                $fmtLabel = $fmt['label']    ?? $batchLabel;
                $fmtW     = (int)($fmt['width']  ?? 1080);
                $fmtH     = (int)($fmt['height'] ?? 1080);
                $sortOrd  = count($allCreatives);
                $snippetHtml = (string)$snippetHtml;
                $snippetHtml = ext_force_visual_assets($snippetHtml, $campaignFormData);
                $snippetHtml = ext_force_minimum_copy($snippetHtml, $campaignFormData, $fmtW, $fmtH);

                agents_reconnect_mysqli_if_needed($conn);
                $insC = $conn->prepare(
                    "INSERT INTO ads_creatives
                       (project_id, campaign_id, name, platform, format, label, width, height, generated_html, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                );
                if (!$insC) {
                    throw new RuntimeException('Error preparing creative insert: ' . $conn->error);
                }
                $insC->bind_param(
                    'iissssiisi',
                    $campaignProjectId, $campaignId, $fmtLabel,
                    $platform, $fmtName, $fmtLabel,
                    $fmtW, $fmtH, $snippetHtml, $sortOrd
                );
                if (!$insC->execute()) {
                    $insertError = $insC->error;
                    $insC->close();
                    throw new RuntimeException('Error saving HTML creative: ' . $insertError);
                }
                $creativeId = (int)$conn->insert_id;
                $insC->close();
                if ($creativeId <= 0) {
                    throw new RuntimeException('HTML creative insert returned no id.');
                }

                $htmlUrl  = null;
                $imageUrl = null;
                if ($creativeId && $campaignRelPath !== '') {
                    $creativeRelPath = $campaignRelPath . '/' . $creativeId;
                    $creativeDir     = $sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $creativeRelPath);
                    $htmlFilePath    = $creativeDir . DIRECTORY_SEPARATOR . 'index.html';
                    $pngFilePath     = $creativeDir . DIRECTORY_SEPARATOR . 'banner.png';
                    ensure_directory($creativeDir);
                    if (file_put_contents($htmlFilePath, $snippetHtml) !== false) {
                        $htmlUrl = '/projects/' . $creativeRelPath . '/index.html';
                        agents_reconnect_mysqli_if_needed($conn);
                        $updUrl = $conn->prepare("UPDATE ads_creatives SET public_url = ? WHERE id = ?");
                        if ($updUrl) { $updUrl->bind_param('si', $htmlUrl, $creativeId); $updUrl->execute(); $updUrl->close(); }
                        try {
                            ext_render_creative_png_like_zip($browserBin ?: '', $htmlUrl, $htmlFilePath, $pngFilePath, $fmtW, $fmtH);
                            // Flatten a JPEG sibling for Meta; deliver the JPEG when it works.
                            $jpgName = function_exists('cf_make_jpg_sibling') ? cf_make_jpg_sibling($pngFilePath) : '';
                            $imageUrl = '/projects/' . $creativeRelPath . '/' . ($jpgName !== '' ? $jpgName : 'banner.png');
                        } catch (Throwable $renderErr) {
                            error_log('[generate-ads-worker] PNG skipped for creative ' . $creativeId . ': ' . $renderErr->getMessage());
                        }
                    }
                }
                $allCreatives[] = [
                    'id'       => $creativeId,
                    'platform' => $platform,
                    'format'   => $fmtName,
                    'label'    => $fmtLabel,
                    'width'    => $fmtW,
                    'height'   => $fmtH,
                    'html_url' => $htmlUrl,
                    'image_url' => $imageUrl,
                ];
                $savedCount++;
            }

            if ($savedCount <= 0) {
                throw new RuntimeException("No HTML creatives saved for batch {$batchIdx}");
            }

            agents_reconnect_mysqli_if_needed($conn);
            $updDone = $conn->prepare(
                "UPDATE ad_generation_job_batches SET status = 'completed', saved_count = ?
                 WHERE job_id = ? AND batch_index = ?"
            );
            if ($updDone) { $updDone->bind_param('iii', $savedCount, $jobId, $batchIdx); $updDone->execute(); $updDone->close(); }
            $completedBatches++;

        } catch (Throwable $batchErr) {
            error_log('[generate-ads-worker] Batch ' . $batchIdx . ' error: ' . $batchErr->getMessage());
            $errMsg = substr($batchErr->getMessage(), 0, 500);
            $batchErrors[] = ['batch_index' => $batchIdx, 'label' => $batchLabel, 'error' => $errMsg];
            agents_reconnect_mysqli_if_needed($conn);
            $updF = $conn->prepare(
                "UPDATE ad_generation_job_batches SET status = 'failed', error = ?
                 WHERE job_id = ? AND batch_index = ?"
            );
            if ($updF) { $updF->bind_param('sii', $errMsg, $jobId, $batchIdx); $updF->execute(); $updF->close(); }
            $failedBatches++;
        }
    }

    // ── 11. Finalize job ──────────────────────────────────────────────────

    $jobStatus = ($failedBatches === 0 && $completedBatches > 0) ? 'completed' : ($completedBatches > 0 ? 'completed' : 'failed');
    $jobError  = !empty($batchErrors) ? json_encode($batchErrors, JSON_UNESCAPED_UNICODE) : null;
    agents_reconnect_mysqli_if_needed($conn);
    $updJob = $conn->prepare(
        "UPDATE ad_generation_jobs SET status = ?, completed_batches = ?, failed_batches = ?, error = ? WHERE id = ?"
    );
    if ($updJob) {
        $updJob->bind_param('siisi', $jobStatus, $completedBatches, $failedBatches, $jobError, $jobId);
        $updJob->execute();
        $updJob->close();
    }

} catch (Throwable $e) {
    error_log('[generate-ads-worker] Job ' . $jobId . ': ' . $e->getMessage());
    try {
        agents_reconnect_mysqli_if_needed($conn);
        $errMsg = substr($e->getMessage(), 0, 500);
        $failStmt = $conn->prepare(
            "UPDATE ad_generation_jobs SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?"
        );
        if ($failStmt) { $failStmt->bind_param('si', $errMsg, $jobId); $failStmt->execute(); $failStmt->close(); }
    } catch (Throwable $inner) {
        error_log('[generate-ads-worker] failed to mark job failed: ' . $inner->getMessage());
    }
    exit(1);
}
