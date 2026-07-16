<?php
// Shared helpers for all agents endpoints

// Estimated Gemini cost log (server error_log only; never returned to clients).
// Prices USD per 1M tokens — keep in sync with https://ai.google.dev/gemini-api/docs/pricing
// ── Gemini cost tracking (authoritative, exact-to-the-token) ─────────────────
// Single source of truth for pricing across PHP + the edge (the edge POSTs its raw
// usageMetadata to log-gemini-usage.php, which calls gemini_record_usage below, so BOTH
// PHP-native calls and edge calls land in ONE table with ONE price table).
if (!function_exists('gemini_pricing_table')) {
    // [input $/1M, text-output $/1M]. Image models bill their output separately (see below).
    function gemini_pricing_table(): array {
        return [
            'gemini-2.5-flash'        => [0.30, 2.50],
            'gemini-2.5-flash-lite'   => [0.10, 0.40],
            'gemini-2.5-pro'          => [1.25, 10.00],
            'gemini-3.5-flash'        => [1.50, 9.00],
            'gemini-3-flash-preview'  => [0.50, 3.00],
            'gemini-3-pro-preview'    => [2.00, 12.00],
            'gemini-2.5-flash-image'  => [0.30, 0.00],
            'gemini-3-pro-image'      => [2.00, 0.00],
            'gemini-3.1-flash-image'  => [0.50, 0.00],
        ];
    }
}
if (!function_exists('gemini_image_out_per_1m')) {
    // Image OUTPUT price per 1M tokens (image models bill the generated image as output tokens).
    function gemini_image_out_per_1m(string $model): float {
        $t = ['gemini-2.5-flash-image' => 30.0, 'gemini-3.1-flash-image' => 60.0, 'gemini-3-pro-image' => 120.0];
        foreach ($t as $k => $v) { if (strpos($model, $k) === 0) return $v; }
        return 0.0;
    }
}
if (!function_exists('gemini_calc_usd')) {
    // Exact USD for ONE call, from Google's real usageMetadata (prompt + output + THINKING tokens).
    // promptTokenCount already includes File Search retrieval + cached content, so retrieval is billed.
    function gemini_calc_usd(string $model, $usage): float {
        $P = gemini_pricing_table(); $rate = [0.30, 2.50];
        foreach ($P as $k => $v) { if (strpos($model, $k) === 0) { $rate = $v; break; } }
        $u = is_array($usage) ? $usage : [];
        $in    = (int)($u['promptTokenCount']    ?? $u['prompt_token_count']     ?? 0);
        $out   = (int)($u['candidatesTokenCount'] ?? $u['candidates_token_count'] ?? 0);
        $think = (int)($u['thoughtsTokenCount']   ?? $u['thoughts_token_count']   ?? 0); // billed at output rate
        $imgRate = gemini_image_out_per_1m($model);
        $inUsd  = ($in / 1000000) * $rate[0];
        $outUsd = $imgRate > 0
            ? ($out / 1000000) * $imgRate                 // image model: candidates = generated image
            : (($out + $think) / 1000000) * $rate[1];     // text/vision: candidates + thinking at output rate
        return $inUsd + $outUsd;
    }
}
if (!function_exists('gemini_record_usage')) {
    // Compute exact cost + PERSIST one call into the gemini_usage table. Returns the USD.
    // $conn optional — falls back to the global $conn (db.php). Never throws.
    function gemini_record_usage(string $source, string $model, $usage, ?int $jobId = null, ?string $meta = null, $conn = null): float {
        $usd = gemini_calc_usd($model, $usage);
        try {
            if (!$conn) { global $conn; }
            if ($conn instanceof mysqli) {
                $u = is_array($usage) ? $usage : [];
                $in    = (int)($u['promptTokenCount']    ?? $u['prompt_token_count']     ?? 0);
                $out   = (int)($u['candidatesTokenCount'] ?? $u['candidates_token_count'] ?? 0);
                $think = (int)($u['thoughtsTokenCount']   ?? $u['thoughts_token_count']   ?? 0);
                $cached= (int)($u['cachedContentTokenCount'] ?? $u['cached_content_token_count'] ?? 0);
                $metaS = $meta !== null ? mb_substr($meta, 0, 250) : null;
                $stmt = $conn->prepare("INSERT INTO gemini_usage (source, model, in_tokens, cached_tokens, out_tokens, thought_tokens, usd, job_id, meta) VALUES (?,?,?,?,?,?,?,?,?)");
                if ($stmt) {
                    $stmt->bind_param('ssiiiidis', $source, $model, $in, $cached, $out, $think, $usd, $jobId, $metaS);
                    $stmt->execute(); $stmt->close();
                }
            }
        } catch (\Throwable $e) {
            // Logging must never break the request — but a SILENT swallow is what hid the fact
            // that the gemini_usage table didn't exist, so the whole ledger recorded nothing for
            // a long time. Surface the reason in the server log without ever throwing.
            error_log('[cost] persist FAILED (' . $e->getMessage() . ') — is the gemini_usage table created?');
        }
        error_log(sprintf('[cost] fn=%s model=%s ~=$%.5f', $source, $model, $usd));
        return $usd;
    }
}
if (!function_exists('gemini_log_cost')) {
    // Back-compat wrapper — existing callers (chat, setup-wizard) now persist exactly.
    function gemini_log_cost(string $fn, string $model, $usage): void {
        try { gemini_record_usage($fn, $model, $usage); } catch (\Throwable $e) { /* never break */ }
    }
}

if (!function_exists('agents_starts_with')) {
    function agents_starts_with(string $haystack, string $needle): bool {
        return $needle === '' || strpos($haystack, $needle) === 0;
    }
}

