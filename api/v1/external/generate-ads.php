<?php
/**
 * External API — Generate Ads
 *
 * Flow: auth → company find/create → store sync → campaign → job
 *       → interpret (batch specs) → render per batch → return creatives
 *
 * Auth: Authorization: Bearer cf_xxx  OR  body.api_key
 */

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(600);
ini_set('memory_limit', '256M');

include __DIR__ . '/../../db.php';
include __DIR__ . '/../agents/helpers.php';
include __DIR__ . '/../../site_helpers.php';
include __DIR__ . '/../../_render.php';
include __DIR__ . '/compose-gd.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Format presets ─────────────────────────────────────────────────────────

function ext_format_presets(): array {
    return [
        'instagram-feed-square'    => ['platform' => 'instagram', 'format' => 'square',           'label' => 'Instagram Feed Square',    'width' => 1080, 'height' => 1080, 'enabled' => true],
        'instagram-feed-landscape' => ['platform' => 'instagram', 'format' => 'landscape',         'label' => 'Instagram Feed Landscape', 'width' => 1080, 'height' => 566,  'enabled' => true],
        'instagram-story'          => ['platform' => 'instagram', 'format' => 'story',             'label' => 'Instagram Story',          'width' => 1080, 'height' => 1920, 'enabled' => true],
        'facebook-feed-square'     => ['platform' => 'facebook',  'format' => 'square',            'label' => 'Facebook Feed Square',     'width' => 1080, 'height' => 1080, 'enabled' => true],
        'facebook-story'           => ['platform' => 'facebook',  'format' => 'story',             'label' => 'Facebook Story',           'width' => 1080, 'height' => 1920, 'enabled' => true],
        'google-leaderboard'       => ['platform' => 'display',   'format' => 'leaderboard',       'label' => 'Google Leaderboard',       'width' => 728,  'height' => 90,   'enabled' => true],
        'google-medium-rectangle'  => ['platform' => 'display',   'format' => 'medium-rectangle',  'label' => 'Google Medium Rectangle',  'width' => 300,  'height' => 250,  'enabled' => true],
        'tiktok-feed'              => ['platform' => 'tiktok',    'format' => 'story',             'label' => 'TikTok Feed',              'width' => 1080, 'height' => 1920, 'enabled' => true],
    ];
}

function ext_resolve_formats(array $rawFormats): array {
    $presets = ext_format_presets();
    $resolved = [];
    foreach ($rawFormats as $f) {
        if (is_string($f)) {
            $key = strtolower(trim($f));
            if (isset($presets[$key])) {
                $resolved[] = $presets[$key];
            }
        } elseif (is_array($f)
            && !empty($f['platform'])
            && !empty($f['format'])
            && !empty($f['width'])
            && !empty($f['height'])
        ) {
            $resolved[] = array_merge(['enabled' => true, 'label' => $f['platform'] . '/' . $f['format']], $f);
        }
    }
    return $resolved;
}

// ── Runtime schema migrations ──────────────────────────────────────────────

function ext_ensure_columns(mysqli $conn): void {
    $migs = [
        ['projects',           'phone',               'VARCHAR(30)  NULL DEFAULT NULL'],
        ['ads_campaign',       'api_source',           'VARCHAR(100) NULL DEFAULT NULL'],
        ['ads_campaign',       'external_request_id',  'VARCHAR(128) NULL DEFAULT NULL'],
        ['ad_generation_jobs', 'gemini_api_key',       'VARCHAR(255) NULL DEFAULT NULL'],
        ['ad_generation_jobs', 'generate_as_image',    'TINYINT(1)   NOT NULL DEFAULT 0'],
    ];
    foreach ($migs as [$table, $col, $def]) {
        $s = $conn->prepare(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?"
        );
        if (!$s) continue;
        $s->bind_param('ss', $table, $col);
        $s->execute();
        $s->bind_result($cnt);
        $s->fetch();
        $s->close();
        if ((int)$cnt === 0) {
            $conn->query("ALTER TABLE `{$table}` ADD COLUMN `{$col}` {$def}");
        }
    }
    $idxRes = $conn->query("SHOW INDEX FROM projects WHERE Key_name = 'idx_projects_phone'");
    if ($idxRes && $idxRes->num_rows === 0) {
        $conn->query("ALTER TABLE projects ADD INDEX idx_projects_phone (phone)");
    }
}

// ── Auth ───────────────────────────────────────────────────────────────────

function ext_auth(mysqli $conn, string $apiKey): ?array {
    if ($apiKey === '') return null;
    $stmt = $conn->prepare(
        "SELECT k.user_id, u.account_type
         FROM api_keys k
         JOIN users u ON u.id = k.user_id
         WHERE k.api_key = ? AND k.is_active = 1
         LIMIT 1"
    );
    if (!$stmt) return null;
    $stmt->bind_param('s', $apiKey);
    $stmt->execute();
    $stmt->bind_result($userId, $accountType);
    $found = $stmt->fetch();
    $stmt->close();
    if (!$found || !$userId) return null;

    $upd = $conn->prepare(
        "UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = NOW()
         WHERE api_key = ?"
    );
    if ($upd) { $upd->bind_param('s', $apiKey); $upd->execute(); $upd->close(); }

    return [
        'user_id'      => (int)$userId,
        'account_type' => (string)$accountType,
    ];
}

// ── Data mapping ───────────────────────────────────────────────────────────

function ext_map_company(array $c): array {
    $str = fn($k) => trim((string)($c[$k] ?? ''));
    $arr = fn($k) => array_values(array_filter((array)($c[$k] ?? [])));
    // Like $str but joins arrays (callers send brand_keywords/forbidden_words as arrays).
    $csv = fn($k) => is_array($c[$k] ?? null)
        ? implode(', ', array_values(array_filter(array_map(fn($v) => trim((string)$v), $c[$k]), 'strlen')))
        : trim((string)($c[$k] ?? ''));
    $images = is_array($c['images'] ?? null) ? $c['images'] : [];
    $first = function (array $keys) use ($c, $images): string {
        foreach ($keys as $key) {
            $value = $c[$key] ?? ($images[$key] ?? '');
            if (is_array($value)) continue;
            $value = trim((string)$value);
            if ($value !== '') return $value;
        }
        return '';
    };
    $collect = function (array $keys) use ($c, $images): array {
        $out = [];
        foreach ($keys as $key) {
            $value = $c[$key] ?? ($images[$key] ?? null);
            if (is_array($value)) {
                foreach ($value as $item) {
                    $item = trim((string)$item);
                    if ($item !== '') $out[] = $item;
                }
            } else {
                $value = trim((string)$value);
                if ($value !== '') $out[] = $value;
            }
        }
        return array_values(array_unique($out));
    };

    $logo = $first(['logo_url', 'logoUrl', 'logo']);
    $hero = $first(['hero_image_url', 'heroImageUrl', 'heroImage1', 'hero', 'background_image_url', 'backgroundImageUrl', 'background_image', 'image_url']);
    $productImages = $collect(['product_images', 'productImages', 'product_image_urls', 'productImageUrls', 'product_image_url', 'productImageUrl', 'product_image', 'brand_image_url', 'brandImage', 'sectionImage1', 'image_url']);
    $referenceImages = $collect(['reference_images', 'referenceImages', 'reference_image_urls', 'ref_images']);

    return array_filter([
        'businessName'        => $str('name'),
        'businessCategory'    => $str('industry'),
        'businessDescription' => $str('description'),
        'language'            => $first(['language', 'lang', 'locale']),
        'toneOfVoice'         => $str('tone_of_voice'),
        'brandPersonality'    => $str('brand_personality'),
        'brandKeywords'       => $csv('brand_keywords'),
        'forbiddenWords'      => $csv('forbidden_words'),
        'targetAudience'      => $str('target_audience'),
        'valueProposition'    => $str('value_proposition'),
        'logoUrl'             => $logo,
        'primaryColor'        => $str('primary_color'),
        'secondaryColor'      => $str('secondary_color'),
        'accentColor'         => $str('accent_color'),
        'backgroundColor'     => $str('background_color'),
        'textColor'           => $str('text_color'),
        'headingFont'         => $str('heading_font'),
        'bodyFont'            => $str('body_font'),
        'sourceWebsite'       => $str('website'),
        'services'            => $arr('services'),
        'differentiators'     => $arr('differentiators'),
        'referenceImages'     => $referenceImages,
        'images'              => array_filter([
            'logo'          => $logo,
            'hero'          => $hero,
            'productImages' => $productImages,
        ]),
    ], fn($v) => is_array($v) ? !empty($v) : trim((string)$v) !== '');
}

