<?php
// ============================================================================
// ClickUp integration — shared helpers (v1).
// Included by every clickup_*.php endpoint AFTER `include "db.php"`.
//   - .env loader + env reader (Hostinger getenv falls back to .env file)
//   - token encryption at rest (AES-256-CBC)
//   - schema ensure (clickup_connections + projects origin columns)
//   - ClickUp REST helper: RAW Authorization token (NO "Bearer"), 429 backoff
//   - OAuth code->token exchange
//   - connection get/save (one per user)
// Security: client_secret and tokens never leave the server; tokens never logged.
// ============================================================================

if (!function_exists('clickup_load_dotenv')) {
    function clickup_load_dotenv(): void {
        $candidates = [
            dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env',
            __DIR__          . DIRECTORY_SEPARATOR . '.env',
        ];
        foreach ($candidates as $path) {
            if (!is_file($path) || !is_readable($path)) continue;
            $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (!is_array($lines)) continue;
            foreach ($lines as $line) {
                $line = trim((string)$line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
                [$k, $v] = explode('=', $line, 2);
                $k = trim($k); $v = trim($v);
                if ($k === '') continue;
                if ((str_starts_with($v, '"') && str_ends_with($v, '"')) ||
                    (str_starts_with($v, "'") && str_ends_with($v, "'"))) {
                    $v = substr($v, 1, -1);
                }
                if (getenv($k) === false) putenv("$k=$v");
                $_ENV[$k]    ??= $v;
                $_SERVER[$k] ??= $v;
            }
            break;
        }
    }
}
clickup_load_dotenv();

if (!function_exists('clickup_env')) {
    function clickup_env(string $key, string $default = ''): string {
        $v = getenv($key);
        if (is_string($v) && $v !== '') return $v;
        if (isset($_ENV[$key])    && is_string($_ENV[$key])    && $_ENV[$key]    !== '') return $_ENV[$key];
        if (isset($_SERVER[$key]) && is_string($_SERVER[$key]) && $_SERVER[$key] !== '') return $_SERVER[$key];
        return $default;
    }
}

// ── OAuth / app config ──────────────────────────────────────────────────────
function clickup_client_id(): string     { return clickup_env('CLICKUP_CLIENT_ID'); }
function clickup_client_secret(): string  { return clickup_env('CLICKUP_CLIENT_SECRET'); }
function clickup_redirect_uri(): string   { return clickup_env('CLICKUP_REDIRECT_URI', 'https://testforge.chili.pa/api/clickup_callback.php'); }
// Space is fixed (per product decision): match by id OR by name substring.
function clickup_fixed_space_id(): string   { return clickup_env('CLICKUP_SPACE_ID'); }
function clickup_fixed_space_name(): string { return clickup_env('CLICKUP_SPACE_NAME', 'Campaign Delivery'); }

// ── Token encryption at rest (AES-256-CBC) ──────────────────────────────────
function clickup_secret_key(): string {
    $k = clickup_env('CLICKUP_TOKEN_KEY');
    if ($k === '') $k = clickup_env('APP_SECRET');
    if ($k === '') $k = clickup_env('DB_PASS', 'chiliforge-clickup-fallback-key');
    return hash('sha256', $k, true); // 32 raw bytes
}
function clickup_encrypt(string $plain): string {
    if ($plain === '') return '';
    $iv = random_bytes(16);
    $ct = openssl_encrypt($plain, 'aes-256-cbc', clickup_secret_key(), OPENSSL_RAW_DATA, $iv);
    if ($ct === false) return '';
    return base64_encode($iv . $ct);
}
function clickup_decrypt(string $enc): string {
    if ($enc === '') return '';
    $raw = base64_decode($enc, true);
    if ($raw === false || strlen($raw) < 17) return '';
    $iv = substr($raw, 0, 16);
    $ct = substr($raw, 16);
    $pt = openssl_decrypt($ct, 'aes-256-cbc', clickup_secret_key(), OPENSSL_RAW_DATA, $iv);
    return $pt === false ? '' : $pt;
}

// ── Schema ensure ───────────────────────────────────────────────────────────
function clickup_ensure_column(mysqli $conn, string $table, string $col, string $alterSql): void {
    $res = $conn->query("SHOW COLUMNS FROM `$table` LIKE '" . $conn->real_escape_string($col) . "'");
    if ($res) {
        $missing = ($res->num_rows === 0);
        $res->free();
        if ($missing) { @$conn->query($alterSql); }
    }
}
function clickup_ensure_schema(mysqli $conn): void {
    $conn->query(
        "CREATE TABLE IF NOT EXISTS clickup_connections (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NULL,
            token_expires_at DATETIME NULL,
            clickup_user_id VARCHAR(64) NULL,
            workspace_id VARCHAR(64) NULL,
            space_id VARCHAR(64) NULL,
            folder_id VARCHAR(64) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_clickup_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    clickup_ensure_column($conn, 'projects', 'source',           "ALTER TABLE projects ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'manual'");
    clickup_ensure_column($conn, 'projects', 'clickup_list_ids', "ALTER TABLE projects ADD COLUMN clickup_list_ids TEXT NULL");
    clickup_ensure_column($conn, 'projects', 'channels',         "ALTER TABLE projects ADD COLUMN channels TEXT NULL");

    // v3 — webhook (listCreated) detection of new companies.
    $conn->query(
        "CREATE TABLE IF NOT EXISTS clickup_webhooks (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            webhook_id VARCHAR(128) NOT NULL,
            folder_id VARCHAR(64) NOT NULL,       -- monitored location ('space:<id>' for folderless)
            endpoint VARCHAR(512) NOT NULL,
            secret TEXT NOT NULL,                 -- AES-256-CBC encrypted at rest
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            fail_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_webhook_id (webhook_id),
            KEY idx_user_folder (user_id, folder_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $conn->query(
        "CREATE TABLE IF NOT EXISTS clickup_detected_companies (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            norm_key VARCHAR(190) NOT NULL,       -- normalized company name
            company_name VARCHAR(255) NOT NULL,
            channels TEXT NULL,                   -- JSON array
            list_ids TEXT NULL,                   -- JSON array
            source_list_id VARCHAR(64) NULL,      -- the list that triggered it
            status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|dismissed|imported
            detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_user_company (user_id, norm_key),
            KEY idx_user_status (user_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// Parse a ClickUp List name "{CHANNEL} - {Company}" (split on the FIRST " - ", so
// multi-word channels like "SEO INT" work). Returns ['channel','company'] or null.
function clickup_parse_list_name(string $listName): ?array {
    $listName = trim($listName);
    if ($listName === '') return null;
    $pos = mb_strpos($listName, ' - ');
    if ($pos === false) return null;
    $channel = trim(mb_substr($listName, 0, $pos));
    $company = trim(mb_substr($listName, $pos + 3));
    if ($company === '') return null;
    return ['channel' => $channel, 'company' => $company];
}

// Normalized dedup key for a company name (lowercase, collapsed whitespace).
function clickup_norm_company_key(string $company): string {
    return mb_strtolower(trim(preg_replace('/\s+/', ' ', $company)));
}

// Verify a ClickUp webhook request: X-Signature = HMAC-SHA256(rawBody, secret) hex.
function clickup_verify_webhook_signature(string $rawBody, string $signatureHeader, string $secret): bool {
    if ($secret === '' || $signatureHeader === '') return false;
    $expected = hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, trim($signatureHeader));
}

// ── ClickUp REST helper ─────────────────────────────────────────────────────
// CRITICAL: ClickUp API v2 takes the token RAW in Authorization (no "Bearer").
// Returns ['code'=>int, 'data'=>array, 'error'=>string]. Retries 429 with backoff.
function clickup_api_request(string $token, string $method, string $path, ?array $body = null, string $version = 'v2'): array {
    $base = $version === 'v3' ? 'https://api.clickup.com/api/v3' : 'https://api.clickup.com/api/v2';
    $url = $base . $path;
    $attempt = 0;
    while (true) {
        $ch = curl_init($url);
        $headers = ['Authorization: ' . $token, 'Accept: application/json'];
        if ($body !== null) $headers[] = 'Content-Type: application/json';
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HEADER         => true,
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));

        $raw      = curl_exec($ch);
        $code     = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $hdrSize  = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return ['code' => 0, 'data' => [], 'error' => 'curl: ' . $curlErr];
        }
        $headerBlock = substr((string)$raw, 0, $hdrSize);
        $bodyBlock   = substr((string)$raw, $hdrSize);

        if ($code === 429 && $attempt < 4) {
            $retryAfter = 0;
            if (preg_match('/retry-after:\s*(\d+)/i', $headerBlock, $m)) $retryAfter = (int)$m[1];
            $wait = $retryAfter > 0 ? $retryAfter : min(8, 1 << $attempt);
            sleep($wait);
            $attempt++;
            continue;
        }

        $decoded = json_decode($bodyBlock, true);
        $data = is_array($decoded) ? $decoded : [];
        $error = '';
        if ($code >= 400) {
            $error = isset($data['err']) ? (string)$data['err']
                   : (isset($data['error']) ? (string)$data['error'] : ('HTTP ' . $code));
        }
        return ['code' => $code, 'data' => $data, 'error' => $error];
    }
}

// ── Docs API v3: fetch a Doc's full text (all pages, markdown) ──────────────
function clickup_fetch_doc_markdown(string $token, string $workspaceId, string $docId): string {
    $res = clickup_api_request($token, 'GET', "/workspaces/{$workspaceId}/docs/{$docId}/pages?content_format=text/md", null, 'v3');
    if (($res['code'] ?? 0) !== 200) return '';
    $d = $res['data'];
    $pages = is_array($d['pages'] ?? null) ? $d['pages'] : (is_array($d) ? $d : []);
    $out = [];
    foreach ($pages as $pg) {
        if (!is_array($pg)) continue;
        $title   = trim((string)($pg['name'] ?? ''));
        $content = (string)($pg['content'] ?? '');
        if ($title !== '')   $out[] = '## ' . $title;
        if ($content !== '') $out[] = $content;
    }
    return trim(implode("\n\n", $out));
}

// ── OAuth state (CSRF + binds the callback to the Forge user) ───────────────
function clickup_make_state(int $userId): string {
    $payload = $userId . '.' . dechex(time());
    $sig = hash_hmac('sha256', $payload, clickup_secret_key());
    return rtrim(strtr(base64_encode($payload . '|' . $sig), '+/', '-_'), '=');
}
function clickup_verify_state(string $state): int {
    $decoded = base64_decode(strtr($state, '-_', '+/'), true);
    if ($decoded === false || !str_contains($decoded, '|')) return 0;
    [$payload, $sig] = explode('|', $decoded, 2);
    $expected = hash_hmac('sha256', $payload, clickup_secret_key());
    if (!hash_equals($expected, $sig)) return 0;
    $parts = explode('.', $payload, 2);
    $userId = (int)($parts[0] ?? 0);
    $ts = isset($parts[1]) ? (int)hexdec($parts[1]) : 0;
    if ($userId <= 0 || $ts <= 0 || (time() - $ts) > 3600) return 0; // 1h TTL
    return $userId;
}

// ── OAuth code -> token ─────────────────────────────────────────────────────
function clickup_oauth_exchange_code(string $code): array {
    $url = 'https://api.clickup.com/api/v2/oauth/token?' . http_build_query([
        'client_id'     => clickup_client_id(),
        'client_secret' => clickup_client_secret(),
        'code'          => $code,
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    $raw  = curl_exec($ch);
    $code2 = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($raw === false) return ['ok' => false, 'error' => 'curl: ' . $err];
    $data = json_decode((string)$raw, true);
    if (!is_array($data) || empty($data['access_token'])) {
        $msg = is_array($data) && isset($data['err']) ? (string)$data['err'] : ('token exchange failed (HTTP ' . $code2 . ')');
        return ['ok' => false, 'error' => $msg];
    }
    return ['ok' => true, 'data' => $data];
}

// ── Connection persistence (one per user) ───────────────────────────────────
function clickup_get_connection(mysqli $conn, int $userId): ?array {
    $stmt = $conn->prepare(
        "SELECT id, access_token, refresh_token, token_expires_at, clickup_user_id, workspace_id, space_id, folder_id
         FROM clickup_connections WHERE user_id = ? LIMIT 1"
    );
    if (!$stmt) return null;
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $stmt->bind_result($id, $at, $rt, $exp, $cuId, $wsId, $spId, $foId);
    if (!$stmt->fetch()) { $stmt->close(); return null; }
    $stmt->close();
    return [
        'id'               => (int)$id,
        'access_token'     => clickup_decrypt((string)$at),
        'refresh_token'    => clickup_decrypt((string)($rt ?? '')),
        'token_expires_at' => $exp,
        'clickup_user_id'  => $cuId,
        'workspace_id'     => $wsId,
        'space_id'         => $spId,
        'folder_id'        => $foId,
    ];
}
function clickup_save_connection(mysqli $conn, int $userId, string $accessToken, ?string $refreshToken, ?string $expiresAt, ?string $clickupUserId, ?string $workspaceId): bool {
    $encAccess  = clickup_encrypt($accessToken);
    $encRefresh = $refreshToken ? clickup_encrypt($refreshToken) : null;
    $stmt = $conn->prepare(
        "INSERT INTO clickup_connections (user_id, access_token, refresh_token, token_expires_at, clickup_user_id, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            access_token = VALUES(access_token),
            refresh_token = VALUES(refresh_token),
            token_expires_at = VALUES(token_expires_at),
            clickup_user_id = VALUES(clickup_user_id),
            workspace_id = VALUES(workspace_id),
            updated_at = NOW()"
    );
    if (!$stmt) return false;
    $stmt->bind_param('isssss', $userId, $encAccess, $encRefresh, $expiresAt, $clickupUserId, $workspaceId);
    $ok = $stmt->execute();
    $stmt->close();
    return $ok;
}