if (!function_exists('agents_contains')) {
    function agents_contains(string $haystack, string $needle): bool {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}

if (!function_exists('agents_has_base64_image')) {
    /**
     * Detect a base64 image data URI (data:image/...;base64,...) anywhere in the text.
     * Bounded scan (checks only the 64 chars after each "data:image/"), no preg_*.
     */
    function agents_has_base64_image(string $content): bool {
        if ($content === '') return false;
        $offset = 0;
        while (($pos = stripos($content, 'data:image/', $offset)) !== false) {
            if (stripos(substr($content, $pos, 64), 'base64,') !== false) return true;
            $offset = $pos + 11;
        }
        return false;
    }
}

if (!function_exists('agents_strip_base64_images')) {
    /**
     * Replace base64 image data URIs in HTML/markdown with a short placeholder BEFORE
     * the content is sent to Gemini (File Search store or text prompts).
     *
     * Why: a single inlined `data:image/...;base64,...` can be hundreds of KB of text.
     * Once indexed in a store and retrieved into every generation, it costs millions of
     * TEXT tokens. The model only needs the example's layout/structure, not the raw bytes.
     *
     * Uses strpos/substr/strcspn (NOT preg_*) on purpose: multi-MB base64 blows
     * pcre.backtrack_limit and makes preg_* fail silently.
     */
    function agents_strip_base64_images(string $content): string {
        if ($content === '' || stripos($content, 'data:image/') === false) {
            return $content;
        }
        $out = '';
        $offset = 0;
        $len = strlen($content);
        while (($pos = stripos($content, 'data:image/', $offset)) !== false) {
            $out .= substr($content, $offset, $pos - $offset);
            // The data URI runs until the next delimiter (quote, paren, angle, space).
            $tokenLen = strcspn($content, "\"')<> \t\r\n", $pos);
            $uri = substr($content, $pos, $tokenLen);
            if (stripos($uri, 'base64,') !== false) {
                $out .= '[base64-image-removed]';
            } else {
                // Small non-base64 data URIs (e.g. svg+xml;utf8,...) are kept as-is.
                $out .= $uri;
            }
            $offset = $pos + $tokenLen;
            if ($offset >= $len) break;
        }
        $out .= substr($content, $offset);
        return $out;
    }
}

if (!function_exists('agents_assert_no_base64_for_gemini')) {
    /**
     * Fail-closed guard: if base64 image data is present in text bound for Gemini,
     * reject the request (HTTP 422) instead of sending it. Prevents the massive token
     * cost of a base64 image being tokenized as text. Legitimate images must be sent
     * as files/URLs (proper inline_data image parts are handled separately).
     */
    function agents_assert_no_base64_for_gemini(string $content, string $context = 'request'): void {
        if (agents_has_base64_image($content)) {
            http_response_code(422);
            echo json_encode([
                'error' => 'Blocked: base64 image detected in Gemini input (' . $context . '). '
                         . 'Images must be saved to a file and referenced by URL — base64 in prompt text is rejected to avoid massive token cost.',
                'code'  => 'base64_in_gemini_input',
            ]);
            exit;
        }
    }
}

if (!function_exists('agents_strip_base64_images')) {
    /**
     * Replace base64 image data URIs in HTML/markdown with a short placeholder
     * BEFORE the content is sent to Gemini (File Search store or text prompts).
     *
     * Why: a single inlined `data:image/...;base64,...` can be hundreds of KB of
     * text. Once indexed in a store and retrieved into every generation, it costs
     * millions of TEXT tokens. The model only needs the example's layout/structure,
     * not the raw image bytes.
     *
     * Uses strpos/substr/strcspn (NOT preg_*) on purpose: multi-MB base64 blows
     * pcre.backtrack_limit and makes preg_* fail silently.
     */
    function agents_strip_base64_images(string $content): string {
        if ($content === '' || stripos($content, 'data:image/') === false) {
            return $content;
        }
        $out = '';
        $offset = 0;
        $len = strlen($content);
        while (($pos = stripos($content, 'data:image/', $offset)) !== false) {
            $out .= substr($content, $offset, $pos - $offset);
            // The data URI runs until the next delimiter (quote, paren, angle, space).
            $tokenLen = strcspn($content, "\"')<> \t\r\n", $pos);
            $uri = substr($content, $pos, $tokenLen);
            if (stripos($uri, 'base64,') !== false) {
                $out .= '[base64-image-removed]';
            } else {
                // Small non-base64 data URIs (e.g. svg+xml;utf8,...) are kept as-is.
                $out .= $uri;
            }
            $offset = $pos + $tokenLen;
            if ($offset >= $len) break;
        }
        $out .= substr($content, $offset);
        return $out;
    }
}

if (!function_exists('agents_env_value')) {
    function agents_env_value(string $key, string $default = ''): string {
        $value = getenv($key);

        if ((!is_string($value) || trim($value) === '') && isset($_ENV[$key])) {
            $value = $_ENV[$key];
        }

        if (!is_string($value) || trim($value) === '') {
            $envPath = realpath(__DIR__ . '/../../../.env');
            if ($envPath && is_readable($envPath)) {
                $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines ?: [] as $line) {
                    $line = trim($line);
                    if ($line === '' || agents_starts_with($line, '#') || !agents_contains($line, '=')) {
                        continue;
                    }

                    [$envKey, $envValue] = explode('=', $line, 2);
                    if (trim($envKey) === $key) {
                        $value = trim($envValue);
                        break;
                    }
                }
            }
        }

        if (!is_string($value) || trim($value) === '') {
            return $default;
        }

        return trim(trim($value), "\"'");
    }
}

if (!function_exists('agents_env_value_from_file')) {
    // Read a key ONLY from the .env file, ignoring getenv()/$_ENV. Used to
    // recover the legacy service-role JWT when a host-level env var overrides
    // it with the new (non-JWT) sb_secret key format.
    function agents_env_value_from_file(string $key, string $default = ''): string {
        $envPath = realpath(__DIR__ . '/../../../.env');
        if ($envPath && is_readable($envPath)) {
            $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || agents_starts_with($line, '#') || !agents_contains($line, '=')) {
                    continue;
                }
                [$envKey, $envValue] = explode('=', $line, 2);
                if (trim($envKey) === $key) {
                    return trim(trim((string)$envValue), "\"'");
                }
            }
        }
        return $default;
    }
}

if (!function_exists('agents_is_jwt')) {
    function agents_is_jwt(string $value): bool {
        return substr_count($value, '.') === 2;
    }
}

if (!function_exists('agents_new_db_connection')) {
    function agents_new_db_connection(): mysqli {
        $host = agents_env_value('DB_HOST', 'localhost');
        $user = agents_env_value('DB_USER', 'u427845891_forge_admin');
        $pass = agents_env_value('DB_PASS', 'ChiliForge2026@');
        $db   = agents_env_value('DB_NAME', 'u427845891_chiliforge');

        $next = new mysqli($host, $user, $pass, $db);
        if ($next->connect_error) {
            throw new RuntimeException('Database reconnect error: ' . $next->connect_error);
        }

        $next->set_charset('utf8mb4');
        @$next->query('SET SESSION wait_timeout = 28800');
        @$next->query('SET SESSION interactive_timeout = 28800');
        @$next->query('SET SESSION net_read_timeout = 300');
        @$next->query('SET SESSION net_write_timeout = 300');
        return $next;
    }
}

