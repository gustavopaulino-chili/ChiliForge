<?php
/**
 * Background worker — called via exec() when fastcgi_finish_request() is unavailable.
 * Usage: php generate-ads-worker.php <job_id>
 *
 * Reads job from DB and executes the slow path:
 * store sync → asset mirror → OpenAI image generation (caminho C) → finalize
 *
 * Gemini image drawing (interpret / compose / render) foi aposentado — geracao e'
 * OpenAI-only agora. Gemini continua em uso so' para brand_visual (secao 8d, brief de
 * identidade visual) e para o mode "copy" (headline/subheadline/CTA).
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
    function ext_force_minimum_copy(string $html, array $campaignData, int $width = 1080, int $height = 1080, string $fontStack = 'Arial,sans-serif'): string {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')));
        if (mb_strlen($plain) >= 18) return $html;

        $headline = ext_escape_attr((string)($campaignData['mainHeadline'] ?? $campaignData['valueProposition'] ?? 'Limited offer'));
        $cta = ext_escape_attr((string)($campaignData['ctaText'] ?? 'Get Started'));
        $isStrip = $height <= 120 || $width > ($height * 3);
        $headlineSize = $isStrip ? max(12, min(20, (int)round($height * 0.24))) : max(22, min(48, (int)round($height * 0.06)));
        $ctaSize = $isStrip ? max(10, min(14, (int)round($height * 0.13))) : max(13, min(20, (int)round($height * 0.028)));
        $ctaPadding = $isStrip ? '5px 10px' : '10px 16px';
        $ctaRadius = $isStrip ? '4px' : '12px';
        $copy = '<div style="position:absolute;left:7%;top:12%;width:72%;z-index:30;color:#fff;font-family:' . $fontStack . ';font-size:' . $headlineSize . 'px;line-height:1.02;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.55);">' . $headline . '</div>'
            . '<div class="ad-cta" style="position:absolute;left:7%;bottom:8%;z-index:40;background:#fff;color:#111;padding:' . $ctaPadding . ';border-radius:' . $ctaRadius . ';font-family:' . $fontStack . ';font-size:' . $ctaSize . 'px;font-weight:800;line-height:1;white-space:nowrap;max-width:44%;">' . $cta . '</div>';

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

    // Sync do company store (Gemini File Search) foi removido daqui: nada neste worker
    // le mais companyStoreName desde que interpret/compose/render (Gemini) saiu — quem
    // ainda depende do store e' o editor interno (AdsEditor), que faz seu proprio
    // lazy-init (agents_lazy_init_store) na hora de gerar por la. company-assets.php
    // continua sincronizando a cada push do n8n, entao o store existe e fica
    // atualizado pra quando essa empresa for aberta no app.

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

    // ── 8. Agent config ────────────────────────────────────────────────────
    // O SELECT dos stores globais do Gemini (gemini_global_ads_store e afins) saiu daqui:
    // interpret/compose/render foram aposentados e eram os unicos consumidores. So' o
    // ADS_AGENT (usado pelo mode "copy") continua sendo carregado.

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

    // The stored brand posts are market reference, not this client's own profile. The edge needs
    // this to invert its colour rules: the posts drive STRUCTURE, the brand's saved colour drives
    // COLOUR (and when no colour is known, a neutral treatment rather than the reference's).
    // Without this line the flag never reaches buildBackgroundPrompt and the whole feature is dead.
    $campaignFormData['brandPostsAreProxy'] = !empty($companyFormData['brandPostsAreProxy']);

    // Site images = the CLIENT'S OWN identity (their website), captured in the proxy flow. In proxy
    // mode the stored brand posts belong to a COMPETITOR (structure reference only), so the site is
    // the ONLY source of the client's real colour, mood and identity. It MUST reach the image model
    // as the PRIMARY reference — ahead of the competitor posts — or the ad comes out with no site
    // colour and no site feel (the "fundo sem cor da empresa, sem ref do site" regression). Before
    // this the site images were stored on the company but never injected into composeCompanyRefs,
    // so they only fed the brief text and never influenced a single pixel.
    $storedSiteImages = is_array($companyFormData['siteImages'] ?? null)
        ? array_values(array_filter(array_map('strval', $companyFormData['siteImages'])))
        : [];

    // Inject brand post images into composeCompanyRefs so they reach the image model.
    $storedBrandPosts = is_array($companyFormData['brandPostImages'] ?? null)
        ? array_values(array_filter(array_map('strval', $companyFormData['brandPostImages'])))
        : [];

    // ignore_references = true: nem o site nem os brand posts entram. Sem esta trava o bloqueio
    // feito la' no generate-ads.php nao valeria nada — esta injecao remonta o conjunto inteiro a
    // partir do cadastro, e a peca sairia com todo o eco visual que o cliente pediu para tirar.
    if ((!empty($storedSiteImages) || !empty($storedBrandPosts)) && empty($campaignFormData['ignoreReferences'])) {
        $existingComposeRefs = is_array($campaignFormData['composeCompanyRefs'] ?? null)
            ? $campaignFormData['composeCompanyRefs'] : [];
        // When the caller sent an explicit reference_image_url (composeHeroRef), that image is
        // genRefUrl — already first in $existingComposeRefs — and it MUST stay first: it's the
        // featured hero subject. Otherwise the priority order is:
        //   [client SITE identity] → [competitor / brand posts] → [any pre-existing refs]
        // Site leads so the client's own colour/feel dominates the reference set; competitor posts
        // follow purely as structure. Site capped at 4, posts at 8, so the site is never pushed
        // past the edge's fetch cutoff.
        $heroRefActive = !empty($campaignFormData['composeHeroRef']);
        $siteSlice  = array_slice($storedSiteImages, -4);
        $postsSlice = array_slice($storedBrandPosts, -8);
        $mergedRefs = $heroRefActive
            ? array_merge($existingComposeRefs, $siteSlice, $postsSlice)
            : array_merge($siteSlice, $postsSlice, $existingComposeRefs);
        $mergedRefs = array_values(array_unique(array_filter($mergedRefs, 'strlen')));
        // Absolutize — site images and brand posts are stored ROOT-RELATIVE (/projects/...). This
        // injection runs AFTER the section-7 absolutization, so without re-absolutizing here they
        // stay relative and the edge (which only fetches http(s) URLs) silently DROPS them.
        if ($pubBase !== '') {
            $mergedRefs = array_values(array_filter(array_map(function ($u) use ($pubBase) {
                $u = trim((string)$u);
                if ($u === '' || preg_match('~^https?://~i', $u)) return $u;
                return ($u[0] === '/') ? $pubBase . $u : $u;
            }, $mergedRefs), 'strlen'));
        }
        $campaignFormData['composeCompanyRefs'] = array_slice($mergedRefs, 0, 10);

        // Tell the edge how many of the LEADING refs are the client's own site (identity/colour) vs
        // the trailing competitor posts (structure only). Non-hero proxy path puts the site first,
        // so the edge treats the first N companyRefImages as the site identity and grades the whole
        // background to them, taking ONLY structure from the competitor posts.
        if (!$heroRefActive && !empty($siteSlice)) {
            $campaignFormData['composeSiteRefCount'] = count($siteSlice);
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

    // Gemini foi aposentado para geracao: nao ha mais motor_imagem opcional nem fallback.
    // OpenAI e' o unico caminho — sem chave, o job falha aqui em vez de tentar o Gemini.
    $chaveOpenai = trim((string)($campaignFormData['openaiApiKey'] ?? ''));
    if ($chaveOpenai === '' && function_exists('agents_env_value')) {
        $chaveOpenai = trim((string)agents_env_value('OPENAI_API_KEY', ''));
    }
    if ($chaveOpenai === '' || !function_exists('extc_openai_gerar')) {
        throw new RuntimeException('OpenAI API key is required. Gemini image generation has been retired — send openai_api_key in the payload or set OPENAI_API_KEY on the server.');
    }

    // interpret (planejamento gemini-3.5-flash com File Search) foi aposentado junto com o
    // resto da geracao Gemini: extc_openai_prompt nunca leu o resultado dele (batchSpecs) —
    // monta o prompt direto de campanha + company. Manter a chamada so' pagaria ~$0,07/job
    // a toa. brand_visual continua rodando normalmente (secao 8d acima) — esse sim alimenta
    // composeCompanyRefs, que o caminho C usa.

    // ── 9. Render each batch — OpenAI (caminho C), unico motor ────────────────

    $allCreatives     = [];
    $completedBatches = 0;
    $failedBatches    = 0;
    $batchErrors      = [];

    $refs  = is_array($campaignFormData['composeCompanyRefs'] ?? null) ? $campaignFormData['composeCompanyRefs'] : [];
    $logoC = trim((string)($companyFormData['logoUrl'] ?? ($campaignFormData['logoUrl'] ?? '')));
    // Canto pedido no payload (logo_position / logo_strategy). Vazio = o carimbo segue
    // escolhendo sozinho o canto mais calmo, exatamente como sempre fez.
    $cantoC = trim((string)($campaignFormData['logoPosition'] ?? ''));
    $qualC = strtolower(trim((string)($campaignFormData['qualidadeImagem'] ?? 'medium')));
    if (!in_array($qualC, ['low', 'medium', 'high'], true)) $qualC = 'medium';
    // O que o payload PEDIU, ecoado de volta cru. Hoje o campo nao decide nada (a OpenAI e' o
    // unico motor), mas ecoa-lo e' o que permite a quem chama distinguir "meu motor_imagem
    // chegou" de "meu motor_imagem se perdeu no caminho" sem depender de log de servidor.
    $motorPedido = strtolower(trim((string)($campaignFormData['motorImagem'] ?? ''))) ?: 'nao-informado';
    error_log('[caminho-c] job=' . $jobId . ' refs=' . count($refs) . ' qualidade=' . $qualC . ' motor_pedido=' . $motorPedido);

    $composeResults = [];
    foreach ($batches as $bIdx => $b) {
        agents_reconnect_mysqli_if_needed($conn);
        $updR = $conn->prepare("UPDATE ad_generation_job_batches SET status = 'running', attempts = attempts + 1 WHERE job_id = ? AND batch_index = ?");
        if ($updR) { $updR->bind_param('ii', $jobId, $bIdx); $updR->execute(); $updR->close(); }

        $bannersC = [];
        $motivoC  = null;
        foreach (($b['formats'] ?? []) as $iF => $fmtC) {
            $wC = (int)($fmtC['width'] ?? 1080);
            $hC = (int)($fmtC['height'] ?? 1080);
            $promptC = extc_openai_prompt($campaignFormData, $companyFormData, $fmtC);
            $bytesC = extc_openai_gerar($chaveOpenai, $refs, $promptC, $qualC, extc_tamanho_openai($wC, $hC), $motivoC);
            if ($bytesC === null) { $bannersC = []; break; }
            $bytesC = extc_poe_logo($bytesC, $logoC, 92, $cantoC);
            $tmpC = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cforge-c-' . $jobId . '-' . $bIdx . '-' . $iF . '.jpg';
            if (@file_put_contents($tmpC, $bytesC) === false) { $bannersC = []; $motivoC = 'falha-ao-gravar-temporario'; break; }
            $bannersC[] = [
                // HTML minimo so' para o registro: a peca ja' esta' pronta em pixels.
                'html'          => '<div class="ad-banner" data-motor="openai"></div>',
                'imagemPronta'  => $tmpC,
                'platform'      => (string)($fmtC['platform'] ?? 'other'),
                'format'        => (string)($fmtC['format'] ?? 'ad'),
                'label'         => (string)($fmtC['label'] ?? ($wC . 'x' . $hC)),
                // motor_pedido/motor_usado/fallback saem em TODA peca, com os mesmos nomes em
                // qualquer motor, para que quem consome o job detecte um desvio comparando dois
                // campos em vez de inferir do formato do objeto de debug — que ate' aqui mudava
                // de forma conforme o caminho e nao dava para comparar programaticamente.
                'debug'         => [
                    'motor'         => 'openai',
                    'motor_pedido'  => $motorPedido,
                    'motor_usado'   => 'gpt-image-2',
                    'fallback'      => false,
                    'fallback_motivo' => null,
                    'qualidade'     => $qualC,
                    'refs'          => count($refs),
                    'tamanho'       => extc_tamanho_openai($wC, $hC),
                ],
            ];
        }
        // Sem fallback: um batch que a OpenAI nao produzir termina falho, ponto — nao ha
        // mais Gemini para tentar de novo. O motivo viaja junto do erro do batch porque
        // job-status.php so' devolve batch_errors — sem creative, nao ha' debug onde grava-lo.
        $composeResults[$bIdx] = $bannersC
            ? ['ok' => true, 'data' => ['banners' => $bannersC]]
            : ['ok' => false, 'error' => 'OpenAI image generation failed for this batch: ' . ($motivoC ?: 'motivo-desconhecido')];
        if (!$bannersC) error_log('[caminho-c] batch ' . $bIdx . ' falhou: ' . ($motivoC ?: 'motivo-desconhecido'));
    }

    foreach ($batches as $batchIdx => $batch) {
        $batchLabel = $batch['label'];
        $batchFmts  = $batch['formats'];

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
                    // Image ads: the overlay HTML comes from the engine, so it never passed
                    // through ext_force_minimum_copy. Inject the brand font here too, otherwise
                    // the feature would only ever show up on the HTML generation type. Both
                    // renderers benefit — Browserless reads the <link>, and the GD compositor
                    // parses the same URL to download the TTF.
                    $composeFont = ext_resolve_brand_font($campaignFormData, $companyFormData);
                    if ($composeFont !== '') {
                        $bannerHtml = ext_inject_font_head($bannerHtml, $composeFont);
                    }
                    if (trim($bannerHtml) === '') continue;

                    // MEASURED SCRIM. The engine writes the darkening gradient blind — it never
                    // sees the photo — so it emits roughly the same fade on every ad. Here the
                    // JPEG is in hand: sample what is actually under the copy, compute the
                    // contrast the ink really gets, and resize the gradient to the minimum that
                    // works. On a dark or calm photo that is zero and the fade is deleted, which
                    // is the single biggest reason every creative looked like the same template.
                    // Behind the beta flag: these run on the live server, so an unreviewed change
                    // must not reach real clients. Without `beta_variedade` in the payload the
                    // output is byte-for-byte what it is today. Flip the default once the new
                    // look has been approved.
                    $betaVisual = !empty($campaignFormData['betaVariedade']);

                    // Guarded: compose-layers.php is include'd, not require'd, so a missing or
                    // half-uploaded file must degrade to today's behaviour instead of fatalling
                    // a job. (It already bit us once during deploy.)
                    $scrimDiag = [];
                    $tuned = ($betaVisual && function_exists('extd_tune_scrim'))
                        ? extd_tune_scrim($bannerHtml, $fmtW, $fmtH, $scrimDiag)
                        : $bannerHtml;
                    if (is_string($tuned) && trim($tuned) !== '') $bannerHtml = $tuned;
                    if (!empty($scrimDiag['ran'])) {
                        error_log('[scrim-medido] creative=' . $sortOrd . ' acao=' . ($scrimDiag['action'] ?? '?')
                            . ' need=' . ($scrimDiag['need'] ?? '?')
                            . ' antes=' . ($scrimDiag['peakBefore'] ?? '-') . ' depois=' . ($scrimDiag['peakAfter'] ?? '-'));
                    } else {
                        error_log('[scrim-medido] creative=' . $sortOrd . ' NAO rodou: ' . ($scrimDiag['reason'] ?? '?'));
                    }
                    if (isset($banner['debug']) && is_array($banner['debug'])) {
                        $banner['debug']['scrimMedido'] = $scrimDiag;
                    }

                    // DEPTH LAYER. Until now the copy sat above every pixel of the ad, so no
                    // scene element could ever pass in front of it — the flat, caption-on-a-photo
                    // look. An explicit cut-out wins; otherwise the product photo is tried, and
                    // it is only used if it really has transparency or a keyable studio backdrop.
                    $depthRaw = trim((string)($campaignFormData['depthLayerUrl'] ?? ''));
                    if ($depthRaw === '') $depthRaw = trim((string)($campaignFormData['productImageUrl'] ?? ''));
                    if (!$betaVisual) $depthRaw = '';
                    if ($depthRaw !== '' && function_exists('extd_prepare_cutout')) {
                        $cutout = extd_prepare_cutout($depthRaw);
                        if ($cutout !== '') {
                            $depthDiag = [];
                            $withDepth = extd_add_depth_layer($bannerHtml, $cutout, $fmtW, $fmtH, $depthDiag);
                            if (!empty($depthDiag['ran'])) {
                                $bannerHtml = $withDepth;
                                error_log('[camada-profundidade] creative=' . $sortOrd . ' lado=' . ($depthDiag['side'] ?? '?'));
                            } else {
                                error_log('[camada-profundidade] creative=' . $sortOrd . ' nao injetou: ' . ($depthDiag['reason'] ?? '?'));
                            }
                            if (isset($banner['debug']) && is_array($banner['debug'])) $banner['debug']['camadaProfundidade'] = $depthDiag;
                        } else {
                            error_log('[camada-profundidade] creative=' . $sortOrd . ' fonte nao recortavel: ' . substr($depthRaw, 0, 80));
                        }
                    }

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
                        // Which family actually made it into the HTML. Without this there is no
                        // way to tell a working font from a silent fallback by looking at the job.
                        $banner['debug']['fontApplied'] = $composeFont !== '' ? $composeFont : 'Arial (fallback)';
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

                        // Caminho C: a peca ja' veio pronta em pixels. Nao ha' o que rasterizar —
                        // e' so' mover o arquivo para o lugar do banner.
                        $prontaC = (string)($banner['imagemPronta'] ?? '');
                        if ($prontaC !== '' && is_file($prontaC)) {
                            if (@copy($prontaC, $jpgFilePath)) {
                                $imageUrl = '/projects/' . $creativeRelPath . '/banner.jpg';
                                $rendered = true;
                                @unlink($prontaC);
                                error_log('[caminho-c] creative=' . $creativeId . ' peca gravada sem rasterizacao');
                            } else {
                                error_log('[caminho-c] creative=' . $creativeId . ' falha ao copiar ' . $prontaC);
                            }
                        }

                        if (!$rendered && function_exists('browserless_enabled') && browserless_enabled()) {
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

            // generation_type "html" (mode: render, Gemini) foi aposentado — generate-ads.php
            // ja recusa esse tipo na validacao, entao chegar aqui so' acontece para um job
            // antigo enfileirado antes deste deploy com generate_as_image=0. Falha explicita
            // em vez de cair no Gemini, que nao existe mais neste fluxo.
            throw new RuntimeException('generation_type "html" has been retired. Only generation_type "image" (OpenAI) is supported.');

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
