<?php
// Returns the PENDING ClickUp company detections for a user (for the Projects
// badge / panel). Each one can be imported via the normal v1 flow or dismissed.
// GET ?user_id=
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId = isset($_REQUEST['user_id']) ? (int)$_REQUEST['user_id'] : 0;
if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "user_id is required"]);
    exit;
}

clickup_ensure_schema($conn);

$items = [];
if ($st = $conn->prepare(
    "SELECT id, company_name, channels, list_ids, detected_at
     FROM clickup_detected_companies
     WHERE user_id = ? AND status = 'pending'
     ORDER BY detected_at DESC"
)) {
    $st->bind_param('i', $userId);
    $st->execute();
    $res = $st->get_result();
    while ($r = $res->fetch_assoc()) {
        $channels = json_decode((string)($r['channels'] ?? '[]'), true);
        $listIds  = json_decode((string)($r['list_ids'] ?? '[]'), true);
        $items[] = [
            'id'          => (int)$r['id'],
            'company'     => (string)$r['company_name'],
            'channels'    => is_array($channels) ? array_values($channels) : [],
            'list_ids'    => is_array($listIds) ? array_values($listIds) : [],
            'detected_at' => (string)$r['detected_at'],
        ];
    }
    $st->close();
}

echo json_encode(["success" => true, "count" => count($items), "detections" => $items]);
$conn->close();
