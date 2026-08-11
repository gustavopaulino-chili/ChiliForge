<?php
// Browserless.io HTML→image renderer.
//
// Renders a self-contained HTML banner (background <img> + overlay) to a JPEG using a
// real headless Chrome in the cloud — so the overlay can use full CSS3 (gradients,
// box-shadow, backdrop-filter, real flexbox/gap) that the PHP/GD compositor cannot do.
//
// Token + endpoint come from .env (read via agents_env_value, which helpers.php exposes):
//   BROWSERLESS_URL    e.g. https://production-sfo.browserless.io   (check your region)
//   BROWSERLESS_TOKEN  your API token
//
// Returns true on success (JPEG written to $outJpgPath), false otherwise. NEVER throws —
// the caller falls back to GD so a Browserless outage never breaks generation.

if (!function_exists('browserless_enabled')) {
    function browserless_token(): string {
        if (function_exists('agents_env_value')) return agents_env_value('BROWSERLESS_TOKEN', '');
        $v = getenv('BROWSERLESS_TOKEN');
        return is_string($v) ? trim($v) : '';
    }

    function browserless_base_url(): string {
        $u = function_exists('agents_env_value')
            ? agents_env_value('BROWSERLESS_URL', 'https://production-sfo.browserless.io')
            : (getenv('BROWSERLESS_URL') ?: 'https://production-sfo.browserless.io');
        return rtrim(trim((string)$u), '/');
    }

    function browserless_enabled(): bool {
        $tok = browserless_token();
        return $tok !== '' && stripos($tok, 'COLE_SEU_TOKEN') === false;
    }
}

if (!function_exists('browserless_render_html_to_jpeg')) {
    /**
     * POST the HTML to Browserless /screenshot and write the resulting JPEG.
     *
     * @return bool true if a non-empty JPEG was written to $outJpgPath.
     */
    function browserless_render_html_to_jpeg(string $html, int $width, int $height, string $outJpgPath, int $quality = 90): bool {
        if (!browserless_enabled()) return false;
        if (trim($html) === '') return false;

        $width  = max(1, min(4096, $width));
        $height = max(1, min(4096, $height));
        $quality = max(40, min(100, $quality));

        $endpoint = browserless_base_url() . '/screenshot?token=' . rawurlencode(browserless_token());

        // Browserless v2 /screenshot schema. networkidle2 waits for the background <img>
        // and any @import font to load before the shot. clip pins the exact banner box so
        // a stray margin never produces letterboxing.
        $payload = json_encode([
            'html'        => $html,
            'options'     => [
                'type'     => 'jpeg',
                'quality'  => $quality,
                'fullPage' => false,
                'clip'     => ['x' => 0, 'y' => 0, 'width' => $width, 'height' => $height],
            ],
            'viewport'    => ['width' => $width, 'height' => $height, 'deviceScaleFactor' => 1],
            'gotoOptions' => ['waitUntil' => 'networkidle2', 'timeout' => 25000],
            // networkidle2 waits for the font FILE, not for the browser to finish applying it —
            // so a brand font could arrive a beat late and the shot would catch Arial instead.
            // document.fonts.ready is the explicit signal that every declared face is usable.
            // Bounded and non-fatal: if it times out Browserless still shoots, and a banner in
            // the fallback font is far better than a generation that fails.
            'waitForFunction' => ['fn' => 'document.fonts.ready.then(() => true)', 'timeout' => 5000],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($payload === false) return false;

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: image/jpeg'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 35,
            CURLOPT_CONNECTTIMEOUT => 12,
        ]);
        $body   = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ctype  = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($body === false || $status !== 200) {
            error_log('[browserless] render failed status=' . $status . ' ctype=' . $ctype
                . ' err=' . $err . ' body=' . substr((string)$body, 0, 300));
            return false;
        }
        // A JSON error body with a 200 would not be an image — guard on content-type/size.
        if (stripos($ctype, 'image') === false || strlen($body) < 1024) {
            error_log('[browserless] non-image response ctype=' . $ctype . ' len=' . strlen((string)$body));
            return false;
        }

        if (@file_put_contents($outJpgPath, $body) === false) {
            error_log('[browserless] failed to write JPEG to ' . $outJpgPath);
            return false;
        }
        return is_file($outJpgPath) && filesize($outJpgPath) > 0;
    }
}
