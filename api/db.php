<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);


$host = getenv('DB_HOST') ?: 'localhost';
$user = getenv('DB_USER') ?: 'u427845891_forge_admin';
$pass = getenv('DB_PASS') ?: 'ChiliForge2026@';
$db   = getenv('DB_NAME') ?: 'u427845891_chiliforge';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    http_response_code(500);
    die(json_encode([
        "error" => "Database connection error",
        "details" => $conn->connect_error,
        "host" => $host,
        "database" => $db
    ]));
}
$conn->set_charset("utf8mb4");
// Prevent "MySQL server has gone away" on long-running requests (edge functions can take ~5 min)
$conn->query("SET SESSION wait_timeout = 28800");
$conn->query("SET SESSION interactive_timeout = 28800");
$conn->query("SET SESSION net_read_timeout = 300");
$conn->query("SET SESSION net_write_timeout = 300");
?>