function ext_map_campaign(array $cam, array $formats): array {
    $str  = fn($k) => trim((string)($cam[$k] ?? ''));
    $bool = fn($k, $d = true) => isset($cam[$k]) ? filter_var($cam[$k], FILTER_VALIDATE_BOOLEAN) : $d;
    $first = function (array $keys) use ($cam): string {
        foreach ($keys as $key) {
            $value = trim((string)($cam[$key] ?? ''));
            if ($value !== '') return $value;
        }
        return '';
    };

    return array_filter([
        'campaignName'          => $str('name'),
        'campaignObjective'     => $str('objective'),
        'funnelStage'           => $str('funnel_stage'),
        'language'              => $first(['language', 'lang', 'locale']),
        'productName'           => $first(['product_name', 'product', 'service_name', 'service']),
        'valueProposition'      => $first(['value_proposition', 'value_prop', 'benefit', 'main_benefit']),
        'offer'                 => $str('offer'),
        'pricing'               => $str('pricing'),
        'discount'              => $str('discount'),
        'guarantee'             => $str('guarantee'),
        'scarcity'              => $str('scarcity'),
        'ctaText'               => $first(['cta_text', 'cta', 'button_text']),
        'mainHeadline'          => $first(['main_headline', 'headline', 'title', 'hook']),
        'subheadline'           => $first(['subheadline', 'subtitle', 'supporting_copy']),
        'useAiCopy'             => $bool('use_ai_copy'),
        'targetAudience'        => $str('target_audience'),
        'ageRange'              => $str('age_range'),
        'gender'                => $str('gender'),
        'painPoints'            => $str('pain_points'),
        'desires'               => $str('desires'),
        'urgencyLevel'          => $str('urgency_level'),
        'creativeStrategy'      => $str('creative_strategy'),
        'productImageUrl'       => $first(['product_image_url', 'product_image', 'image_url', 'creative_image_url']),
        'backgroundImageUrl'    => $first(['background_image_url', 'background_image', 'hero_image_url']),
        // Creative reference image for this specific generation. Sent to the image model with
        // full creative freedom — Gemini decides how to use it (composition, mood, texture, etc.).
        // Sets bgSource='inspired' so the model can creatively interpret it, not just copy it.
        'referenceImageUrl'     => $first(['reference_image', 'reference_image_url', 'creative_reference', 'inspiration_image']),
        'preferredStyle'        => $str('preferred_style'),
        'preferredLogoStrategy' => $str('logo_strategy'),
        // Logo corner: explicit logo_position, or parsed from the logo_strategy text.
        'logoPosition'          => (function () use ($cam) {
            $s = strtolower(trim((string)($cam['logo_position'] ?? $cam['logoPosition'] ?? $cam['logo_strategy'] ?? '')));
            if (preg_match('/top.?left|upper.?left|superior.?esquerd|canto.?superior.?esquerd/', $s)) return 'top-left';
            if (preg_match('/top.?right|upper.?right|superior.?direit/', $s)) return 'top-right';
            if (preg_match('/top.?cent|top.?middle|superior.?cent/', $s)) return 'top-center';
            if (preg_match('/bottom.?left|inferior.?esquerd/', $s)) return 'bottom-left';
            if (preg_match('/bottom.?right|inferior.?direit/', $s)) return 'bottom-right';
            return '';
        })(),
        // Optional override for the compose background style (reference|company|creative|shapes).
        // When omitted, ext_enrich_campaign_for_generation picks a rich default.
        'composeBackgroundSource' => $first(['compose_background_source', 'background_source']),
        // Forces the text/logo layout (and thus where the AI background reserves negative
        // space). Must be a known LAYOUT_KEY in the edge; unknown values fall back to auto.
        'textLayout'            => $first(['text_layout', 'layout', 'logo_position']),
        'selectedFormats'       => $formats,
    ], fn($v) => !($v === '' || $v === null || (is_array($v) && empty($v))));
}

