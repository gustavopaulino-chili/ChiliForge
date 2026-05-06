<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

set_time_limit(30);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

$data = json_decode(file_get_contents("php://input"), true);
if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON body"]);
    exit;
}

$host     = preg_replace('#^ftps?://#i', '', trim($data['host']     ?? ''));
$port     = (int)($data['port']     ?? 21);
$username = trim($data['username'] ?? '');
$password = (string)($data['password'] ?? '');
$path     = trim($data['path']     ?? '/');

if ($host === '' || $username === '' || $password === '') {
    http_response_code(400);
    echo json_encode(["error" => "host, username, and password are required"]);
    exit;
}

if (!function_exists('ftp_connect')) {
    http_response_code(500);
    echo json_encode(["error" => "FTP extension not available on this server"]);
    exit;
}

// Connect — try FTPS first, fall back to plain FTP
$conn = null;
if (function_exists('ftp_ssl_connect')) {
    $conn = @ftp_ssl_connect($host, $port, 10);
}
if (!$conn) {
    $conn = @ftp_connect($host, $port, 10);
}
if (!$conn) {
    http_response_code(502);
    echo json_encode(["error" => "Could not connect to FTP server: {$host}:{$port}"]);
    exit;
}

if (!@ftp_login($conn, $username, $password)) {
    ftp_close($conn);
    http_response_code(401);
    echo json_encode(["error" => "FTP login failed — check your username and password"]);
    exit;
}

@ftp_pasv($conn, true);

$ftpHome = @ftp_pwd($conn) ?: '/';
if ($path === '' || $path === '.') $path = '/';

// Navigate to the requested path using segment-by-segment (reliable on shared hosting)
$segments   = array_values(array_filter(explode('/', $path)));
$navigated  = false;

// Strategy 1: absolute path
if (@ftp_chdir($conn, $path)) {
    $navigated = true;
}

// Strategy 2: walk segments from FTP home
if (!$navigated) {
    @ftp_chdir($conn, $ftpHome);
    $ok = true;
    foreach ($segments as $seg) {
        if (!@ftp_chdir($conn, $seg)) { $ok = false; break; }
    }
    if ($ok) $navigated = true;
}

if (!$navigated) {
    ftp_close($conn);
    http_response_code(502);
    echo json_encode(["error" => "Could not navigate to: $path"]);
    exit;
}

$currentPath = @ftp_pwd($conn) ?: $path;

// List only subdirectories using raw listing
$rawList = @ftp_rawlist($conn, '.') ?: [];
ftp_close($conn);

$folders = [];
foreach ($rawList as $line) {
    if ($line === '' || $line[0] !== 'd') continue;
    // Format: drwxr-xr-x  2 user group 4096 Jan  1 00:00 foldername
    $parts = preg_split('/\s+/', ltrim($line), 9);
    $name  = isset($parts[8]) ? trim($parts[8]) : '';
    if ($name === '' || $name === '.' || $name === '..') continue;
    $folders[] = $name;
}

sort($folders);

echo json_encode(['folders' => $folders, 'path' => $currentPath]);
