<?php
/**
 * testFtp.php — diagnostic only, remove after debugging
 * Usage: GET /api/testFtp.php?host=ftp.exemplo.com&port=21&user=ftpuser&pass=senha
 */
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
set_time_limit(30);

$host = isset($_GET['host']) ? trim($_GET['host']) : '';
$port = isset($_GET['port']) ? (int)$_GET['port'] : 21;

// Strip protocol prefix if user included it (e.g. "ftp://host" → "host")
$host = preg_replace('#^ftps?://#i', '', $host);
$user = isset($_GET['user']) ? trim($_GET['user']) : '';
$pass = isset($_GET['pass']) ? (string)$_GET['pass'] : '';

if ($host === '' || $user === '' || $pass === '') {
    echo json_encode(["error" => "Pass host, port, user, pass as query params"]);
    exit;
}

$result = [
    "ftp_connect_available"     => function_exists('ftp_connect'),
    "ftp_ssl_connect_available" => function_exists('ftp_ssl_connect'),
    "max_execution_time"        => ini_get('max_execution_time'),
    "memory_limit"              => ini_get('memory_limit'),
    "host"                      => $host,
    "port"                      => $port,
];

if (!function_exists('ftp_connect')) {
    $result['error'] = 'FTP extension not available';
    echo json_encode($result);
    exit;
}

// Try FTPS first
$conn = null;
if (function_exists('ftp_ssl_connect')) {
    $conn = @ftp_ssl_connect($host, $port, 8);
    $result['ftps_connect'] = ($conn !== false) ? 'ok' : 'failed';
}
if (!$conn) {
    $conn = @ftp_connect($host, $port, 8);
    $result['ftp_connect'] = ($conn !== false) ? 'ok' : 'failed (connection refused or timed out)';
}

if (!$conn) {
    $result['verdict'] = 'Cannot connect to FTP. Hostinger may be blocking outbound FTP connections.';
    echo json_encode($result);
    exit;
}

$login = @ftp_login($conn, $user, $pass);
$result['login'] = $login ? 'ok' : 'failed (wrong user/password)';

if ($login) {
    @ftp_pasv($conn, true);
    $list = @ftp_nlist($conn, '.');
    $result['remote_ls'] = is_array($list) ? $list : 'failed';
    $result['verdict'] = 'FTP connection successful!';
} else {
    $result['verdict'] = 'Connected but login failed.';
}

@ftp_close($conn);
echo json_encode($result, JSON_PRETTY_PRINT);
