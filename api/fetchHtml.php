<?php
/**
 * fetchHtml.php — server-side HTML proxy for the ChiliForge scraper.
 *
 * Called by the scrape-website Supabase edge function.
 * Uses cURL on the host server (different IP, real browser headers) to bypass
 * bot-protection mechanisms that block Supabase / Deno edge IPs directly.
 *
 * Query params:
 *   url    (required) — full URL to fetch, e.g. https://example.com
 *   token  (required) — shared secret from SCRAPER_PROXY_TOKEN env/constant
 *
 * Returns JSON:
 *   { "html": "...", "finalUrl": "...", "status": 200 }   on success
 *   { "error": "..." }                                      on failure
 *
 * Security:
 *   - Token check prevents public abuse
 *   - Only http/https URLs are allowed (no file://, ftp://, etc.)
 *   - Response body capped at 2 MB to prevent memory exhaustion
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Proxy-Token");
header("Content-Type: application/json; charset=utf-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// ── Secret token ────────────────────────────────────────────────────────────
// Set SCRAPER_PROXY_TOKEN in your .env / server env, or hard-code a secret here.
// The edge function must send the same value via the `token` query param or
// X-Proxy-Token header.
$envToken = getenv('SCRAPER_PROXY_TOKEN') ?: 'CHANGE_ME_STRONG_SECRET';

$requestToken = isset($_GET['token']) ? $_GET['token']
    : (isset($_SERVER['HTTP_X_PROXY_TOKEN']) ? $_SERVER['HTTP_X_PROXY_TOKEN'] : '');

if (!hash_equals($envToken, (string) $requestToken)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// ── Target URL ───────────────────────────────────────────────────────────────
$targetUrl = isset($_GET['url']) ? trim($_GET['url']) : '';
if (!$targetUrl) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

// Only allow http/https
if (!preg_match('#^https?://#i', $targetUrl)) {
    http_response_code(400);
    echo json_encode(['error' => 'Only http/https URLs are allowed']);
    exit;
}

// Block private/localhost IPs to prevent SSRF
$host = parse_url($targetUrl, PHP_URL_HOST);
if ($host) {
    $resolved = gethostbyname($host);
    if (filter_var($resolved, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        http_response_code(400);
        echo json_encode(['error' => 'Private/reserved IP addresses are not allowed']);
        exit;
    }
}

// ── cURL fetch ───────────────────────────────────────────────────────────────
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_ENCODING       => '',          // Accept-Encoding: gzip/deflate (auto-decompress)
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control: max-age=0',
        'Upgrade-Insecure-Requests: 1',
        'Sec-Fetch-Dest: document',
        'Sec-Fetch-Mode: navigate',
        'Sec-Fetch-Site: none',
        'Sec-Fetch-User: ?1',
    ],
    // Cap response at 2 MB
    CURLOPT_NOPROGRESS     => false,
    CURLOPT_PROGRESSFUNCTION => function($resource, $downloadSize, $downloaded) {
        if ($downloaded > 2 * 1024 * 1024) {
            return 1; // abort
        }
        return 0;
    },
]);

$body     = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
$error    = curl_error($ch);
curl_close($ch);

if ($body === false || $error) {
    http_response_code(502);
    echo json_encode(['error' => 'cURL error: ' . $error]);
    exit;
}

if ($httpCode >= 400) {
    http_response_code(502);
    echo json_encode(['error' => "Target site returned HTTP $httpCode", 'status' => $httpCode]);
    exit;
}

// Ensure UTF-8 encoding
$encoding = mb_detect_encoding($body, ['UTF-8', 'ISO-8859-1', 'Windows-1252'], true);
if ($encoding && $encoding !== 'UTF-8') {
    $body = mb_convert_encoding($body, 'UTF-8', $encoding);
}

function cf_proxy_make_absolute_url($url, $baseUrl) {
    $url = trim((string)$url);
    if ($url === '' || str_starts_with($url, 'data:')) return $url;
    if (preg_match('#^https?://#i', $url)) return $url;
    if (str_starts_with($url, '//')) return 'https:' . $url;

    $base = parse_url($baseUrl);
    $origin = ($base['scheme'] ?? 'https') . '://' . ($base['host'] ?? '');
    if (str_starts_with($url, '/')) return $origin . $url;

    $path = $base['path'] ?? '/';
    $dir = preg_replace('#/[^/]*$#', '/', $path);
    return $origin . rtrim((string)$dir, '/') . '/' . ltrim($url, '/');
}

function cf_proxy_safe_public_url($url) {
    if (!preg_match('#^https?://#i', (string)$url)) return false;
    $host = parse_url((string)$url, PHP_URL_HOST);
    if (!$host) return false;
    $resolved = gethostbyname($host);
    return filter_var($resolved, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function cf_proxy_extract_image_candidates_for_palette($html, $baseUrl) {
    $candidates = [];
    $add = function ($url, $score) use (&$candidates, $baseUrl) {
        $absolute = cf_proxy_make_absolute_url($url, $baseUrl);
        if (!$absolute || !cf_proxy_safe_public_url($absolute)) return;
        if (preg_match('#\.(?:svg|ico)(?:[?#].*)?$#i', $absolute)) return;
        $candidates[$absolute] = max($candidates[$absolute] ?? 0, $score);
    };

    foreach ([
        'property' => ['og:image' => 42],
        'name' => ['twitter:image' => 40],
    ] as $attr => $items) {
        foreach ($items as $value => $score) {
            $escaped = preg_quote($value, '#');
            if (preg_match('#<meta\b[^>]*\b' . $attr . '\s*=\s*["\']' . $escaped . '["\'][^>]*\bcontent\s*=\s*["\']([^"\']+)["\']#i', $html, $m)
                || preg_match('#<meta\b[^>]*\bcontent\s*=\s*["\']([^"\']+)["\'][^>]*\b' . $attr . '\s*=\s*["\']' . $escaped . '["\']#i', $html, $m)) {
                $add(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5), $score);
            }
        }
    }

    if (preg_match_all('#<link\b[^>]*rel=["\'][^"\']*(?:apple-touch-icon|icon)[^"\']*["\'][^>]*href=["\']([^"\']+)["\']#i', $html, $links)) {
        foreach ($links[1] as $href) $add(html_entity_decode($href, ENT_QUOTES | ENT_HTML5), 44);
    }

    if (preg_match_all('#<img\b[^>]*>#i', $html, $tags)) {
        foreach ($tags[0] as $tag) {
            $score = preg_match('/logo|brand|marca|logotipo|custom-logo|site-logo|navbar-brand|itemprop=["\']logo["\']/i', $tag) ? 72 : 18;
            if (!preg_match('/\b(?:src|data-src|data-lazy-src|data-original)\s*=\s*["\']([^"\']+)["\']/i', $tag, $src)) continue;
            $add(html_entity_decode($src[1], ENT_QUOTES | ENT_HTML5), $score);
        }
    }

    arsort($candidates);
    return array_slice(array_keys($candidates), 0, 6);
}

function cf_proxy_fetch_binary_asset($url) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'Mozilla/5.0 ChiliForgeColorSampler/1.0',
        CURLOPT_HTTPHEADER => ['Accept: image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'],
        CURLOPT_NOPROGRESS => false,
        CURLOPT_PROGRESSFUNCTION => function($resource, $downloadSize, $downloaded) {
            return $downloaded > 1536 * 1024 ? 1 : 0;
        },
    ]);
    $body = curl_exec($ch);
    $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $ok = $body !== false && (int)curl_getinfo($ch, CURLINFO_HTTP_CODE) < 400;
    curl_close($ch);
    return $ok && is_string($body) && str_starts_with(strtolower((string)$type), 'image/') ? $body : '';
}

function cf_proxy_is_neutral_rgb($r, $g, $b) {
    if ($r > 238 && $g > 238 && $b > 238) return true;
    if ($r < 18 && $g < 18 && $b < 18) return true;
    $max = max($r, $g, $b);
    $min = min($r, $g, $b);
    return (($max - $min) / max(1, $max)) < 0.12;
}

function cf_proxy_palette_from_image_body($body) {
    if (!function_exists('imagecreatefromstring') || !function_exists('imagecolorat')) return [];
    $img = @imagecreatefromstring($body);
    if (!$img) return [];

    $w = imagesx($img);
    $h = imagesy($img);
    if ($w <= 0 || $h <= 0) {
        imagedestroy($img);
        return [];
    }

    $step = max(1, (int)floor(max($w, $h) / 80));
    $buckets = [];
    for ($y = 0; $y < $h; $y += $step) {
        for ($x = 0; $x < $w; $x += $step) {
            $rgb = imagecolorat($img, $x, $y);
            if ($rgb === false) continue;

            if (imageistruecolor($img)) {
                $alpha = ($rgb & 0x7F000000) >> 24;
                if ($alpha > 110) continue;
                $r = ($rgb >> 16) & 0xFF;
                $g = ($rgb >> 8) & 0xFF;
                $b = $rgb & 0xFF;
            } else {
                $colors = imagecolorsforindex($img, $rgb);
                $alpha = (int)($colors['alpha'] ?? 0);
                if ($alpha > 110) continue;
                $r = (int)$colors['red'];
                $g = (int)$colors['green'];
                $b = (int)$colors['blue'];
            }

            if (cf_proxy_is_neutral_rgb($r, $g, $b)) continue;

            $qr = max(0, min(255, (int)(round($r / 24) * 24)));
            $qg = max(0, min(255, (int)(round($g / 24) * 24)));
            $qb = max(0, min(255, (int)(round($b / 24) * 24)));
            $key = sprintf('#%02x%02x%02x', $qr, $qg, $qb);
            $buckets[$key] = ($buckets[$key] ?? 0) + 1;
        }
    }

    imagedestroy($img);
    arsort($buckets);
    return array_slice(array_keys($buckets), 0, 5);
}

function cf_proxy_extract_pixel_palette($html, $baseUrl) {
    $palette = [];
    foreach (cf_proxy_extract_image_candidates_for_palette($html, $baseUrl) as $imageUrl) {
        $body = cf_proxy_fetch_binary_asset($imageUrl);
        if ($body === '') continue;
        foreach (cf_proxy_palette_from_image_body($body) as $color) {
            $palette[$color] = ($palette[$color] ?? 0) + 1;
        }
        if (count($palette) >= 8) break;
    }
    arsort($palette);
    return array_slice(array_keys($palette), 0, 8);
}

$pixelPalette = cf_proxy_extract_pixel_palette($body, $finalUrl ?: $targetUrl);

echo json_encode([
    'html'     => $body,
    'finalUrl' => $finalUrl,
    'status'   => $httpCode,
    'pixelPalette' => $pixelPalette,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
