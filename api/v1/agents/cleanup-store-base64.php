<?php
// Admin tool: purge base64 image data already indexed inside Gemini File Search stores.
// A single inlined data:image/...;base64,... in a stored example/reference is tokenized as
// TEXT and retrieved into every future generation, costing millions of tokens. This endpoint
// finds polluted documents, re-uploads a sanitized copy, deletes the old document, and updates
// the tracking rows.
//
// POST params:
//   scope   = 'global' | 'examples' | 'all'   (default 'all')
//   dry_run = '1' to only report what WOULD be cleaned (no writes/deletes)
//   admin_key OR user_id (admin) for auth
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(0);
ini_set('memory_limit', '512M');

require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$scope  = strtolower(trim($_POST['scope'] ?? 'all'));
$dryRun = (string)($_POST['dry_run'] ?? '') === '1';
if (!in_array($scope, ['global', 'examples', 'all'], true)) $scope = 'all';

// ── Auth: admin_key (server/CLI) or admin user_id ──────────────────────────
$authorized = false;
$adminKey = $_POST['admin_key'] ?? '';
$userId   = (int)($_POST['user_id'] ?? 0);
if ($adminKey !== '') {
    $expectedKey = getenv('AGENTS_ADMIN_KEY') ?: '';
    $authorized  = $expectedKey !== '' && hash_equals($expectedKey, (string)$adminKey);
} elseif ($userId > 0) {
    $stmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1");
    if ($stmt) {
        $stmt->bind_param('i', $userId);
        $stmt->execute();
        $stmt->bind_result($email, $acct);
        $stmt->fetch();
        $stmt->close();
        $resolved = resolve_account_type_by_domain($email ?? '', $acct ?? 'user');
        $authorized = ($resolved['accountType'] === 'admin');
    }
}
if (!$authorized) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden: admin only']);
    exit;
}

$report = [
    'dry_run'  => $dryRun,
    'scope'    => $scope,
    'global'   => ['scanned' => 0, 'polluted' => 0, 'cleaned' => 0, 'errors' => []],
    'examples' => ['scanned' => 0, 'polluted' => 0, 'cleaned' => 0, 'errors' => []],
];

$baseDir = realpath(__DIR__ . '/../../') ?: (__DIR__ . '/../../');

// ── 1) GLOBAL STORE FILES ───────────────────────────────────────────────────
if ($scope === 'global' || $scope === 'all') {
    $res = $conn->query("SELECT id, store_type, store_name, document_name, display_name, mime_type, storage_path FROM global_store_files");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $report['global']['scanned']++;
            $rid       = (int)$row['id'];
            $storeName = (string)$row['store_name'];
            $docName   = (string)($row['document_name'] ?? '');
            $display   = (string)($row['display_name'] ?? ('Guidelines #' . $rid));
            $mime      = (string)($row['mime_type'] ?? 'text/plain');
            $relPath   = (string)($row['storage_path'] ?? '');
            if ($relPath === '') continue;

            $absPath = realpath($baseDir . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relPath));
            $allowedRoot = realpath($baseDir . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'agents-global');
            if (!$absPath || !$allowedRoot || !agents_starts_with($absPath, $allowedRoot) || !is_file($absPath)) continue;

            $content = (string)@file_get_contents($absPath);
            if ($content === '' || !agents_has_base64_image($content)) continue;

            $report['global']['polluted']++;
            if ($dryRun) continue;

            try {
                $clean = agents_strip_base64_images($content);
                $upload = agents_call_edge_function('agents-store', [
                    'action'      => 'upload_file',
                    'storeName'   => $storeName,
                    'fileBase64'  => base64_encode($clean),
                    'mimeType'    => $mime ?: 'text/plain',
                    'displayName' => $display,
                    'accountType' => 'admin',
                ]);
                if (!empty($upload['error'])) throw new RuntimeException($upload['error']);
                $newDoc = agents_extract_document_name($upload);

                // Replace on disk + DB, then delete the old polluted document from Gemini.
                @file_put_contents($absPath, $clean);
                $upd = $conn->prepare("UPDATE global_store_files SET document_name = ?, file_size_bytes = ? WHERE id = ?");
                if ($upd) {
                    $size = strlen($clean);
                    $upd->bind_param('sii', $newDoc, $size, $rid);
                    $upd->execute();
                    $upd->close();
                }
                if ($docName !== '') {
                    try { agents_delete_gemini_file_search_document($docName); }
                    catch (Throwable $e) { $report['global']['errors'][] = "id $rid delete old: " . $e->getMessage(); }
                }
                $report['global']['cleaned']++;
            } catch (Throwable $e) {
                $report['global']['errors'][] = "id $rid: " . $e->getMessage();
            }
        }
        $res->free();
    }
}

