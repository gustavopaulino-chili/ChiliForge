<?php
// Lists ClickUp companies for the connected user.
// Space is FIXED (product decision); the user picks the Folder.
//   - no folder_id  -> returns the Folders inside the fixed Space (UI picks one)
//   - with folder_id -> returns the parsed + deduped companies of that Folder
// Company = embedded in the List name as "{CHANNEL} - {Company}". We split on the
// FIRST " - " (so multi-word channels like "SEO INT" work), dedup by normalized
// company name, aggregate channels + list_ids, and best-effort detect a site URL
// from the List content (the user confirms it before any scrape).
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$userId   = isset($_REQUEST['user_id'])   ? (int)$_REQUEST['user_id'] : 0;
$folderId = isset($_REQUEST['folder_id']) ? trim((string)$_REQUEST['folder_id']) : '';
if ($userId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "user_id is required"]);
    exit;
}

clickup_ensure_schema($conn);

$conn_row = clickup_get_connection($conn, $userId);
if (!$conn_row || $conn_row['access_token'] === '') {
    http_response_code(409);
    echo json_encode(["error" => "not_connected", "message" => "Connect your ClickUp account first."]);
    exit;
}
$token = $conn_row['access_token'];

// ── Resolve workspace (team) ────────────────────────────────────────────────
$workspaceId = (string)($conn_row['workspace_id'] ?? '');
if ($workspaceId === '') {
    $teamRes = clickup_api_request($token, 'GET', '/team');
    if (($teamRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
    if (!empty($teamRes['data']['teams'][0]['id'])) $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}
if ($workspaceId === '') {
    http_response_code(502);
    echo json_encode(["error" => "no_workspace", "message" => "No ClickUp workspace found for this account."]);
    exit;
}

// Space: free choice by the user. The env CLICKUP_SPACE_ID still PINS it if an
// admin wants to lock the integration to a single Space.
$spaceId = trim((string)($_REQUEST['space_id'] ?? '')) ?: clickup_fixed_space_id();

// ── Mode A1: no space chosen (and none pinned) -> return the Spaces ──────────
if ($spaceId === '' && $folderId === '') {
    $spaceRes = clickup_api_request($token, 'GET', "/team/{$workspaceId}/space");
    if (($spaceRes['code'] ?? 0) === 401) { echo json_encode(["error" => "token_invalid", "message" => "ClickUp session expired. Reconnect."]); exit; }
    if (($spaceRes['code'] ?? 0) !== 200) {
        http_response_code(502);
        echo json_encode(["error" => "space_fetch_failed", "message" => $spaceRes['error'] ?: 'Could not list spaces.']);
        exit;
    }
    $spaces = array_map(fn($s) => [
        'id'   => (string)($s['id'] ?? ''),
        'name' => (string)($s['name'] ?? ''),
    ], is_array($spaceRes['data']['spaces'] ?? null) ? $spaceRes['data']['spaces'] : []);
    echo json_encode([
        "success"      => true,
        "mode"         => "spaces",
        "workspace_id" => $workspaceId,
        "spaces"       => $spaces,
    ]);
    $conn->close();
    exit;
}

// ── Mode A2: space chosen, no folder yet -> return the Folders of the Space ──
if ($folderId === '') {
    $folderRes = clickup_api_request($token, 'GET', "/space/{$spaceId}/folder");
    if (($folderRes['code'] ?? 0) !== 200) {
        http_response_code(502);
        echo json_encode(["error" => "folder_fetch_failed", "message" => $folderRes['error'] ?: 'Could not list folders.']);
        exit;
    }
    $folders = array_map(fn($f) => [
        'id'         => (string)($f['id'] ?? ''),
        'name'       => (string)($f['name'] ?? ''),
        'list_count' => isset($f['lists']) && is_array($f['lists']) ? count($f['lists']) : (int)($f['task_count'] ?? 0),
    ], is_array($folderRes['data']['folders'] ?? null) ? $folderRes['data']['folders'] : []);

    echo json_encode([
        "success"     => true,
        "mode"        => "folders",
        "space_id"    => $spaceId,
        "workspace_id"=> $workspaceId,
        "folders"     => $folders,
    ]);
    $conn->close();
    exit;
}

// ── Mode B: folder chosen -> parse + dedup companies from its Lists ──────────
$listRes = clickup_api_request($token, 'GET', "/folder/{$folderId}/list");
if (($listRes['code'] ?? 0) !== 200) {
    http_response_code(502);
    echo json_encode(["error" => "list_fetch_failed", "message" => $listRes['error'] ?: 'Could not list the folder lists.']);
    exit;
}
$lists = is_array($listRes['data']['lists'] ?? null) ? $listRes['data']['lists'] : [];

// Already-imported list_ids for this user (idempotency hint for the UI).
$importedListIds = [];
if ($importedRes = $conn->query("SELECT clickup_list_ids FROM projects WHERE user_id = " . (int)$userId . " AND source = 'clickup' AND clickup_list_ids IS NOT NULL")) {
    while ($r = $importedRes->fetch_assoc()) {
        $ids = json_decode((string)($r['clickup_list_ids'] ?? '[]'), true);
        if (is_array($ids)) foreach ($ids as $lid) $importedListIds[(string)$lid] = true;
    }
    $importedRes->free();
}

$companies = []; // normKey => entry
foreach ($lists as $list) {
    $listId   = (string)($list['id'] ?? '');
    $listName = trim((string)($list['name'] ?? ''));
    if ($listId === '' || $listName === '') continue;

    // Split on the FIRST " - " → channel | company (multi-word channel safe).
    $pos = mb_strpos($listName, ' - ');
    if ($pos === false) continue; // not "{CHANNEL} - {Company}" → skip (logged)
    $channel = trim(mb_substr($listName, 0, $pos));
    $company = trim(mb_substr($listName, $pos + 3));
    if ($company === '') continue;

    $normKey = mb_strtolower(preg_replace('/\s+/', ' ', $company));
    if (!isset($companies[$normKey])) {
        $companies[$normKey] = [
            'company'          => $company,
            'channels'         => [],
            'list_ids'         => [],
            'list_names'       => [],
            'detected_url'     => '',
            'already_imported' => false,
        ];
    }
    if ($channel !== '' && !in_array($channel, $companies[$normKey]['channels'], true)) {
        $companies[$normKey]['channels'][] = $channel;
    }
    $companies[$normKey]['list_ids'][]   = $listId;
    $companies[$normKey]['list_names'][] = $listName;
    if (isset($importedListIds[$listId])) $companies[$normKey]['already_imported'] = true;

    // Best-effort: detect a site URL from the List content/description. User confirms it.
    if ($companies[$normKey]['detected_url'] === '') {
        $content = (string)($list['content'] ?? '');
        if ($content === '' && isset($list['id'])) {
            $detail = clickup_api_request($token, 'GET', "/list/{$listId}");
            if (($detail['code'] ?? 0) === 200) $content = (string)($detail['data']['content'] ?? '');
        }
        if ($content !== '' && preg_match('~https?://[^\s"\'<>)]+~i', $content, $um)) {
            $companies[$normKey]['detected_url'] = $um[0];
        }
    }
}

echo json_encode([
    "success"   => true,
    "mode"      => "companies",
    "space_id"  => $spaceId,
    "folder_id" => $folderId,
    "companies" => array_values($companies),
]);
$conn->close();
