<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data["id"]) || !isset($data["user_id"])) {
    http_response_code(400);
    echo json_encode(["error" => "Project ID and user_id are required"]);
    exit;
}

$id     = (int)$data["id"];
$userId = isset($data["user_id"]) ? (int)$data["user_id"] : 0;

if ($id <= 0 || $userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project/user ID"]);
    exit;
}

include "db.php";
// For agents_env_value() — used to best-effort delete the company's Gemini File Search stores
// from Google's project so a delete leaves NO orphan anywhere (guarded by function_exists inside).
@include __DIR__ . '/v1/agents/helpers.php';

// Determine the folder to clean up and resolve the effective owner user_id.
$folderPath      = '';
$effectiveUserId = 0;

$row = find_project_for_user($conn, $id, $userId, 'p.id');
if (!$row) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $conn->close();
    exit;
}
$folderPath      = (string)($row['folder_path'] ?? '');
$effectiveUserId = (int)($row['actual_user_id'] ?? $userId);

// Helper: recursively delete a project's published folder from disk (path is relative to repo root).
$projectRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
$deleteFolder = function (string $folderPath) use ($projectRoot) {
    $folderPath = trim($folderPath);
    if ($folderPath === '' || $projectRoot === false) return;
    $normalized     = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, ltrim($folderPath, '/\\'));
    $absoluteFolder = $projectRoot . DIRECTORY_SEPARATOR . $normalized;
    // Safety: never escape the repo root.
    $real = realpath($absoluteFolder);
    if ($real === false || strpos($real, $projectRoot) !== 0 || !is_dir($real)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($real);
};

// If this is a COMPANY project, its child projects (LPs / ad campaigns) reference it via
// company_project_id (FK is ON DELETE SET NULL, so they would be orphaned — rows AND server
// folders left behind). Cascade them explicitly: collect children, delete their folders + rows
// (their lps/ads_campaign/ads_creatives cascade via FK), and clean the company-scoped tables
// that have no FK cascade (company_store_files, ad_generation_jobs).
$childIds     = [];
$childFolders = [];
$childStmt = $conn->prepare("SELECT id, folder_path FROM projects WHERE company_project_id = ?");
if ($childStmt) {
    $childStmt->bind_param("i", $id);
    $childStmt->execute();
    $childRes = $childStmt->get_result();
    while ($childRes && ($r = $childRes->fetch_assoc())) {
        $childIds[] = (int)$r['id'];
        if (!empty($r['folder_path'])) $childFolders[] = (string)$r['folder_path'];
    }
    $childStmt->close();
}

// Collect every Gemini File Search store reachable from this company BEFORE the rows go away, so
// we can delete them from Google's project afterwards. A store outlives its DB row otherwise —
// an external orphan (cost + the store/key confusion we hit before). Best-effort: names only here.
$geminiStores = [];
$collectStore = function ($v) use (&$geminiStores) {
    $v = trim((string)$v);
    if ($v !== '') $geminiStores[$v] = true;   // dedupe by key
};
// projects.gemini_store_name — company itself + all children.
if ($cs = $conn->prepare("SELECT gemini_store_name FROM projects WHERE id = ? OR company_project_id = ?")) {
    $cs->bind_param("ii", $id, $id);
    $cs->execute();
    $r = $cs->get_result();
    while ($r && ($x = $r->fetch_assoc())) $collectStore($x['gemini_store_name'] ?? '');
    $cs->close();
}
// company_store_files.gemini_store_name
if ($cs = $conn->prepare("SELECT gemini_store_name FROM company_store_files WHERE company_project_id = ?")) {
    $cs->bind_param("i", $id);
    $cs->execute();
    $r = $cs->get_result();
    while ($r && ($x = $r->fetch_assoc())) $collectStore($x['gemini_store_name'] ?? '');
    $cs->close();
}
// ads_campaign memory/good-example stores + ads_campaign_examples stores, for campaigns under the
// children (ads_campaign.project_id → child ad_creative project).
if (!empty($childIds)) {
    $ph = implode(',', array_fill(0, count($childIds), '?'));
    $ty = str_repeat('i', count($childIds));
    if ($cs = $conn->prepare("SELECT gemini_memory_store, gemini_good_examples_store FROM ads_campaign WHERE project_id IN ($ph)")) {
        $cs->bind_param($ty, ...$childIds);
        $cs->execute();
        $r = $cs->get_result();
        while ($r && ($x = $r->fetch_assoc())) { $collectStore($x['gemini_memory_store'] ?? ''); $collectStore($x['gemini_good_examples_store'] ?? ''); }
        $cs->close();
    }
    if ($cs = $conn->prepare("SELECT e.gemini_store_name FROM ads_campaign_examples e JOIN ads_campaign c ON c.id = e.campaign_id WHERE c.project_id IN ($ph)")) {
        $cs->bind_param($ty, ...$childIds);
        $cs->execute();
        $r = $cs->get_result();
        while ($r && ($x = $r->fetch_assoc())) $collectStore($x['gemini_store_name'] ?? '');
        $cs->close();
    }
}

