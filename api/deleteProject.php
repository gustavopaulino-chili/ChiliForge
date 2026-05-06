<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["id"])) {
    http_response_code(400);
    echo json_encode(["error" => "ID do projeto é obrigatório"]);
    exit;
}

$id = (int)$data["id"];

if ($id <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "ID do projeto inválido"]);
    exit;
}

include "db.php";

$select = $conn->prepare("SELECT folder_path FROM projects WHERE id = ?");
$select->bind_param("i", $id);
$select->execute();
$select->bind_result($folderPath);
$select->fetch();
$select->close();

$stmt = $conn->prepare("DELETE FROM projects WHERE id = ?");
$stmt->bind_param("i", $id);

if ($stmt->execute()) {
    if ($stmt->affected_rows > 0) {
        if ($folderPath) {
            $projectRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
            $normalizedFolder = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($folderPath, '/\\'));
            $absoluteFolder = $projectRoot . DIRECTORY_SEPARATOR . $normalizedFolder;

            if (is_dir($absoluteFolder)) {
                $iterator = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($absoluteFolder, FilesystemIterator::SKIP_DOTS),
                    RecursiveIteratorIterator::CHILD_FIRST
                );

                foreach ($iterator as $item) {
                    if ($item->isDir()) {
                        @rmdir($item->getPathname());
                    } else {
                        @unlink($item->getPathname());
                    }
                }

                @rmdir($absoluteFolder);
            }
        }

        echo json_encode(["success" => true]);
    } else {
        http_response_code(404);
        echo json_encode(["error" => "Projeto não encontrado"]);
    }
} else {
    http_response_code(500);
    echo json_encode(["error" => "Erro ao deletar projeto: " . $conn->error]);
}

$stmt->close();
$conn->close();
?>

