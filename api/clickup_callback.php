<?php
// OAuth redirect target. ClickUp sends ?code=...&state=... here.
// Exchanges the code for a token, saves the (encrypted) connection, then
// redirects the browser back into the Forge app. Browser-facing → redirects,
// not JSON. Tokens are never echoed/logged.

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$appBase = clickup_env('APP_BASE_URL', 'https://testforge.chili.pa');

function clickup_redirect_back(string $appBase, string $status, string $msg = ''): void {
    $url = rtrim($appBase, '/') . '/projects?clickup=' . rawurlencode($status);
    if ($msg !== '') $url .= '&msg=' . rawurlencode(substr($msg, 0, 160));
    header('Location: ' . $url, true, 302);
    exit;
}

// OAuth error returned by ClickUp (user denied, etc.)
if (isset($_GET['error']) && $_GET['error'] !== '') {
    clickup_redirect_back($appBase, 'denied', (string)$_GET['error']);
}

$code  = isset($_GET['code'])  ? trim((string)$_GET['code'])  : '';
$state = isset($_GET['state']) ? trim((string)$_GET['state']) : '';
if ($code === '' || $state === '') {
    clickup_redirect_back($appBase, 'error', 'Missing code/state from ClickUp.');
}

$userId = clickup_verify_state($state);
if ($userId <= 0) {
    clickup_redirect_back($appBase, 'error', 'Invalid or expired authorization state.');
}

clickup_ensure_schema($conn);

// 1) Exchange the code for an access token.
$exchange = clickup_oauth_exchange_code($code);
if (empty($exchange['ok'])) {
    error_log('[clickup_callback] token exchange failed: ' . ($exchange['error'] ?? 'unknown'));
    clickup_redirect_back($appBase, 'error', 'Could not exchange the ClickUp code for a token.');
}
$token        = (string)$exchange['data']['access_token'];
$refreshToken = isset($exchange['data']['refresh_token']) ? (string)$exchange['data']['refresh_token'] : null;
$expiresIn    = isset($exchange['data']['expires_in']) ? (int)$exchange['data']['expires_in'] : 0;
$expiresAt    = $expiresIn > 0 ? gmdate('Y-m-d H:i:s', time() + $expiresIn) : null;

// 2) Resolve the ClickUp user + first authorized workspace (team).
$clickupUserId = null;
$workspaceId   = null;
$userRes = clickup_api_request($token, 'GET', '/user');
if (($userRes['code'] ?? 0) === 200 && isset($userRes['data']['user']['id'])) {
    $clickupUserId = (string)$userRes['data']['user']['id'];
}
$teamRes = clickup_api_request($token, 'GET', '/team');
if (($teamRes['code'] ?? 0) === 200 && !empty($teamRes['data']['teams'][0]['id'])) {
    $workspaceId = (string)$teamRes['data']['teams'][0]['id'];
}

// 3) Persist (encrypted, one per user).
$saved = clickup_save_connection($conn, $userId, $token, $refreshToken, $expiresAt, $clickupUserId, $workspaceId);
if (!$saved) {
    error_log('[clickup_callback] failed to save connection for user ' . $userId);
    clickup_redirect_back($appBase, 'error', 'Could not save the ClickUp connection.');
}

$conn->close();
clickup_redirect_back($appBase, 'connected');
