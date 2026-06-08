<?php
// Public ClickUp webhook receiver for `listCreated`. Validates the X-Signature
// HMAC, responds 200 immediately, then (async, after flushing) fetches the List,
// parses "{CHANNEL} - {Company}", dedups, and records a PENDING detection so the
// user can import it through the normal v1 flow. NEVER creates a company itself.
//
// Security/health: invalid signatures are dropped; heavy work runs after the 200
// so ClickUp doesn't disable the webhook for slow responses.

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

// --- Read raw body + signature ------------------------------------------------
$rawBody = (string)file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_X_SIGNATURE'] ?? '';

$event = json_decode($rawBody, true);
$webhookId = is_array($event) ? (string)($event['webhook_id'] ?? '') : '';
$eventName = is_array($event) ? (string)($event['event'] ?? '') : '';
$listId    = is_array($event) ? (string)($event['list_id'] ?? '') : '';

clickup_ensure_schema($conn);

// Look up the webhook to get its secret + owning user.
$userId = 0; $secret = ''; $folderId = '';
if ($webhookId !== '' && ($st = $conn->prepare("SELECT user_id, secret, folder_id FROM clickup_webhooks WHERE webhook_id = ? LIMIT 1"))) {
    $st->bind_param('s', $webhookId);
    $st->execute();
    $st->bind_result($uId, $encSecret, $foId);
    if ($st->fetch()) { $userId = (int)$uId; $secret = clickup_decrypt((string)$encSecret); $folderId = (string)$foId; }
    $st->close();
}

// Validate signature. Drop anything we can't verify.
if ($userId <= 0 || !clickup_verify_webhook_signature($rawBody, (string)$sigHeader, $secret)) {
    http_response_code(401);
    echo json_encode(["ok" => false]);
    error_log('[clickup-webhook] dropped: invalid signature or unknown webhook_id=' . $webhookId);
    exit;
}

// Respond 200 FAST, then keep processing after the connection is released so the
// ClickUp webhook stays healthy (it disables webhooks that respond slowly).
http_response_code(200);
echo json_encode(["ok" => true]);
if (function_exists('fastcgi_finish_request')) {
    @fastcgi_finish_request();
} elseif (function_exists('litespeed_finish_request')) {
    @litespeed_finish_request();
} else {
    // Best effort flush so the body is sent before we continue.
    @ob_end_flush(); @flush();
}

// --- Async processing ---------------------------------------------------------
try {
    if ($eventName !== 'listCreated' || $listId === '') { $conn->close(); exit; }

    $conn_row = clickup_get_connection($conn, $userId);
    if (!$conn_row || $conn_row['access_token'] === '') { $conn->close(); exit; }
    $token = $conn_row['access_token'];

    // The listCreated payload has no name — fetch the List to read it.
    $detail = clickup_api_request($token, 'GET', "/list/{$listId}");
    if (($detail['code'] ?? 0) === 401) {
        // Token revoked — flag the connection so the UI asks to reconnect.
        @$conn->query("UPDATE clickup_connections SET token_expires_at = NOW() WHERE user_id = " . (int)$userId);
        $conn->close(); exit;
    }
    if (($detail['code'] ?? 0) !== 200) { $conn->close(); exit; }

    $listName = trim((string)($detail['data']['name'] ?? ''));
    $parsed = clickup_parse_list_name($listName);
    if ($parsed === null) {
        error_log('[clickup-webhook] list ' . $listId . ' name "' . $listName . '" is not "{CHANNEL} - {Company}" — ignored');
        $conn->close(); exit;
    }
    $company = $parsed['company'];
    $channel = $parsed['channel'];
    $normKey = clickup_norm_company_key($company);

    // Dedup #1 — already imported (this list_id is on an existing clickup project)?
    $alreadyImported = false;
    if ($q = $conn->prepare("SELECT clickup_list_ids FROM projects WHERE user_id = ? AND source = 'clickup' AND clickup_list_ids LIKE ?")) {
        $like = '%"' . $conn->real_escape_string($listId) . '"%';
        $q->bind_param('is', $userId, $like);
        $q->execute();
        $q->store_result();
        $alreadyImported = $q->num_rows > 0;
        $q->close();
    }
    if ($alreadyImported) { $conn->close(); exit; }

    // Dedup #2 — merge into an existing detection for the same company, else insert.
    $channelsJson = json_encode($channel !== '' ? [$channel] : [], JSON_UNESCAPED_UNICODE);
    $listIdsJson  = json_encode([$listId], JSON_UNESCAPED_UNICODE);

    $existing = null;
    if ($s = $conn->prepare("SELECT id, channels, list_ids, status FROM clickup_detected_companies WHERE user_id = ? AND norm_key = ? LIMIT 1")) {
        $s->bind_param('is', $userId, $normKey);
        $s->execute();
        $s->bind_result($exId, $exCh, $exLi, $exStatus);
        if ($s->fetch()) $existing = ['id' => (int)$exId, 'channels' => (string)$exCh, 'list_ids' => (string)$exLi, 'status' => (string)$exStatus];
        $s->close();
    }

    if ($existing) {
        // Append channel/list_id; re-open a dismissed detection only when a genuinely
        // new list arrives (status 'imported' is left untouched).
        $chArr = json_decode($existing['channels'] ?: '[]', true); if (!is_array($chArr)) $chArr = [];
        $liArr = json_decode($existing['list_ids'] ?: '[]', true); if (!is_array($liArr)) $liArr = [];
        $isNewList = !in_array($listId, $liArr, true);
        if ($channel !== '' && !in_array($channel, $chArr, true)) $chArr[] = $channel;
        if ($isNewList) $liArr[] = $listId;
        $newStatus = $existing['status'];
        if ($existing['status'] === 'dismissed' && $isNewList) $newStatus = 'pending';
        if ($existing['status'] === 'imported') { $conn->close(); exit; } // keep imported as-is
        $chJson = json_encode(array_values($chArr), JSON_UNESCAPED_UNICODE);
        $liJson = json_encode(array_values($liArr), JSON_UNESCAPED_UNICODE);
        if ($u = $conn->prepare("UPDATE clickup_detected_companies SET channels = ?, list_ids = ?, status = ?, source_list_id = ?, updated_at = NOW() WHERE id = ?")) {
            $u->bind_param('ssssi', $chJson, $liJson, $newStatus, $listId, $existing['id']);
            $u->execute();
            $u->close();
        }
    } else {
        if ($i = $conn->prepare("INSERT INTO clickup_detected_companies (user_id, norm_key, company_name, channels, list_ids, source_list_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")) {
            $i->bind_param('isssss', $userId, $normKey, $company, $channelsJson, $listIdsJson, $listId);
            $i->execute();
            $i->close();
        }
    }
    $conn->close();
} catch (Throwable $e) {
    error_log('[clickup-webhook] processing error: ' . $e->getMessage());
}
