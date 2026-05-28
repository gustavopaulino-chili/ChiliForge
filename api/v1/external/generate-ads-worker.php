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
    if ($generateAsImage && trim($globalImageRefStore) === '') {
        throw new RuntimeException('Global Ads Image Reference Store is missing. Upload at least one image ad example first.');
    }

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

    // ── 9. Interpret ──────────────────────────────────────────────────────

    $interpretResult = agents_call_edge_function('agents-ads', [
        'mode'                     => 'interpret',
        'agentConfig'              => $agentConfig,
        'globalStoreName'          => $globalAdsStore,
        'globalReferenceStoreName' => $globalRefStore ?: null,
        'imageReferenceStoreName'  => $globalImageRefStore ?: null,
        'companyStoreName'         => $companyStoreName,
        'campaignData'             => $campaignFormData,
    ], $passKey);
    agents_reconnect_mysqli_if_needed($conn);
    $batchSpecs = is_array($interpretResult['batchSpecs'] ?? null) ? $interpretResult['batchSpecs'] : [];

    // ── 10. Brand spec extraction (image mode only) ───────────────────────

    $brandSpec = '';
    if ($generateAsImage) {
        try {
            $extractResult = agents_call_edge_function('agents-ads', [
                'mode'                     => 'extract_brand',
                'globalStoreName'          => $globalAdsStore,
                'globalReferenceStoreName' => $globalRefStore ?: null,
                'companyStoreName'         => $companyStoreName,
                'campaignData'             => $campaignFormData,
            ], $passKey);
            agents_reconnect_mysqli_if_needed($conn);
            $brandSpec = (string)($extractResult['brandSpec'] ?? '');
        } catch (Throwable $extractErr) {
            error_log('[generate-ads-worker] Brand spec extraction failed (non-fatal): ' . $extractErr->getMessage());
        }
    }

    // ── 11. Render each batch ─────────────────────────────────────────────

    $allCreatives     = [];
    $completedBatches = 0;
    $failedBatches    = 0;
    $batchErrors      = [];

    foreach ($batches as $batchIdx => $batch) {
        $batchLabel = $batch['label'];
        $batchFmts  = $batch['formats'];

        $spec = '';
        foreach ($batchSpecs as $bs) {
            if (strcasecmp(trim((string)($bs['label'] ?? '')), $batchLabel) === 0) {
                $spec = (string)($bs['spec'] ?? '');
                break;
            }
        }
        if ($spec === '' && isset($batchSpecs[$batchIdx]['spec'])) {
            $spec = (string)$batchSpecs[$batchIdx]['spec'];
        }

        agents_reconnect_mysqli_if_needed($conn);
        $updR = $conn->prepare(
            "UPDATE ad_generation_job_batches
             SET status = 'running', attempts = attempts + 1
             WHERE job_id = ? AND batch_index = ?"
        );
        if ($updR) { $updR->bind_param('ii', $jobId, $batchIdx); $updR->execute(); $updR->close(); }

        try {
            if ($generateAsImage) {
                $imageResult = agents_call_edge_function('agents-ads', [
                    'mode'                     => 'image',
                    'agentConfig'              => $agentConfig,
                    'globalStoreName'          => $globalAdsStore,
                    'globalReferenceStoreName' => $globalRefStore ?: null,
                    'imageReferenceStoreName'  => $globalImageRefStore ?: null,
                    'companyStoreName'         => $companyStoreName,
                    'batchFormats'             => $batchFmts,
                    'batchIndex'               => $batchIdx,
                    'totalBatches'             => $totalBatches,
                    'creativePlan'             => $spec,
                    'brandSpec'               => $brandSpec,
                    'campaignData'             => $campaignFormData,
                    'generateAsImage'          => true,
                ], $passKey);
                agents_reconnect_mysqli_if_needed($conn);

                $images = is_array($imageResult['images'] ?? null) ? $imageResult['images'] : [];
                if (empty($images)) throw new RuntimeException("No Gemini images returned for batch {$batchIdx}");
                $expectedCount = ext_expected_creatives_for_batch($batchFmts, $campaignFormData);
                if (count($images) > $expectedCount) {
                    error_log('[generate-ads-worker] Trimming image batch ' . $batchIdx . ' from ' . count($images) . ' to expected ' . $expectedCount);
                    $images = array_slice($images, 0, $expectedCount);
                }

                $savedCount = 0;
                foreach ($images as $sIdx => $img) {
                    $fmt      = $batchFmts[$sIdx] ?? $batchFmts[0];
                    $platform = $fmt['platform'] ?? ($img['platform'] ?? '');
                    $fmtName  = $fmt['format']   ?? ($img['format'] ?? '');
                    $fmtLabel = $fmt['label']    ?? ($img['label'] ?? $batchLabel);
                    $variant  = trim((string)($img['variant'] ?? ''));
                    if ($variant !== '' && stripos($fmtLabel, 'variant') === false) {
                        $fmtLabel .= ' - Variant ' . $variant;
                    }
                    $fmtW     = (int)($fmt['width']  ?? ($img['width'] ?? 1080));
                    $fmtH     = (int)($fmt['height'] ?? ($img['height'] ?? 1080));
                    $sortOrd  = count($allCreatives);
                    $imageDataUrl = (string)($img['imageUrl'] ?? $img['image_url'] ?? '');
                    $generated = extw_generated_image_bytes($imageDataUrl);

                    agents_reconnect_mysqli_if_needed($conn);
                    $emptyHtml = '';
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
                        $fmtW, $fmtH, $emptyHtml, $sortOrd
                    );
                    if (!$insC->execute()) {
                        $insertError = $insC->error;
                        $insC->close();
                        throw new RuntimeException('Error saving image creative: ' . $insertError);
                    }
                    $creativeId = (int)$conn->insert_id;
                    $insC->close();
                    if ($creativeId <= 0) {
                        throw new RuntimeException('Image creative insert returned no id.');
                    }

                    $htmlUrl  = null;
                    $imageUrl = null;
                    if ($creativeId && $campaignRelPath !== '') {
                        $creativeRelPath = $campaignRelPath . '/' . $creativeId;
                        $creativeDir     = $sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $creativeRelPath);
                        $htmlFilePath    = $creativeDir . DIRECTORY_SEPARATOR . 'index.html';
                        $pngFilePath     = $creativeDir . DIRECTORY_SEPARATOR . 'banner.png';
                        ensure_directory($creativeDir);
                        file_put_contents($pngFilePath, $generated['bytes']);
                        $previewHtml = extw_image_preview_html('banner.png', $fmtLabel, $fmtW, $fmtH);
                        file_put_contents($htmlFilePath, $previewHtml);
                        $htmlUrl = '/projects/' . $creativeRelPath . '/index.html';
                        $imageUrl = '/projects/' . $creativeRelPath . '/banner.png';
                        agents_reconnect_mysqli_if_needed($conn);
                        $updUrl = $conn->prepare("UPDATE ads_creatives SET public_url = ?, generated_html = ? WHERE id = ?");
                        if ($updUrl) { $updUrl->bind_param('ssi', $htmlUrl, $previewHtml, $creativeId); $updUrl->execute(); $updUrl->close(); }
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
                        'type' => $generated['mime'],
                        'variant' => $variant ?: null,
                    ];
                    $savedCount++;
                }

                if ($savedCount <= 0) {
                    throw new RuntimeException("No image creatives saved for batch {$batchIdx}");
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
                            $imageUrl = '/projects/' . $creativeRelPath . '/banner.png';
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