if (!empty($childIds)) {
    $placeholders = implode(',', array_fill(0, count($childIds), '?'));
    $types        = str_repeat('i', count($childIds));
    $delChildren  = $conn->prepare("DELETE FROM projects WHERE id IN ($placeholders)");
    if ($delChildren) {
        $delChildren->bind_param($types, ...$childIds);
        $delChildren->execute();
        $delChildren->close();
    }
}

// ad_generation_job_batches has no FK to ad_generation_jobs, so it would orphan when the jobs go.
// Delete the batches of this company's jobs FIRST, while the job rows still exist to join against.
if ($cb = $conn->prepare(
    "DELETE b FROM ad_generation_job_batches b
     JOIN ad_generation_jobs j ON j.id = b.job_id
     WHERE j.company_project_id = ?"
)) { $cb->bind_param("i", $id); $cb->execute(); $cb->close(); }

// Non-cascading, company-scoped tables. company_asset_jobs (brand-brief jobs) is included so a
// delete leaves no orphan — and because that row can hold a stored gemini_api_key until the job
// finishes, so an orphan is also a lingering credential.
foreach (['company_store_files', 'ad_generation_jobs', 'company_asset_jobs'] as $tbl) {
    $c = $conn->prepare("DELETE FROM {$tbl} WHERE company_project_id = ?");
    if ($c) { $c->bind_param("i", $id); $c->execute(); $c->close(); }
}

// Delete the project (company or standalone) itself.
$stmt = $conn->prepare("DELETE FROM projects WHERE id = ? AND user_id = ?");
$stmt->bind_param("ii", $id, $effectiveUserId);

if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["error" => "Failed to delete project: " . $conn->error]);
    $stmt->close();
    $conn->close();
    exit;
}

if ($stmt->affected_rows === 0) {
    http_response_code(404);
    echo json_encode(["error" => "Project not found"]);
    $stmt->close();
    $conn->close();
    exit;
}

$stmt->close();

// Remove published files from disk — the project's own folder + all child folders.
$deleteFolder($folderPath);
foreach ($childFolders as $cf) {
    $deleteFolder($cf);
}

echo json_encode(["success" => true, "deletedChildren" => count($childIds)]);

// ── Best-effort: delete the Gemini File Search stores from Google's project ────────────────────
// Done AFTER flushing the response so the user never waits on Google, and fully guarded so it can
// NEVER turn a successful delete into an error. A store belongs to the Google project of the key
// that created it; after a key rotation the current key may 403 (the store lives in the old
// project) — logged and skipped, not fatal. The DB/disk rows are already gone regardless.
if (!empty($geminiStores) && function_exists('agents_env_value')) {
    @ignore_user_abort(true);
    if (function_exists('fastcgi_finish_request')) { @fastcgi_finish_request(); }
    else { while (ob_get_level() > 0) { @ob_end_flush(); } @flush(); }

    $gkey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING');
    if ($gkey !== '') {
        foreach (array_keys($geminiStores) as $storeName) {
            $storeName = ltrim(trim($storeName), '/');
            if ($storeName === '') continue;
            $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/' . $storeName . '?force=true&key=' . rawurlencode($gkey));
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST  => 'DELETE',
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 8,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);
            $resp = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($code !== 200 && $code !== 404) {
                error_log('[deleteProject] gemini store delete ' . $storeName . ' → HTTP ' . $code . ' ' . substr((string)$resp, 0, 120));
            }
        }
    }
}

$conn->close();
?>

