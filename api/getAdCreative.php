<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$creativeId = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if ($creativeId <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "id e user_id sao obrigatorios"]);
    exit;
}

include "db.php";

$stmt = $conn->prepare(
    "SELECT c.id, c.project_id, c.campaign_id, c.name, c.platform, c.format, c.label, c.width, c.height, c.generated_html, c.public_url, c.sort_order, c.metadata, p.user_id, a.form_data
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     LEFT JOIN ads_campaign a ON a.id = c.campaign_id
     WHERE c.id = ? AND p.user_id = ?
     LIMIT 1"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Tabela ads_creatives nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("ii", $creativeId, $userId);
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($id, $projectId, $campaignId, $name, $platform, $format, $label, $width, $height, $html, $publicUrl, $sortOrder, $metadata, $ownerId, $campaignFormData);

if (!$stmt->fetch()) {
    http_response_code(404);
    echo json_encode(["error" => "Criativo nao encontrado"]);
    $stmt->close();
    $conn->close();
    exit;
}

echo json_encode([
    "success" => true,
    "creative" => [
        "id" => (int)$id,
        "project_id" => (int)$projectId,
        "campaign_id" => (int)$campaignId,
        "user_id" => (int)$ownerId,
        "name" => $name,
        "platform" => $platform,
        "format" => $format,
        "label" => $label,
        "width" => (int)$width,
        "height" => (int)$height,
        "html" => $html,
        "public_url" => $publicUrl,
        "sort_order" => (int)$sortOrder,
        "metadata" => json_decode((string)($metadata ?? '{}'), true),
        "form_data" => json_decode((string)($campaignFormData ?? '{}'), true),
        "project_type" => "ad_creative_item",
    ],
]);

$stmt->close();
$conn->close();
?>
