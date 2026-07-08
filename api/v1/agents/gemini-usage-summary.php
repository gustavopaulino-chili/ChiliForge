<?php
/**
 * Read side of the Gemini cost ledger — sums gemini_usage by model.
 * Auth: shared secret (same USAGE_LOG_SECRET). GET/POST.
 * Params: job_ids (comma list) | since (YYYY-MM-DD) | source.
 */
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
set_time_limit(15);
include __DIR__ . '/../../db.php';

$secret   = (string) (getenv('USAGE_LOG_SECRET') ?: '4abec0d3d772668c863df116597c2264370dfeb19a7e9024');
$provided = (string) ($_GET['secret'] ?? $_POST['secret'] ?? $_SERVER['HTTP_X_USAGE_SECRET'] ?? '');
if (!hash_equals($secret, $provided)) { http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit; }

$where = []; $types = ''; $args = [];
$jobIds = trim((string) ($_GET['job_ids'] ?? $_POST['job_ids'] ?? ''));
if ($jobIds !== '') {
    $ids = array_values(array_filter(array_map('intval', explode(',', $jobIds))));
    if ($ids) { $where[] = 'job_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'; $types .= str_repeat('i', count($ids)); array_push($args, ...$ids); }
}
$since = trim((string) ($_GET['since'] ?? $_POST['since'] ?? ''));
if ($since !== '') { $where[] = 'created_at >= ?'; $types .= 's'; $args[] = $since . ' 00:00:00'; }
$source = trim((string) ($_GET['source'] ?? $_POST['source'] ?? ''));
if ($source !== '') { $where[] = 'source = ?'; $types .= 's'; $args[] = $source; }
$sqlWhere = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

// by_job=1 → recent jobs with per-job cost (to find "my last request").
if (!empty($_GET['by_job']) || !empty($_POST['by_job'])) {
    try {
        $sqlJ = "SELECT job_id, COUNT(*) calls, SUM(usd) usd, MIN(created_at) at FROM gemini_usage $sqlWhere GROUP BY job_id ORDER BY at DESC LIMIT 20";
        $stmtJ = $conn->prepare($sqlJ);
        if (!$stmtJ) { echo json_encode(['error' => 'prepare failed — table exists?', 'mysql' => $conn->error]); exit; }
        if ($types !== '') $stmtJ->bind_param($types, ...$args);
        $stmtJ->execute(); $rj = $stmtJ->get_result(); $jobs = [];
        while ($row = $rj->fetch_assoc()) { $row['usd'] = round((float)$row['usd'], 6); $jobs[] = $row; }
        echo json_encode(['ok' => true, 'jobs' => $jobs], JSON_UNESCAPED_UNICODE); exit;
    } catch (\Throwable $e) { echo json_encode(['error' => 'query failed', 'detail' => $e->getMessage()]); exit; }
}

try {
    $sql = "SELECT model, COUNT(*) calls, SUM(usd) usd, SUM(in_tokens) in_tok, SUM(out_tokens) out_tok, SUM(thought_tokens) thought_tok FROM gemini_usage $sqlWhere GROUP BY model ORDER BY usd DESC";
    $stmt = $conn->prepare($sql);
    if (!$stmt) { echo json_encode(['error' => 'prepare failed — does the gemini_usage table exist?', 'mysql' => $conn->error]); exit; }
    if ($types !== '') $stmt->bind_param($types, ...$args);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = []; $totalUsd = 0.0; $totalCalls = 0;
    while ($r = $res->fetch_assoc()) {
        $r['usd'] = round((float) $r['usd'], 6);
        $totalUsd += $r['usd']; $totalCalls += (int) $r['calls'];
        $rows[] = $r;
    }
    echo json_encode(['ok' => true, 'total_usd' => round($totalUsd, 6), 'total_calls' => $totalCalls, 'by_model' => $rows], JSON_UNESCAPED_UNICODE);
} catch (\Throwable $e) {
    echo json_encode(['error' => 'query failed — table may not exist yet', 'detail' => $e->getMessage()]);
}