if (!function_exists('agents_reconnect_mysqli_if_needed')) {
    function agents_reconnect_mysqli_if_needed(mysqli &$conn): void {
        $alive = false;
        try {
            $alive = @$conn->ping();
        } catch (Throwable $e) {
            $alive = false;
        }

        if ($alive) return;

        try {
            @$conn->close();
        } catch (Throwable $e) {
            // Ignore close failures; the connection is already unusable.
        }

        $conn = agents_new_db_connection();
    }
}

if (!function_exists('agents_get_user_gemini_key')) {
    function agents_get_user_gemini_key(mysqli $conn, int $userId): string {
        if ($userId <= 0) return '';
        $stmt = $conn->prepare("SELECT gemini_api_key FROM users WHERE id = ? LIMIT 1");
        if (!$stmt) return '';
        $stmt->bind_param('i', $userId);
        $stmt->execute();
        $stmt->bind_result($key);
        $stmt->fetch();
        $stmt->close();
        return is_string($key) ? trim($key) : '';
    }
}

if (!function_exists('agents_call_edge_function')) {
    /**
     * @param int|null $timeoutSeconds Total curl budget. Defaults to 580 (long jobs run detached
     *   with no PHP time limit). Callers still inside a live HTTP request MUST pass a budget that
     *   fits under their set_time_limit() and the front-end proxy's ~120s cut, otherwise the proxy
     *   kills the request and the caller sees a 500/503 instead of a handled failure.
     */
    function agents_call_edge_function(string $name, array $payload, ?string $geminiApiKey = null, ?int $timeoutSeconds = null): array {
        if ($geminiApiKey !== null && trim($geminiApiKey) !== '') {
            $payload['geminiApiKey'] = trim($geminiApiKey);
        }

        // Defense-in-depth chokepoint: no base64 image may reach Gemini via an edge call.
        // - Store-bound text (documentText/learningsText) is STRIPPED so the File Search
        //   store stays lean (a single inlined image otherwise costs millions of tokens on
        //   every later retrieval).
        // - Any other text field carrying a base64 image is a leak and is BLOCKED
        //   (fail-closed): images must be saved to files and passed as URLs.
        // - fileBase64 (raw file-upload channel) and geminiApiKey are exempt.
        $guardBase64 = function ($val, string $key) use (&$guardBase64, $name) {
            if (is_array($val)) {
                $out = [];
                foreach ($val as $k => $v) { $out[$k] = $guardBase64($v, (string)$k); }
                return $out;
            }
            if (is_string($val) && $val !== '') {
                if ($key === 'documentText' || $key === 'learningsText') {
                    return agents_strip_base64_images($val);
                }
                if ($key !== 'fileBase64' && $key !== 'geminiApiKey' && agents_has_base64_image($val)) {
                    throw new RuntimeException(
                        'Blocked: base64 image detected in field "' . $key . '" sent to Gemini edge function "'
                        . $name . '". Save the image to a file and pass its URL instead of inline base64.'
                    );
                }
            }
            return $val;
        };
        $payload = $guardBase64($payload, '');

        $baseUrl = rtrim(agents_env_value('SUPABASE_URL', 'https://vehowvyqxhelyfdesmog.supabase.co'), '/');
        $key     = agents_env_value('SUPABASE_SERVICE_ROLE_KEY');

        // A host-level env var may override the .env with the new (non-JWT)
        // sb_secret key, which Storage rejects ("Invalid Compact JWS"). When the
        // resolved value is not a JWT, recover the legacy JWT directly from .env.
        if (!agents_is_jwt($key)) {
            $fromFile = agents_env_value_from_file('SUPABASE_SERVICE_ROLE_KEY');
            if (agents_is_jwt($fromFile)) {
                $key = $fromFile;
            }
        }

        if ($key === '' || !agents_is_jwt($key)) {
            throw new RuntimeException('SUPABASE_SERVICE_ROLE_KEY is missing or is not a JWT. Configure the service role JWT on the PHP server; sb_publishable keys cannot call protected Edge Functions as Bearer tokens.');
        }

        // Pass the working service-role JWT to the Edge so it can upload generated images to
        // Supabase Storage. The Edge's auto-injected SUPABASE_SERVICE_ROLE_KEY is the new
        // (non-JWT) key format, which the Storage API rejects ("Invalid Compact JWS"); this
        // legacy JWT is the one proven to authenticate against Storage.
        if (!isset($payload['storageKey'])) {
            $payload['storageKey'] = $key;
        }

        $url     = $baseUrl . '/functions/v1/' . $name;

        $timeout = ($timeoutSeconds !== null && $timeoutSeconds > 0) ? $timeoutSeconds : 580;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'apikey: '               . $key,
                'Authorization: Bearer ' . $key,
            ],
        ]);

        $body     = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        unset($ch);

        if ($body === false) throw new RuntimeException("curl error calling {$name}: {$curlErr}");
        if ($httpCode >= 400) throw new RuntimeException("Edge function {$name} returned HTTP {$httpCode}: " . substr((string)$body, 0, 400));

        $decoded = json_decode((string)$body, true);
        if ($decoded === null) throw new RuntimeException("Invalid JSON from {$name}: " . substr((string)$body, 0, 200));
        return $decoded;
    }
}

