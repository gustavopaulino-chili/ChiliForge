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

if (!isset($_GET['user_id'])) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuário é obrigatório"]);
    exit;
}

$user_id = (int)$_GET['user_id'];
$user_email = isset($_GET['user_email']) ? trim((string)$_GET['user_email']) : '';

if ($user_id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuário inválido"]);
    exit;
}

include "db.php";

if ($user_email !== '' && filter_var($user_email, FILTER_VALIDATE_EMAIL)) {
    $stmt = $conn->prepare("SELECT p.id, p.name, p.public_url, p.folder_path, p.form_data, p.generated_html, p.current_step, p.created_at FROM projects p LEFT JOIN users u ON u.id = p.user_id WHERE p.user_id = ? OR LOWER(u.email) = LOWER(?) ORDER BY p.id DESC");
    $stmt->bind_param("is", $user_id, $user_email);
} else {
    $stmt = $conn->prepare("SELECT id, name, public_url, folder_path, form_data, generated_html, current_step, created_at FROM projects WHERE user_id = ? ORDER BY id DESC");
    $stmt->bind_param("i", $user_id);
}

$stmt->execute();
$stmt->store_result();
$stmt->bind_result($projectId, $projectName, $projectUrl, $projectPath, $projectFormData, $projectGeneratedHtml, $projectCurrentStep, $projectCreatedAt);

$projects = [];

while ($stmt->fetch()) {
    $projects[] = [
        "id" => $projectId,
        "name" => $projectName,
        "public_url" => $projectUrl,
        "folder_path" => $projectPath,
        "form_data" => json_decode((string)($projectFormData ?? '{}'), true),
        "generated_html" => $projectGeneratedHtml,
        "currentStep" => (int)$projectCurrentStep,
        "created_at" => $projectCreatedAt,
    ];
}

echo json_encode($projects);

$stmt->close();
$conn->close();
?>
