<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

require_once __DIR__ . '/accountType.php';
include __DIR__ . '/db.php';

$userId     = (int)($_GET['user_id']     ?? 0);
$idsRaw     = trim($_GET['creative_ids'] ?? '');

if ($userId <= 0 || $idsRaw === '') {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and creative_ids are required']);
    exit;
}

// Validate admin
$userStmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1");
$userStmt->bind_param('i', $userId);
$userStmt->execute();
$userStmt->bind_result($userEmail, $storedAccountType);
$userStmt->fetch();
$userStmt->close();
$result = resolve_account_type_by_domain($userEmail ?? '', $storedAccountType ?? 'user');
if ($result['accountType'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['error' => 'Admin access required']);
    exit;
}

// Parse and validate IDs (only integers)
$ids = array_values(array_filter(array_map('intval', explode(',', $idsRaw))));
if (empty($ids) || count($ids) > 50) {
    http_response_code(400);
    echo json_encode(['error' => 'Provide between 1 and 50 creative IDs']);
    exit;
}

$placeholders = implode(',', array_fill(0, count($ids), '?'));
$types = str_repeat('i', count($ids));
$stmt = $conn->prepare(
    "SELECT c.id, c.label, c.name, c.platform, c.format, c.width, c.height, c.generated_html
     FROM ads_creatives c
     INNER JOIN projects p ON p.id = c.project_id
     WHERE c.id IN ($placeholders) AND p.user_id = ?
     ORDER BY FIELD(c.id, $placeholders)"
);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(['error' => 'DB error: ' . $conn->error]);
    exit;
}

// bind: IDs twice (IN + ORDER BY FIELD) + user_id
$bindValues = array_merge($ids, [$userId], $ids);
$bindTypes  = $types . 'i' . $types;
$stmt->bind_param($bindTypes, ...$bindValues);
$stmt->execute();
$result_set = $stmt->get_result();
$creatives  = [];
while ($row = $result_set->fetch_assoc()) {
    $creatives[] = [
        'id'       => (int)$row['id'],
        'label'    => $row['label'] ?: $row['name'] ?: "Creative {$row['id']}",
        'platform' => $row['platform'],
        'format'   => $row['format'],
        'width'    => (int)$row['width'],
        'height'   => (int)$row['height'],
        'html'     => $row['generated_html'] ?? '',
    ];
}
$stmt->close();
$conn->close();

echo json_encode(['success' => true, 'creatives' => $creatives], JSON_UNESCAPED_UNICODE);