if (!function_exists('agents_call_edge_function_multi')) {
    /**
     * Fire several edge-function calls CONCURRENTLY (curl_multi) and return all results.
     * Used to parallelize per-batch ad generation so total time ≈ the slowest batch
     * instead of the sum. Never throws for a single failed call — each entry reports ok/error.
     *
     * @param array<int|string,array> $payloads  keyed payloads (key is echoed back in the result)
     * @return array<int|string,array{ok:bool,data:?array,http:int,error:?string}>
     */
    function agents_call_edge_function_multi(string $name, array $payloads, ?string $geminiApiKey = null): array {
        if (empty($payloads)) return [];

        $baseUrl = rtrim(agents_env_value('SUPABASE_URL', 'https://vehowvyqxhelyfdesmog.supabase.co'), '/');
        $key     = agents_env_value('SUPABASE_SERVICE_ROLE_KEY');
        if (!agents_is_jwt($key)) {
            $fromFile = agents_env_value_from_file('SUPABASE_SERVICE_ROLE_KEY');
            if (agents_is_jwt($fromFile)) $key = $fromFile;
        }
        if ($key === '' || !agents_is_jwt($key)) {
            throw new RuntimeException('SUPABASE_SERVICE_ROLE_KEY is missing or is not a JWT.');
        }
        $url = $baseUrl . '/functions/v1/' . $name;
        $gk  = ($geminiApiKey !== null && trim($geminiApiKey) !== '') ? trim($geminiApiKey) : null;

        // Same fail-closed base64 guard as the single-call path.
        $guard = function ($val, string $k) use (&$guard, $name) {
            if (is_array($val)) {
                $out = [];
                foreach ($val as $kk => $vv) { $out[$kk] = $guard($vv, (string)$kk); }
                return $out;
            }
            if (is_string($val) && $val !== '') {
                if ($k === 'documentText' || $k === 'learningsText') return agents_strip_base64_images($val);
                if ($k !== 'fileBase64' && $k !== 'geminiApiKey' && agents_has_base64_image($val)) {
                    throw new RuntimeException('Blocked: base64 image in field "' . $k . '" to edge "' . $name . '".');
                }
            }
            return $val;
        };

        $mh = curl_multi_init();
        $handles = [];
        foreach ($payloads as $pkey => $payload) {
            if ($gk !== null) $payload['geminiApiKey'] = $gk;
            $payload = $guard($payload, '');
            if (!isset($payload['storageKey'])) $payload['storageKey'] = $key;
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 580,
                CURLOPT_HTTPHEADER     => [
                    'Content-Type: application/json',
                    'apikey: '               . $key,
                    'Authorization: Bearer ' . $key,
                ],
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$pkey] = $ch;
        }

        $running = null;
        do {
            curl_multi_exec($mh, $running);
            if ($running > 0) curl_multi_select($mh, 1.0);
        } while ($running > 0);

        $results = [];
        foreach ($handles as $pkey => $ch) {
            $body = curl_multi_getcontent($ch);
            $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            if ($body === false || $body === null || $body === '') {
                $results[$pkey] = ['ok' => false, 'data' => null, 'http' => $http, 'error' => ($err ?: 'empty response')];
            } elseif ($http >= 400) {
                $results[$pkey] = ['ok' => false, 'data' => null, 'http' => $http, 'error' => "HTTP {$http}: " . substr((string)$body, 0, 400)];
            } else {
                $decoded = json_decode((string)$body, true);
                $results[$pkey] = ($decoded === null)
                    ? ['ok' => false, 'data' => null, 'http' => $http, 'error' => 'Invalid JSON: ' . substr((string)$body, 0, 200)]
                    : ['ok' => true, 'data' => $decoded, 'http' => $http, 'error' => null];
            }
        }
        curl_multi_close($mh);
        return $results;
    }
}

if (!function_exists('agents_delete_gemini_file_search_document')) {
    function agents_delete_gemini_file_search_document(string $documentName): bool {
        $documentName = trim($documentName);
        if ($documentName === '') return false;

        $apiKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING');
        if ($apiKey === '') {
            throw new RuntimeException('GEMINI_API_KEY_PRODUCTION or GEMINI_API_KEY_TESTING is required to delete File Search documents');
        }

        $url = 'https://generativelanguage.googleapis.com/v1beta/' . $documentName . '?key=' . rawurlencode($apiKey);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => 'DELETE',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 60,
        ]);

        $body = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        unset($ch);

        if ($body === false) throw new RuntimeException("curl error deleting Gemini document: {$curlErr}");
        if ($httpCode === 404) return false;
        if ($httpCode >= 400) throw new RuntimeException('Gemini document delete returned HTTP ' . $httpCode . ': ' . substr((string)$body, 0, 300));
        return true;
    }
}

if (!function_exists('agents_extract_document_name')) {
    function agents_extract_document_name(array $storeResult): ?string {
        if (isset($storeResult['document']['documentName']) && is_string($storeResult['document']['documentName'])) {
            return $storeResult['document']['documentName'];
        }
        if (isset($storeResult['document']['name']) && is_string($storeResult['document']['name'])) {
            return $storeResult['document']['name'];
        }
        if (isset($storeResult['operationName']) && is_string($storeResult['operationName'])) {
            return $storeResult['operationName'];
        }
        return null;
    }
}

