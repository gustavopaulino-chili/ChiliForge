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

// Ownership: allow access when the creative's project is owned directly by the user
// OR when it belongs to a child project linked to one of the user's company projects.
// This MUST match getAdCreatives.php (the board) — otherwise creatives that show on
// the board (via company linkage) would 404 when opened in the editor.
$stmt = $conn->prepare(
    "SELECT c.id, c.project_id, c.campaign_id, c.name, c.platform, c.format, c.label, c.width, c.height, c.generated_html, c.public_url, c.sort_order, c.metadata, p.user_id, a.form_data
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     LEFT JOIN ads_campaign a ON a.id = c.campaign_id
     WHERE c.id = ? AND (
        p.user_id = ?
        OR p.company_project_id IN (SELECT id FROM projects WHERE user_id = ? AND project_type = 'project')
     )
     LIMIT 1"
);

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Tabela ads_creatives nao encontrada. Execute o SQL de migracao.", "details" => $conn->error]);
    $conn->close();
    exit;
}

$stmt->bind_param("iii", $creativeId, $userId, $userId);
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
