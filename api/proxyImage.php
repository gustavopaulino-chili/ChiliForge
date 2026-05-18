<?php
/**
 * Server-side image proxy — fetches external images without CORS restrictions.
 * Used by the ad creative export flow to inline images that block CORS.
 * Security: only fetches image/* content types, blocks private IPs (SSRF protection).
 */
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

$url = trim((string)($_GET['url'] ?? ''));

if ($url === '' || !preg_match('/^https?:\/\//i', $url)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing or invalid url parameter']);
    exit;
}

// SSRF protection — block private / loopback address ranges
$host = strtolower(parse_url($url, PHP_URL_HOST) ?? '');
$blocked = [
    '/^localhost$/i',
    '/^127\./i',
    '/^10\./i',
    '/^172\.(1[6-9]|2[0-9]|3[01])\./i',
    '/^192\.168\./i',
    '/^::1$/',
    '/^0\.0\.0\.0$/i',
];
foreach ($blocked as $pattern) {
    if (preg_match($pattern, $host)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Forbidden host']);
        exit;
    }
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'cURL not available']);
    exit;
}

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 12,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; ChiliForge/1.0; +image-proxy)',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HEADER         => false,
]);

$body        = curl_exec($ch);
$httpCode    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlError   = curl_error($ch);
curl_close($ch);

if ($body === false || $curlError !== '') {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Upstream fetch failed: ' . $curlError]);
    exit;
}

if ($httpCode < 200 || $httpCode >= 400) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => "Upstream returned HTTP $httpCode"]);
    exit;
}

// Only allow image/* and font/* content types — reject HTML, JS, etc.
$mime = strtolower(explode(';', $contentType)[0]);
$allowed = ['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml','image/avif','font/woff','font/woff2','font/ttf','font/otf','application/font-woff','application/octet-stream'];
if (!in_array($mime, $allowed, true) && !str_starts_with($mime, 'image/') && !str_starts_with($mime, 'font/')) {
    http_response_code(415);
    header('Content-Type: application/json');
    echo json_encode(['error' => "Content-type not allowed: $mime"]);
    exit;
}

header('Content-Type: ' . $contentType);
header('Cache-Control: public, max-age=3600');
header('Content-Length: ' . strlen($body));
echo $body;
