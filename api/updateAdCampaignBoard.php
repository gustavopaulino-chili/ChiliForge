<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['project_id']) || !isset($data['user_id']) || !isset($data['html'])) {
    http_response_code(400);
    echo json_encode(["error" => "Missing required data"]);
    exit;
}

$projectId = (int)$data['project_id'];
$userId = (int)$data['user_id'];
$html = strip_editor_bridge_artifacts((string)$data['html']);

function rewrite_project_asset_refs_for_ad_board(string $content, string $projectPublicUrl): string {
    $projectPrefix = preg_replace('/\/index\.html$/i', '/', trim($projectPublicUrl));
    if ($projectPrefix === '') {
        return $content;
    }
    if (!str_ends_with($projectPrefix, '/')) {
        $projectPrefix .= '/';
    }

    $projectPath = parse_url($projectPrefix, PHP_URL_PATH);
    $projectPath = is_string($projectPath) && $projectPath !== '' ? $projectPath : $projectPrefix;
    if (!str_starts_with($projectPath, '/')) {
        $projectPath = '/' . $projectPath;
    }
    if (!str_ends_with($projectPath, '/')) {
        $projectPath .= '/';
    }

    $assetPath = preg_quote(ltrim($projectPath, '/') . 'assets/', '/');
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/' . $assetPath . '/i', 'assets/', $content);
    $content = str_replace([
        $projectPath . 'assets/',
        ltrim($projectPath, '/') . 'assets/',
    ], 'assets/', $content);
    $content = preg_replace('/https?:\/\/[^"\'\s)]+\/projects\/(?:[^\/"\'\s)]+\/)+assets\//i', 'assets/', $content);
    $content = preg_replace('/(?<![\w:])\/?projects\/(?:[^\/"\'\s)]+\/)+assets\//i', 'assets/', $content);

    return is_string($content) ? $content : '';
}

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid identifiers"]);
    exit;
}

include "db.php";

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.project_type');
if (!$projectRow) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}

$projectType = (string)($projectRow['project_type'] ?? '');
if ($projectType !== 'ad_creative' && $projectType !== 'project') {
    http_response_code(400);
    echo json_encode(["error" => "This endpoint only saves ad campaign boards"]);
    $conn->close();
    exit;
}

// Ad projects store public_url in ads_campaign, not lps
$publicUrl = '';
$acStmt = $conn->prepare("SELECT public_url FROM ads_campaign WHERE project_id = ? ORDER BY id DESC LIMIT 1");
if ($acStmt) {
    $acStmt->bind_param("i", $projectId);
    $acStmt->execute();
    $acStmt->bind_result($acPublicUrl);
    if ($acStmt->fetch()) {
        $publicUrl = (string)($acPublicUrl ?? '');
    }
    $acStmt->close();
}
$folderPath = '';
if ($publicUrl !== '') {
    $path = trim((string)(parse_url($publicUrl, PHP_URL_PATH) ?? ''), '/');
    $folderPath = $path !== '' ? '/public/' . $path : '';
}
$writeWarning = null;
$html = rewrite_project_asset_refs_for_ad_board($html, $publicUrl);

try {
    $projectDir = resolve_project_directory_from_folder_path($folderPath, $publicUrl);
    ensure_directory($projectDir);
    file_put_contents($projectDir . DIRECTORY_SEPARATOR . 'index.html', $html);
} catch (Throwable $error) {
    $writeWarning = $error->getMessage();
}

echo json_encode([
    "success" => $writeWarning === null,
    "id" => $projectId,
    "url" => $publicUrl,
    "warning" => $writeWarning,
]);

$conn->close();
?>