function ext_enrich_campaign_for_generation(array $campaignData, array $companyData): array {
    $pick = function (array $keys, array ...$sources): string {
        foreach ($sources as $source) {
            foreach ($keys as $key) {
                $value = trim((string)($source[$key] ?? ''));
                if ($value !== '') return $value;
            }
        }
        return '';
    };

    $product = $pick(['productName', 'product_name', 'product', 'service_name'], $campaignData, $companyData);
    if ($product !== '' && empty($campaignData['productName'])) {
        $campaignData['productName'] = $product;
    }

    $value = $pick(['valueProposition', 'value_proposition', 'value_prop', 'main_benefit'], $campaignData, $companyData);
    if ($value !== '' && empty($campaignData['valueProposition'])) {
        $campaignData['valueProposition'] = $value;
    }

    $offer = trim((string)($campaignData['offer'] ?? ''));
    if (empty($campaignData['mainHeadline'])) {
        $base = $offer !== '' ? $offer : ($value !== '' ? $value : ($product !== '' ? $product : 'Grow faster with us'));
        $campaignData['mainHeadline'] = mb_substr($base, 0, 72);
    }
    if (empty($campaignData['subheadline'])) {
        $audience = trim((string)($campaignData['targetAudience'] ?? $companyData['targetAudience'] ?? ''));
        $campaignData['subheadline'] = $audience !== ''
            ? mb_substr("Built for {$audience}", 0, 90)
            : 'A clear offer designed to convert.';
    }
    if (empty($campaignData['ctaText'])) {
        $campaignData['ctaText'] = 'Get Started';
    }

    $images = is_array($companyData['images'] ?? null) ? $companyData['images'] : [];
    if (empty($campaignData['logoUrl'])) {
        $logo = $pick(['logoUrl', 'logo_url', 'logo'], $campaignData, $companyData, $images);
        if ($logo !== '') $campaignData['logoUrl'] = $logo;
    }
    if (empty($campaignData['productImageUrl'])) {
        $productImage = $pick(['productImageUrl', 'product_image_url', 'product_image', 'image_url', 'brandImage', 'sectionImage1'], $campaignData, $companyData, $images);
        if ($productImage === '' && !empty($images['productImages']) && is_array($images['productImages'])) {
            $productImage = trim((string)($images['productImages'][0] ?? ''));
        }
        if ($productImage !== '') $campaignData['productImageUrl'] = $productImage;
    }
    if (empty($campaignData['backgroundImageUrl'])) {
        $background = $pick(['backgroundImageUrl', 'background_image_url', 'background_image', 'heroImage1', 'heroImage2', 'hero'], $campaignData, $companyData, $images);
        if ($background !== '') $campaignData['backgroundImageUrl'] = $background;
    }

    // Every image the caller provides — regardless of field name — is a reference for
    // the background generator. Gather ALL image URLs from company and campaign into
    // composeCompanyRefs so the edge passes them via file_data (URL, no base64) to Gemini.
    // They also go through the re-absolutizing step at line ~1053 so root-relative
    // /projects/... paths (produced by asset mirroring) become fetchable absolute URLs.
    $logoUrl = trim((string)($campaignData['logoUrl'] ?? $companyData['logoUrl'] ?? ''));
    $isLogo  = fn(string $u): bool => $logoUrl !== '' && $u === $logoUrl;
    $addRef  = function (array &$refs, $val) use ($isLogo): void {
        if (is_array($val)) { foreach ($val as $v) { $v = trim((string)$v); if ($v !== '' && preg_match('~^https?://~i', $v) && !$isLogo($v)) $refs[] = $v; } }
        else { $v = trim((string)$val); if ($v !== '' && preg_match('~^https?://~i', $v) && !$isLogo($v)) $refs[] = $v; }
    };
    // Generation-time reference image — caller sends this in campaign.reference_image.
    // It goes FIRST in composeCompanyRefs (highest visual priority) and triggers 'inspired'
    // bgSource so the model can creatively interpret it rather than copy it verbatim.
    $genRefUrl = trim((string)($campaignData['referenceImageUrl'] ?? ''));
    $genRefUrl = ($genRefUrl !== '' && preg_match('~^https?://~i', $genRefUrl) && !$isLogo($genRefUrl)) ? $genRefUrl : '';

    $allRefs = [];
    if ($genRefUrl !== '') $allRefs[] = $genRefUrl;                                // [FIRST] campaign.reference_image
    $addRef($allRefs, $companyData['referenceImages'] ?? []);                      // company.reference_images
    $addRef($allRefs, ($images['productImages'] ?? []));                            // company.product_images
    $addRef($allRefs, $images['hero'] ?? '');                                       // company.hero_image_url
    $addRef($allRefs, $campaignData['productImageUrl'] ?? '');                      // campaign.product_image_url
    $addRef($allRefs, $campaignData['backgroundImageUrl'] ?? '');                   // campaign.background_image_url
    // Brand posts (Instagram) mirrored via company-assets — stored as root-relative /projects/...
    // Added directly (not via $addRef) because $addRef filters non-http. The absolutize step
    // in asset-mirroring (line ~1073) converts them to absolute URLs before the edge call.
    if (!empty($companyData['brandPostImages']) && is_array($companyData['brandPostImages'])) {
        foreach (array_slice($companyData['brandPostImages'], 0, 3) as $bp) {
            $bp = trim((string)$bp);
            if ($bp !== '' && !$isLogo($bp)) $allRefs[] = $bp;
        }
    }
    $allRefs = array_values(array_unique($allRefs));
    if (!empty($allRefs)) {
        $campaignData['composeCompanyRefs'] = array_slice($allRefs, 0, 4);
    }

    $bgSourceRaw = strtolower(trim((string)($campaignData['composeBackgroundSource'] ?? '')));
    if (!in_array($bgSourceRaw, ['reference', 'company', 'creative', 'shapes', 'inspired'], true)) {
        if ($genRefUrl !== '') {
            $bgSourceRaw = 'inspired'; // ref image → full creative freedom, model decides how to use it
        } else {
            // brandPostImages → treat as "company" so the model studies the brand's visual world.
            $hasBrandPosts = !empty($companyData['brandPostImages']) && is_array($companyData['brandPostImages']);
            $bgSourceRaw = !empty($allRefs) ? ($hasBrandPosts && empty($genRefUrl) ? 'company' : 'reference') : 'creative';
        }
    }
    $campaignData['composeBackgroundSource'] = $bgSourceRaw;

    // Bridge the company's brand identity into campaignData. The COMPOSE engine reads
    // brand fields (colors, fonts, voice, personality, keywords, category, description,
    // audience) from campaignData — NOT from the company store — so without this the rich
    // brand kit never reaches the image prompt (BRAND_CSS_VARS / BRAND_VISUAL come out
    // empty). Only fills when the campaign itself didn't already provide the field.
    $brandBridge = [
        'language'            => 'language',
        'brandName'           => 'businessName',
        'industry'            => 'businessCategory',
        'businessDescription' => 'businessDescription',
        'toneOfVoice'         => 'toneOfVoice',
        'brandPersonality'    => 'brandPersonality',
        'brandKeywords'       => 'brandKeywords',
        'forbiddenWords'      => 'forbiddenWords',
        'targetAudience'      => 'targetAudience',
        'primaryColor'        => 'primaryColor',
        'secondaryColor'      => 'secondaryColor',
        'accentColor'         => 'accentColor',
        'backgroundColor'     => 'backgroundColor',
        'textColor'           => 'textColor',
        'headingFont'         => 'headingFont',
        'bodyFont'            => 'bodyFont',
        // Brief de identidade visual extraído dos posts do Instagram via company-assets.php.
        // Lido pelo compose mode diretamente de campaignData (não passa pelo store).
        'brandVisualBrief'    => 'brandVisualBrief',
    ];
    foreach ($brandBridge as $campKey => $compKey) {
        if (trim((string)($campaignData[$campKey] ?? '')) === '' && trim((string)($companyData[$compKey] ?? '')) !== '') {
            $campaignData[$campKey] = $companyData[$compKey];
        }
    }

    $campaignData['externalApiContract'] = 'Return ad image URLs in image_url. Use provided copy and provided image assets visibly in each creative.';
    return $campaignData;
}

function ext_escape_attr(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ext_absolute_public_url(?string $path): ?string {
    $path = trim((string)$path);
    if ($path === '') return null;
    if (preg_match('~^https?://~i', $path)) return $path;
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host === '') return $path;
    return $scheme . '://' . $host . '/' . ltrim($path, '/');
}

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

