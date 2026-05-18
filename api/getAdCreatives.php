<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$projectId = isset($_GET['project_id']) ? (int)$_GET['project_id'] : 0;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if ($projectId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "project_id e user_id sao obrigatorios"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "SELECT c.id, c.project_id, c.campaign_id, c.name, c.platform, c.format, c.label, c.width, c.height, c.public_url, c.sort_order, c.created_at, c.updated_at
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     WHERE c.project_id = ? AND p.user_id = ?
     ORDER BY c.campaign_id DESC, c.sort_order ASC, c.id ASC"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Tabela ads_creatives nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("ii", $projectId, $userId);
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($id, $rowProjectId, $campaignId, $name, $platform, $format, $label, $width, $height, $publicUrl, $sortOrder, $createdAt, $updatedAt);

$creatives = [];
while ($stmt->fetch()) {
    $creatives[] = [
        "id" => (int)$id,
        "creative_id" => (int)$id,
        "project_id" => (int)$rowProjectId,
        "campaign_id" => (int)$campaignId,
        "name" => $name,
        "platform" => $platform,
        "format" => $format,
        "label" => $label,
        "width" => (int)$width,
        "height" => (int)$height,
        "public_url" => $publicUrl,
        "url" => $publicUrl,
        "sort_order" => (int)$sortOrder,
        "created_at" => $createdAt,
        "updated_at" => $updatedAt,
    ];
}

echo json_encode([
    "success" => true,
    "creatives" => $creatives,
]);

$stmt->close();
$conn->close();
?>
