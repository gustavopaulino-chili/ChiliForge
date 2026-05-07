<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["user_id"]) || !isset($data["name"]) || !isset($data["form_data"])) {
    http_response_code(400);
    echo json_encode(["error" => "Dados obrigatórios faltando"]);
    exit;
}

$user_id = (int)$data["user_id"];
$name = trim($data["name"]);
$form_data = json_encode($data["form_data"], JSON_UNESCAPED_UNICODE);
$generated_html = isset($data["generated_html"]) ? $data["generated_html"] : "";

if ($user_id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID de usuário inválido"]);
    exit;
}

if (strlen($name) < 1 || strlen($name) > 255) {
    http_response_code(400);
    echo json_encode(["error" => "Nome deve ter entre 1 e 255 caracteres"]);
    exit;
}

if (!$form_data) {
    http_response_code(400);
    echo json_encode(["error" => "Dados do formulário inválidos"]);
    exit;
}

include "db.php";

$public_url = "";
$folder_path = "";
$current_step = isset($data["current_step"]) ? (int)$data["current_step"] : 0;
$stmt = $conn->prepare("INSERT INTO projects (user_id, name, public_url, folder_path, form_data, generated_html, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
$stmt->bind_param("isssssi", $user_id, $name, $public_url, $folder_path, $form_data, $generated_html, $current_step);

if ($stmt->execute()) {
    $project_id = $conn->insert_id;
    $slug = 'site-' . $project_id;
    $public_url = "/projects/" . $slug . "/";
    $folder_path = "/public/projects/" . $slug;

    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $projectPath = $sitesBasePath . DIRECTORY_SEPARATOR . $slug;
    ensure_directory($projectPath);

    if (is_string($generated_html) && trim($generated_html) !== '') {
        file_put_contents($projectPath . DIRECTORY_SEPARATOR . 'index.html', (string)$generated_html);
    }

    $update = $conn->prepare("UPDATE projects SET public_url = ?, folder_path = ? WHERE id = ?");
    $update->bind_param("ssi", $public_url, $folder_path, $project_id);
    if (!$update->execute()) {
        error_log("UPDATE failed: " . $update->error);
    }
    $update->close();

    echo json_encode([
        "success" => true,
        "id" => $project_id,
        "public_url" => $public_url,
        "folder_path" => $folder_path,
        "message" => "Projeto salvo com sucesso"
    ]);
} else {
    http_response_code(500);
    error_log("INSERT failed: " . $stmt->error);
    echo json_encode([
        "error" => "Erro ao salvar projeto",
        "details" => $stmt->error
    ]);
}

$stmt->close();
$conn->close();
?>