function ext_generated_image_bytes(string $imageUrl): array {
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

function ext_image_preview_html(string $imageFileName, string $label, int $width, int $height): string {
    $safeFile = htmlspecialchars($imageFileName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $safeLabel = htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' . $safeLabel . '</title>'
        . '<style>*{box-sizing:border-box}html,body{margin:0;width:' . $width . 'px;height:' . $height . 'px;overflow:hidden;background:#111}'
        . 'img{display:block;width:' . $width . 'px;height:' . $height . 'px;object-fit:cover}</style></head>'
        . '<body><img src="' . $safeFile . '" alt="' . $safeLabel . '"></body></html>';
}

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

// ── Banner extraction (fallback when snippets[] not in response) ───────────

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

function ext_expected_creatives_for_batch(array $batchFormats, array $campaignData): int {
    $formatCount = max(1, count($batchFormats));
    $isAb = !empty($campaignData['abTestingEnabled']) || !empty($campaignData['ab_testing_enabled']);
    $rawVariantCount = $campaignData['abVariantCount'] ?? $campaignData['ab_variant_count'] ?? 1;
    $variantCount = $isAb ? min(3, max(2, (int)$rawVariantCount)) : 1;
    return max(1, $formatCount * $variantCount);
}

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

/**
 * Decode inline base64 data URIs (data:image/...;base64,...) found anywhere in the
 * company/campaign payload, save them as real files under the company's assets folder,
 * and return a map [originalBase64String => localPublicUrl]. This lets callers send
 * images straight from n8n without an external host, while ensuring generation only
 * ever receives a URL (never the base64 blob, which would waste prompt tokens).
 */
function ext_mirror_inline_base64_to_company(string $companyRelPath, array ...$sources): array {
    if ($companyRelPath === '') return [];

    // Collect unique base64 image data URIs from the raw payload.
    $dataUris = [];
    $walk = function ($value) use (&$walk, &$dataUris): void {
        if (is_array($value)) { foreach ($value as $child) $walk($child); return; }
        if (!is_string($value)) return;
        $trimmed = trim($value);
        if ($trimmed !== '' && preg_match('~^data:image/[a-z0-9.+-]+;base64,~i', $trimmed)) {
            $dataUris[$trimmed] = true;
        }
    };
    foreach ($sources as $source) $walk($source);
    if (empty($dataUris)) return [];

    $companyDir = project_directory_from_relative($companyRelPath);
    $assetsDir = $companyDir . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsDir);

    $publicBase = project_public_url_from_relative($companyRelPath);
    $publicBase = preg_replace('/\/index\.html$/i', '/', $publicBase);
    if (!str_ends_with($publicBase, '/')) $publicBase .= '/';

    $mimeExt = [
        'image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png',
        'image/webp' => 'webp', 'image/gif' => 'gif', 'image/avif' => 'avif',
        'image/svg+xml' => 'svg', 'image/bmp' => 'bmp',
    ];

    $map = [];
    $assetIndex = 1;
    foreach (array_keys($dataUris) as $dataUri) {
        if (!preg_match('~^data:(image/[a-z0-9.+-]+);base64,(.+)$~i', $dataUri, $m)) continue;
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || $bytes === '') continue;

        $detectedType = detect_asset_content_type($bytes, strtolower($m[1]));
        if (!is_safe_asset_content_type($detectedType)) continue;
        $ext = $mimeExt[strtolower($detectedType)] ?? ($mimeExt[strtolower($m[1])] ?? 'jpg');

        $fileName = 'external-api-inline-' . $assetIndex . '.' . $ext;
        while (file_exists($assetsDir . DIRECTORY_SEPARATOR . $fileName)) {
            $assetIndex++;
            $fileName = 'external-api-inline-' . $assetIndex . '.' . $ext;
        }
        $targetPath = $assetsDir . DIRECTORY_SEPARATOR . $fileName;
        if (@file_put_contents($targetPath, $bytes) === false) continue;

        $map[$dataUri] = $publicBase . 'assets/' . rawurlencode($fileName);
        $assetIndex++;
    }

    return $map;
}

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

// ── Main ───────────────────────────────────────────────────────────────────

$rawBody = file_get_contents('php://input');
$body    = json_decode($rawBody ?: '{}', true);
$jobId   = 0;
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

// Resolve API key: Authorization header takes priority, fallback to body
// Apache on shared hosting may strip HTTP_AUTHORIZATION — also check REDIRECT_HTTP_AUTHORIZATION
$apiKey = '';
$authHeader = trim(
    $_SERVER['HTTP_AUTHORIZATION'] ??
    $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ??
    getallheaders()['Authorization'] ?? ''
);
if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    $apiKey = trim($m[1]);
} elseif (!empty($body['api_key'])) {
    $apiKey = trim((string)$body['api_key']);
}

