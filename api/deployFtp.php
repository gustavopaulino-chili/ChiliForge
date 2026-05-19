<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

// FTP upload can take a while — override default 30s limit
set_time_limit(180);
ini_set('max_execution_time', '180');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
include "db.php";

// ── Input validation ──────────────────────────────────────────────────────────

$data = json_decode(file_get_contents("php://input"), true);

if (!$data) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON body"]);
    exit;
}

$projectId   = isset($data['project_id'])   ? (int)$data['project_id']             : 0;
$userId      = isset($data['user_id'])      ? (int)$data['user_id']                : 0;
$serverId    = isset($data['server_id'])    ? (int)$data['server_id']              : 0;
$ftpHost     = isset($data['ftp_host'])     ? trim((string)$data['ftp_host'])      : '';
$ftpPort     = isset($data['ftp_port'])     ? (int)$data['ftp_port']               : 21;

$ftpUser     = isset($data['ftp_username']) ? trim((string)$data['ftp_username'])  : '';
$ftpPass     = isset($data['ftp_password']) ? (string)$data['ftp_password']        : '';
$targetDir   = isset($data['target_dir'])   ? trim((string)$data['target_dir'])    : '/';
$projectSlug = isset($data['project_slug']) ? trim((string)$data['project_slug'])  : '';

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "project_id and user_id are required"]);
    exit;
}

// If server_id is provided, load host/port/username/target_dir from the saved server
if ($serverId > 0) {
    $s = $conn->prepare(
        "SELECT host, port, username, target_dir FROM ftp_servers WHERE id=? AND user_id=? LIMIT 1"
    );
    $s->bind_param("ii", $serverId, $userId);
    $s->execute();
    $s->bind_result($dbHost, $dbPort, $dbUser, $dbDir);
    $found = $s->fetch();
    $s->close();
    if (!$found) {
        $conn->close();
        http_response_code(404);
        echo json_encode(["error" => "Saved FTP server not found"]);
        exit;
    }
    $ftpHost   = $dbHost;
    $ftpPort   = (int)$dbPort;
    $ftpUser   = $dbUser;
    $targetDir = $dbDir;
    // Allow overriding the saved target_dir when user browsed and selected a different folder
    if (isset($data['target_dir_override']) && trim((string)$data['target_dir_override']) !== '') {
        $targetDir = trim((string)$data['target_dir_override']);
    }
}

// Strip protocol prefix regardless of source (form input or saved in DB)
$ftpHost = preg_replace('#^ftps?://#i', '', $ftpHost);

if ($ftpHost === '' || $ftpUser === '' || $ftpPass === '') {
    http_response_code(400);
    echo json_encode(["error" => "ftp_host, ftp_username, and ftp_password are required"]);
    exit;
}

if ($ftpPort < 1 || $ftpPort > 65535) {
    $ftpPort = 21;
}

// Normalise target directory — always ends with /
$targetDir = rtrim($targetDir, '/') . '/';
if ($targetDir === '/') {
    $targetDir = '/';
}

// Resolve project, including legacy rows whose original users entry was reset.
$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.id');
$conn->close();

if (!$projectRow) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    exit;
}

$folderPath = (string)($projectRow['folder_path'] ?? '');
$publicUrl = (string)($projectRow['public_url'] ?? '');

// ── Resolve local project path ────────────────────────────────────────────────

try {
    $projectPath = resolve_project_directory_from_folder_path($folderPath, $publicUrl);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Could not resolve project files: " . $e->getMessage()]);
    exit;
}

if (!is_dir($projectPath)) {
    http_response_code(404);
    echo json_encode(["error" => "Project files not found on server"]);
    exit;
}

// ── FTP connection ────────────────────────────────────────────────────────────

if (!function_exists('ftp_connect')) {
    http_response_code(500);
    echo json_encode(["error" => "FTP extension is not available on this server"]);
    exit;
}

// Try FTPS (explicit TLS) first, fall back to plain FTP
$ftpConn = null;
$usedSsl = false;

if (function_exists('ftp_ssl_connect')) {
    $ftpConn = @ftp_ssl_connect($ftpHost, $ftpPort, 10);
    if ($ftpConn !== false) {
        $usedSsl = true;
    }
}

if (!$ftpConn) {
    $ftpConn = @ftp_connect($ftpHost, $ftpPort, 10);
}

if (!$ftpConn) {
    http_response_code(502);
    echo json_encode(["error" => "Could not connect to FTP server: {$ftpHost}:{$ftpPort}. Check the host/port or ensure your hosting allows outbound FTP connections."]);
    exit;
}

// Login — intentionally not logged (password never appears in output)
$loginOk = @ftp_login($ftpConn, $ftpUser, $ftpPass);
if (!$loginOk) {
    ftp_close($ftpConn);
    http_response_code(401);
    echo json_encode(["error" => "FTP login failed — check your username and password"]);
    exit;
}

// Passive mode — required for most shared hosting
@ftp_pasv($ftpConn, true);

// ── Determine remote slug name ────────────────────────────────────────────────

$slug = $projectSlug !== ''
    ? preg_replace('/[^a-z0-9\-_\.]/i', '-', basename($projectSlug))
    : basename($projectPath);