if (!function_exists('agents_ensure_company_store_files_table')) {
    function agents_ensure_company_store_files_table(mysqli $conn): void {
        $createSql = "CREATE TABLE IF NOT EXISTS company_store_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_project_id INT NOT NULL,
            gemini_file_uri VARCHAR(500) NULL,
            gemini_store_name VARCHAR(255) NULL,
            record_type ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file',
            display_name VARCHAR(255) NOT NULL,
            original_name VARCHAR(255) NULL,
            mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
            file_size_bytes INT NULL,
            storage_path VARCHAR(500) NULL,
            uploaded_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_csf_company (company_project_id),
            INDEX idx_csf_record_type (record_type)
        )";
        if (!$conn->query($createSql)) {
            throw new RuntimeException('Failed to ensure company_store_files table: ' . $conn->error);
        }

        $columns = [
            "gemini_store_name VARCHAR(255) NULL AFTER gemini_file_uri",
            "record_type ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file' AFTER gemini_store_name",
            "original_name VARCHAR(255) NULL AFTER display_name",
            "storage_path VARCHAR(500) NULL AFTER file_size_bytes",
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_store_files' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE company_store_files ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add company_store_files.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_ensure_ads_campaign_memory_columns')) {
    function agents_ensure_ads_campaign_memory_columns(mysqli $conn): void {
        $columns = [
            "creative_plans LONGTEXT NULL AFTER metadata",
            "gemini_memory_store VARCHAR(255) NULL DEFAULT NULL AFTER creative_plans",
            "gemini_good_examples_store VARCHAR(255) NULL DEFAULT NULL AFTER gemini_memory_store",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ads_campaign' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE ads_campaign ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add ads_campaign.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_save_campaign_creative_plan')) {
    function agents_save_campaign_creative_plan(mysqli $conn, int $campaignId, array $formData, string $creativePlanText, string $source = ''): void {
        $creativePlanText = trim($creativePlanText);
        if ($campaignId <= 0 || $creativePlanText === '') return;

        agents_ensure_ads_campaign_memory_columns($conn);

        $plansStmt = $conn->prepare("SELECT creative_plans FROM ads_campaign WHERE id = ? LIMIT 1");
        if (!$plansStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $plansStmt->bind_param('i', $campaignId);
        $plansStmt->execute();
        $plansStmt->bind_result($existingPlansJson);
        $plansStmt->fetch();
        $plansStmt->close();

        $plans = json_decode($existingPlansJson ?: '[]', true);
        if (!is_array($plans)) $plans = [];

        $selectedFormats = $formData['selectedFormats'] ?? [];
        $formatLabels = is_array($selectedFormats) ? array_values(array_filter(array_column($selectedFormats, 'label'))) : [];

        $nextPlan = [
            'date'    => date('Y-m-d H:i'),
            'plan'    => $creativePlanText,
            'formats' => $formatLabels,
        ];
        if ($source !== '') $nextPlan['source'] = $source;

        array_unshift($plans, $nextPlan);
        $plans = array_slice($plans, 0, 10);

        $jsonPlans = json_encode($plans, JSON_UNESCAPED_UNICODE);
        if (!$jsonPlans) throw new RuntimeException('Failed to encode creative plans');

        $updPlans = $conn->prepare("UPDATE ads_campaign SET creative_plans = ? WHERE id = ?");
        if (!$updPlans) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $updPlans->bind_param('si', $jsonPlans, $campaignId);
        $updPlans->execute();
        $updPlans->close();
    }
}

if (!function_exists('agents_ensure_campaign_examples_table')) {
    function agents_ensure_campaign_examples_table(mysqli $conn): void {
        $createSql = "CREATE TABLE IF NOT EXISTS ads_campaign_examples (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT NOT NULL,
            creative_id INT NOT NULL,
            gemini_store_name VARCHAR(255) NULL,
            gemini_document_name VARCHAR(500) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_campaign_example (campaign_id, creative_id),
            INDEX idx_campaign_examples_campaign (campaign_id),
            INDEX idx_campaign_examples_creative (creative_id)
        )";
        if (!$conn->query($createSql)) {
            throw new RuntimeException('Failed to ensure ads_campaign_examples table: ' . $conn->error);
        }

        $columns = [
            "gemini_store_name VARCHAR(255) NULL AFTER creative_id",
            "gemini_document_name VARCHAR(500) NULL AFTER gemini_store_name",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ads_campaign_examples' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE ads_campaign_examples ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add ads_campaign_examples.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_upsert_company_profile_record')) {
    function agents_upsert_company_profile_record(
        mysqli $conn,
        int $companyProjectId,
        string $storeName,
        ?string $documentName,
        int $userId = 0
    ): void {
        agents_ensure_company_store_files_table($conn);

        $recordType = 'company_profile';
        $displayName = 'Company Profile / Brand Guidelines';
        $mimeType = 'text/plain';
        $fileSize = null;
        $uploadedBy = $userId > 0 ? $userId : null;

        $selectStmt = $conn->prepare(
            "SELECT id FROM company_store_files
             WHERE company_project_id = ? AND record_type = 'company_profile'
             ORDER BY id DESC LIMIT 1"
        );
        if (!$selectStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $selectStmt->bind_param('i', $companyProjectId);
        $selectStmt->execute();
        $selectStmt->bind_result($existingId);
        $hasExisting = $selectStmt->fetch();
        $selectStmt->close();

        if ($hasExisting) {
            $updateStmt = $conn->prepare(
                "UPDATE company_store_files
                 SET gemini_file_uri = COALESCE(?, gemini_file_uri),
                     gemini_store_name = ?,
                     display_name = ?,
                     mime_type = ?,
                     uploaded_by = COALESCE(uploaded_by, ?)
                 WHERE id = ?"
            );
            if (!$updateStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $updateStmt->bind_param('ssssii', $documentName, $storeName, $displayName, $mimeType, $uploadedBy, $existingId);
            $updateStmt->execute();
            $updateStmt->close();
            return;
        }

        $insertStmt = $conn->prepare(
            "INSERT INTO company_store_files
             (company_project_id, gemini_file_uri, gemini_store_name, record_type, display_name, mime_type, file_size_bytes, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        if (!$insertStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $insertStmt->bind_param('isssssii', $companyProjectId, $documentName, $storeName, $recordType, $displayName, $mimeType, $fileSize, $uploadedBy);
        $insertStmt->execute();
        $insertStmt->close();
    }
}

if (!function_exists('agents_sync_company_store')) {
    function agents_sync_company_store(
        mysqli $conn,
        int $companyProjectId,
        array $companyFormData,
        string $accountType,
        int $userId = 0,
        ?string $existingStoreName = null,
        ?string $geminiApiKey = null,
        ?int $timeoutSeconds = null
    ): string {
        $companyDocument = buildCompanyDocument($companyFormData);

        $storeResult = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'storeName'     => $existingStoreName ?: null,
            'displayName'   => 'company-' . $companyProjectId . '-brandguide',
            'documentText'  => $companyDocument,
            'documentLabel' => 'Brand Guidelines',
            'accountType'   => $accountType,
        ], $geminiApiKey, $timeoutSeconds);

        if (empty($storeResult['storeName'])) {
            throw new RuntimeException('agents-store did not return a storeName');
        }

        $storeName = (string)$storeResult['storeName'];
        $documentName = agents_extract_document_name($storeResult);

        agents_reconnect_mysqli_if_needed($conn);

        $saveStmt = $conn->prepare("UPDATE projects SET gemini_store_name = ? WHERE id = ?");
        if (!$saveStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $saveStmt->bind_param('si', $storeName, $companyProjectId);
        $saveStmt->execute();
        $saveStmt->close();

        agents_reconnect_mysqli_if_needed($conn);
        agents_upsert_company_profile_record($conn, $companyProjectId, $storeName, $documentName, $userId);

        return $storeName;
    }
}

if (!function_exists('buildCompanyDocument')) {
    function buildCompanyDocument(array $fd): string {
        $str = fn($v) => is_string($v) ? trim($v) : '';
        $arr = fn($v) => is_array($v) ? array_filter(array_map('strval', $v)) : [];

        $theme    = is_array($fd['theme']       ?? null) ? $fd['theme']       : [];
        $images   = is_array($fd['images']      ?? null) ? $fd['images']      : [];
        $contact  = is_array($fd['contact']     ?? null) ? $fd['contact']     : [];
        $social   = is_array($fd['socialLinks'] ?? null) ? $fd['socialLinks'] : [];
        $location = is_array($fd['location']    ?? null) ? $fd['location']    : [];

        $name = $str($fd['businessName'] ?? $fd['brandName'] ?? '');
        $doc  = "# {$name} — Brand & Marketing Guidelines\n\n";

        $industry = $str($fd['businessCategory'] ?? $fd['industry'] ?? '');
        if ($industry !== '') $doc .= "Industry: {$industry}\n\n";

        $desc = $str($fd['businessDescription'] ?? '');
        if ($desc !== '') $doc .= "## Company Overview\n{$desc}\n\n";

        $services = $arr($fd['services'] ?? []);
        if (!empty($services)) {
            $doc .= "## Products & Services\n" . implode("\n", array_map(fn($s) => "- {$s}", $services)) . "\n\n";
        }

        $audience = $str($fd['targetAudience']    ?? '');
        $value    = $str($fd['valueProposition']  ?? '');
        $diff     = implode(', ', $arr($fd['differentiators'] ?? []));
        if ($audience !== '' || $value !== '' || $diff !== '') {
            $doc .= "## Target Audience & Positioning\n";
            if ($audience !== '') $doc .= "Audience: {$audience}\n";
            if ($value    !== '') $doc .= "Value Proposition: {$value}\n";
            if ($diff     !== '') $doc .= "Differentiators: {$diff}\n";
            $doc .= "\n";
        }

        $tone        = $str($fd['toneOfVoice']      ?? '');
        $personality = $str($fd['brandPersonality'] ?? '');
        $keywords    = $str($fd['brandKeywords']    ?? '');
        $forbidden   = $str($fd['forbiddenWords']   ?? '');
        if ($tone !== '' || $personality !== '' || $keywords !== '' || $forbidden !== '') {
            $doc .= "## Brand Voice\n";
            if ($tone        !== '') $doc .= "Tone: {$tone}\n";
            if ($personality !== '') $doc .= "Personality: {$personality}\n";
            if ($keywords    !== '') $doc .= "Required keywords: {$keywords}\n";
            if ($forbidden   !== '') $doc .= "Forbidden words: {$forbidden}\n";
            $doc .= "\n";
        }

        $primary    = $str($theme['primary']    ?? $fd['primaryColor']    ?? '');
        $secondary  = $str($theme['secondary']  ?? $fd['secondaryColor']  ?? '');
        $accent     = $str($theme['accent']     ?? $fd['accentColor']     ?? '');
        $background = $str($theme['background'] ?? $fd['backgroundColor'] ?? '');
        $textColor  = $str($theme['text']       ?? $fd['textColor']       ?? '');
        $hFont      = $str($theme['headingFont'] ?? $fd['headingFont']    ?? '');
        $bFont      = $str($theme['bodyFont']   ?? $fd['bodyFont']        ?? '');
        $style      = $str($theme['style']      ?? $fd['preferredStyle']  ?? '');
        $logo       = $str($images['logo']      ?? $images['logoUrl']     ?? $fd['logoUrl']   ?? '');
        $hero       = $str($images['hero']      ?? $images['heroImage1']  ?? $fd['heroImage'] ?? '');

        if ($primary !== '' || $logo !== '' || $hFont !== '') {
            $doc .= "## Visual Identity\n";
            if ($primary    !== '') $doc .= "Primary color: {$primary}\n";
            if ($secondary  !== '') $doc .= "Secondary color: {$secondary}\n";
            if ($accent     !== '') $doc .= "Accent color: {$accent}\n";
            if ($background !== '') $doc .= "Background color: {$background}\n";
            if ($textColor  !== '') $doc .= "Text color: {$textColor}\n";
            if ($hFont      !== '') $doc .= "Heading font: {$hFont}\n";
            if ($bFont      !== '') $doc .= "Body font: {$bFont}\n";
            if ($style      !== '') $doc .= "Style: {$style}\n";
            if ($logo       !== '') $doc .= "Logo URL: {$logo}\n";
            if ($hero       !== '') $doc .= "Hero image URL: {$hero}\n";
            $doc .= "\n";
        }

        $sections = $arr($images['sections'] ?? $images['productImages'] ?? $fd['productImages'] ?? []);
        if (!empty($sections)) {
            $doc .= "## Additional Images\n" . implode("\n", array_map(fn($u) => "- {$u}", $sections)) . "\n\n";
        }

        $city    = $str($location['city']    ?? $fd['city']    ?? '');
        $country = $str($location['country'] ?? $fd['country'] ?? '');
        $email   = $str($contact['email']    ?? $fd['email']   ?? '');
        $phone   = $str($contact['phone']    ?? $fd['phone']   ?? '');
        $wa      = $str($contact['whatsapp'] ?? $fd['whatsapp'] ?? '');
        $website = $str($fd['sourceWebsite'] ?? '');
        $loc     = trim("{$city}, {$country}", ', ');

        if ($loc !== '' || $email !== '' || $phone !== '' || $wa !== '' || $website !== '') {
            $doc .= "## Contact & Location\n";
            if ($loc     !== '') $doc .= "Location: {$loc}\n";
            if ($email   !== '') $doc .= "Email: {$email}\n";
            if ($phone   !== '') $doc .= "Phone: {$phone}\n";
            if ($wa      !== '') $doc .= "WhatsApp: {$wa}\n";
            if ($website !== '') $doc .= "Website: {$website}\n";
            $doc .= "\n";
        }

        foreach ($social as $platform => $url) {
            if (is_string($url) && trim($url) !== '') {
                $doc .= strtoupper($platform) . ': ' . trim($url) . "\n";
            }
        }

        // Brand visual identity from Instagram profile analysis — the most important signal
        // for compose mode background generation. Stored verbatim from the scraper output.
        // brandVisualBrief = gerado pelo modo brand_visual (company-assets); brandVisualGuidelines = campo legado.
        $brandVisualGuidelines = $str($fd['brandVisualBrief'] ?? $fd['brandVisualGuidelines'] ?? '');
        if ($brandVisualGuidelines !== '') {
            $doc .= "## Brand Visual Identity — Instagram Profile Analysis\n";
            $doc .= "COMPOSE BACKGROUND DIRECTIVE: The following visual identity was extracted from this brand's own Instagram profile. ";
            $doc .= "When generating advertising backgrounds (compose mode), these elements MUST be embodied. ";
            $doc .= "Treat them as the brand's visual DNA — not optional inspiration.\n\n";
            $doc .= $brandVisualGuidelines . "\n\n";
        }

        // Competitor layout examples — for composition/layout inspiration ONLY.
        // Never use these for brand identity, colors, typography, or visual style.
        $competitorLayoutExamples = $str($fd['competitorLayoutExamples'] ?? '');
        if ($competitorLayoutExamples !== '') {
            $doc .= "## Competitor Layout Examples — FOR LAYOUT INSPIRATION ONLY\n";
            $doc .= "STRICT RESTRICTION: The following patterns come from COMPETITOR brands. ";
            $doc .= "Use ONLY for composition structure, subject placement, whitespace ratios, and visual hierarchy. ";
            $doc .= "FORBIDDEN to use: any competitor color, brand element, typography style, logo, identity mark, or visual aesthetic. ";
            $doc .= "This brand's identity comes exclusively from its own Brand Visual Identity section above.\n\n";
            $doc .= $competitorLayoutExamples . "\n\n";
        }

        // Prescriptive rules for ad generation — consumed by the planner and HTML generator
        $adRules = [];
        $adRules[] = $logo !== ''
            ? "ABSOLUTE LOGO LOCK: Logo URL: {$logo} - every ad must contain at least one visible instance of this exact original logo asset as <img> with object-fit:contain. Reinterpreted logos are NOT logos: similar generated marks, redrawn symbols, monograms, recolored versions, decorative brand-like shapes, or fake logos do not count. Never redraw, recolor, stylize, warp, crop, add effects, replace, or invent a logo. A missing or altered logo is a failed creative."
            : "ABSOLUTE LOGO LOCK: no logo asset was provided. Use brand name text only; never invent a fake logo, icon, monogram, seal, mascot, or abstract mark.";
        $adRules[] = "SOCIAL MEDIA CTA LOCK: Instagram, Facebook, TikTok, LinkedIn, social feed, square social, story, reels, and social media placements must never use CTA buttons, pills, rounded rectangles, bordered buttons, app UI controls, or clickable blocks. Express CTA as footer text, underlined phrase, caption line, swipe/DM cue, offer line, or sticker words without a button container.";
        if ($logo !== '') {
            $adRules[] = "Logo URL: {$logo} — render as <img> with object-fit:contain in every banner.";
        }
        if ($primary !== '') {
            $adRules[] = "Primary brand color: {$primary} — must appear on the dominant visual element.";
        }
        if ($accent !== '') {
            $adRules[] = "Accent color: {$accent} — use exclusively on CTA buttons and key highlights.";
        }
        if ($background !== '') {
            $adRules[] = "Base background color: {$background} — use when no background image is available.";
        }
        if (!empty($services)) {
            $top = implode(', ', array_slice($services, 0, 3));
            $adRules[] = "Feature these services/products when no specific product is in the campaign: {$top}";
        }
        if ($audience !== '') {
            $adRules[] = "Write all copy as if speaking directly to: {$audience}";
        }
        if ($tone !== '') {
            $adRules[] = "Tone of voice: {$tone} — apply to headline, subheadline, and CTA.";
        }
        if ($forbidden !== '') {
            $adRules[] = "Forbidden words/claims: {$forbidden} — never use these.";
        }

        $imgCatalog = [];
        if ($logo !== '') $imgCatalog[] = "Logo: {$logo}";
        if ($hero !== '') $imgCatalog[] = "Hero/brand image: {$hero}";
        foreach (array_slice($sections, 0, 3) as $url) $imgCatalog[] = "Product/brand image: {$url}";

        if (!empty($adRules) || !empty($imgCatalog)) {
            $doc .= "## Ad Generation Rules\n";
            foreach ($adRules as $rule) $doc .= "- {$rule}\n";
            if (!empty($adRules)) $doc .= "\n";
            if (!empty($imgCatalog)) {
                $doc .= "### Available Image Assets (use in <img src='...'>)\n";
                foreach ($imgCatalog as $asset) $doc .= "- {$asset}\n";
                $doc .= "\n";
            }
        }

        return trim($doc);
    }
}

if (!function_exists('agents_enrich_ad_form_with_company_data')) {
    function agents_enrich_ad_form_with_company_data(array $formData, array $companyFormData): array {
        $str = fn($v) => is_string($v) ? trim($v) : '';
        $arr = fn($v) => is_array($v) ? array_values(array_filter(array_map('strval', $v))) : [];
        $setIfEmpty = function (string $key, $value) use (&$formData) {
            if ((is_string($value) && trim($value) === '') || $value === null) return;
            if (!isset($formData[$key]) || (is_string($formData[$key]) && trim($formData[$key]) === '') || $formData[$key] === null) {
                $formData[$key] = $value;
            }
        };

        $theme = is_array($companyFormData['theme'] ?? null) ? $companyFormData['theme'] : [];
        $images = is_array($companyFormData['images'] ?? null) ? $companyFormData['images'] : [];

        $setIfEmpty('brandName', $str($companyFormData['businessName'] ?? $companyFormData['brandName'] ?? ''));
        $setIfEmpty('industry', $str($companyFormData['businessCategory'] ?? $companyFormData['industry'] ?? ''));
        $setIfEmpty('targetAudience', $str($companyFormData['targetAudience'] ?? ''));
        $setIfEmpty('valueProposition', $str($companyFormData['valueProposition'] ?? ''));
        $setIfEmpty('toneOfVoice', $str($companyFormData['toneOfVoice'] ?? ''));
        $setIfEmpty('brandPersonality', $str($companyFormData['brandPersonality'] ?? ''));
        $setIfEmpty('brandKeywords', $str($companyFormData['brandKeywords'] ?? ''));
        $setIfEmpty('forbiddenWords', $str($companyFormData['forbiddenWords'] ?? ''));
        $setIfEmpty('preferredStyle', $str($theme['style'] ?? $companyFormData['preferredStyle'] ?? ''));
        $setIfEmpty('primaryColor', $str($theme['primary'] ?? $companyFormData['primaryColor'] ?? ''));
        $setIfEmpty('secondaryColor', $str($theme['secondary'] ?? $companyFormData['secondaryColor'] ?? ''));
        $setIfEmpty('accentColor', $str($theme['accent'] ?? $companyFormData['accentColor'] ?? ''));
        $setIfEmpty('textColor', $str($theme['text'] ?? $companyFormData['textColor'] ?? ''));
        $setIfEmpty('backgroundColor', $str($theme['background'] ?? $companyFormData['backgroundColor'] ?? ''));
        $setIfEmpty('headingFont', $str($theme['headingFont'] ?? $companyFormData['headingFont'] ?? ''));
        $setIfEmpty('bodyFont', $str($theme['bodyFont'] ?? $companyFormData['bodyFont'] ?? ''));
        $setIfEmpty('language', $str($companyFormData['language'] ?? ''));

        $logo = $str($images['logoUrl'] ?? $images['logo'] ?? $companyFormData['logoUrl'] ?? '');
        $hero = $str($images['heroImage1'] ?? $images['hero'] ?? $images['heroImage2'] ?? '');
        $productImages = $arr($images['productImages'] ?? []);
        $product = $productImages[0] ?? $str($images['brandImage'] ?? $images['sectionImage1'] ?? '');
        $setIfEmpty('logoUrl', $logo);
        $setIfEmpty('backgroundImageUrl', $hero);
        $setIfEmpty('productImageUrl', $product);

        $services = $arr($companyFormData['services'] ?? []);
        $differentiators = $arr($companyFormData['differentiators'] ?? []);
        $companyProfile = [
            'businessName'        => $str($companyFormData['businessName'] ?? $companyFormData['brandName'] ?? ''),
            'industry'            => $str($companyFormData['businessCategory'] ?? $companyFormData['industry'] ?? ''),
            'description'         => $str($companyFormData['businessDescription'] ?? ''),
            'services'            => array_slice($services, 0, 8),
            'differentiators'     => array_slice($differentiators, 0, 8),
            'brandPersonality'    => $str($companyFormData['brandPersonality'] ?? ''),
            'brandKeywords'       => $str($companyFormData['brandKeywords'] ?? ''),
            'forbiddenWords'      => $str($companyFormData['forbiddenWords'] ?? ''),
            'designNotes'         => $str($companyFormData['designNotes'] ?? ''),
            'sourceWebsite'       => $str($companyFormData['sourceWebsite'] ?? ''),
        ];
        $companyProfile = array_filter($companyProfile, fn($v) => is_array($v) ? !empty($v) : trim((string)$v) !== '');
        if (!empty($companyProfile)) {
            $formData['companyProfile'] = $companyProfile;
        }

        return $formData;
    }
}

if (!function_exists('agents_build_ad_example_fingerprint')) {
    function agents_build_ad_example_fingerprint(string $html, string $platform, string $format, int $width, int $height): string {
        $lower = strtolower($html);
        preg_match_all('/<img\b/i', $html, $imgMatches);
        preg_match_all('/class=["\'][^"\']*(ad-cta|cta|button)[^"\']*["\']/i', $html, $ctaMatches);
        preg_match_all('/class=["\'][^"\']*(ad-logo|logo)[^"\']*["\']/i', $html, $logoMatches);
        preg_match_all('/class=["\'][^"\']*(ad-headline|headline|title)[^"\']*["\']/i', $html, $headlineMatches);

        $ratio = $height > 0 ? $width / $height : 1;
        $family = $ratio < 0.7 ? 'vertical/story'
            : ($ratio > 3 ? 'leaderboard'
            : ($ratio > 1.2 ? 'landscape'
            : 'square/rectangle'));

        $signals = [];
        $signals[] = "Format family: {$family}";
        $signals[] = "Platform/format: {$platform}/{$format}";
        $signals[] = "Dimensions: {$width}x{$height}";
        $signals[] = "Image count: " . count($imgMatches[0] ?? []);
        $signals[] = "CTA elements detected: " . count($ctaMatches[0] ?? []);
        $signals[] = "Logo elements detected: " . count($logoMatches[0] ?? []);
        $signals[] = "Headline elements detected: " . count($headlineMatches[0] ?? []);
        $signals[] = "Uses background image or url(): " . (preg_match('/background[^;]*url\(|<img\b/i', $lower) ? 'yes' : 'no');
        $signals[] = "Uses badges/stickers/proof chips: " . (preg_match('/badge|sticker|proof|tag|chip|pill|discount|off|new|limited/i', $html) ? 'yes' : 'no');
        $signals[] = "Likely layout density: " . (strlen(strip_tags($html)) > 260 ? 'dense' : 'lean');

        return "## Visual fingerprint\n\n- " . implode("\n- ", $signals) . "\n";
    }
}

if (!function_exists('agents_lazy_init_store')) {
    function agents_lazy_init_store(
        mysqli $conn,
        int $companyProjectId,
        ?string &$geminiStoreName,
        string $companyDocument,
        string $accountType,
        int $userId = 0,
        ?string $geminiApiKey = null
    ): void {
        if (!empty($geminiStoreName)) {
            agents_upsert_company_profile_record($conn, $companyProjectId, $geminiStoreName, null, $userId);
            return;
        }

        $storeResult = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'displayName'   => 'company-' . $companyProjectId . '-brandguide',
            'documentText'  => $companyDocument,
            'documentLabel' => 'Brand Guidelines',
            'accountType'   => $accountType,
        ], $geminiApiKey);

        if (!empty($storeResult['storeName'])) {
            $geminiStoreName = (string)$storeResult['storeName'];
            $documentName = agents_extract_document_name($storeResult);
            agents_reconnect_mysqli_if_needed($conn);
            $saveStmt = $conn->prepare("UPDATE projects SET gemini_store_name = ? WHERE id = ?");
            if (!$saveStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $saveStmt->bind_param('si', $geminiStoreName, $companyProjectId);
            $saveStmt->execute();
            $saveStmt->close();
            agents_reconnect_mysqli_if_needed($conn);
            agents_upsert_company_profile_record($conn, $companyProjectId, $geminiStoreName, $documentName, $userId);
        }
    }
}