try {
    ext_ensure_columns($conn);

    $auth = ext_auth($conn, $apiKey);
    if (!$auth) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or inactive API key']);
        exit;
    }
    $userId      = $auth['user_id'];
    $accountType = $auth['account_type'];
    $passKey     = trim((string)($body['gemini_api_key'] ?? ''));
    $passKey     = $passKey !== '' ? $passKey : null;

    if ($passKey === null) {
        http_response_code(400);
        echo json_encode([
            'error' => 'gemini_api_key is required. External Ads API generation uses the caller Gemini key and quota.',
        ]);
        exit;
    }

    $generationTypeRaw = strtolower(trim((string)(
        $body['generation_type'] ??
        $body['output_type'] ??
        $body['output'] ??
        ''
    )));
    if ($generationTypeRaw === '' && array_key_exists('generate_as_image', $body)) {
        $generationTypeRaw = !empty($body['generate_as_image']) ? 'image' : 'html';
    }
    $generationAliases = [
        'html'  => 'html',
        'image' => 'image',
        'images' => 'image',
        'png'   => 'image',
        'picture' => 'image',
    ];
    if (!isset($generationAliases[$generationTypeRaw])) {
        http_response_code(400);
        echo json_encode([
            'error' => 'generation_type is required and must be "html" or "image".',
            'accepted_aliases' => ['html', 'image', 'images', 'png'],
        ]);
        exit;
    }
    $generationType  = $generationAliases[$generationTypeRaw];
    $generateAsImage = $generationType === 'image';

    $sitesBasePath = resolve_sites_base_path();
    $browserBin    = function_exists('find_browser_binary') ? find_browser_binary() : null;

    // ── Validate input ───────────────────────────────────────────────────

    $phone    = trim((string)($body['phone']    ?? ''));
    $company  = is_array($body['company']  ?? null) ? $body['company']  : null;
    $campaign = is_array($body['campaign'] ?? null) ? $body['campaign'] : null;
    $rawFmts  = is_array($body['formats']  ?? null) ? $body['formats']  : [];

    if (!$phone)               { http_response_code(400); echo json_encode(['error' => 'phone is required']); exit; }
    if (!$company)             { http_response_code(400); echo json_encode(['error' => 'company object is required']); exit; }
    if (empty($company['name'])) { http_response_code(400); echo json_encode(['error' => 'company.name is required']); exit; }
    if (!$campaign)            { http_response_code(400); echo json_encode(['error' => 'campaign object is required']); exit; }
    if (empty($rawFmts))       { http_response_code(400); echo json_encode(['error' => 'formats array is required']); exit; }

    $resolvedFormats = ext_resolve_formats($rawFmts);
    if (empty($resolvedFormats)) {
        $validPresets = array_keys(ext_format_presets());
        http_response_code(400);
        echo json_encode([
            'error'         => 'No valid formats provided',
            'valid_presets' => $validPresets,
        ]);
        exit;
    }

    $forceSync = !empty($body['force_sync']);

    // ── 1. Find or create company by phone ───────────────────────────────

    $companyFormData = ext_map_company($company);
    $companyFormDataJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);

    $compStmt = $conn->prepare(
        "SELECT id, gemini_store_name, company_form_data, folder_path, public_url
         FROM projects
         WHERE user_id = ? AND phone = ? AND project_type = 'project'
         ORDER BY created_at DESC LIMIT 1"
    );
    if (!$compStmt) throw new RuntimeException($conn->error);
    $compStmt->bind_param('is', $userId, $phone);
    $compStmt->execute();
    $existingCompanyFolderPath = null;
    $existingCompanyPublicUrl  = null;
    $compStmt->bind_result($companyId, $existingStoreName, $existingFormDataJson, $existingCompanyFolderPath, $existingCompanyPublicUrl);
    $companyExists = $compStmt->fetch();
    $compStmt->close();

    if (!$companyExists) {
        $companyName = trim((string)($company['name'] ?? 'Company'));
        $context     = trim((string)($company['description'] ?? ''));
        $insComp = $conn->prepare(
            "INSERT INTO projects (user_id, name, project_type, phone, company_form_data, context)
             VALUES (?, ?, 'project', ?, ?, ?)"
        );
        if (!$insComp) throw new RuntimeException($conn->error);
        $insComp->bind_param('issss', $userId, $companyName, $phone, $companyFormDataJson, $context);
        $insComp->execute();
        $companyId = (int)$conn->insert_id;
        $insComp->close();
        $existingStoreName = null;
        $forceSync = true;
    } elseif ($forceSync) {
        $updComp = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
        if ($updComp) {
            $updComp->bind_param('si', $companyFormDataJson, $companyId);
            $updComp->execute();
            $updComp->close();
        }
    } else {
        // Reuse stored company data as the BASE, but let any fields the caller provided in
        // THIS request override the stored ones (deep-merging the images map). Otherwise a
        // stale stored value — e.g. an old placeholder logo from a previous run — would win
        // over the real logo_url/colors the caller just sent. Persist so later runs keep it.
        $existing = json_decode($existingFormDataJson ?: '{}', true);
        if (is_array($existing) && !empty($existing)) {
            $payloadCompany = $companyFormData; // already mapped + non-empty-filtered above
            $mergedImages = array_merge(
                is_array($existing['images'] ?? null) ? $existing['images'] : [],
                is_array($payloadCompany['images'] ?? null) ? $payloadCompany['images'] : []
            );
            $companyFormData = array_merge($existing, $payloadCompany);
            if (!empty($mergedImages)) $companyFormData['images'] = $mergedImages;

            // Logo already hosted on our server? Keep the cached URL — don't re-mirror the
            // external URL the client re-sends every call. The logo is composited via <img src>
            // in the HTML, never downloaded as base64, so the local URL is always correct.
            $cachedLogo = trim((string)($existing['logoUrl'] ?? ''));
            if ($cachedLogo !== '' && str_contains($cachedLogo, '/projects/')) {
                $companyFormData['logoUrl'] = $cachedLogo;
                if (isset($companyFormData['images']['logo'])) $companyFormData['images']['logo'] = $cachedLogo;
            }

            $mergedJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
            if ($mergedJson && $mergedJson !== ($existingFormDataJson ?: '')) {
                $updMerge = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
                if ($updMerge) { $updMerge->bind_param('si', $mergedJson, $companyId); $updMerge->execute(); $updMerge->close(); }
            }
        }
    }

    // ── 2b. Ensure company folder exists on disk ─────────────────────────

    $companyRelPath = extract_project_relative_path_from_folder_path((string)($existingCompanyFolderPath ?? ''));
    if ($companyRelPath === '') {
        $companyRelPath = extract_project_relative_path_from_public_url((string)($existingCompanyPublicUrl ?? ''));
    }
    if ($companyRelPath === '') {
        $companySlugBase = sanitize_slug((string)($company['name'] ?? 'company'));
        $companyRelPath  = ensure_unique_slug($companySlugBase, $sitesBasePath);
        $newCompFolderPath = project_folder_path_from_relative($companyRelPath);
        $newCompPublicUrl  = project_public_url_from_relative($companyRelPath);
        $updCompPath = $conn->prepare("UPDATE projects SET folder_path = ?, public_url = ? WHERE id = ?");
        if ($updCompPath) {
            $updCompPath->bind_param('ssi', $newCompFolderPath, $newCompPublicUrl, $companyId);
            $updCompPath->execute();
            $updCompPath->close();
        }
    }
    ensure_directory($sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $companyRelPath));

    // ── 3. Create campaign ───────────────────────────────────────────────

    $campaignFormData = ext_map_campaign($campaign, $resolvedFormats);
    $campaignFormData = agents_enrich_ad_form_with_company_data($campaignFormData, $companyFormData);
    $campaignFormData = ext_enrich_campaign_for_generation($campaignFormData, $companyFormData);

    // Host any inline base64 images BEFORE the async/sync fork so generation only
    // ever sees URLs (never the base64 blob, which wastes prompt tokens) and the
    // blob never lands in the job metadata / DB / worker payload.
    $inlineAssetMap = ext_mirror_inline_base64_to_company($companyRelPath, $company, $campaign);
    if (!empty($inlineAssetMap)) {
        $companyFormData  = ext_rewrite_payload_asset_urls($companyFormData, $inlineAssetMap);
        $campaignFormData = ext_rewrite_payload_asset_urls($campaignFormData, $inlineAssetMap);
        $rewrittenCompanyJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
        if ($rewrittenCompanyJson) {
            $updInlineComp = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
            if ($updInlineComp) { $updInlineComp->bind_param('si', $rewrittenCompanyJson, $companyId); $updInlineComp->execute(); $updInlineComp->close(); }
        }
    }

    // Mirror only assets explicitly sent in this API request. Do not re-mirror
    // stored/enriched company/campaign data, otherwise existing local assets get
    // copied again on every request and the assets folder grows with duplicates.
    $assetUrlsToMirror = ext_collect_asset_urls_from_payload($company, $campaign);

    // debug:true → the engine returns the final image prompt + aspectRatio + refs
    // used, surfaced per creative in job-status (for prompt calibration). Persisted
    // in form_data so the async worker forwards it to the edge function.
    $campaignFormData['debug'] = !empty($body['debug']);
    $campaignFormDataJson = json_encode($campaignFormData, JSON_UNESCAPED_UNICODE);
    $campaignMetadataJson = json_encode([
        'external_asset_urls_to_mirror' => $assetUrlsToMirror,
        // Absolute base so the (CLI, no $_SERVER) worker can turn mirrored /projects/... refs
        // into absolute URLs the image edge can fetch.
        'public_base' => ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? ''),
    ], JSON_UNESCAPED_UNICODE);
    $campaignName       = trim((string)($campaign['name'] ?? 'Campaign')) ?: 'Campaign';
    $apiSource          = substr(trim((string)($body['source']     ?? 'external')), 0, 100);
    $externalRequestId  = substr(trim((string)($body['request_id'] ?? '')), 0, 128) ?: null;

    // Child project for this campaign
    $insCampProj = $conn->prepare(
        "INSERT INTO projects (user_id, name, project_type, company_project_id)
         VALUES (?, ?, 'ad_creative', ?)"
    );
    if (!$insCampProj) throw new RuntimeException($conn->error);
    $insCampProj->bind_param('isi', $userId, $campaignName, $companyId);
    $insCampProj->execute();
    $campaignProjectId = (int)$conn->insert_id;
    $insCampProj->close();

    $insCamp = $conn->prepare(
        "INSERT INTO ads_campaign (project_id, name, form_data, api_source, external_request_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?)"
    );
    if (!$insCamp) throw new RuntimeException($conn->error);
    $insCamp->bind_param('isssss', $campaignProjectId, $campaignName, $campaignFormDataJson, $apiSource, $externalRequestId, $campaignMetadataJson);
    $insCamp->execute();
    $campaignId = (int)$conn->insert_id;
    $insCamp->close();

    // Create campaign subfolder inside company folder
    $companyDir     = $sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $companyRelPath);
    $campaignSlug   = ensure_unique_slug(sanitize_slug($campaignName), $companyDir);
    $campaignRelPath = $companyRelPath . '/' . $campaignSlug;
    ensure_directory($sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $campaignRelPath));
    $campaignFolderPath = project_folder_path_from_relative($campaignRelPath);
    $campaignPublicUrl  = project_public_url_from_relative($campaignRelPath);

    $updCampProj = $conn->prepare("UPDATE projects SET folder_path = ?, public_url = ? WHERE id = ?");
    if ($updCampProj) {
        $updCampProj->bind_param('ssi', $campaignFolderPath, $campaignPublicUrl, $campaignProjectId);
        $updCampProj->execute();
        $updCampProj->close();
    }
    $updCamp = $conn->prepare("UPDATE ads_campaign SET public_url = ? WHERE id = ?");
    if ($updCamp) {
        $updCamp->bind_param('si', $campaignPublicUrl, $campaignId);
        $updCamp->execute();
        $updCamp->close();
    }

    // ── 4. Create job + batches (1 per format) ──────────────────────────

    $batches = array_values(array_map(fn($fmt) => [
        'label'   => $fmt['label'],
        'formats' => [$fmt],
    ], $resolvedFormats));
    $totalBatches = count($batches);

    $conn->begin_transaction();
    $insJob = $conn->prepare(
        "INSERT INTO ad_generation_jobs
           (user_id, company_project_id, campaign_id, project_id, status, total_batches, gemini_api_key, generate_as_image)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?)"
    );
    if (!$insJob) throw new RuntimeException($conn->error);
    $generateAsImageInt = $generateAsImage ? 1 : 0;
    $insJob->bind_param('iiiiisi', $userId, $companyId, $campaignId, $campaignProjectId, $totalBatches, $passKey, $generateAsImageInt);
    $insJob->execute();
    $jobId = (int)$conn->insert_id;
    $insJob->close();

    $insBatch = $conn->prepare(
        "INSERT INTO ad_generation_job_batches (job_id, batch_index, status, label, formats_json)
         VALUES (?, ?, 'queued', ?, ?)"
    );
    if (!$insBatch) throw new RuntimeException($conn->error);
    foreach ($batches as $i => $batch) {
        $bLabel = $batch['label'];
        $bFmtsJson = json_encode($batch['formats'], JSON_UNESCAPED_UNICODE);
        $insBatch->bind_param('iiss', $jobId, $i, $bLabel, $bFmtsJson);
        $insBatch->execute();
    }
    $insBatch->close();
    $conn->commit();

    // ── 5. Send 202 immediately — client polls job-status.php ───────────

    ignore_user_abort(true);
    set_time_limit(0);
    $statusUrl = ext_absolute_public_url('/api/v1/external/job-status.php?api_key=' . rawurlencode($apiKey) . '&job_id=' . $jobId);
    $body202   = json_encode([
        'job_id'        => $jobId,
        'status'        => 'running',
        'status_url'    => $statusUrl,
        'generation_type' => $generationType,
        'company_id'    => $companyId,
        'campaign_id'   => $campaignId,
        'total_batches' => $totalBatches,
    ], JSON_UNESCAPED_UNICODE);
    http_response_code(202);
    header('Content-Type: application/json');
    header('Content-Length: ' . strlen($body202));
    echo $body202;
    // Keep processing after the client gets its 202.
    @ignore_user_abort(true);
    @set_time_limit(0);
    if (function_exists('fastcgi_finish_request')) {
        // PHP-FPM: detach and continue inline below.
        fastcgi_finish_request();
    } else {
        // LiteSpeed (this host): do NOT call litespeed_finish_request() here — it ends
        // the script (LSAPI recycles the process) BEFORE the exec line runs, so the
        // worker is never spawned and the job hangs at 'running' forever. Just flush the
        // 202 and spawn a DETACHED background worker (this is how jobs completed before).
        while (ob_get_level() > 0) { @ob_end_flush(); }
        @flush();
        $workerPath = __DIR__ . '/generate-ads-worker.php';
        if (is_file($workerPath)) {
            // Use a REAL CLI php — PHP_BINARY here is lsphp (LiteSpeed LSAPI), which is not
            // a CLI: exec'ing it fatals (no STDOUT/STDIN constants) so the worker never runs.
            // /usr/bin/php is a proper CLI with gd/mysqli/curl.
            $cliPhp = '';
            foreach (['/usr/bin/php', '/usr/local/bin/php', '/opt/cpanel/ea-php81/root/usr/bin/php'] as $cand) {
                if (@is_executable($cand)) { $cliPhp = $cand; break; }
            }
            if ($cliPhp === '') $cliPhp = 'php';
            @exec(escapeshellarg($cliPhp) . ' ' . escapeshellarg($workerPath) . ' ' . $jobId . ' > /dev/null 2>&1 &');
        }
        exit;
    }

    // ── SLOW PATH (HTTP 202 already sent to client) ──────────────────────

    // ── 6. Sync company store ────────────────────────────────────────────

    if ($forceSync || !$existingStoreName) {
        $existingStoreName = agents_sync_company_store(
            $conn, $companyId, $companyFormData, $accountType, $userId,
            $existingStoreName ?: null,
            $passKey
        );
        agents_reconnect_mysqli_if_needed($conn);
    }
    $companyStoreName = (string)$existingStoreName;

    // ── 7. Asset mirroring ───────────────────────────────────────────────

    $companyAssetMirror = ['uploaded' => [], 'skipped' => []];
    if (!empty($assetUrlsToMirror)) {
        $mirrorResult = ext_mirror_api_assets_to_company($assetUrlsToMirror, $companyRelPath);
        $companyAssetMirror = $mirrorResult['report'] ?? $companyAssetMirror;
        $assetUrlMap = is_array($mirrorResult['map'] ?? null) ? $mirrorResult['map'] : [];
        if (!empty($assetUrlMap)) {
            $companyFormData  = ext_rewrite_payload_asset_urls($companyFormData, $assetUrlMap);
            $campaignFormData = ext_rewrite_payload_asset_urls($campaignFormData, $assetUrlMap);
            // composeCompanyRefs must stay ABSOLUTE: the rewrite above turns mirrored refs into
            // root-relative /projects/... which the image edge (Deno) cannot fetch (it only keeps
            // http(s) URLs). Re-absolutize using the request host so the edge fetches the local copy.
            if (!empty($campaignFormData['composeCompanyRefs']) && is_array($campaignFormData['composeCompanyRefs'])) {
                $absBase = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '');
                $campaignFormData['composeCompanyRefs'] = array_values(array_filter(array_map(function ($u) use ($absBase) {
                    $u = trim((string)$u);
                    if ($u === '' || preg_match('~^https?://~i', $u)) return $u;
                    if ($u[0] === '/' && $absBase !== '') return $absBase . $u;
                    return $u;
                }, $campaignFormData['composeCompanyRefs']), 'strlen'));
            }
            agents_reconnect_mysqli_if_needed($conn);
            $updatedCompanyFormDataJson = json_encode($companyFormData, JSON_UNESCAPED_UNICODE);
            if ($updatedCompanyFormDataJson) {
                $updAssetsComp = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?");
                if ($updAssetsComp) { $updAssetsComp->bind_param('si', $updatedCompanyFormDataJson, $companyId); $updAssetsComp->execute(); $updAssetsComp->close(); }
            }
            agents_reconnect_mysqli_if_needed($conn);
            $updatedCampaignFormDataJson = json_encode($campaignFormData, JSON_UNESCAPED_UNICODE);
            if ($updatedCampaignFormDataJson) {
                $updAssetsCamp = $conn->prepare("UPDATE ads_campaign SET form_data = ? WHERE id = ?");
                if ($updAssetsCamp) { $updAssetsCamp->bind_param('si', $updatedCampaignFormDataJson, $campaignId); $updAssetsCamp->execute(); $updAssetsCamp->close(); }
            }
        }
    }

    // ── 8. Global stores + agent config ─────────────────────────────────

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
    if (trim((string)$globalAdsStore) === '') {
        error_log('[external/generate-ads] Global Ads Store missing for job ' . $jobId);
        agents_reconnect_mysqli_if_needed($conn);
        $failMsg = 'Global Ads Store is missing.';
        $failJob = $conn->prepare("UPDATE ad_generation_jobs SET status = 'failed', error = ? WHERE id = ?");
        if ($failJob) { $failJob->bind_param('si', $failMsg, $jobId); $failJob->execute(); $failJob->close(); }
        exit;
    }
    if (!$generateAsImage && trim((string)$globalRefStore) === '') {
        error_log('[external/generate-ads] Global Ads Reference Store missing for job ' . $jobId);
        agents_reconnect_mysqli_if_needed($conn);
        $failMsg = 'Global Ads Reference Store is missing. Upload at least one ad example via "Send to Store" first.';
        $failJob = $conn->prepare("UPDATE ad_generation_jobs SET status = 'failed', error = ? WHERE id = ?");
        if ($failJob) { $failJob->bind_param('si', $failMsg, $jobId); $failJob->execute(); $failJob->close(); }
        exit;
    }
    // generate_as_image now routes through COMPOSE (Gemini background + HTML overlay),
    // which does not query the image reference store — so it is no longer required.
    agents_reconnect_mysqli_if_needed($conn);
    $agentStmt = $conn->prepare(
        "SELECT system_prompt, model, temperature, max_tokens, version
         FROM agents WHERE name = 'ADS_AGENT' AND is_active = 1 LIMIT 1"
    );
    if (!$agentStmt) { error_log('[external/generate-ads] DB error loading ADS_AGENT for job ' . $jobId); exit; }
    $agentStmt->execute();
    $agentStmt->bind_result($sysPrompt, $agentModel, $agentTemp, $agentTokens, $agentVer);
    if (!$agentStmt->fetch()) { error_log('[external/generate-ads] ADS_AGENT not found for job ' . $jobId); exit; }
    $agentStmt->close();
    $agentConfig = [
        'systemPrompt' => $sysPrompt,
        'model'        => $agentModel,
        'temperature'  => (float)$agentTemp,
        'maxTokens'    => (int)$agentTokens,
        'version'      => (int)$agentVer,
    ];

    // ── 9. Interpret: get per-format specs ───────────────────────────────

    // Interpret is a planning aid, not a hard requirement for COMPOSE (image): the
    // compose pipeline derives a brand spec from campaignData when no plan is given,
    // and each batch is a separate edge call. A transient Gemini/edge 503 here must
    // not nuke the whole image job — only the optional per-creative spec is lost.
    // HTML render genuinely needs the spec, so for that path the failure rethrows.
    $batchSpecs = [];
    try {
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
    } catch (Throwable $interpretErr) {
        if (!$generateAsImage) throw $interpretErr;
        error_log('[external/generate-ads] interpret failed (non-fatal for image/compose): ' . $interpretErr->getMessage());
        agents_reconnect_mysqli_if_needed($conn);
    }

    // ── 7. Render each batch ─────────────────────────────────────────────

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
    // total wait ≈ the slowest batch instead of the sum. HTML render stays sequential.
    $composeResults = [];
    if ($generateAsImage) {
        $composePayloads = [];
        foreach ($batches as $bIdx => $b) {
            $composePayloads[$bIdx] = [
                'mode'             => 'compose',
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

        // Compose marked 'running' in the parallel pre-pass; only the sequential HTML
        // render path marks it here.
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
                // COMPOSE: Gemini draws ONLY the background scene; the EXACT logo + typo-free
                // copy live in the returned HTML overlay. The bg call was fired in parallel
                // above — read its result here.
                $cr = $composeResults[$batchIdx] ?? null;
                if (!$cr || empty($cr['ok'])) {
                    throw new RuntimeException('Compose call failed for batch ' . $batchIdx . ': ' . (string)($cr['error'] ?? 'no result'));
                }
                $composeResult = is_array($cr['data'] ?? null) ? $cr['data'] : [];

                $banners = is_array($composeResult['banners'] ?? null) ? $composeResult['banners'] : [];
                if (empty($banners)) {
                    throw new RuntimeException("No compose banners returned for batch {$batchIdx}");
                }
                $expectedCount = ext_expected_creatives_for_batch($batchFmts, $campaignFormData);
                if (count($banners) > $expectedCount) {
                    error_log('[external/generate-ads] Trimming compose batch ' . $batchIdx . ' from ' . count($banners) . ' to expected ' . $expectedCount);
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

                    // Save the compose HTML and rasterize a Meta-ready banner.jpg with GD,
                    // faithfully reproducing the layout the background reserved (no browser).
                    $htmlUrl  = null;
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
                        try {
                            if (extgd_compose_html_to_jpeg($bannerHtml, $fmt, $jpgFilePath)) {
                                $imageUrl = '/projects/' . $creativeRelPath . '/banner.jpg';
                            }
                        } catch (Throwable $gdErr) {
                            error_log('[external/generate-ads] GD compose failed for creative ' . $creativeId . ': ' . $gdErr->getMessage());
                        }
                    }
                    $absoluteImageUrl = ext_absolute_public_url($imageUrl);
                    $absoluteHtmlUrl  = ext_absolute_public_url($htmlUrl);

                    $allCreatives[] = [
                        'id'        => $creativeId,
                        'platform'  => $platform,
                        'format'    => $fmtName,
                        'label'     => $fmtLabel,
                        'width'     => $fmtW,
                        'height'    => $fmtH,
                        'image_url' => $absoluteImageUrl,
                        'html_url'  => $absoluteHtmlUrl,
                        'type'      => $absoluteImageUrl ? 'image/jpeg' : 'text/html',
                        'variant'   => $variant ?: null,
                    ];
                    $savedCount++;
                }

                if ($savedCount <= 0) {
                    throw new RuntimeException("No compose creatives saved for batch {$batchIdx}");
                }

                agents_reconnect_mysqli_if_needed($conn);
                $updDone = $conn->prepare(
                    "UPDATE ad_generation_job_batches
                     SET status = 'completed', saved_count = ?
                     WHERE job_id = ? AND batch_index = ?"
                );
                if ($updDone) {
                    $updDone->bind_param('iii', $savedCount, $jobId, $batchIdx);
                    $updDone->execute();
                    $updDone->close();
                }
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

            // Use snippets[] from response (added to edge function), fallback to DOMDocument parse
            $snippets = is_array($renderResult['snippets'] ?? null) ? $renderResult['snippets'] : [];
            if (empty($snippets)) {
                $banners = ext_extract_banners_from_html((string)($renderResult['html'] ?? ''), $batchFmts);
                foreach ($banners as $b) $snippets[] = $b['html'];
            }

            if (empty($snippets)) {
                throw new RuntimeException("No banners extracted for batch {$batchIdx}");
            }
            $expectedCount = ext_expected_creatives_for_batch($batchFmts, $campaignFormData);
            if (count($snippets) > $expectedCount) {
                error_log('[external/generate-ads] Trimming HTML batch ' . $batchIdx . ' from ' . count($snippets) . ' to expected ' . $expectedCount);
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

                // Save HTML to disk and optionally render PNG
                $htmlUrl  = null;
                $imageUrl = null;
                $renderError = null;
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
                            $renderError = substr($renderErr->getMessage(), 0, 500);
                            error_log('[external/generate-ads] PNG render skipped for creative ' . $creativeId . ': ' . $renderError);
                        }
                    }
                }
                $absoluteImageUrl = ext_absolute_public_url($imageUrl);
                $absoluteHtmlUrl = ext_absolute_public_url($htmlUrl);
                $imageIsJpeg = $absoluteImageUrl !== '' && preg_match('~\.jpe?g$~i', (string)$imageUrl);

                $allCreatives[] = [
                    'id'        => $creativeId,
                    'platform'  => $platform,
                    'format'    => $fmtName,
                    'label'     => $fmtLabel,
                    'width'     => $fmtW,
                    'height'    => $fmtH,
                    'image_url' => $absoluteImageUrl,
                    'html_url'  => $absoluteHtmlUrl,
                    'type'      => $absoluteImageUrl ? ($imageIsJpeg ? 'image/jpeg' : 'image/png') : 'html_available',
                    'render_error' => $renderError,
                ];
                $savedCount++;
            }

            if ($savedCount <= 0) {
                throw new RuntimeException("No HTML creatives saved for batch {$batchIdx}");
            }

            agents_reconnect_mysqli_if_needed($conn);
            $updDone = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'completed', saved_count = ?
                 WHERE job_id = ? AND batch_index = ?"
            );
            if ($updDone) {
                $updDone->bind_param('iii', $savedCount, $jobId, $batchIdx);
                $updDone->execute();
                $updDone->close();
            }
            $completedBatches++;

        } catch (Throwable $batchErr) {
            error_log('[external/generate-ads] Batch ' . $batchIdx . ' error: ' . $batchErr->getMessage());
            $errMsg = substr($batchErr->getMessage(), 0, 500);
            $batchErrors[] = [
                'batch_index' => $batchIdx,
                'label'       => $batchLabel,
                'error'       => $errMsg,
            ];
            agents_reconnect_mysqli_if_needed($conn);
            $updF = $conn->prepare(
                "UPDATE ad_generation_job_batches
                 SET status = 'failed', error = ?
                 WHERE job_id = ? AND batch_index = ?"
            );
            if ($updF) { $updF->bind_param('sii', $errMsg, $jobId, $batchIdx); $updF->execute(); $updF->close(); }
            $failedBatches++;
        }
    }

    // ── 8. Finalize job ──────────────────────────────────────────────────

    $jobStatus = ($failedBatches === 0 && $completedBatches > 0) ? 'completed' : ($completedBatches > 0 ? 'completed' : 'failed');
    $jobError = !empty($batchErrors) ? json_encode($batchErrors, JSON_UNESCAPED_UNICODE) : null;
    agents_reconnect_mysqli_if_needed($conn);
    $updJob = $conn->prepare(
        "UPDATE ad_generation_jobs
         SET status = ?, completed_batches = ?, failed_batches = ?, error = ?
         WHERE id = ?"
    );
    if ($updJob) {
        $updJob->bind_param('siisi', $jobStatus, $completedBatches, $failedBatches, $jobError, $jobId);
        $updJob->execute();
        $updJob->close();
    }

    // Job finalizado — resposta já foi enviada via 202. Cliente obtém resultado via job-status.php.

} catch (Throwable $e) {
    error_log('[external/generate-ads] ' . $e->getMessage());
    if ($jobId > 0 && isset($conn) && $conn instanceof mysqli) {
        try {
            agents_reconnect_mysqli_if_needed($conn);
            $errMsg = substr($e->getMessage(), 0, 500);
            $failStmt = $conn->prepare(
                "UPDATE ad_generation_jobs
                 SET status = 'failed', error = ?, updated_at = NOW()
                 WHERE id = ?"
            );
            if ($failStmt) {
                $failStmt->bind_param('si', $errMsg, $jobId);
                $failStmt->execute();
                $failStmt->close();
            }
        } catch (Throwable $inner) {
            error_log('[external/generate-ads] failed to mark job as failed: ' . $inner->getMessage());
        }
    }
    if ($jobId === 0) {
        // Error before job creation — can still send HTTP error
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
    // If jobId > 0, 202 was already sent. Client will see status='failed' when polling.
}
