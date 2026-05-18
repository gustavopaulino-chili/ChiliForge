<?php
// Shared headless-browser rendering utilities.
// Used by downloadAdCreativesZip.php and api/v1/ads/generate.php.

function command_exists($command) {
    if (!function_exists('exec')) return false;
    $where = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN' ? 'where' : 'command -v';
    $output = [];
    $status = 1;
    @exec($where . ' ' . escapeshellarg($command) . ' 2>&1', $output, $status);
    return $status === 0 && !empty($output);
}

function find_browser_binary() {
    $candidates = [
        'chromium-browser',
        'chromium',
        'google-chrome-stable',
        'google-chrome',
        'chrome',
        'microsoft-edge',
        'msedge',
    ];

    foreach ($candidates as $candidate) {
        if (command_exists($candidate)) return $candidate;
    }

    $windowsCandidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    foreach ($windowsCandidates as $candidate) {
        if (is_file($candidate)) return $candidate;
    }

    return '';
}

function path_to_file_url($path) {
    $real = realpath($path);
    if ($real === false) {
        throw new RuntimeException('HTML file was not found for rendering.');
    }
    $normalized = str_replace(DIRECTORY_SEPARATOR, '/', $real);
    $segments = explode('/', $normalized);
    $encoded = implode('/', array_map('rawurlencode', $segments));
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        $encoded = preg_replace('/^([A-Za-z])%3A/', '$1:', $encoded);
        return 'file:///' . $encoded;
    }
    return 'file://' . $encoded;
}

function render_url_to_png($browserBinary, $targetUrl, $outputPng, $width, $height) {
    if (!function_exists('exec')) {
        throw new RuntimeException('HTML to image conversion requires exec() to be enabled on the server.');
    }
    if ($browserBinary === '') {
        throw new RuntimeException('No headless browser found. Install Chrome, Chromium, or Edge on the server to export creatives as images.');
    }

    $width     = max(1, min(4096, (int)$width));
    $height    = max(1, min(4096, (int)$height));
    $targetUrl = trim((string)$targetUrl);
    if ($targetUrl === '') {
        throw new RuntimeException('Creative URL is empty.');
    }

    $baseCommand = escapeshellarg($browserBinary)
        . ' --disable-gpu'
        . ' --no-sandbox'
        . ' --hide-scrollbars'
        . ' --disable-dev-shm-usage'
        . ' --force-device-scale-factor=1'
        . ' --default-background-color=00000000'
        . ' --run-all-compositor-stages-before-draw'
        . ' --disable-web-security'
        . ' --allow-running-insecure-content'
        . ' --virtual-time-budget=10000'
        . ' --window-size=' . $width . ',' . $height
        . ' --screenshot=' . escapeshellarg($outputPng)
        . ' ' . escapeshellarg($targetUrl)
        . ' 2>&1';

    $lastOutput = [];
    $lastStatus = 1;
    foreach ([' --headless=new', ' --headless'] as $headlessFlag) {
        @unlink($outputPng);
        $output = [];
        $status = 1;
        @exec(escapeshellarg($browserBinary) . $headlessFlag . substr($baseCommand, strlen(escapeshellarg($browserBinary))), $output, $status);
        $lastOutput = $output;
        $lastStatus = $status;
        if ($status === 0 && is_file($outputPng) && filesize($outputPng) > 0) return;
    }

    throw new RuntimeException('Failed to render creative image: ' . trim(implode("\n", $lastOutput)) . ' (status ' . $lastStatus . ')');
}

function render_html_to_png($browserBinary, $htmlFile, $outputPng, $width, $height) {
    render_url_to_png($browserBinary, path_to_file_url($htmlFile), $outputPng, $width, $height);
}

function normalize_public_render_url($publicUrl) {
    $url = trim((string)$publicUrl);
    if ($url === '') return '';
    if (!preg_match('~^https?://~i', $url)) {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host   = $_SERVER['HTTP_HOST'] ?? '';
        if ($host !== '') {
            $url = $scheme . '://' . $host . '/' . ltrim($url, '/');
        }
    }
    if (preg_match('~/$~', $url)) return $url . 'index.html';
    if (!preg_match('~/[^/?#]+\.html(?:[?#].*)?$~i', $url)) return rtrim($url, '/') . '/index.html';
    return $url;
}