// ── 2) CAMPAIGN GOOD EXAMPLES ────────────────────────────────────────────────
if ($scope === 'examples' || $scope === 'all') {
    $sql = "SELECT e.id, e.creative_id, e.gemini_store_name, e.gemini_document_name,
                   c.platform, c.format, c.width, c.height, c.generated_html
            FROM ads_campaign_examples e
            JOIN ads_creatives c ON c.id = e.creative_id
            WHERE e.gemini_store_name IS NOT NULL AND e.gemini_store_name <> ''";
    $res = $conn->query($sql);
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $report['examples']['scanned']++;
            $eid       = (int)$row['id'];
            $creative  = (int)$row['creative_id'];
            $storeName = (string)$row['gemini_store_name'];
            $oldDoc    = (string)($row['gemini_document_name'] ?? '');
            $html      = (string)($row['generated_html'] ?? '');
            if ($html === '' || !agents_has_base64_image($html)) continue;

            $report['examples']['polluted']++;
            if ($dryRun) continue;

            try {
                $platform = (string)($row['platform'] ?? '');
                $format   = (string)($row['format'] ?? '');
                $w = (int)($row['width'] ?: 1080);
                $h = (int)($row['height'] ?: 1080);
                $clean = agents_strip_base64_images($html);

                $doc  = "# Good Ad Example (sanitized)\n\n";
                $doc .= "Creative ID: {$creative}\nPlatform: {$platform}\nFormat: {$format}\nDimensions: {$w}x{$h}\n\n";
                $doc .= "Treat this as a performance reference, not a template to copy. Analyze layout, hierarchy, focal point, CTA, spacing, and brand color use.\n\n";
                $doc .= agents_build_ad_example_fingerprint($clean, $platform, $format, $w, $h) . "\n";
                $doc .= "## HTML\n\n```html\n" . $clean . "\n```\n";

                $upload = agents_call_edge_function('agents-store', [
                    'action'      => 'upload_file',
                    'storeName'   => $storeName,
                    'fileBase64'  => base64_encode($doc),
                    'mimeType'    => 'text/markdown',
                    'displayName' => 'Ad #' . $creative . ' - Good Example (cleaned)',
                    'accountType' => 'admin',
                ]);
                if (!empty($upload['error'])) throw new RuntimeException($upload['error']);
                $newDoc = agents_extract_document_name($upload);

                $upd = $conn->prepare("UPDATE ads_campaign_examples SET gemini_document_name = ? WHERE id = ?");
                if ($upd) { $upd->bind_param('si', $newDoc, $eid); $upd->execute(); $upd->close(); }

                if ($oldDoc !== '') {
                    try { agents_delete_gemini_file_search_document($oldDoc); }
                    catch (Throwable $e) { $report['examples']['errors'][] = "ex $eid delete old: " . $e->getMessage(); }
                }
                $report['examples']['cleaned']++;
            } catch (Throwable $e) {
                $report['examples']['errors'][] = "ex $eid: " . $e->getMessage();
            }
        }
        $res->free();
    }
}

echo json_encode(['success' => true] + $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