// ── Upload helpers ────────────────────────────────────────────────────────────

/**
 * Upload the CONTENTS of $localDir into the FTP directory we are currently in.
 * Uses only relative names — no absolute paths — for maximum compatibility.
 * Returns [uploaded_count, failed_paths[]].
 */
function ftp_upload_contents($conn, $localDir): array {
    $localDir = rtrim(str_replace('\\', '/', $localDir), '/');
    $entries  = @scandir($localDir);
    if ($entries === false) return [0, []];

    $uploaded = 0;
    $failed   = [];

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') continue;

        $localPath = $localDir . '/' . $entry;

        if (is_dir($localPath)) {
            // Create subdirectory (ignore error if already exists)
            @ftp_mkdir($conn, $entry);
            if (@ftp_chdir($conn, $entry)) {
                @ftp_pasv($conn, true);
                [$u, $f] = ftp_upload_contents($conn, $localPath);
                $uploaded += $u;
                foreach ($f as $ff) {
                    $failed[] = "$entry/$ff";
                }
                // Go back up one level
                @ftp_chdir($conn, '..');
                @ftp_pasv($conn, true);
            } else {
                $failed[] = "$entry/";
            }
        } else {
            $ok = false;
            for ($attempt = 0; $attempt < 3; $attempt++) {
                if ($attempt > 0) {
                    usleep(500000); // 0.5s
                    @ftp_pasv($conn, true);
                }
                if (@ftp_put($conn, $entry, $localPath, FTP_BINARY)) {
                    $ok = true;
                    break;
                }
            }
            if ($ok) {
                $uploaded++;
            } else {
                $failed[] = $entry;
            }
        }
    }

    return [$uploaded, $failed];
}

// ── Navigate to target directory ──────────────────────────────────────────────

/**
 * Walk into each segment from the current FTP directory.
 * Does NOT create directories — only navigates into existing ones.
 */
function ftp_walk_segments($conn, array $segments): bool {
    foreach ($segments as $seg) {
        if ($seg === '' || $seg === '.') continue;
        if (!@ftp_chdir($conn, $seg)) return false;
    }
    return true;
}

$ftpHome        = (string)(@ftp_pwd($ftpConn) ?: '/');
$targetSegments = array_values(array_filter(explode('/', $targetDir)));
$navigated      = false;

// Strategy 1: walk segments relative to FTP home (most reliable on shared hosting)
if (ftp_walk_segments($ftpConn, $targetSegments)) {
    $navigated = true;
}

// Strategy 2: reset to home, strip segments already in home path, walk remainder
if (!$navigated) {
    @ftp_chdir($ftpConn, $ftpHome);
    $homeSegs  = array_values(array_filter(explode('/', $ftpHome)));
    $remaining = $targetSegments;
    $hLen      = count($homeSegs);
    $tLen      = count($targetSegments);
    if ($tLen >= $hLen && $hLen > 0) {
        $match = true;
        for ($i = 0; $i < $hLen; $i++) {
            if ($homeSegs[$i] !== $targetSegments[$i]) { $match = false; break; }
        }
        if ($match) $remaining = array_slice($targetSegments, $hLen);
    }
    if (ftp_walk_segments($ftpConn, $remaining)) {
        $navigated = true;
    }
}

// Strategy 3: try absolute path as last resort
if (!$navigated) {
    $abs = '/' . implode('/', $targetSegments);
    if (@ftp_chdir($ftpConn, $abs)) {
        $navigated = true;
    }
}

$targetDirClean = '/' . implode('/', $targetSegments);

if (!$navigated) {
    $listing = @ftp_nlist($ftpConn, '.') ?: [];
    ftp_close($ftpConn);
    http_response_code(502);
    echo json_encode([
        "error" => "Could not navigate to: {$targetDirClean} | FTP home: {$ftpHome} | Root contents: " . implode(', ', $listing),
    ]);
    exit;
}

// Create the project slug subfolder (relative, from wherever we landed)
@ftp_mkdir($ftpConn, $slug);
if (!@ftp_chdir($ftpConn, $slug)) {
    ftp_close($ftpConn);
    http_response_code(502);
    echo json_encode(["error" => "Could not create or enter project folder: $slug inside $targetDirClean"]);
    exit;
}

@ftp_pasv($ftpConn, true);

$remotePath = $targetDirClean . '/' . $slug;

// ── Upload ────────────────────────────────────────────────────────────────────

[$uploadCount, $failedFiles] = ftp_upload_contents($ftpConn, $projectPath);
ftp_close($ftpConn);

if ($uploadCount === 0 && !empty($failedFiles)) {
    http_response_code(502);
    echo json_encode(["error" => "All file uploads failed. First: " . $failedFiles[0]]);
    exit;
}

// ── Success ───────────────────────────────────────────────────────────────────

$response = [
    "success"        => true,
    "files_uploaded" => $uploadCount,
    "deployed_path"  => $remotePath,
    "secure"         => $usedSsl,
];

if (!empty($failedFiles)) {
    $response["warnings"]      = count($failedFiles) . " file(s) could not be uploaded after 3 attempts";
    $response["failed_files"]  = $failedFiles;
}

echo json_encode($response);
