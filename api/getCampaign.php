<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include __DIR__ . '/db.php';
require_once __DIR__ . '/v1/agents/helpers.php';

$userId     = (int)($_GET['user_id']     ?? 0);
$campaignId = (int)($_GET['campaign_id'] ?? 0);

if ($userId <= 0 || $campaignId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and campaign_id are required']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);
    agents_ensure_campaign_examples_table($conn);

    $stmt = $conn->prepare(
        "SELECT
            c.id,
            c.name,
            c.form_data,
            c.metadata,
            c.creative_plans,
            c.gemini_good_examples_store,
            c.gemini_memory_store,
            c.project_id,
            COALESCE(p.company_project_id, p.id) AS company_project_id,
            company.company_form_data
         FROM ads_campaign c
         INNER JOIN projects p ON p.id = c.project_id
         INNER JOIN projects company ON company.id = COALESCE(p.company_project_id, p.id)
         WHERE c.id = ? AND (p.user_id = ? OR p.company_project_id IN (
             SELECT id FROM projects WHERE user_id = ? AND project_type = 'project'
         ))
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('iii', $campaignId, $userId, $userId);
    $stmt->execute();
    $stmt->bind_result(
        $id, $name, $formDataJson, $metadataJson, $creativePlansJson,
        $goodExamplesStore, $memoryStore, $projectId, $companyProjectId, $companyFormDataJson
    );
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Campaign not found or access denied']);
        exit;
    }
    $stmt->close();

    $examples = [];
    $exampleStmt = $conn->prepare(
        "SELECT
            e.id,
            e.creative_id,
            e.gemini_document_name,
            e.created_at,
            c.name,
            c.public_url,
            c.platform,
            c.format,
            c.label,
            c.width,
            c.height,
            c.generated_html,
            c.metadata
         FROM ads_campaign_examples e
         INNER JOIN ads_creatives c ON c.id = e.creative_id
         WHERE e.campaign_id = ?
         ORDER BY e.created_at DESC, e.id DESC"
    );
    if ($exampleStmt) {
        $exampleStmt->bind_param('i', $campaignId);
        $exampleStmt->execute();
        $exampleStmt->bind_result(
            $exampleId, $creativeId, $documentName, $exampleCreatedAt,
            $creativeName, $creativeUrl, $platform, $format, $label, $width, $height,
            $creativeHtml, $creativeMetadataJson
        );
        while ($exampleStmt->fetch()) {
            $creativeMetadata = json_decode($creativeMetadataJson ?: '{}', true);
            if (!is_array($creativeMetadata)) $creativeMetadata = [];
            $exampleImageUrl = '';
            foreach (['image_url', 'imageUrl', 'png_url', 'pngUrl', 'preview_url', 'previewUrl'] as $key) {
                if (isset($creativeMetadata[$key]) && trim((string)$creativeMetadata[$key]) !== '') {
                    $exampleImageUrl = trim((string)$creativeMetadata[$key]);
                    break;
                }
            }
            if ($exampleImageUrl === '' && preg_match('/^data:image\//i', trim((string)$creativeHtml))) {
                $exampleImageUrl = trim((string)$creativeHtml);
            }
            if ($exampleImageUrl === '' && preg_match('/^(?:https?:\/\/|\/|\.?\/).+\.(?:png|jpe?g|webp|gif|avif)(?:\?.*)?$/i', trim((string)$creativeUrl))) {
                $exampleImageUrl = trim((string)$creativeUrl);
            }
            $examples[] = [
                'id' => (int)$exampleId,
                'creative_id' => (int)$creativeId,
                'gemini_document_name' => $documentName,
                'created_at' => $exampleCreatedAt,
                'name' => $creativeName,
                'url' => $creativeUrl,
                'public_url' => $creativeUrl,
                'image_url' => $exampleImageUrl,
                'platform' => $platform,
                'format' => $format,
                'label' => $label ?: $creativeName,
                'width' => (int)$width,
                'height' => (int)$height,
            ];
        }
        $exampleStmt->close();
    }

    echo json_encode([
        'success'                  => true,
        'id'                       => (int)$id,
        'name'                     => $name,
        'form_data'                => json_decode($formDataJson ?: '{}', true) ?: [],
        'company_form_data'        => json_decode($companyFormDataJson ?: '{}', true) ?: [],
        'metadata'                 => json_decode($metadataJson ?: '{}', true) ?: [],
        'creative_plans'           => json_decode($creativePlansJson ?: '[]', true) ?: [],
        'example_creatives'        => $examples,
        'gemini_good_examples_store' => $goodExamplesStore,
        'gemini_memory_store'      => $memoryStore,
        'project_id'               => (int)$projectId,
        'company_project_id'       => (int)$companyProjectId,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[getCampaign] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
