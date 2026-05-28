<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(300);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$userId           = (int)($body['user_id']            ?? 0);
$companyProjectId = (int)($body['company_project_id'] ?? 0);
$campaignId       = (int)($body['campaign_id']        ?? 0);
$adIds            = is_array($body['ad_ids'] ?? null) ? array_map('intval', $body['ad_ids']) : [];

if ($userId <= 0 || $companyProjectId <= 0 || $campaignId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id and campaign_id are required']);
    exit;
}

if (empty($adIds)) {
    http_response_code(400);
    echo json_encode(['error' => 'ad_ids must be a non-empty array']);
    exit;
}

try {
    agents_ensure_ads_campaign_memory_columns($conn);
    agents_ensure_campaign_examples_table($conn);

    // 1. Verify ownership + load campaign good examples store
    $stmt = $conn->prepare(
        "SELECT c.gemini_good_examples_store FROM ads_campaign c
         INNER JOIN projects p ON p.id = c.project_id
         INNER JOIN projects company ON company.id = ?
         WHERE c.id = ?
           AND company.user_id = ?
           AND company.project_type = 'project'
           AND (p.id = company.id OR p.company_project_id = company.id)
         LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('iii', $companyProjectId, $campaignId, $userId);
    $stmt->execute();
    $stmt->bind_result($goodExamplesStore);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Campaign not found or access denied']);
        exit;
    }
    $stmt->close();

    // 2. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 3. Create good examples store if it doesn't exist yet
    $storeCreated = false;
    if (empty($goodExamplesStore)) {
        $initResult = agents_call_edge_function('agents-store', [
            'action'       => 'get_or_create',
            'displayName'  => 'campaign-' . $campaignId . '-examples',
            'documentText' => 'Campaign ' . $campaignId . ' good ad examples store.',
            'documentLabel' => 'Store Initialization',
            'accountType'  => $accountType,
        ]);
        if (empty($initResult['storeName'])) {
            throw new RuntimeException('Failed to create good examples store');
        }
        $goodExamplesStore = $initResult['storeName'];
        $storeCreated = true;
    }

    // 4. Load and upload each ad as a structured example document
    $uploadedCount = 0;
    foreach ($adIds as $adId) {
        $adStmt = $conn->prepare(
            "SELECT name, platform, format, label, width, height, generated_html
             FROM ads_creatives
             WHERE id = ? AND campaign_id = ?
             LIMIT 1"
        );
        if (!$adStmt) continue;
        $adStmt->bind_param('ii', $adId, $campaignId);
        $adStmt->execute();
        $adStmt->bind_result($adName, $platform, $format, $label, $width, $height, $adHtml);
        $fetched = $adStmt->fetch();
        $adStmt->close();

        if (!$fetched || empty($adHtml)) continue;

        $exampleDoc  = "# Good Ad Example\n\n";
        $exampleDoc .= "Campaign ID: {$campaignId}\n";
        $exampleDoc .= "Creative ID: {$adId}\n";
        $exampleDoc .= "Name: " . ($adName ?: '') . "\n";
        $exampleDoc .= "Platform: " . ($platform ?: '') . "\n";
        $exampleDoc .= "Format: " . ($format ?: '') . "\n";
        $exampleDoc .= "Label: " . ($label ?: '') . "\n";
        $exampleDoc .= "Dimensions: " . ((int)$width ?: 1080) . "x" . ((int)$height ?: 1080) . "\n";
        $exampleDoc .= "Why stored: user marked this creative as a high-performing example for future generations in this campaign.\n\n";
        $exampleDoc .= "## How to use this example\n\n";
        $exampleDoc .= "- Treat this as a performance reference, not a template to copy.\n";
        $exampleDoc .= "- Analyze the layout structure, visual hierarchy, focal point, CTA treatment, spacing, and use of brand colors.\n";
        $exampleDoc .= "- Preserve the winning principles when generating future creatives for the same campaign.\n";
        $exampleDoc .= "- Do not duplicate the exact HTML, exact element positions, exact crop, or exact composition.\n";
        $exampleDoc .= "- When creating a new format, adapt the idea to the natural layout pattern of that format instead of scaling this creative.\n\n";
        $exampleDoc .= agents_build_ad_example_fingerprint($adHtml, (string)($platform ?: ''), (string)($format ?: ''), (int)$width ?: 1080, (int)$height ?: 1080) . "\n";
        $exampleDoc .= "## Example analysis hints\n\n";
        $ratio = ((int)$height > 0) ? ((int)$width / (int)$height) : 1;
        if ($ratio < 0.7) {
            $exampleDoc .= "- Format family: vertical/story. Look for top hook, middle hero, lower CTA, and safe-zone discipline.\n";
        } elseif ($ratio > 3) {
            $exampleDoc .= "- Format family: leaderboard. Look for horizontal logo-message-action rhythm and minimal copy.\n";
        } elseif ($ratio > 1.2) {
            $exampleDoc .= "- Format family: landscape. Look for side-by-side copy/visual balance or cinematic crop.\n";
        } else {
            $exampleDoc .= "- Format family: square/rectangle. Look for poster hierarchy, strong focal point, and compact CTA placement.\n";
        }
        $exampleDoc .= "- The model should explicitly remix this example into a new layout recipe before outputting HTML.\n\n";
        $exampleDoc .= "## HTML\n\n```html\n" . $adHtml . "\n```\n";

        $uploadResult = agents_call_edge_function('agents-store', [
            'action'      => 'upload_file',
            'storeName'   => $goodExamplesStore,
            'fileBase64'  => base64_encode($exampleDoc),
            'mimeType'    => 'text/markdown',
            'displayName' => 'Ad #' . $adId . ' - Good Example',
            'accountType' => $accountType,
        ]);

        if (empty($uploadResult['error'])) {
            $documentName = agents_extract_document_name($uploadResult);
            $exampleStmt = $conn->prepare(
                "INSERT INTO ads_campaign_examples (campaign_id, creative_id, gemini_store_name, gemini_document_name)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    gemini_store_name = VALUES(gemini_store_name),
                    gemini_document_name = COALESCE(VALUES(gemini_document_name), gemini_document_name)"
            );
            if ($exampleStmt) {
                $exampleStmt->bind_param('iiss', $campaignId, $adId, $goodExamplesStore, $documentName);
                $exampleStmt->execute();
                $exampleStmt->close();
            }
            $uploadedCount++;
        }
    }

    // 5. Save store name to DB if newly created
    if ($storeCreated) {
        $updateStmt = $conn->prepare(
            "UPDATE ads_campaign SET gemini_good_examples_store = ? WHERE id = ?"
        );
        $updateStmt->bind_param('si', $goodExamplesStore, $campaignId);
        $updateStmt->execute();
        $updateStmt->close();
    }

    echo json_encode([
        'success'       => true,
        'storeName'     => $goodExamplesStore,
        'uploadedCount' => $uploadedCount,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/mark-good-example] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
