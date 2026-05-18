<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
header("Expires: 0");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$user_id = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
$user_email = isset($_GET['user_email']) ? trim((string)$_GET['user_email']) : '';
$has_valid_email = $user_email !== '' && filter_var($user_email, FILTER_VALIDATE_EMAIL);
$include_html = isset($_GET['include_html']) && in_array(strtolower((string)$_GET['include_html']), ['1', 'true', 'yes', 'on'], true);

if ($user_id <= 0 && !$has_valid_email) {
    http_response_code(400);
    echo json_encode(["error" => "Valid user_id or user_email is required"]);
    exit;
}

include "db.php";

$project_id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$generatedHtmlSelect = $include_html
    ? "generated_html"
    : "'' AS generated_html";
$generatedHtmlSelectPrefixed = $include_html
    ? "p.generated_html"
    : "'' AS generated_html";
$hasGeneratedHtmlSelect = "TRIM(COALESCE(generated_html, '')) <> '' AS has_generated_html";
$hasGeneratedHtmlSelectPrefixed = "TRIM(COALESCE(p.generated_html, '')) <> '' AS has_generated_html";

if ($project_id > 0 && $user_id > 0 && $has_valid_email) {
    $stmt = $conn->prepare("SELECT p.id, p.user_id, p.name, p.public_url, p.folder_path, p.form_data, {$generatedHtmlSelectPrefixed}, {$hasGeneratedHtmlSelectPrefixed}, p.current_step, p.created_at, COALESCE(p.project_type, 'landing_page') AS project_type FROM projects p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ? AND (p.user_id = ? OR LOWER(u.email) = LOWER(?))");
    $stmt->bind_param("iis", $project_id, $user_id, $user_email);
} elseif ($project_id > 0 && $user_id > 0) {
    $stmt = $conn->prepare("SELECT id, user_id, name, public_url, folder_path, form_data, {$generatedHtmlSelect}, {$hasGeneratedHtmlSelect}, current_step, created_at, COALESCE(project_type, 'landing_page') AS project_type FROM projects WHERE id = ? AND user_id = ?");
    $stmt->bind_param("ii", $project_id, $user_id);
} elseif ($user_id > 0 && $has_valid_email) {
    $stmt = $conn->prepare("SELECT p.id, p.user_id, p.name, p.public_url, p.folder_path, p.form_data, {$generatedHtmlSelectPrefixed}, {$hasGeneratedHtmlSelectPrefixed}, p.current_step, p.created_at, COALESCE(p.project_type, 'landing_page') AS project_type FROM projects p LEFT JOIN users u ON u.id = p.user_id WHERE p.user_id = ? OR LOWER(u.email) = LOWER(?) ORDER BY p.id DESC");
    $stmt->bind_param("is", $user_id, $user_email);
} elseif ($user_id > 0) {
    $stmt = $conn->prepare("SELECT id, user_id, name, public_url, folder_path, form_data, {$generatedHtmlSelect}, {$hasGeneratedHtmlSelect}, current_step, created_at, COALESCE(project_type, 'landing_page') AS project_type FROM projects WHERE user_id = ? ORDER BY id DESC");
    $stmt->bind_param("i", $user_id);
} else {
    // Fallback for legacy/inconsistent client sessions where user_id is unavailable but email is known.
    $stmt = $conn->prepare("SELECT p.id, p.user_id, p.name, p.public_url, p.folder_path, p.form_data, {$generatedHtmlSelectPrefixed}, {$hasGeneratedHtmlSelectPrefixed}, p.current_step, p.created_at, COALESCE(p.project_type, 'landing_page') AS project_type FROM projects p INNER JOIN users u ON u.id = p.user_id WHERE LOWER(u.email) = LOWER(?) ORDER BY p.id DESC");
    $stmt->bind_param("s", $user_email);
}

$stmt->execute();
$stmt->store_result();
$stmt->bind_result($projectId, $projectUserId, $projectName, $projectUrl, $projectPath, $projectFormData, $projectGeneratedHtml, $projectHasGeneratedHtml, $projectCurrentStep, $projectCreatedAt, $projectType);

$projects = [];

while ($stmt->fetch()) {
    $projects[] = [
        "id" => $projectId,
        "user_id" => (int)$projectUserId,
        "name" => $projectName,
        "public_url" => $projectUrl,
        "folder_path" => $projectPath,
        "form_data" => json_decode((string)($projectFormData ?? '{}'), true),
        "generated_html" => $include_html ? $projectGeneratedHtml : "",
        "has_generated_html" => (bool)$projectHasGeneratedHtml,
        "currentStep" => (int)$projectCurrentStep,
        "created_at" => $projectCreatedAt,
        "project_type" => $projectType ?? 'landing_page',
    ];
}

echo json_encode($projects);

$stmt->close();
$conn->close();
?>
