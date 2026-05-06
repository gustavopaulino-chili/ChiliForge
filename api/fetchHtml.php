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

echo json_encode([
    'html'     => $body,
    'finalUrl' => $finalUrl,
    'status'   => $httpCode,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
