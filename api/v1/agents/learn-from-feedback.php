<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(120);
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
$badAdIds         = is_array($body['bad_ad_ids'] ?? null) ? array_map('intval', $body['bad_ad_ids']) : [];
$feedback         = is_string($body['feedback'] ?? null) ? trim($body['feedback']) : '';
$metrics          = is_array($body['metrics']   ?? null) ? $body['metrics']   : null;

if ($userId <= 0 || $companyProjectId <= 0 || $campaignId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id, company_project_id and campaign_id are required']);
    exit;
}

if (empty($badAdIds)) {
    http_response_code(400);
    echo json_encode(['error' => 'bad_ad_ids must be a non-empty array']);
    exit;
}

try {
    // 1. Load company project (verify ownership + get store)
    $stmt = $conn->prepare(
        "SELECT id, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $geminiStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    // 2. Load campaign memory store
    $campaignMemoryStore = null;
    $camStmt = $conn->prepare(
        "SELECT c.gemini_memory_store FROM ads_campaign c
         INNER JOIN projects p ON p.id = c.project_id
         WHERE c.id = ? AND (p.id = ? OR p.company_project_id = ?) LIMIT 1"
    );
    if ($camStmt) {
        $camStmt->bind_param('iii', $campaignId, $companyProjectId, $companyProjectId);
        $camStmt->execute();
        $camStmt->bind_result($campaignMemoryStore);
        $camStmt->fetch();
        $camStmt->close();
    }

    // 3. Load ADS_AGENT
    $agentStmt = $conn->prepare(
        "SELECT system_prompt, model FROM agents WHERE name = 'ADS_AGENT' AND is_active = 1 LIMIT 1"
    );
    if (!$agentStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $agentStmt->execute();
    $agentStmt->bind_result($systemPrompt, $model);
    if (!$agentStmt->fetch()) {
        $agentStmt->close();
        http_response_code(500);
        echo json_encode(['error' => 'ADS_AGENT not found. Run the agents seed SQL first.']);
        exit;
    }
    $agentStmt->close();

    // 4. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 5. Load bad ad metadata
    $badAds = [];
    if (!empty($badAdIds)) {
        $placeholders = implode(',', array_fill(0, count($badAdIds), '?'));
        $types = str_repeat('i', count($badAdIds));
        $adsStmt = $conn->prepare(
            "SELECT id, platform, format, label FROM ads_creatives WHERE id IN ({$placeholders}) LIMIT 50"
        );
        if ($adsStmt) {
            $adsStmt->bind_param($types, ...$badAdIds);
            $adsStmt->execute();
            $adsStmt->bind_result($adId, $adPlatform, $adFormat, $adLabel);
            while ($adsStmt->fetch()) {
                $badAds[] = ['id' => $adId, 'platform' => $adPlatform, 'format' => $adFormat, 'label' => $adLabel];
            }
            $adsStmt->close();
        }
    }

    if (empty($badAds)) {
        $badAds = array_map(fn($id) => ['id' => $id], $badAdIds);
    }

    // 6. Call agents-learn to get learnings text
    $learnResult = agents_call_edge_function('agents-learn', [
        'agentConfig'      => ['systemPrompt' => $systemPrompt, 'model' => $model],
        'companyStoreName' => $geminiStoreName ?? '',
        'badAds'           => $badAds,
        'feedback'         => $feedback ?: null,
        'metrics'          => $metrics,
        'accountType'      => $accountType,
    ]);

    if (!empty($learnResult['error'])) {
        throw new RuntimeException('agents-learn error: ' . $learnResult['error']);
    }

    $learnings = $learnResult['learnings'] ?? '';
    if (empty($learnings)) {
        throw new RuntimeException('agents-learn returned empty learnings');
    }

    // 7. Upload learnings to campaign memory store
    $storeResult = agents_call_edge_function('agents-store', [
        'action'        => 'upload_learnings',
        'storeName'     => $campaignMemoryStore ?: null,
        'displayName'   => 'campaign-' . $campaignId . '-memory',
        'learningsText' => $learnings,
        'accountType'   => $accountType,
    ]);

    if (!empty($storeResult['storeName'])) {
        $newStoreName = $storeResult['storeName'];

        if ($newStoreName !== $campaignMemoryStore) {
            $updateStmt = $conn->prepare(
                "UPDATE ads_campaign SET gemini_memory_store = ? WHERE id = ?"
            );
            $updateStmt->bind_param('si', $newStoreName, $campaignId);
            $updateStmt->execute();
            $updateStmt->close();
            $campaignMemoryStore = $newStoreName;
        }
    }

    echo json_encode([
        'success'   => true,
        'learnings' => $learnings,
        'storeName' => $campaignMemoryStore,
        'adCount'   => count($badAds),
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/learn-from-feedback] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
