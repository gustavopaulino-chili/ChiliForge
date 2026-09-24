<?php
/**
 * Browserless creative compositor (PHP GD) — FAITHFUL renderer.
 *
 * The external API server has no headless browser, so it cannot rasterize the compose
 * HTML. Instead of imposing a fixed layout, this renders the compose banner FAITHFULLY:
 * it parses the layers the edge already produced (background, scrim, EXACT logo <img>,
 * headline/sub/CTA divs with their absolute %-positions, font sizes, alignment and colors)
 * and reproduces them with GD — so the output matches the design the background reserved
 * space for. Pixel-exact logo, typo-free text, correct text zone.
 *
 * Entry point:
 *   extgd_compose_html_to_jpeg(string $bannerHtml, array $fmt, string $outJpgPath): bool
 *     $fmt ['width','height'] — fallback dimensions if the HTML omits them.
 */

/* ── Brand font for ad copy ────────────────────────────────────────────────────
 * The family is detected from the client's website by Fullstop and persisted by
 * company-assets.php into company_form_data['headingFont']. These three helpers are the
 * ONLY place that decides which family to use, sanitises it, and turns it into markup —
 * generate-ads.php and generate-ads-worker.php both include this file and call them, so
 * the two duplicated overlay builders cannot drift apart.
 */

if (!function_exists('ext_sanitize_font_family')) {
    /**
     * The name comes from a third-party website read by a script, and it is interpolated into
     * both an HTML attribute and a URL — so it is untrusted input on two fronts. Google Fonts
     * families are letters, digits and spaces, nothing else; anything richer than that is
     * either not a Google family or an injection attempt. Returns '' when it does not pass,
     * and '' always means "use Arial".
     */
    function ext_sanitize_font_family($raw): string {
        $s = trim((string) $raw);
        if ($s === '') return '';
        if (mb_strlen($s) > 60) return '';
        if (!preg_match('/^[A-Za-z0-9 ]+$/', $s)) return '';
        $s = trim(preg_replace('/\s+/', ' ', $s));
        // A bare number is never a family name and would produce a nonsense Google Fonts URL.
        if ($s === '' || preg_match('/^[0-9 ]+$/', $s)) return '';
        return $s;
    }
}

if (!function_exists('ext_resolve_brand_font')) {
    /**
     * Precedence: per-generation override → company payload → what company-assets.php already
     * persisted. The third case is the one that happens in practice: the font is registered
     * once alongside the logo and every later generation reads it from the stored company data,
     * exactly like the logo does. Missing everywhere → '' → Arial.
     */
    function ext_resolve_brand_font(array $campaignData = [], array $companyData = []): string {
        $candidates = [
            $campaignData['fontFamily'] ?? '',
            $companyData['fontFamily']  ?? '',
            $companyData['headingFont'] ?? '',
        ];
        foreach ($candidates as $c) {
            $clean = ext_sanitize_font_family($c);
            if ($clean !== '') return $clean;
        }
        return '';
    }
}

if (!function_exists('ext_font_css_stack')) {
    // Arial always stays as the fallback: if the family fails to load for any reason the ad
    // still renders with legible copy instead of a default serif or, worse, nothing.
    function ext_font_css_stack(string $family): string {
        $clean = ext_sanitize_font_family($family);
        if ($clean === '') return 'Arial,sans-serif';
        return "'" . $clean . "',Arial,sans-serif";
    }
}

if (!function_exists('ext_font_head_links')) {
    /**
     * Without this the browser renders the fallback and the whole feature is invisible.
     * It doubles as the signal for the GD path: extgd_compose parses the family straight out
     * of this googleapis URL, so injecting the link is all the GD renderer needs too.
     */
    function ext_font_head_links(string $family): string {
        $clean = ext_sanitize_font_family($family);
        if ($clean === '') return '';
        $href = 'https://fonts.googleapis.com/css2?family=' . rawurlencode($clean) . ':wght@400;700;800;900&display=swap';
        return '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            . '<link href="' . htmlspecialchars($href, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '" rel="stylesheet">';
    }
}

if (!function_exists('ext_inject_font_head')) {
    // Prepends the font links to a banner snippet, once. Safe to call on any HTML: a fragment
    // gets them at the top, a full document gets them inside <head>.
    function ext_inject_font_head(string $html, string $family): string {
        $links = ext_font_head_links($family);
        if ($links === '' || $html === '') return $html;
        if (stripos($html, 'fonts.googleapis.com') !== false) return $html; // already carries a family
        if (preg_match('/<head\b[^>]*>/i', $html, $m)) {
            return preg_replace('/(<head\b[^>]*>)/i', '$1' . $links, $html, 1) ?: $html;
        }
        return $links . $html;
    }
}

if (!function_exists('extgd_font_override_store')) {
    // Stores a custom font family (downloaded from Google Fonts) for the current request.
    // Call with an array to set; call with no args to read.
    function extgd_font_override_store(array $paths = null): array {
        static $store = [];
        if ($paths !== null) $store = $paths;
        return $store;
    }
}

if (!function_exists('extgd_http_get')) {
    // Simple HTTP GET helper: tries cURL first (more reliable on restricted servers), then
    // falls back to file_get_contents. Used for Google Fonts CSS + TTF downloads.
    function extgd_http_get(string $url, string $ua = 'ChiliForge/1.0'): string {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 5,
                CURLOPT_TIMEOUT        => 20,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
                CURLOPT_USERAGENT      => $ua,
            ]);
            $b = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($b !== false && $b !== '' && $code >= 200 && $code < 300) return (string)$b;
        }
        $ctx = stream_context_create([
            'http' => ['timeout' => 20, 'follow_location' => 1, 'user_agent' => $ua],
            'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false],
        ]);
        $b = @file_get_contents($url, false, $ctx);
        return $b === false ? '' : $b;
    }
}

if (!function_exists('extgd_fetch_google_font')) {
    // Download a Google Font as TTF and cache it in fonts/. Returns the local path or ''.
    // Uses an old User-Agent so Google returns TTF links instead of WOFF2.
    function extgd_fetch_google_font(string $family, int $weight): string {
        if ($family === '') return '';
        $slug    = preg_replace('/[^a-z0-9]+/', '-', strtolower(trim($family)));
        $wName   = $weight >= 800 ? 'extrabold' : ($weight >= 600 ? 'bold' : 'regular');
        $fontDir = __DIR__ . '/fonts/';
        $cached  = $fontDir . $slug . '-' . $wName . '.ttf';
        if (is_file($cached)) {
            // Validate: must have a recognisable font magic (TTF/OTF). Google's dynamic CDN
            // sometimes returns binary blobs in an undocumented format (e.g. 0xBC1E0200) that
            // GD/FreeType cannot render. Reject them so the system-font fallback kicks in.
            $hdr = @file_get_contents($cached, false, null, 0, 4);
            $magic = $hdr !== false ? substr(bin2hex($hdr), 0, 8) : '';
            if (preg_match('/^(0001|7472|4f54|7479)/i', $magic)) return $cached;
            // Bad format — don't return; fall through to re-download attempt
            error_log("[extgd_font] Cached font has unreadable format family=$family weight=$weight magic=$magic — will retry download");
        }
        $failTag = $cached . '.fail';
        if (is_file($failTag) && (time() - filemtime($failTag)) < 600) return ''; // 10min cooldown

        // ── Preferred source: Fontsource static TTF (jsDelivr) ──────────────────
        // Google's css2 CDN serves VARIABLE-font blobs that GD/FreeType cannot render — even with
        // an old UA it returns an undocumented wrapper (magic 0xBC1E0200), and the raw variable TTF
        // (Raleway[wght].ttf) segfaults PHP. Fontsource ships per-weight STATIC .ttf instances
        // (magic 0x00010000) that GD reads fine, for any family. Try the EXACT requested weight only
        // — a missing weight falls through to Google's closest-weight matching below, and the
        // override fill-in step backfills it from the nearest weight we did get.
        if (!is_dir($fontDir)) @mkdir($fontDir, 0775, true);
        $fsUrl = 'https://cdn.jsdelivr.net/fontsource/fonts/' . $slug . '@latest/latin-' . $weight . '-normal.ttf';
        $fs    = extgd_http_get($fsUrl, 'ChiliForge-Compositor/1.0');
        if ($fs && strlen($fs) > 2000) {
            $fsMagic = substr(bin2hex(substr($fs, 0, 4)), 0, 8);
            if (preg_match('/^(0001|7472|4f54|7479)/i', $fsMagic)) {
                @file_put_contents($cached, $fs);
                @unlink($failTag);
                if (is_file($cached)) return $cached;
            } else {
                error_log("[extgd_font] Fontsource returned unreadable format family=$family weight=$weight magic=$fsMagic — trying Google");
            }
        }

        $oldUa  = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
        // Request only the specific weight — Google returns a single @font-face block for old UAs
        $cssUrl = 'https://fonts.googleapis.com/css2?family=' . rawurlencode($family) . ':wght@' . $weight . '&display=swap';
        $css    = extgd_http_get($cssUrl, $oldUa);
        if (!$css) {
            error_log("[extgd_font] Google Fonts CSS fetch failed for family=$family weight=$weight url=$cssUrl");
            @file_put_contents($failTag, '1'); return '';
        }

        // Google returns dynamic URLs (no .ttf in path) for old UAs — match any src URL in @font-face
        preg_match_all('/@font-face\s*\{([^}]+)\}/si', $css, $blocks);
        $fontEntries = [];
        foreach ($blocks[1] as $block) {
            if (preg_match('/font-weight\s*:\s*(\d+)/i', $block, $wm)
             && preg_match('/src\s*:[^;]*url\(\'?([^\'\)\s]+)\'?\)/i', $block, $um)) {
                $fontEntries[] = [(int)$wm[1], trim($um[1], "' \"")];
            }
        }
        if (!$fontEntries) {
            // Fallback: any url() in the CSS
            if (!preg_match('/url\(\'?([^\'\)\s]+)\'?\)/i', $css, $fm)) {
                error_log("[extgd_font] No src URL found in CSS for family=$family weight=$weight");
                @file_put_contents($failTag, '1'); return '';
            }
            $ttfUrl = trim($fm[1], "' \"");
        } else {
            usort($fontEntries, static fn($a, $b) => abs($a[0] - $weight) <=> abs($b[0] - $weight));
            $ttfUrl = $fontEntries[0][1];
        }

        $ttf = extgd_http_get($ttfUrl, $oldUa);
        if (!$ttf || strlen($ttf) < 2000) {
            error_log("[extgd_font] TTF download failed for family=$family weight=$weight url=$ttfUrl size=" . strlen((string)$ttf));
            @file_put_contents($failTag, '1'); return '';
        }
        // Validate magic before caching — reject binary blobs that GD can't render
        $dlMagic = substr(bin2hex(substr($ttf, 0, 4)), 0, 8);
        if (!preg_match('/^(0001|7472|4f54|7479)/i', $dlMagic)) {
            error_log("[extgd_font] Downloaded font has unreadable format family=$family weight=$weight magic=$dlMagic url=$ttfUrl — skip cache");
            @file_put_contents($failTag, '1'); return '';
        }

        if (!is_dir($fontDir)) @mkdir($fontDir, 0775, true);
        @file_put_contents($cached, $ttf);
        @unlink($failTag);
        return is_file($cached) ? $cached : '';
    }
}

if (!function_exists('extgd_font')) {
    // Pick the bundled/downloaded font closest to the requested CSS font-weight.
    // Custom font override (set by extgd_font_override_store) takes priority.
    // Falls back to OpenSans bundles, then system fonts.
    function extgd_font(int $weight = 400): string {
        // Custom Google Font override for this request
        $ov = extgd_font_override_store();
        if (!empty($ov)) {
            $tier = $weight >= 800 ? 900 : ($weight >= 600 ? 700 : 400);
            if (!empty($ov[$tier])) return $ov[$tier];
            foreach ([900, 700, 400] as $w) if (!empty($ov[$w])) return $ov[$w];
        }
        $tier = $weight >= 800 ? 'x' : ($weight >= 600 ? 'b' : 'r');
        $bundles = [
            'x' => ['OpenSans-ExtraBold.ttf', 'OpenSans-Bold.ttf'],
            'b' => ['OpenSans-Bold.ttf'],
            'r' => ['OpenSans-Regular.ttf'],
        ][$tier];
        foreach ($bundles as $f) {
            $p = __DIR__ . '/fonts/' . $f;
            if (is_file($p)) return $p;
        }
        $sys = $weight >= 600
            ? ['/usr/share/fonts/urw-base35/NimbusSans-Bold.otf', '/usr/share/fonts/google-droid/DroidSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']
            : ['/usr/share/fonts/urw-base35/NimbusSans-Regular.otf', '/usr/share/fonts/google-droid/DroidSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'];
        foreach ($sys as $p) if (is_file($p)) return $p;
        return '';
    }
}

if (!function_exists('extgd_fetch_bytes')) {
    function extgd_fetch_bytes(string $src): string {
        $src = trim($src);
        if ($src === '') return '';
        if (preg_match('~^data:[^;]+;base64,(.+)$~is', $src, $m)) {
            $b = base64_decode(str_replace(["\n", "\r", " ", "\t"], '', $m[1]), true);
            return $b === false ? '' : $b;
        }
        if (preg_match('~^https?://~i', $src)) {
            if (function_exists('download_remote_asset')) {
                $d = download_remote_asset($src);
                if (is_array($d) && isset($d['body']) && $d['body'] !== '') return (string)$d['body'];
            }
            // Try file_get_contents first, fall back to cURL (handles servers with allow_url_fopen=off)
            $ctx = stream_context_create(['http' => ['timeout' => 25, 'follow_location' => 1], 'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
            $b = @file_get_contents($src, false, $ctx);
            if ($b !== false && $b !== '') return $b;
            if (function_exists('curl_init')) {
                $ch = curl_init($src);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_MAXREDIRS      => 5,
                    CURLOPT_TIMEOUT        => 25,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => false,
                    CURLOPT_USERAGENT      => 'ChiliForge-Compositor/1.0',
                ]);
                $b = curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($b !== false && $b !== '' && $code >= 200 && $code < 300) return (string)$b;
            }
            return '';
        }
        // Root-relative public URL (e.g. /projects/.../logo.png, after the API mirrors a logo
        // locally) → resolve to the actual file on disk. In the CLI worker $_SERVER's
        // DOCUMENT_ROOT is empty, so also map /projects/* via resolve_sites_base_path().
        if ($src[0] === '/') {
            $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
            if ($root !== '' && is_file($root . $src)) { $b = @file_get_contents($root . $src); return $b === false ? '' : $b; }
            if (function_exists('resolve_sites_base_path') && preg_match('#^/projects/(.+)$#', $src, $mm)) {
                $p = resolve_sites_base_path() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, rawurldecode($mm[1]));
                if (is_file($p)) { $b = @file_get_contents($p); return $b === false ? '' : $b; }
            }
            // Fallback: fetch via HTTP using the server's own public hostname — handles CLI worker
            // context where DOCUMENT_ROOT is empty and resolve_sites_base_path() is unavailable.
            $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
            if ($host === '') {
                // CLI worker: derive hostname from file path (e.g. .../domains/testforge.chili.pa/public_html/...)
                if (preg_match('#/domains/([^/]+)/public_html/#', __FILE__, $hm)) $host = $hm[1];
            }
            if ($host !== '') {
                $absUrl = 'https://' . $host . $src;
                $ctx2 = stream_context_create(['http' => ['timeout' => 10], 'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
                $b = @file_get_contents($absUrl, false, $ctx2);
                if ($b !== false && $b !== '') return $b;
            }
        }
        if (is_file($src)) { $b = @file_get_contents($src); return $b === false ? '' : $b; }
        return '';
    }
}

if (!function_exists('extgd_image_from_bytes')) {
    /** Decode image bytes to a GD resource. GD handles PNG/JPG/GIF/WebP; SVG (and other
     *  vector/exotic formats) fall back to Imagick → PNG when available. */
    function extgd_image_from_bytes(string $bytes) {
        if ($bytes === '') return false;
        $head = substr($bytes, 0, 300);
        $isSvg = (stripos($head, '<svg') !== false) || (stripos($head, 'w3.org/2000/svg') !== false);
        if (!$isSvg) {
            $im = @imagecreatefromstring($bytes);
            if ($im !== false) return $im;
        }
        if (class_exists('Imagick')) {
            try {
                $imk = new Imagick();
                if ($isSvg) { $imk->setBackgroundColor(new ImagickPixel('transparent')); $imk->setResolution(384, 384); }
                $imk->readImageBlob($bytes);
                $imk->setImageFormat('png32');
                $png = $imk->getImageBlob();
                $imk->clear(); $imk->destroy();
                $g = @imagecreatefromstring($png);
                if ($g !== false) return $g;
            } catch (Throwable $e) { /* fall through */ }
        }
        return false;
    }
}

if (!function_exists('extgd_color')) {
    /** Parse #hex, #rgb, rgb()/rgba() → [r,g,b,alpha127] (alpha 0=opaque..127=transparent). */
    function extgd_color(?string $v, array $fb = [255, 255, 255, 0]): array {
        $v = strtolower(trim((string)$v));
        if ($v === '') return $fb;
        if (preg_match('/^#([0-9a-f]{3})$/', $v, $m)) {
            $h = $m[1];
            return [hexdec($h[0].$h[0]), hexdec($h[1].$h[1]), hexdec($h[2].$h[2]), 0];
        }
        if (preg_match('/^#([0-9a-f]{6})$/', $v, $m)) {
            return [hexdec(substr($m[1],0,2)), hexdec(substr($m[1],2,2)), hexdec(substr($m[1],4,2)), 0];
        }
        if (preg_match('/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/', $v, $m)) {
            $a = isset($m[4]) ? (float)$m[4] : 1.0;
            return [(int)$m[1], (int)$m[2], (int)$m[3], (int)round((1 - max(0, min(1, $a))) * 127)];
        }
        return $fb;
    }
}

if (!function_exists('extgd_parse_style')) {
    function extgd_parse_style(string $style): array {
        $out = [];
        foreach (explode(';', $style) as $decl) {
            $decl = trim($decl);
            if ($decl === '' || strpos($decl, ':') === false) continue;
            [$k, $v] = explode(':', $decl, 2);
            $out[strtolower(trim($k))] = trim($v);
        }
        return $out;
    }
}

if (!function_exists('extgd_pct')) {
    function extgd_pct(?string $v, float $base): ?float {
        if ($v === null) return null;
        $v = trim($v);
        if (preg_match('/^(-?[\d.]+)%$/', $v, $m)) return (float)$m[1] / 100 * $base;
        if (preg_match('/^(-?[\d.]+)px$/', $v, $m)) return (float)$m[1];
        return null;
    }
}

if (!defined('EXTGD_TEXT_SCALE')) {
    // The compose HTML declares 'Open Sans', but in the app's html-to-image capture the
    // Google-Fonts @import often does not load, so the browser falls back to the system
    // sans-serif (narrower than Open Sans). We render real Open Sans, which looks a bit
    // larger/heavier and crowds the layout — scale text down slightly to match the app.
    define('EXTGD_TEXT_SCALE', 0.9);
}

if (!function_exists('extgd_font_px')) {
    /** Resolve a CSS font-size value to pixels relative to the banner box.
     *  Supports: calc(min(Acqh,Bcqw)*N) — TypeScript-generated format
     *            Ncqw / Ncqh — Gemini-generated creative format
     *            Npx — absolute pixels */
    function extgd_font_px(?string $fs, int $W, int $H): float {
        $fs = (string)$fs;
        if (preg_match('/min\(\s*([\d.]+)cqh\s*,\s*([\d.]+)cqw\s*\)\s*\*\s*([\d.]+)/i', $fs, $m)) {
            return min((float)$m[1] / 100 * $H, (float)$m[2] / 100 * $W) * (float)$m[3] * EXTGD_TEXT_SCALE;
        }
        // Plain container-query units (Gemini creative HTML)
        if (preg_match('/([\d.]+)\s*cqw/i', $fs, $m)) return (float)$m[1] / 100 * $W * EXTGD_TEXT_SCALE;
        if (preg_match('/([\d.]+)\s*cqh/i', $fs, $m)) return (float)$m[1] / 100 * $H * EXTGD_TEXT_SCALE;
        if (preg_match('/([\d.]+)px/', $fs, $m)) return (float)$m[1] * EXTGD_TEXT_SCALE;
        return max(14, $H * 0.05) * EXTGD_TEXT_SCALE;
    }
}

if (!function_exists('extgd_inner_text')) {
    /** Extract text from a DOMElement, converting <br> to \n so line breaks survive into GD. */
    function extgd_inner_text(DOMElement $el): string {
        $parts = [];
        foreach ($el->childNodes as $n) {
            if ($n instanceof DOMText) {
                $parts[] = $n->textContent;
            } elseif ($n instanceof DOMElement) {
                $parts[] = (strtolower($n->tagName) === 'br') ? "\n" : extgd_inner_text($n);
            }
        }
        return implode('', $parts);
    }
}

if (!function_exists('extgd_text_segments')) {
    /**
     * Extract text with per-span color overrides from a DOMElement.
     * Returns: [['text' => string, 'color' => string|null], ...]
     * where null means "inherit parent color". <br> becomes a "\n" segment.
     */
    function extgd_text_segments(DOMElement $el): array {
        $segs = [];
        foreach ($el->childNodes as $n) {
            if ($n instanceof DOMText) {
                $t = $n->textContent;
                if ($t !== '') $segs[] = ['text' => $t, 'color' => null];
            } elseif ($n instanceof DOMElement) {
                $tag = strtolower($n->tagName);
                if ($tag === 'br') {
                    $segs[] = ['text' => "\n", 'color' => null];
                } elseif ($tag === 'span') {
                    $sst = extgd_parse_style($n->getAttribute('style'));
                    $spanColor = $sst['color'] ?? null;
                    $inner = extgd_inner_text($n); // plain text inside span
                    if ($inner !== '') $segs[] = ['text' => $inner, 'color' => $spanColor];
                } else {
                    // strong, em, b, etc — recurse, inherit color
                    foreach (extgd_text_segments($n) as $s) $segs[] = $s;
                }
            }
        }
        return $segs;
    }
}

if (!function_exists('extgd_wrap_lines')) {
    /** Word-wrap text to fit $maxW px. Respects \n as hard line breaks (from HTML <br> tags). */
    function extgd_wrap_lines(string $text, string $font, float $size, float $maxW): array {
        if ($text === '') return [];
        $lines = [];
        // Split on hard breaks first, then word-wrap each segment
        foreach (explode("\n", $text) as $seg) {
            $seg = trim(preg_replace('/\s+/', ' ', $seg));
            if ($seg === '') { $lines[] = ''; continue; }
            $cur = '';
            foreach (explode(' ', $seg) as $w) {
                if ($w === '') continue;
                $try = $cur === '' ? $w : $cur . ' ' . $w;
                $bb  = imagettfbbox($size, 0, $font, $try);
                if (abs($bb[2] - $bb[0]) <= $maxW || $cur === '') { $cur = $try; }
                else { $lines[] = $cur; $cur = $w; }
            }
            if ($cur !== '') $lines[] = $cur;
        }
        return $lines ?: [''];
    }
}

if (!function_exists('extgd_filled_round_rect')) {
    function extgd_filled_round_rect($img, int $x1, int $y1, int $x2, int $y2, int $r, int $color): void {
        $r = max(0, min($r, (int)(($x2 - $x1) / 2), (int)(($y2 - $y1) / 2)));
        $w = $x2 - $x1; $h = $y2 - $y1;
        if ($w <= 0 || $h <= 0) return;

        // 17/09 (job 679): the old version drew 2 overlapping filled rectangles + 4 overlapping
        // filled ellipses DIRECTLY on $img with alpha blending ON. That is fine for an OPAQUE
        // color (the only other caller, the button background) but for a SEMI-TRANSPARENT one —
        // the logo backing plate, alpha 45 — every place two of those six shapes overlap (the
        // rectangle∩rectangle centre, and each corner circle over the rectangle arms) got the
        // alpha blended TWICE+, so the plate came out with a visibly darker/more-opaque centre
        // and four bright corner blobs instead of a uniform rounded rectangle ("bloco atras mt
        // feio"). FIX: build the shape on an isolated temp canvas with blending OFF (so the six
        // draws just SET each pixel once, no compounding) and composite it onto $img in a single
        // blend pass.
        $tmp = imagecreatetruecolor($w, $h);
        imagesavealpha($tmp, true);
        imagealphablending($tmp, false);
        $transparent = imagecolorallocatealpha($tmp, 0, 0, 0, 127);
        imagefilledrectangle($tmp, 0, 0, $w - 1, $h - 1, $transparent);

        imagefilledrectangle($tmp, $r, 0, $w - 1 - $r, $h - 1, $color);
        imagefilledrectangle($tmp, 0, $r, $w - 1, $h - 1 - $r, $color);
        imagefilledellipse($tmp, $r, $r, $r * 2, $r * 2, $color);
        imagefilledellipse($tmp, $w - 1 - $r, $r, $r * 2, $r * 2, $color);
        imagefilledellipse($tmp, $r, $h - 1 - $r, $r * 2, $r * 2, $color);
        imagefilledellipse($tmp, $w - 1 - $r, $h - 1 - $r, $r * 2, $r * 2, $color);

        imagealphablending($img, true);
        imagecopy($img, $tmp, $x1, $y1, 0, 0, $w, $h);
        imagedestroy($tmp);
    }
}

if (!function_exists('extgd_gradient_stops')) {
    /** Parse a CSS gradient's color stops → [[pos 0..1, alpha 0..1], ...] sorted by pos.
     *  Falls back to a sensible dark→clear ramp when no rgba stops are present. */
    function extgd_gradient_stops(string $bg): array {
        $stops = [];
        if (preg_match_all('/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)\s*(-?[\d.]+%)?/i', $bg, $mm, PREG_SET_ORDER)) {
            $n = count($mm);
            foreach ($mm as $i => $m) {
                $a = (isset($m[1]) && $m[1] !== '') ? (float)$m[1] : 1.0;
                $pos = (isset($m[2]) && $m[2] !== '') ? (float)rtrim($m[2], '%') / 100 : ($n > 1 ? $i / ($n - 1) : 0.0);
                $stops[] = [max(0.0, min(1.0, $pos)), max(0.0, min(1.0, $a))];
            }
        }
        if (!$stops) return [[0.0, 0.6], [1.0, 0.0]];
        usort($stops, static fn($x, $y) => $x[0] <=> $y[0]);
        return $stops;
    }
}

if (!function_exists('extgd_sample_alpha')) {
    /** Linearly interpolate the gradient alpha (0..1) at position gp (0..1). */
    function extgd_sample_alpha(array $stops, float $gp): float {
        $gp = max(0.0, min(1.0, $gp));
        $prev = $stops[0];
        if ($gp <= $prev[0]) return $prev[1];
        foreach ($stops as $s) {
            if ($gp <= $s[0]) {
                $span = $s[0] - $prev[0];
                $f = $span > 0 ? ($gp - $prev[0]) / $span : 0.0;
                return $prev[1] + ($s[1] - $prev[1]) * $f;
            }
            $prev = $s;
        }
        return $prev[1];
    }
}

if (!function_exists('extgd_draw_scrim')) {
    /** Faithfully reproduce the compose scrim: a CSS linear/radial dark gradient (with its
     *  real color stops) over a region — matches the overlay's reserved-legibility layer. */
    function extgd_draw_scrim($img, array $st, int $W, int $H): void {
        // Region from `inset: T R B L` (% each). Defaults to full frame.
        $t = 0; $r = 0; $b = 0; $l = 0;
        if (isset($st['inset'])) {
            $parts = preg_split('/\s+/', trim($st['inset']));
            $vals = [];
            foreach ($parts as $p) {
                if ($p === 'auto') { $vals[] = null; continue; }
                $vals[] = (preg_match('/(-?[\d.]+)%/', $p, $mm)) ? (float)$mm[1] : 0.0;
            }
            // CSS inset shorthand: T R B L (1-4 values)
            $n = count($vals);
            $T = $vals[0] ?? 0; $R = $n > 1 ? $vals[1] : $T; $B = $n > 2 ? $vals[2] : $T; $L = $n > 3 ? $vals[3] : $R;
            $t = ($T === null) ? 0 : (int)round($T / 100 * $H);
            $r = ($R === null) ? 0 : (int)round($R / 100 * $W);
            $b = ($B === null) ? 0 : (int)round($B / 100 * $H);
            $l = ($L === null) ? 0 : (int)round($L / 100 * $W);
        }
        $x1 = $l; $y1 = $t; $x2 = $W - $r; $y2 = $H - $b;
        if (isset($st['height']) && preg_match('/([\d.]+)%/', $st['height'], $mm)) {
            $hpx = (int)round((float)$mm[1] / 100 * $H);
            // height + inset bottom(0) → band at the bottom; height + top:0 → band at top.
            if (($st['inset'] ?? '') !== '' && stripos($st['inset'], 'auto') === 0) $y1 = $y2 - $hpx; else $y2 = $y1 + $hpx;
        }
        $x1 = max(0, min($W, $x1)); $x2 = max(0, min($W, $x2));
        $y1 = max(0, min($H, $y1)); $y2 = max(0, min($H, $y2));
        if ($x2 <= $x1 || $y2 <= $y1) return;

        $bg = $st['background'] ?? $st['background-image'] ?? '';
        $stops = extgd_gradient_stops($bg);
        $dir = 'to top';
        if (preg_match('/linear-gradient\(\s*(to [a-z ]+|[\d.]+deg)/i', $bg, $dm)) $dir = strtolower(trim($dm[1]));
        $radial = stripos($bg, 'radial-gradient') !== false;

        if ($radial) {
            // CSS radial: first stop at center (gp=0), last at the edge (gp=1).
            $cx = ($x1 + $x2) / 2; $cy = ($y1 + $y2) / 2;
            $maxd = sqrt((($x2 - $x1) / 2) ** 2 + (($y2 - $y1) / 2) ** 2);
            for ($y = $y1; $y < $y2; $y++) for ($x = $x1; $x < $x2; $x += 1) {
                $d = sqrt(($x - $cx) ** 2 + ($y - $cy) ** 2) / max(1, $maxd);
                $al = (int)round(extgd_sample_alpha($stops, $d) * 127);
                if ($al <= 0) continue;
                imagesetpixel($img, $x, $y, imagecolorallocatealpha($img, 0, 0, 0, 127 - $al));
            }
            return;
        }
        // Linear: gp = position along the gradient axis from the 0% stop (start) to 100%.
        // CSS "to top": 0% at the BOTTOM; "to bottom": 0% at the top; "to right": 0% at the
        // left; "to left": 0% at the right. We sample the real stop alphas at gp.
        $vertical = (strpos($dir, 'top') !== false || strpos($dir, 'bottom') !== false || preg_match('/(0|180)deg/', $dir));
        $startAtFarEnd = (strpos($dir, 'top') !== false || strpos($dir, 'left') !== false);
        for ($i = ($vertical ? $y1 : $x1); $i < ($vertical ? $y2 : $x2); $i++) {
            $frac = $vertical ? ($i - $y1) / max(1, $y2 - $y1) : ($i - $x1) / max(1, $x2 - $x1);
            $gp = $startAtFarEnd ? (1 - $frac) : $frac;
            $al = (int)round(extgd_sample_alpha($stops, $gp) * 127);
            if ($al <= 0) continue;
            $col = imagecolorallocatealpha($img, 0, 0, 0, 127 - $al);
            if ($vertical) imagefilledrectangle($img, $x1, $i, $x2, $i, $col);
            else imagefilledrectangle($img, $i, $y1, $i, $y2, $col);
        }
    }
}

if (!function_exists('extgd_compose_html_to_jpeg')) {
    function extgd_compose_html_to_jpeg(string $bannerHtml, array $fmt, string $outJpgPath): bool {
        if (!extension_loaded('gd')) throw new RuntimeException('GD extension not available.');

        // ── Custom Google Font download ────────────────────────────────────────
        // Parse the @import URL from the HTML to find the requested font family,
        // download its TTF weights from Google Fonts, and register them as override
        // so extgd_font() returns them instead of the bundled OpenSans.
        extgd_font_override_store([]); // clear any previous request's override
        if (preg_match('/fonts\.googleapis\.com\/css2?\?family=([A-Za-z0-9%+\- ]+)/i', $bannerHtml, $fm)) {
            $rawFamily = preg_replace('/[:&].+/', '', $fm[1]); // strip :wght... and &display=...
            $family    = str_replace('+', ' ', rawurldecode(trim($rawFamily)));
            if ($family !== '' && stripos($family, 'opensans') === false && stripos($family, 'open-sans') === false) {
                $override = [];
                foreach ([400, 700, 900] as $w) {
                    $path = extgd_fetch_google_font($family, $w);
                    if ($path !== '') $override[$w] = $path;
                }
                if (!empty($override)) {
                    // Fill in missing weights with closest available
                    foreach ([400, 700, 900] as $w) {
                        if (!isset($override[$w])) {
                            $best = ''; $bd = PHP_INT_MAX;
                            foreach ($override as $ew => $ep) { if (abs($ew - $w) < $bd) { $bd = abs($ew - $w); $best = $ep; } }
                            if ($best !== '') $override[$w] = $best;
                        }
                    }
                    extgd_font_override_store($override);
                }
            }
        }

        $fontReg = extgd_font(400);
        if ($fontReg === '') throw new RuntimeException('No TTF/OTF font available for GD.');

        $dom = new DOMDocument('1.0', 'UTF-8');
        @$dom->loadHTML('<?xml encoding="utf-8"?>' . $bannerHtml, LIBXML_NOWARNING | LIBXML_NOERROR);
        $xp = new DOMXPath($dom);
        $banner = $xp->query('//*[contains(concat(" ", normalize-space(@class), " "), " ad-banner ")]')->item(0);
        if (!$banner) throw new RuntimeException('No .ad-banner element in HTML.');
        $bSt = extgd_parse_style($banner->getAttribute('style'));
        $W = (int)round(extgd_pct($bSt['width'] ?? null, 1) ?? (int)($fmt['width'] ?? 1080));
        $H = (int)round(extgd_pct($bSt['height'] ?? null, 1) ?? (int)($fmt['height'] ?? 1080));
        $W = max(1, min(4096, $W)); $H = max(1, min(4096, $H));

        // Supersampling (SSAA): render the whole composite at up to 2x, then downscale to the
        // target size for the JPEG. All geometry is derived from $W/$H so it scales for free,
        // and the final downscale anti-aliases text edges, the logo, button corners and
        // gradients far beyond GD's native drawing. Bounded so the 2x canvas never exceeds
        // 4096px (memory) and never upscales an already-huge banner.
        $Wt = $W; $Ht = $H;
        $S  = max(1, (int)min(2, intdiv(4096, max($Wt, $Ht))));
        $W  = $Wt * $S; $H = $Ht * $S;

        $canvas = imagecreatetruecolor($W, $H);
        imagealphablending($canvas, true); imagesavealpha($canvas, false);
        imagefilledrectangle($canvas, 0, 0, $W, $H, imagecolorallocate($canvas, 20, 20, 24));

        // Walk children in document order (= z-order): bg, scrim, logo, headline, sub, cta.
        // Text/CTA elements are COLLECTED here and rendered in a second pass with auto-fit,
        // so a long block shrinks instead of clipping into its neighbour.
        $textEls = [];
        $logoBottomY = 0;
        foreach (iterator_to_array($banner->childNodes) as $node) {
            if (!($node instanceof DOMElement)) continue;
            $tag = strtolower($node->tagName);
            if ($tag === 'style') continue;
            $st = extgd_parse_style($node->getAttribute('style'));
            $class = $node->getAttribute('class');

            // ── Background image ──
            if ($tag === 'img' && strpos($class, 'ad-bg') !== false) {
                $bytes = extgd_fetch_bytes($node->getAttribute('src'));
                if ($bytes !== '') {
                    $bg = extgd_image_from_bytes($bytes);
                    if ($bg !== false) {
                        $bw = imagesx($bg); $bh = imagesy($bg);
                        $s = max($W / $bw, $H / $bh);
                        $nw = (int)ceil($bw * $s); $nh = (int)ceil($bh * $s);
                        imagecopyresampled($canvas, $bg, (int)(($W - $nw) / 2), (int)(($H - $nh) / 2), 0, 0, $nw, $nh, $bw, $bh);
                        imagedestroy($bg);
                    }
                }
                continue;
            }
            // ── Background fallback color block ──
            if (strpos($class, 'ad-bg') !== false && isset($st['background'])) {
                $c = extgd_color(preg_replace('/\s*0%.*/', '', $st['background']), [20, 20, 24, 0]);
                imagefilledrectangle($canvas, 0, 0, $W, $H, imagecolorallocate($canvas, $c[0], $c[1], $c[2]));
                continue;
            }
            // ── Scrim (z-index:1 or z-index: 1, gradient, empty) ──
            // Accept both "z-index:1" and "z-index: 1" (Gemini sometimes adds a space).
            $zIdx = trim($st['z-index'] ?? '');
            if ($tag === 'div' && $zIdx === '1' && trim($node->textContent) === '') {
                extgd_draw_scrim($canvas, $st, $W, $H);
                continue;
            }
            // ── Logo image (exact) ──
            if ($tag === 'img') {
                $bytes = extgd_fetch_bytes($node->getAttribute('src'));
                if ($bytes === '') continue;
                $logo = extgd_image_from_bytes($bytes);
                if ($logo === false) continue;
                imagealphablending($logo, true);
                $lw = imagesx($logo); $lh = imagesy($logo);
                $boxW = extgd_pct($st['width'] ?? null, $W) ?? ($W * 0.26);
                $boxH = extgd_pct($st['max-height'] ?? null, $H) ?? ($H * 0.14);
                $scale = min($boxW / $lw, $boxH / $lh, 1.0);
                if ($scale <= 0) $scale = $boxW / $lw;
                $dlw = max(1, (int)round($lw * $scale)); $dlh = max(1, (int)round($lh * $scale));
                // x/y from top/left/right/bottom + optional centering transform.
                $left = extgd_pct($st['left'] ?? null, $W); $right = extgd_pct($st['right'] ?? null, $W);
                $top = extgd_pct($st['top'] ?? null, $H); $bottom = extgd_pct($st['bottom'] ?? null, $H);
                $center = isset($st['transform']) && stripos($st['transform'], 'translatex(-50%)') !== false;
                if ($center)        $x = (int)round(($left ?? $W / 2) - $dlw / 2);
                elseif ($right !== null) $x = (int)round($W - $right - $dlw);
                else                $x = (int)round($left ?? $W * 0.05);
                if ($bottom !== null) $y = (int)round($H - $bottom - $dlh);
                else                  $y = (int)round($top ?? $H * 0.05);
                $tmp = imagecreatetruecolor($dlw, $dlh);
                imagealphablending($tmp, false); imagesavealpha($tmp, true);
                imagefilledrectangle($tmp, 0, 0, $dlw, $dlh, imagecolorallocatealpha($tmp, 0, 0, 0, 127));
                imagealphablending($tmp, true);
                imagecopyresampled($tmp, $logo, 0, 0, 0, 0, $dlw, $dlh, $lw, $lh);
                imagecopy($canvas, $tmp, $x, $y, 0, 0, $dlw, $dlh);
                imagedestroy($logo); imagedestroy($tmp);
                $logoBottomY = max($logoBottomY, $y + $dlh);
                continue;
            }
            // ── Text / CTA div → COLLECT for the second (auto-fit) pass ──
            if ($tag === 'div') {
                $rawText = extgd_inner_text($node);
                $text    = trim(implode("\n", array_map(static fn($s) => trim(preg_replace('/\s+/', ' ', $s)), explode("\n", $rawText))));
                if ($text === '') continue;

                // Flex column container: headline + sub + CTA are children, not siblings.
                // Collect each child separately so they render with their own size/color/gap.
                if (stripos($st['display'] ?? '', 'flex') !== false) {
                    $cLeft      = extgd_pct($st['left']   ?? null, $W);
                    $cRight     = extgd_pct($st['right']  ?? null, $W);
                    $cTop       = extgd_pct($st['top']    ?? null, $H);
                    $cBottom    = extgd_pct($st['bottom'] ?? null, $H);
                    $cIsBottom  = ($cBottom !== null);
                    $cAlignItems = strtolower($st['align-items'] ?? 'flex-start');
                    $cTranslateY = isset($st['transform']) && stripos($st['transform'], 'translatey(-50%)') !== false;
                    $gKey = spl_object_id($node);
                    // Parse container-level gap (Gemini prefers gap over margin-top on children)
                    $containerGapPx = 0.0;
                    if (isset($st['gap'])) {
                        $gapVal = $st['gap'];
                        if      (preg_match('/([\d.]+)\s*cqh/i', $gapVal, $gg)) $containerGapPx = (float)$gg[1] / 100 * $H;
                        elseif  (preg_match('/([\d.]+)\s*cqw/i', $gapVal, $gg)) $containerGapPx = (float)$gg[1] / 100 * $W;
                        elseif  (preg_match('/([\d.]+)%/',        $gapVal, $gg)) $containerGapPx = (float)$gg[1] / 100 * $H;
                        elseif  (preg_match('/([\d.]+)px/',       $gapVal, $gg)) $containerGapPx = (float)$gg[1];
                    }
                    $childIdx = 0;
                    foreach (iterator_to_array($node->childNodes) as $child) {
                        if (!($child instanceof DOMElement)) continue;
                        $cSt  = extgd_parse_style($child->getAttribute('style'));
                        // Extract segments (preserves <span> color overrides and <br> as \n)
                        $rawSegs = extgd_text_segments($child);
                        $rawTxt  = implode('', array_column($rawSegs, 'text'));
                        $cTxt  = trim(implode("\n", array_map(static fn($s) => trim(preg_replace('/\s+/', ' ', $s)), explode("\n", $rawTxt))));
                        if ($cTxt === '') continue;
                        // Spacing: explicit margin-top on child > container gap (skip for first child)
                        $cMarginPx = 0.0;
                        if ($childIdx > 0) {
                            if      (preg_match('/([\d.]+)\s*cqh/i', $cSt['margin-top'] ?? '', $mm)) $cMarginPx = (float)$mm[1] / 100 * $H;
                            elseif  (preg_match('/([\d.]+)\s*cqw/i', $cSt['margin-top'] ?? '', $mm)) $cMarginPx = (float)$mm[1] / 100 * $W;
                            elseif  (preg_match('/([\d.]+)%/',        $cSt['margin-top'] ?? '', $mm)) $cMarginPx = (float)$mm[1] / 100 * $H;
                            elseif  (preg_match('/([\d.]+)px/',       $cSt['margin-top'] ?? '', $mm)) $cMarginPx = (float)$mm[1];
                            else    $cMarginPx = $containerGapPx;
                        }
                        $childIdx++;
                        $cWeight = (int)($cSt['font-weight'] ?? 400);
                        $cFontPx = extgd_font_px($cSt['font-size'] ?? null, $W, $H);
                        $cLineH  = max(1.12, (float)($cSt['line-height'] ?? 1.2));
                        $cIsBtn  = isset($cSt['background'])
                            && stripos($cSt['background'], 'transparent') === false
                            && stripos($cSt['background'], 'rgba(0,0,0') === false
                            && stripos($cSt['background'], 'rgba(0, 0, 0') === false;
                        // Keep segments only if at least one has a non-null color override
                        $hasColoredSegs = !empty(array_filter($rawSegs, static fn($s) => $s['color'] !== null));
                        $textEls[] = [
                            'text'         => $cTxt,
                            'segments'     => $hasColoredSegs ? $rawSegs : [],
                            'font'         => (extgd_font($cWeight) ?: $fontReg),
                            'col'          => extgd_color($cSt['color'] ?? '#ffffff', [255, 255, 255, 0]),
                            'align'        => strtolower($cSt['text-align'] ?? ($cAlignItems === 'center' ? 'center' : 'left')),
                            'left'         => $cLeft,
                            'right'        => $cRight,
                            'top'          => $cIsBottom ? null : ($cTop ?? 0),
                            'bottom'       => $cIsBottom ? $cBottom : null,
                            'center'       => $cAlignItems === 'center',
                            'baseFontPx'   => $cFontPx,
                            'lineH'        => $cLineH,
                            'hasBtn'       => $cIsBtn,
                            'btnBg'        => $cIsBtn ? extgd_color($cSt['background'], [255, 255, 255, 0]) : null,
                            'marginTop'    => $cMarginPx,
                            'flexGroupKey' => $gKey,
                            'flexBottom'   => $cIsBottom,
                            'flexTop'      => $cTop,
                            'flexBottom_v' => $cBottom,
                            'translateY'   => $cTranslateY,
                        ];
                    }
                    continue;
                }

                $weight = (int)($st['font-weight'] ?? 400);
                $lineHraw = (float)($st['line-height'] ?? 1.2);
                $baseFontPx = extgd_font_px($st['font-size'] ?? null, $W, $H);
                if ($lineHraw > 3) $lineHraw = $lineHraw / max(1.0, $baseFontPx); // px → ratio
                $textEls[] = [
                    'text'       => $text,
                    'font'       => (extgd_font($weight) ?: $fontReg),
                    'col'        => extgd_color($st['color'] ?? '#ffffff', [255, 255, 255, 0]),
                    'align'      => strtolower($st['text-align'] ?? 'left'),
                    'left'       => extgd_pct($st['left'] ?? null, $W),
                    'right'      => extgd_pct($st['right'] ?? null, $W),
                    'top'        => extgd_pct($st['top'] ?? null, $H),
                    'bottom'     => extgd_pct($st['bottom'] ?? null, $H),
                    'center'     => isset($st['transform']) && stripos($st['transform'], 'translatex(-50%)') !== false,
                    'baseFontPx' => $baseFontPx,
                    'lineH'      => max(1.12, $lineHraw),
                    'hasBtn'     => isset($st['background']) && stripos($st['background'], 'transparent') === false,
                    'btnBg'      => isset($st['background']) ? extgd_color($st['background'], [255, 255, 255, 0]) : null,
                ];
                continue;
            }
        }

        // ── Pre-process flex groups: assign real Y positions by stacking children ──
        // Children collected from flex containers don't have individual absolute positions —
        // their Y derives from the container anchor + cumulative heights + margin-tops.
        $flexGroupKeys = [];
        foreach ($textEls as $k => $el) {
            if (!isset($el['flexGroupKey'])) continue;
            $flexGroupKeys[$el['flexGroupKey']][] = $k;
        }
        foreach ($flexGroupKeys as $indices) {
            $first   = $textEls[$indices[0]];
            $isBot   = !empty($first['flexBottom']);
            $cLeft   = $first['left'] ?? ($W * 0.05);
            $cRight  = $first['right'];
            $blockW  = ($cRight !== null) ? max(40.0, $W - $cRight - $cLeft) : ($W - $cLeft - $W * 0.05);
            // Estimate pixel height of each child (text wrap height or button height).
            $heights = [];
            foreach ($indices as $k) {
                $el = $textEls[$k];
                if ($el['hasBtn']) {
                    $heights[$k] = $el['baseFontPx'] * 2.2;
                } else {
                    $lines = extgd_wrap_lines($el['text'], $el['font'], $el['baseFontPx'], $blockW);
                    $heights[$k] = max(1, count($lines)) * $el['baseFontPx'] * $el['lineH'];
                }
            }
            $totalH = array_sum($heights);
            foreach ($indices as $i => $k) {
                if ($i > 0) $totalH += $textEls[$k]['marginTop'];
            }
            if ($isBot) {
                $anchorY = ($first['flexBottom_v'] !== null) ? ($H - $first['flexBottom_v']) : ($H * 0.93);
                $y = $anchorY - $totalH;
            } elseif (!empty($first['translateY'])) {
                $anchorY = $first['flexTop'] ?? ($H * 0.5);
                $y = $anchorY - $totalH / 2;
            } else {
                $y = $first['flexTop'] ?? ($H * 0.1);
            }
            foreach ($indices as $i => $k) {
                if ($i > 0) $y += $textEls[$k]['marginTop'];
                $textEls[$k]['top']    = max(0.0, $y);
                $textEls[$k]['bottom'] = null;
                $y += $heights[$k];
            }
        }

        // ── Second pass: fit + render text so blocks never clip into each other ──
        // Each block's font shrinks (re-wrapping) until it fits the vertical gap to its
        // neighbours — derived from the layout's % anchors and the creative size, so size
        // scales with BOTH dimensions and line count. Bottom-anchored blocks (e.g. the CTA)
        // are fitted FIRST; the top-anchored ones are then bounded by the CTA's real top.
        if (!empty($textEls)) {
            $gap = $H * 0.02;
            $floor = max(14.0, $H * 0.020);

            foreach ($textEls as $k => $el) {
                $textEls[$k]['repY']     = ($el['bottom'] !== null) ? ($H - $el['bottom']) : ($el['top'] ?? $H * 0.5);
                $textEls[$k]['isBottom'] = ($el['bottom'] !== null);
                $bx = $el['left'] ?? ($W * 0.05);
                $textEls[$k]['bx']  = $bx;
                $textEls[$k]['bw2'] = ($el['right'] !== null) ? max(40.0, $W - $el['right'] - $bx) : ($W - $bx - $W * 0.05);
            }

            // Fit + draw one element within $maxH; returns the Y where it actually starts (top).
            $renderEl = function (array $el, float $maxH) use ($canvas, $W, $H, $floor): int {
                $font = $el['font']; $bx = $el['bx']; $bw2 = $el['bw2'];
                if ($el['hasBtn']) {
                    $fpx = $el['baseFontPx'];
                    $maxBtnW = min($W * 0.86, $bw2 + ($el['right'] !== null ? 0 : $W * 0.40));
                    for ($g = 0; $g < 10; $g++) {
                        $bb = imagettfbbox($fpx, 0, $font, $el['text']);
                        if (abs($bb[2] - $bb[0]) + $fpx * 1.8 <= $maxBtnW || $fpx <= $floor) break;
                        $fpx *= 0.92;
                    }
                    $bb = imagettfbbox($fpx, 0, $font, $el['text']);
                    $tw = abs($bb[2] - $bb[0]); $th = abs($bb[7] - $bb[1]);
                    $padX = (int)round($fpx * 0.90); $padY = (int)round($fpx * 0.42);
                    $bw3 = $tw + 2 * $padX; $bh3 = $th + 2 * $padY;
                    $bxBtn = $el['center'] ? (int)round(($el['left'] ?? $W / 2) - $bw3 / 2)
                        : ($el['right'] !== null ? (int)round($W - $el['right'] - $bw3) : (int)round($bx));
                    $byBtn = $el['isBottom'] ? (int)round($el['repY'] - $bh3) : (int)round($el['repY']);
                    $bgc = $el['btnBg'] ?: [255, 255, 255, 0];
                    extgd_filled_round_rect($canvas, $bxBtn, $byBtn, $bxBtn + $bw3, $byBtn + $bh3, (int)round($fpx * 0.38), imagecolorallocate($canvas, $bgc[0], $bgc[1], $bgc[2]));
                    $tc = imagecolorallocate($canvas, $el['col'][0], $el['col'][1], $el['col'][2]);
                    imagettftext($canvas, $fpx, 0, $bxBtn + $padX, $byBtn + $padY + abs($bb[7]), $tc, $font, $el['text']);
                    return $byBtn;
                }
                $fpx = $el['baseFontPx'];
                $lines = extgd_wrap_lines($el['text'], $font, $fpx, $bw2);
                for ($g = 0; $g < 16; $g++) {
                    if ($fpx * $el['lineH'] * count($lines) <= $maxH || $fpx <= $floor) break;
                    $fpx *= 0.92;
                    $lines = extgd_wrap_lines($el['text'], $font, $fpx, $bw2);
                }
                $step = (int)round($fpx * $el['lineH']);
                $blockH = $step * max(1, count($lines));
                $y0 = $el['isBottom'] ? (int)round($el['repY'] - $blockH) : (int)round($el['repY']);
                $shadow = imagecolorallocatealpha($canvas, 0, 0, 0, 45);
                $fill = imagecolorallocatealpha($canvas, $el['col'][0], $el['col'][1], $el['col'][2], $el['col'][3]);
                $lineSegs = $el['segments'] ?? [];
                $cy = $y0;
                foreach ($lines as $line) {
                    $bb = imagettfbbox($fpx, 0, $font, $line);
                    $lw2 = abs($bb[2] - $bb[0]); $asc = abs($bb[7]);
                    if ($el['align'] === 'center')    $lx = $bx + ($bw2 - $lw2) / 2;
                    elseif ($el['align'] === 'right') $lx = $bx + ($bw2 - $lw2);
                    else                              $lx = $bx;
                    // Base render: shadow + default color
                    imagettftext($canvas, $fpx, 0, (int)$lx + 2, $cy + (int)$asc + 2, $shadow, $font, $line);
                    imagettftext($canvas, $fpx, 0, (int)$lx, $cy + (int)$asc, $fill, $font, $line);
                    // Overlay colored segments (span overrides) — paint accent words on top
                    foreach ($lineSegs as $seg) {
                        if (($seg['color'] ?? null) === null) continue;
                        $sText = trim(preg_replace('/\s+/', ' ', $seg['text']));
                        if ($sText === '') continue;
                        $sPos = mb_strpos($line, $sText, 0, 'UTF-8');
                        if ($sPos === false) continue;
                        $prefix = mb_substr($line, 0, $sPos, 'UTF-8');
                        $prefW = $prefix !== '' ? abs(imagettfbbox($fpx, 0, $font, $prefix)[2] - imagettfbbox($fpx, 0, $font, $prefix)[0]) : 0;
                        $segC = extgd_color($seg['color'], [$el['col'][0], $el['col'][1], $el['col'][2], $el['col'][3]]);
                        $segFill = imagecolorallocatealpha($canvas, $segC[0], $segC[1], $segC[2], $segC[3]);
                        imagettftext($canvas, $fpx, 0, (int)$lx + $prefW, $cy + (int)$asc, $segFill, $font, $sText);
                    }
                    $cy += $step;
                }
                return $y0;
            };

            // Phase A — bottom-anchored blocks (CTA): short/stable, fit first; record real tops.
            $occupiedTops = [];
            foreach ($textEls as $el) {
                if (empty($el['isBottom'])) continue;
                $upper = max($H * 0.03, $logoBottomY + $gap);
                $maxH = $el['repY'] - $upper - $gap;
                if ($maxH < $floor) $maxH = $floor;
                $occupiedTops[] = $renderEl($el, $maxH);
            }

            // Phase B — top-anchored blocks, top→bottom; bounded by the next top block's anchor
            // and by any bottom-anchored block's real top below them.
            $topEls = array_values(array_filter($textEls, static fn($e) => empty($e['isBottom'])));
            usort($topEls, static fn($a, $b) => $a['repY'] <=> $b['repY']);
            $m = count($topEls);
            foreach ($topEls as $i => $el) {
                $lower = $H * 0.97;
                if ($i < $m - 1) $lower = min($lower, $topEls[$i + 1]['repY']);
                foreach ($occupiedTops as $ot) { if ($ot > $el['repY']) $lower = min($lower, $ot); }
                $maxH = $lower - $el['repY'] - $gap;
                if ($maxH < $floor) $maxH = $floor;
                $renderEl($el, $maxH);
            }
        }

        // Downscale the supersampled canvas to the real output size (anti-aliasing pass).
        if ($S > 1) {
            $final = imagecreatetruecolor($Wt, $Ht);
            imagealphablending($final, true); imagesavealpha($final, false);
            imagecopyresampled($final, $canvas, 0, 0, 0, 0, $Wt, $Ht, $W, $H);
            imagedestroy($canvas);
            $canvas = $final;
        }

        $dir = dirname($outJpgPath);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        imageinterlace($canvas, true);
        $ok = imagejpeg($canvas, $outJpgPath, 92);
        imagedestroy($canvas);
        return (bool)$ok && is_file($outJpgPath) && filesize($outJpgPath) > 0;
    }
}

/* ═════════════════════════════════════════════════════════════════════════════════════════
   CAMADAS MEDIDAS — scrim calculado a partir dos pixels, e a camada de profundidade.

   Isto vivia em compose-layers.php. O FTP da Hostinger nao aceita a CRIACAO de arquivo novo
   deste tamanho (falha com 550/timeout enquanto sobrescrita de arquivo existente passa sem
   problema), entao o codigo mora aqui, que ja e incluido pelo worker. Mantido como bloco
   separado e autocontido para poder voltar a ser um arquivo proprio quando o host permitir.
   ═════════════════════════════════════════════════════════════════════════════════════════ */
if (!function_exists('extd_lum')) {

    /** WCAG relative luminance from 8-bit sRGB. */
    function extd_lum(int $r, int $g, int $b): float {
        $f = static function (int $c): float {
            $s = $c / 255;
            return $s <= 0.03928 ? $s / 12.92 : pow(($s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * $f($r) + 0.7152 * $f($g) + 0.0722 * $f($b);
    }

    /** WCAG contrast ratio between two relative luminances. */
    function extd_contrast(float $a, float $b): float {
        $hi = max($a, $b); $lo = min($a, $b);
        return ($hi + 0.05) / ($lo + 0.05);
    }

    /**
     * A CSS length as a FRACTION of the canvas side. Handles %, px and the container units the
     * engine emits (cqw/cqh), which are already percentages of the container box.
     */
    function extd_frac($raw, float $canvasPx): ?float {
        if ($raw === null) return null;
        $v = trim((string)$raw);
        if ($v === '') return null;
        if (preg_match('/(-?[\d.]+)\s*(%|cqw|cqh)/i', $v, $m)) return (float)$m[1] / 100;
        if (preg_match('/(-?[\d.]+)\s*px/i', $v, $m))          return $canvasPx > 0 ? (float)$m[1] / $canvasPx : null;
        if (is_numeric($v))                                    return $canvasPx > 0 ? (float)$v / $canvasPx : null;
        return null;
    }

    /** True when the ink colour is light (white-ish) rather than dark. */
    function extd_ink_is_light(?string $color): bool {
        if ($color === null || trim($color) === '') return true; // engine default is white
        $c = extgd_color($color, [255, 255, 255, 0]);
        return extd_lum((int)$c[0], (int)$c[1], (int)$c[2]) > 0.5;
    }

    /**
     * Copy blocks as FRACTIONAL boxes over the canvas, with the ink colour each one uses.
     *
     * The engine puts headline, subheadline and CTA inside one absolutely positioned flex
     * container, so the container IS the region we need to measure. Sizing follows the same
     * assumptions the overlay builder uses: a block anchored only on the left is treated as
     * ~55% wide rather than full width, because that is how it actually renders.
     */
    function extd_text_boxes(DOMElement $banner, int $W, int $H): array {
        $boxes = [];
        foreach (iterator_to_array($banner->childNodes) as $node) {
            if (!($node instanceof DOMElement)) continue;
            if (strtolower($node->tagName) !== 'div') continue;
            if (trim($node->textContent) === '') continue; // scrim and spacers carry no text

            $st = extgd_parse_style($node->getAttribute('style'));
            $z  = (int)trim($st['z-index'] ?? '0');
            if ($z < 5) continue; // below the scrim: not copy

            $left   = extd_frac($st['left']   ?? null, $W);
            $right  = extd_frac($st['right']  ?? null, $W);
            $top    = extd_frac($st['top']    ?? null, $H);
            $bottom = extd_frac($st['bottom'] ?? null, $H);
            $wid    = extd_frac($st['width'] ?? ($st['max-width'] ?? null), $W) ?? 0.55;
            $hei    = extd_frac($st['height'] ?? null, $H) ?? 0.34;
            $wid    = max(0.10, min(1.0, $wid));
            $hei    = max(0.08, min(1.0, $hei));

            if ($left !== null)       { $x0 = $left; }
            elseif ($right !== null)  { $x0 = 1.0 - $right - $wid; }
            else                      { $x0 = 0.05; }
            $x1 = $x0 + $wid;

            $tr = strtolower($st['transform'] ?? '');
            if ($bottom !== null)                            { $y1 = 1.0 - $bottom; $y0 = $y1 - $hei; }
            elseif ($top !== null && strpos($tr, 'translatey(-50%)') !== false) { $y0 = $top - $hei / 2; $y1 = $y0 + $hei; }
            elseif ($top !== null)                           { $y0 = $top; $y1 = $y0 + $hei; }
            else                                             { $y0 = 0.60; $y1 = 0.94; }

            // Ink: the container's own colour, else the first child that declares one.
            $ink = $st['color'] ?? null;
            if ($ink === null) {
                foreach (iterator_to_array($node->childNodes) as $ch) {
                    if (!($ch instanceof DOMElement)) continue;
                    $cs = extgd_parse_style($ch->getAttribute('style'));
                    if (isset($cs['color'])) { $ink = $cs['color']; break; }
                }
            }

            $boxes[] = [
                'x0'       => max(0.0, min(1.0, $x0 - 0.02)),
                'y0'       => max(0.0, min(1.0, $y0 - 0.02)),
                'x1'       => max(0.0, min(1.0, $x1 + 0.02)),
                'y1'       => max(0.0, min(1.0, $y1 + 0.02)),
                'inkLight' => extd_ink_is_light($ink),
                'z'        => $z,
            ];
        }
        return $boxes;
    }

    /**
     * Luminance statistics of the background under a fractional box.
     *
     * The background is painted with object-fit:cover, so the visible part is a centred crop
     * with the CANVAS aspect ratio — the sampling has to walk that crop, not the whole file,
     * or we would measure pixels the viewer never sees.
     *
     * Returns mean, standard deviation (how busy the area is) and the two tails: p85 is what
     * threatens white ink, p15 is what threatens dark ink.
     */
    function extd_box_stats($bg, float $canvasAR, array $box): ?array {
        $bw = imagesx($bg); $bh = imagesy($bg);
        if ($bw < 4 || $bh < 4) return null;
        $imgAR = $bw / $bh;

        // cover → the fraction of the source actually on screen, centred
        $visW = 1.0; $visH = 1.0;
        if ($imgAR > $canvasAR) $visW = $canvasAR / $imgAR;
        else                    $visH = $imgAR / $canvasAR;

        $N = 28; // 784 samples is plenty and costs under a millisecond
        $lums = [];
        for ($i = 0; $i < $N; $i++) {
            for ($j = 0; $j < $N; $j++) {
                $fx = $box['x0'] + ($box['x1'] - $box['x0']) * (($i + 0.5) / $N);
                $fy = $box['y0'] + ($box['y1'] - $box['y0']) * (($j + 0.5) / $N);
                $u  = 0.5 + ($fx - 0.5) * $visW;
                $v  = 0.5 + ($fy - 0.5) * $visH;
                $px = (int)round($u * ($bw - 1));
                $py = (int)round($v * ($bh - 1));
                if ($px < 0 || $py < 0 || $px >= $bw || $py >= $bh) continue;
                $rgb = imagecolorat($bg, $px, $py);
                $lums[] = extd_lum(($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF);
            }
        }
        $n = count($lums);
        if ($n < 16) return null;

        $mean = array_sum($lums) / $n;
        $var  = 0.0;
        foreach ($lums as $l) $var += ($l - $mean) * ($l - $mean);
        $sd = sqrt($var / $n);
        sort($lums);
        return [
            'mean' => $mean,
            'sd'   => $sd,
            'p85'  => $lums[(int)floor(0.85 * ($n - 1))],
            'p15'  => $lums[(int)floor(0.15 * ($n - 1))],
        ];
    }

    /** Grey sRGB byte whose relative luminance is $L (inverse of extd_lum for a neutral). */
    function extd_lum_to_srgb(float $L): float {
        $L = max(0.0, min(1.0, $L));
        $s = $L <= 0.0031308 ? $L * 12.92 : 1.055 * pow($L, 1 / 2.4) - 0.055;
        return $s * 255;
    }

    /** Relative luminance of a grey sRGB byte. */
    function extd_srgb_to_lum(float $v): float {
        $s = max(0.0, min(255.0, $v)) / 255;
        return $s <= 0.03928 ? $s / 12.92 : pow(($s + 0.055) / 1.055, 2.4);
    }

    /**
     * The MINIMUM scrim alpha that gets this box to the contrast target.
     *
     * IMPORTANT: the blend has to be solved in sRGB, not in luminance. A browser composites
     * the gradient over the photo in gamma space, so mixing the two LUMINANCES linearly — the
     * obvious way to write this — is simply the wrong equation. It over-darkens a bright photo
     * (0.77 where 0.48 already passes, which is precisely the heavy identical fade we are
     * trying to get rid of) and under-lifts a dark one (0.22 where 0.45 is needed, i.e. copy
     * that still cannot be read). So: convert the measured luminance to its equivalent grey,
     * blend THAT towards the scrim colour, and search for the smallest alpha that clears the
     * target. Monotonic in alpha, so a short bisection is exact enough and costs nothing.
     *
     * A busy area gets a surcharge on top: an even mid-grey and a high-frequency pattern with
     * the same average read very differently under type.
     */
    function extd_required_alpha(array $s, bool $inkLight, float $scrimLum, float $target = 4.0): float {
        $inkLum = $inkLight ? 1.0 : 0.02;
        $L      = $inkLight ? $s['p85'] : $s['p15']; // the tail that threatens this ink

        $a = 0.0;
        if (extd_contrast($inkLum, $L) < $target) {
            $vBg    = extd_lum_to_srgb($L);
            $vScrim = extd_lum_to_srgb($scrimLum);
            if (extd_contrast($inkLum, extd_srgb_to_lum($vScrim)) < $target) {
                $a = 0.85; // even an opaque scrim of this colour cannot reach the target
            } else {
                $lo = 0.0; $hi = 1.0;
                for ($i = 0; $i < 24; $i++) {
                    $mid = ($lo + $hi) / 2;
                    $v   = $vBg + $mid * ($vScrim - $vBg);
                    if (extd_contrast($inkLum, extd_srgb_to_lum($v)) >= $target) $hi = $mid; else $lo = $mid;
                }
                $a = $hi;
            }
        }

        if ($a > 0.0 || $s['sd'] > 0.10) $a += min(0.20, $s['sd'] * 0.8); // busy-area surcharge
        return max(0.0, min(0.85, $a));
    }

    /** Largest alpha found in an rgba() list — the peak of the emitted gradient. */
    function extd_peak_alpha(string $style): float {
        $peak = 0.0;
        if (preg_match_all('/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i', $style, $m)) {
            foreach ($m[1] as $a) $peak = max($peak, (float)$a);
        }
        return $peak;
    }

    /** The scrim's own colour, as luminance (it is usually black, but can be brand-dark or white). */
    function extd_scrim_lum(string $style): float {
        if (preg_match('/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/i', $style, $m)) {
            return extd_lum((int)$m[1], (int)$m[2], (int)$m[3]);
        }
        return 0.0;
    }

    /**
     * Rewrite every alpha in a gradient by a factor, preserving the shape the engine designed.
     */
    function extd_scale_alphas(string $style, float $factor): string {
        return preg_replace_callback(
            '/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i',
            static function (array $m) use ($factor): string {
                $a = min(0.90, max(0.0, (float)$m[4] * $factor));
                return sprintf('rgba(%d,%d,%d,%s)', (int)$m[1], (int)$m[2], (int)$m[3], rtrim(rtrim(number_format($a, 3, '.', ''), '0'), '.') ?: '0');
            },
            $style
        );
    }

    /**
     * Measure the background under the copy and resize the scrim to what it actually needs.
     *
     * @param array $diag filled with what was measured and decided, so a job can be audited
     *                    afterwards instead of us guessing whether this ran.
     */
    function extd_tune_scrim(string $bannerHtml, int $canvasW, int $canvasH, array &$diag = []): string {
        $diag = ['ran' => false, 'action' => 'skipped', 'reason' => ''];
        if (trim($bannerHtml) === '' || $canvasW < 8 || $canvasH < 8) { $diag['reason'] = 'sem-html'; return $bannerHtml; }
        if (!function_exists('imagecreatetruecolor')) { $diag['reason'] = 'sem-gd'; return $bannerHtml; }

        try {
            $prev = libxml_use_internal_errors(true);
            $doc  = new DOMDocument();
            $doc->loadHTML('<?xml encoding="utf-8" ?>' . $bannerHtml, LIBXML_NONET);
            libxml_clear_errors();
            libxml_use_internal_errors($prev);

            // The banner root is the element that owns the absolutely positioned children.
            $banner = null;
            foreach ($doc->getElementsByTagName('div') as $d) {
                $cls = $d->getAttribute('class');
                if (strpos($cls, 'ad-banner') !== false || strpos($cls, 'banner') !== false) { $banner = $d; break; }
            }
            if ($banner === null) {
                $body = $doc->getElementsByTagName('body')->item(0);
                foreach (($body ? iterator_to_array($body->childNodes) : []) as $n) {
                    if ($n instanceof DOMElement && strtolower($n->tagName) === 'div') { $banner = $n; break; }
                }
            }
            if ($banner === null) { $diag['reason'] = 'sem-banner'; return $bannerHtml; }

            // Background image element
            $bgSrc = '';
            foreach ($banner->getElementsByTagName('img') as $img) {
                if (strpos($img->getAttribute('class'), 'ad-bg') !== false) { $bgSrc = $img->getAttribute('src'); break; }
            }
            if ($bgSrc === '') { $diag['reason'] = 'fundo-nao-e-imagem'; return $bannerHtml; }

            $bytes = extgd_fetch_bytes($bgSrc);
            if ($bytes === '') { $diag['reason'] = 'fundo-nao-baixou'; return $bannerHtml; }
            $bg = extgd_image_from_bytes($bytes);
            if ($bg === false) { $diag['reason'] = 'fundo-ilegivel'; return $bannerHtml; }

            $boxes = extd_text_boxes($banner, $canvasW, $canvasH);
            if (!$boxes) { imagedestroy($bg); $diag['reason'] = 'sem-copy'; return $bannerHtml; }

            // Locate the scrim: empty div sitting at z-index 1.
            $scrimEl = null; $scrimStyle = '';
            foreach (iterator_to_array($banner->childNodes) as $n) {
                if (!($n instanceof DOMElement) || strtolower($n->tagName) !== 'div') continue;
                if (trim($n->textContent) !== '') continue;
                $st = extgd_parse_style($n->getAttribute('style'));
                if (trim($st['z-index'] ?? '') === '1') { $scrimEl = $n; $scrimStyle = $n->getAttribute('style'); break; }
            }

            $scrimLum = $scrimStyle !== '' ? extd_scrim_lum($scrimStyle) : 0.0;
            $canvasAR = $canvasW / $canvasH;

            $need = 0.0; $measured = [];
            foreach ($boxes as $b) {
                $s = extd_box_stats($bg, $canvasAR, $b);
                if ($s === null) continue;
                $a = extd_required_alpha($s, $b['inkLight'], $scrimLum);
                $need = max($need, $a);
                $measured[] = [
                    'z'    => $b['z'],
                    'ink'  => $b['inkLight'] ? 'clara' : 'escura',
                    'mean' => round($s['mean'], 3),
                    'sd'   => round($s['sd'], 3),
                    'p85'  => round($s['p85'], 3),
                    'p15'  => round($s['p15'], 3),
                    'need' => round($a, 3),
                ];
            }
            imagedestroy($bg);

            if (!$measured) { $diag['reason'] = 'nao-mediu'; return $bannerHtml; }

            $diag['ran']    = true;
            $diag['boxes']  = $measured;
            $diag['need']   = round($need, 3);

            // ── No scrim in the HTML ───────────────────────────────────────────────────────
            if ($scrimEl === null) {
                if ($need < 0.10) { $diag['action'] = 'nada-a-fazer'; return $bannerHtml; }
                $rgb = '0,0,0';
                $inject = sprintf(
                    '<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(%s,%.2f) 0%%,rgba(%s,%.2f) 45%%,rgba(%s,0) 78%%);z-index:1;pointer-events:none"></div>',
                    $rgb, $need, $rgb, $need * 0.38, $rgb
                );
                $diag['action'] = 'injetado';
                $diag['peakAfter'] = round($need, 3);
                return preg_replace('/(<img[^>]*class="[^"]*ad-bg[^"]*"[^>]*>)/i', '$1' . $inject, $bannerHtml, 1) ?? $bannerHtml;
            }

            $peak = extd_peak_alpha($scrimStyle);
            $diag['peakBefore'] = round($peak, 3);

            // ── The photo carries the copy on its own → delete the gradient ────────────────
            // This is the branch that breaks the sameness: no fade, just the picture.
            if ($need < 0.06) {
                $diag['action']    = 'removido';
                $diag['peakAfter'] = 0.0;
                $quoted = preg_quote($scrimStyle, '/');
                $out = preg_replace('/<div[^>]*style="' . $quoted . '"[^>]*>\s*<\/div>\s*/i', '', $bannerHtml, 1);
                return ($out !== null && $out !== $bannerHtml) ? $out : $bannerHtml;
            }

            if ($peak <= 0.0) { $diag['action'] = 'sem-alfa-no-scrim'; return $bannerHtml; }

            $factor = $need / $peak;
            if ($factor > 0.92 && $factor < 1.08) { $diag['action'] = 'mantido'; $diag['peakAfter'] = round($peak, 3); return $bannerHtml; }

            $newStyle = extd_scale_alphas($scrimStyle, $factor);
            $diag['action']    = $factor < 1 ? 'enfraquecido' : 'reforcado';
            $diag['peakAfter'] = round(min(0.90, $peak * $factor), 3);
            $out = str_replace('style="' . $scrimStyle . '"', 'style="' . $newStyle . '"', $bannerHtml);
            return $out !== '' ? $out : $bannerHtml;

        } catch (Throwable $e) {
            $diag['reason'] = 'erro: ' . $e->getMessage();
            return $bannerHtml; // a measurement problem must never cost a generation
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // DEPTH LAYER — the one thing the old stack could not express.
    //
    // Every ad we ship is background (z 0) → scrim (z 1) → copy (z 10..40). There is no layer
    // ABOVE the copy, so a scene element can never pass in front of the type and the result
    // always reads as a caption pasted onto a photo. This adds z-index 35: a cut-out subject
    // that crosses the text block, which is what gives a creative its sense of depth.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Turn a hero rendered on a FLAT key colour into a PNG with a real alpha channel.
     *
     * The image models do not document transparency support, so instead of depending on it we
     * ask for the subject on a flat chroma background and key it out here — deterministic, and
     * it works whatever the model decides to return.
     *
     * Distance is measured in RGB with the key colour's own channels weighted down, which keeps
     * green spill on hair and glass edges from eating into the subject. Pixels near the
     * threshold get partial alpha so edges stay soft instead of stair-stepping.
     *
     * @return string PNG bytes, or '' when the image does not look keyable (no dominant flat
     *                border colour) — in which case the caller must skip the depth layer rather
     *                than composite a rectangle with a coloured halo.
     */
    function extd_chroma_key_png(string $bytes, array $key = [0, 255, 0], float $tol = 0.34): string {
        $src = extgd_image_from_bytes($bytes);
        if ($src === false) return '';
        $w = imagesx($src); $h = imagesy($src);
        if ($w < 16 || $h < 16) { imagedestroy($src); return ''; }

        // Sanity: the border really has to BE the key colour, otherwise we would punch holes in
        // a normal photo. Sample the frame and demand a strong majority.
        $near = 0; $tot = 0;
        $maxD = sqrt(3 * 255 * 255);
        $probe = static function (int $x, int $y) use ($src, $key, $maxD): float {
            $c = imagecolorat($src, $x, $y);
            $dr = (($c >> 16) & 0xFF) - $key[0];
            $dg = (($c >> 8) & 0xFF) - $key[1];
            $db = ($c & 0xFF) - $key[2];
            return sqrt($dr * $dr + $dg * $dg + $db * $db) / $maxD;
        };
        for ($x = 0; $x < $w; $x += max(1, (int)($w / 60))) {
            $tot += 2;
            if ($probe($x, 0) < $tol) $near++;
            if ($probe($x, $h - 1) < $tol) $near++;
        }
        for ($y = 0; $y < $h; $y += max(1, (int)($h / 60))) {
            $tot += 2;
            if ($probe(0, $y) < $tol) $near++;
            if ($probe($w - 1, $y) < $tol) $near++;
        }
        if ($tot === 0 || ($near / $tot) < 0.75) { imagedestroy($src); return ''; }

        $out = imagecreatetruecolor($w, $h);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        imagefilledrectangle($out, 0, 0, $w, $h, imagecolorallocatealpha($out, 0, 0, 0, 127));

        $soft = $tol * 0.55; // width of the partial-alpha ramp
        $kept = 0;
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c  = imagecolorat($src, $x, $y);
                $r  = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
                $dr = $r - $key[0]; $dg = $g - $key[1]; $db = $b - $key[2];
                $d  = sqrt($dr * $dr + $dg * $dg + $db * $db) / $maxD;

                if ($d < $tol - $soft) continue;                      // pure key → stays transparent
                if ($d < $tol) {
                    $a = 127 - (int)round(127 * (($d - ($tol - $soft)) / max(1e-6, $soft)));
                } else {
                    $a = 0; $kept++;
                }
                // Spill suppression: pull the key channel back to its neighbours on edge pixels.
                if ($key[1] >= 200 && $g > max($r, $b)) $g = (int)round(max($r, $b) + ($g - max($r, $b)) * 0.25);
                imagesetpixel($out, $x, $y, imagecolorallocatealpha($out, $r, $g, $b, max(0, min(127, $a))));
            }
        }
        imagedestroy($src);

        if ($kept < ($w * $h) * 0.02) { imagedestroy($out); return ''; } // nothing survived → not a subject
        ob_start(); imagepng($out, null, 6); $png = (string)ob_get_clean();
        imagedestroy($out);
        return $png;
    }

    /**
     * Resolve an arbitrary image into a cut-out usable as the depth layer.
     *
     * Order matters. An image that ALREADY carries transparency is used untouched — that covers
     * a proper PNG from the client and anything a future model returns with a real alpha
     * channel. Otherwise we try to key out a flat studio background. If neither holds, we return
     * '' and the caller skips the layer: pasting an opaque rectangle over the copy would be far
     * worse than having no depth at all.
     *
     * @return string data: URI ready to drop into the HTML, or '' when unusable.
     */
    function extd_prepare_cutout(string $src): string {
        $src = trim($src);
        if ($src === '') return '';
        $bytes = extgd_fetch_bytes($src);
        if ($bytes === '') return '';

        // Already transparent?
        $im = extgd_image_from_bytes($bytes);
        if ($im !== false) {
            $w = imagesx($im); $h = imagesy($im);
            $transp = 0; $probes = 0;
            for ($i = 0; $i < 40; $i++) {
                $x = (int)round(($i / 39) * ($w - 1));
                foreach ([0, $h - 1] as $y) {
                    $probes++;
                    if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) > 100) $transp++;
                }
            }
            imagedestroy($im);
            if ($probes > 0 && ($transp / $probes) > 0.6) {
                return 'data:image/png;base64,' . base64_encode($bytes);
            }
        }

        // Flat studio background → key it out. Green first, then magenta.
        foreach ([[0, 255, 0], [255, 0, 255]] as $key) {
            $png = extd_chroma_key_png($bytes, $key);
            if ($png !== '') return 'data:image/png;base64,' . base64_encode($png);
        }
        return '';
    }

    /**
     * Composite a cut-out subject ABOVE the copy so it crosses the text block.
     *
     * Side is chosen from where the copy actually sits: the subject enters from the opposite
     * edge and is allowed to bite ~10% of the canvas into the text column. That bite is the
     * whole point — a subject that merely sits beside the type adds nothing.
     */
    function extd_add_depth_layer(string $bannerHtml, string $cutoutSrc, int $W, int $H, array &$diag = []): string {
        $diag = ['ran' => false, 'reason' => ''];
        if (trim($bannerHtml) === '' || trim($cutoutSrc) === '') { $diag['reason'] = 'sem-recorte'; return $bannerHtml; }

        try {
            $prev = libxml_use_internal_errors(true);
            $doc  = new DOMDocument();
            $doc->loadHTML('<?xml encoding="utf-8" ?>' . $bannerHtml, LIBXML_NONET);
            libxml_clear_errors();
            libxml_use_internal_errors($prev);

            $banner = null;
            foreach ($doc->getElementsByTagName('div') as $d) {
                if (strpos($d->getAttribute('class'), 'ad-banner') !== false) { $banner = $d; break; }
            }
            if ($banner === null) {
                $body = $doc->getElementsByTagName('body')->item(0);
                foreach (($body ? iterator_to_array($body->childNodes) : []) as $n) {
                    if ($n instanceof DOMElement && strtolower($n->tagName) === 'div') { $banner = $n; break; }
                }
            }
            if ($banner === null) { $diag['reason'] = 'sem-banner'; return $bannerHtml; }

            $boxes = extd_text_boxes($banner, $W, $H);
            if (!$boxes) { $diag['reason'] = 'sem-copy'; return $bannerHtml; }

            // Copy centroid decides which edge the subject comes from.
            $cx = 0.0; $lowest = 0.0;
            foreach ($boxes as $b) { $cx += ($b['x0'] + $b['x1']) / 2; $lowest = max($lowest, $b['y1']); }
            $cx /= count($boxes);
            $fromRight = ($cx < 0.5);

            // Height: tall enough to read as a real element, short enough to leave the logo alone.
            $hPct  = 66;
            $edge  = -6;                       // let it bleed off the canvas — a framed cut-out looks like a sticker
            $side  = $fromRight ? 'right' : 'left';
            $shadow = 'drop-shadow(0 12px 24px rgba(0,0,0,0.45))';

            $img = sprintf(
                '<img class="ad-fg" src="%s" alt="" style="position:absolute;%s:%d%%;bottom:0;height:%d%%;width:auto;max-width:62%%;object-fit:contain;z-index:35;pointer-events:none;filter:%s" />',
                htmlspecialchars($cutoutSrc, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
                $side, $edge, $hPct, $shadow
            );

            // Insert as the LAST child of the banner: document order is z-order for the GD
            // fallback, so appending is what keeps both renderers agreeing.
            $pos = strrpos($bannerHtml, '</div>');
            if ($pos === false) { $diag['reason'] = 'html-sem-fecho'; return $bannerHtml; }

            $diag['ran']  = true;
            $diag['side'] = $side;
            $diag['overlapY'] = round($lowest, 3);
            return substr($bannerHtml, 0, $pos) . $img . substr($bannerHtml, $pos);

        } catch (Throwable $e) {
            $diag['reason'] = 'erro: ' . $e->getMessage();
            return $bannerHtml;
        }
    }
}

/* ═════════════════════════════════════════════════════════════════════════════════════════
   CAMINHO C — o anuncio inteiro pelo modelo de imagem da OpenAI, numa chamada so'.

   O Gemini continua sendo o caminho padrao. Este entra apenas quando o payload pede, e cai
   de volta no fluxo normal em qualquer falha. O que ele faz de diferente:

   - a COR vem sempre do cadastro, em hexadecimal, com o papel de cada uma declarado. So' se
     o campo estiver vazio e' que a paleta sai das referencias. Medido: nomear a cor derruba
     a variacao entre geracoes de 15 graus de matiz para 1.
   - as REFERENCIAS entram com o papel explicito. Em modo proxy os posts sao de concorrente,
     e o modelo e' avisado de que nao pode tirar identidade deles — testado numa marca cujas
     referencias eram azuis e vermelhas e cujo resultado saiu 96% na cor propria.
   - a LOGO nunca e' desenhada: entra por cima, em PNG, no canto que a imagem pronta deixar
     mais calmo.
   - as unicas travas criativas sao a copy exata e a legibilidade.
   ═════════════════════════════════════════════════════════════════════════════════════════ */

if (!function_exists('extc_openai_prompt')) {

    /** Papel de cada cor cadastrada. Vazio quando nao ha' cor — e' o sinal para o modelo
     *  tirar a paleta das referencias, que e' a regra combinada. */
    /**
     * Papel de cada imagem que segue ao modelo, na ORDEM enviada: 'hero' (referencia do cliente),
     * 'site' (site do cliente), 'post' (brand_posts) ou 'outro' (produto/empresa/fundo). O hero e'
     * decidido por POSICAO - composeHeroRef garante que ele e' o primeiro - e os demais casam por
     * nome de arquivo, que sobrevive a absolutizacao/espelhamento de URL.
     */
    function extc_papeis_refs(array $refs, bool $heroRef, array $siteImages, array $brandPosts): array {
        $nome = fn($u) => strtolower(basename((string)parse_url((string)$u, PHP_URL_PATH)));
        $site  = array_flip(array_filter(array_map($nome, $siteImages), 'strlen'));
        $posts = array_flip(array_filter(array_map($nome, $brandPosts), 'strlen'));
        $papeis = [];
        foreach (array_values($refs) as $i => $u) {
            $n = $nome($u);
            if ($heroRef && $i === 0)      $papeis[] = 'hero';
            elseif (isset($site[$n]))      $papeis[] = 'site';
            elseif (isset($posts[$n]))     $papeis[] = 'post';
            else                           $papeis[] = 'outro';
        }
        return $papeis;
    }

    /**
     * Legenda "imagem N = o que e' e para que serve", agrupando posicoes consecutivas de mesmo
     * papel. Devolve '' se os papeis nao foram calculados (o prompt cai no texto generico).
     */
    function extc_legenda_refs(array $papeis, bool $proxy): string {
        if (empty($papeis)) return '';
        $desc = [
            'site'  => "photos/screenshots of the CLIENT'S OWN website - a source for the brand's identity and colour feel only, never the direction for this piece; never reproduce the face or likeness of any real person in them",
            'post'  => $proxy
                ? "posts by OTHER companies in the same market - the conventions of the category only; take NO identity from them (not colour, logo, typography or devices); never reproduce the face or likeness of any real person in them"
                : "this brand's own past posts - its graphic vocabulary (devices, photographic treatment, rhythm) only; do NOT copy their layout or subject, and never reproduce the face or likeness of any real person in them",
            'outro' => "other assets of this brand (product or company photos) - you may use what they depict if it serves the piece, but never the face or likeness of any real person in them; they are not a style direction",
        ];
        $grupos = [];
        foreach ($papeis as $i => $p) {
            if ($p === 'hero') continue;
            $n = $i + 1;
            $ult = count($grupos) - 1;
            if ($ult >= 0 && $grupos[$ult]['p'] === $p && $grupos[$ult]['fim'] === $n - 1) { $grupos[$ult]['fim'] = $n; continue; }
            $grupos[] = ['p' => $p, 'ini' => $n, 'fim' => $n];
        }
        $l = [];
        foreach ($grupos as $g) {
            $rot = $g['ini'] === $g['fim'] ? "Image {$g['ini']}" : "Images {$g['ini']}-{$g['fim']}";
            $l[] = "- {$rot}: {$desc[$g['p']]}.";
        }
        return implode("\n", $l);
    }

    function extc_openai_paleta(array $company, array $campaign = []): string {
        $hex = function ($v) {
            $v = trim((string)$v);
            return preg_match('/^#[0-9a-f]{6}$/i', $v) ? strtolower($v) : '';
        };
        $p = $hex($company['primaryColor'] ?? '');
        $a = $hex($company['accentColor'] ?? '');
        $s = $hex($company['secondaryColor'] ?? '');
        // A cor de FUNDO. Ela atravessava o sistema inteiro e morria aqui: o company-assets
        // grava backgroundColor, o brandBridge leva ate' a campanha, e esta funcao so' lia
        // primary/accent/secondary — pedir um fundo nao mudava um pixel.
        // So' o PEDIDO vale. O fundo do cadastro NAO entra, ao contrario do primary/accent, e a
        // razao e' que ele nao e' uma escolha: o formulario do frontend nasce com '#FFFFFF'
        // (src/types/businessForm.ts), entao toda company criada pelo wizard carrega um hex que
        // ninguem escolheu — e "the dominant field of the piece sits on this colour" em branco
        // achataria a peca inteira. Por isso a chave e' backgroundColorRequested, que o
        // brandBridge nao preenche: 'backgroundColor' chega com o valor do cadastro e nao
        // distingue pedido de padrao.
        $bg = $hex($campaign['backgroundColorRequested'] ?? '');
        $linhaFundo = $bg !== ''
            ? "- BACKGROUND {$bg}. The dominant field of the piece sits on this colour."
            : '';
        if ($p === '') {
            // Sem cor primaria o texto de sempre manda ler a paleta das referencias. Duas
            // situacoes novas o tornam falso, e cada uma ganha o seu proprio: nao ha' referencia
            // nenhuma anexada (ignore_references), ou ha' fundo registrado e a frase generica
            // contradiz a linha do fundo. Sem nenhuma das duas, o texto sai byte a byte igual.
            if (!empty($campaign['ignoreReferences'])) {
                return trim("BRAND COLOURS: this client has no colour registered and no reference image is attached. Choose a restrained palette of two or three colours yourself and hold to it across the whole piece.\n" . $linhaFundo);
            }
            if ($linhaFundo !== '') {
                return "BRAND COLOURS: the background below was requested by the client for this piece and is not negotiable. Read the REST of the palette from the attached brand references and stay strictly inside what is visibly theirs.\n" . $linhaFundo;
            }
            return "BRAND COLOURS: this client has no colour registered. Read the palette from the attached brand references and stay strictly inside it — do not invent a colour that is not visibly theirs.";
        }
        // Com referencia do cliente (heroRef) a divisao muda: a imagem 1 manda no clima, na luz e nas
        // cores da CENA, e as cores da marca assinam a peca (tipo, acentos, paineis) sem repintar a
        // referencia. Antes o bloco dizia "ignore qualquer referencia que puxe pra outra cor" e o
        // primary "dominante" ainda brigava com o fundo pedido - a referencia perdia dos dois lados.
        $comRef = !empty($campaign['composeHeroRef']) && empty($campaign['ignoreReferences']);
        $l = [$comRef
            ? "BRAND COLOURS - these come from the client's registered brand fields. The client also chose a reference image for this piece (Image 1): it decides who or what the hero is and the overall look and feel, while the scene around the hero is designed for this ad, and the brand colours below SIGN the piece on top of it:"
            : "BRAND COLOURS - these come from the client's registered brand fields, not from your reading of the references, and they are not negotiable:"];
        if ($comRef) {
            $l[] = "- PRIMARY {$p}. The brand's signature colour: the headline, the key panel or device, the accents that make the piece recognisably theirs. It does not have to be the largest field.";
        } elseif ($bg !== '') {
            $l[] = "- PRIMARY {$p}. The brand's signature colour: the headline, the panels, the devices that sit on the background below - it does not replace that background.";
        } else {
            $l[] = "- PRIMARY {$p}. This is the dominant colour of the piece: the large fields, the panels, the mood.";
        }
        if ($a !== '') $l[] = "- ACCENT {$a}. Use it sparingly - a highlighted word, a small device, the button.";
        if ($s !== '') $l[] = "- SECONDARY {$s}. Use it for a contrasting block, a card, or the button when the piece needs weight.";
        if ($linhaFundo !== '') $l[] = $linhaFundo;
        $l[] = $comRef
            ? "Introduce NO other brand colour, but do not repaint the hero into these colours either: keep the subject's natural colours, and let these be what identifies the brand around and on top of it."
            : "These are the entire palette. Introduce NO other brand colour. If a reference image pulls you elsewhere, ignore it - those are variations in a feed, not the brand.";
        return implode("\n", $l);
    }

    /**
     * Numero de item de carrossel em lista/passo a passo. 24/09, pedido do Fullstop: "1. ..." e
     * "Passo 1: ..." saiam como mais um caractere da frase, e em carrossel de lista o numero e' o
     * que mostra o progresso da leitura. Separa o numero da headline para o prompt pedi-lo como
     * ELEMENTO GRAFICO. So' vale em carrossel declarado (ou com carousel_item_number explicito):
     * numa peca avulsa "1. ..." nao e' item de nada. O numero explicito vence o lido da headline.
     * O ponto exige espaco depois ("1.5 milhao" nao casa). null = nao ha' numero a destacar.
     *
     * @return array{n:int, rotulo:string, resto:string}|null
     */
    function extc_numero_lista(array $campaign): ?array {
        $head = trim((string)($campaign['mainHeadline'] ?? ''));
        $explicito = (int)($campaign['carouselItemNumber'] ?? 0);
        $emCarrossel = (int)($campaign['carouselIndex'] ?? 0) >= 1 && (int)($campaign['carouselTotal'] ?? 0) >= 2;
        if (!$emCarrossel && $explicito < 1) return null;

        $n = 0; $rotulo = ''; $resto = $head;
        if (preg_match('/^(passo|etapa|step)\s*(\d{1,2})\s*[:.\x{2013}\x{2014}-]\s*(.+)$/iu', $head, $m)) {
            $rotulo = $m[1]; $n = (int)$m[2]; $resto = trim($m[3]);
        } elseif (preg_match('/^(\d{1,2})\s*[.)]\s+(.+)$/u', $head, $m)) {
            $n = (int)$m[1]; $resto = trim($m[2]);
        }
        if ($explicito >= 1) $n = $explicito;
        if ($n < 1 || $resto === '') return null;
        return ['n' => $n, 'rotulo' => $rotulo, 'resto' => $resto];
    }

    /**
     * Descreve ONDE a peca vai aparecer. A deteccao e' pela PROPORCAO, nunca pelo nome do
     * preset: o 4:5 do chamador chega como objeto customizado, sem nome conhecido, e casar
     * por nome deixaria a maioria dos posts sem esse bloco — que e' justamente o que impede
     * o botao falso.
     */
    function extc_bloco_rede(array $fmt): string {
        $w = max(1, (int)($fmt['width'] ?? 1080));
        $h = max(1, (int)($fmt['height'] ?? 1080));
        $r = $w / $h;
        $rede = trim((string)($fmt['platform'] ?? ''));
        $rede = $rede !== '' ? ucfirst($rede) : 'the social network';

        if ($r >= 1.7)        $onde = 'a wide landscape slot in a feed, seen small';
        elseif ($r >= 0.95)   $onde = 'a square post in a feed, scrolling on a phone';
        elseif ($r >= 0.72)   $onde = 'a tall portrait post in a feed — it fills more of the screen than a square, so it has more room vertically';
        else                  $onde = 'a full-screen vertical story or reel, tapped through in seconds';

        return "WHERE THIS WILL BE SEEN: {$onde}, on {$rede}. Around your image the platform draws its own interface — profile name above, caption below, and its own real call-to-action button under the image. Design for that context:\n"
            . "- ⛔ Do NOT draw a user-interface button inside the image: no rounded rectangle with a label inside it, no pill, no chip that looks tappable. The platform already puts a real button right below; a second, fake one reads as a screenshot of an app instead of an advertisement.\n"
            . "- The call to action lives as TYPE: a short confident line, set apart by weight, or underlined, or followed by a small arrow. Never boxed.\n"
            . "- Keep the outer edges and corners clear of anything essential — the platform crops and overlays there.\n"
            . "- It competes against friends' photos in a scroll. The headline has to land in under a second.";
    }

    /** O prompt completo. Duas travas apenas: copy exata e legibilidade. */
    function extc_openai_prompt(array $campaign, array $company, array $fmt = []): string {
        $head = trim((string)($campaign['mainHeadline'] ?? ''));
        // Item de lista: o numero sai da frase e vira elemento grafico ($blocoNumero, abaixo).
        $numLista = extc_numero_lista($campaign);
        if ($numLista !== null) $head = $numLista['resto'];
        $sub  = trim((string)($campaign['subheadline'] ?? ''));
        $cta  = trim((string)($campaign['ctaText'] ?? ''));
        $prod = trim((string)($campaign['productName'] ?? ($campaign['valueProposition'] ?? '')));
        $pub  = trim((string)($campaign['targetAudience'] ?? ''));
        $lang = trim((string)($campaign['language'] ?? 'pt-BR'));
        $proxy = !empty($company['brandPostsAreProxy']);
        // 18/09: caso real de faculdade de TECH saindo com livro-e-caneca em toda peca - o
        // prompt tinha $prod (nome do produto/proposta de valor) e $pub (publico), mas nunca a
        // descricao nem a categoria da empresa. Sem isso o modelo so' tem o NOME da categoria
        // para imaginar a cena ("faculdade" -> cliche' generico de ensino: livro, caneca, beca),
        // nunca o que a empresa REALMENTE e'. $sobreNegocio da' esse chao: categoria, descricao
        // e os arrays services/differentiators (que ja' chegavam mapeados em ext_map_company e
        // nunca eram lidos aqui) - a mesma fonte que hoje so' aparece pro dono ver no cadastro.
        $categoria = trim((string)($company['businessCategory'] ?? ''));
        $descNegocio = trim((string)($company['businessDescription'] ?? ''));
        $servicos = is_array($company['services'] ?? null)
            ? implode(', ', array_values(array_filter(array_map(fn($v) => trim((string)$v), $company['services']), 'strlen')))
            : '';
        $diferenciais = is_array($company['differentiators'] ?? null)
            ? implode(', ', array_values(array_filter(array_map(fn($v) => trim((string)$v), $company['differentiators']), 'strlen')))
            : '';
        $linhasNegocio = [];
        if ($categoria !== '') $linhasNegocio[] = "- Category: {$categoria}.";
        if ($descNegocio !== '') $linhasNegocio[] = "- What it actually is: {$descNegocio}.";
        if ($servicos !== '') $linhasNegocio[] = "- What it offers: {$servicos}.";
        if ($diferenciais !== '') $linhasNegocio[] = "- What sets it apart: {$diferenciais}.";
        $sobreNegocio = empty($linhasNegocio) ? '' : (
            "WHAT THIS BUSINESS ACTUALLY IS - ground the scene and every prop in this, not in the generic "
            . "stereotype of its category:\n" . implode("\n", $linhasNegocio) . "\n"
            . "If the category name alone would suggest a cliche (e.g. \"college\" pulling you toward books, "
            . "a graduation cap, a mug; \"restaurant\" toward a plated dish shot), let the specifics above "
            . "override it - depict what THIS business actually does, never the stock-photo default for its category."
        );
        // A fonte pedida NESTA geracao vence a que esta' persistida na empresa — e' exatamente
        // para isso que customHeadingFontName existe no ext_map_campaign(). O Caminho C lia so'
        // a da empresa, entao pedir outra familia por peca nao tinha efeito nenhum aqui.
        $fonte = trim((string)(
            $campaign['customHeadingFontName']
            ?? $campaign['fontFamily']
            ?? $company['headingFont']
            ?? ''
        ));

        // Terceiro caso: ignore_references pediu a peca do zero, sem anexo nenhum. Sem esta
        // ramificacao o prompt continua afirmando que ha' imagens anexadas quando nao ha', e o
        // modelo passa a descrever referencias que nunca recebeu.
        // Quarto caso: composeHeroRef - o cliente mandou uma referencia de criacao ESPECIFICA
        // para esta peca (campaign.reference_image_url), que generate-ads.php sempre coloca em
        // PRIMEIRO lugar em composeCompanyRefs. Ate' aqui o prompt tratava esse anexo com o MESMO
        // peso dos ~8 brand_posts que viajam em toda geracao (identidade geral da marca, nao
        // referencia desta peca) - o modelo tinha liberdade total para escolher qual dos anexos
        // seguir, e o caso FIAP (16/09/2026, ref-fiap-8.jpeg) mostrou o resultado nao refletindo a
        // referencia que o cliente escolheu. Aqui o primeiro anexo passa a ser nomeado como a
        // referencia PRINCIPAL desta peca; os demais (brand_posts/site) seguem anexados, so' que
        // como contexto de identidade, nao mais como direcao principal.
        //
        // 17/09: carrossel FIAP real testou isso com uma referencia que era uma FOTO DE ROSTO de
        // uma pessoa. "Siga de perto composicao, sujeito e mood" foi lido, literalmente, como
        // "recrie este rosto" - saiu um slide com o rosto da pessoa desenhado em word-art (as
        // letras do copy formando os tracos do rosto), reconhecivel. Alem de visualmente errado,
        // estampa o rosto de uma pessoa real (nao necessariamente o cliente, nem com direito de
        // uso comercial daquele rosto) numa peca publicitaria - risco serio, nao so' estetico.
        // A intencao SEMPRE foi priorizar estilo/composicao/paleta da referencia, nunca reproduzir
        // pessoas especificas que aparecam nela. $clausulaRosto carrega essa ressalva, anexada nos dois
        // ramos do heroRef (proxy e normal) - sem ela a peca de "siga de perto" fica sem contrapeso
        // e o modelo volta a tratar a referencia como algo a copiar literalmente.
        //
        // 18/09: o caso OPOSTO apareceu no dia seguinte, na mesma conta de teste (FIAP, company 660,
        // ref-fiap-10.jpeg): cliente que manda o PROPRIO rosto de proposito - o dono aparece no post,
        // a equipe aparece, depoimento, bastidores - e nao ve' rosto nenhum voltar. Primeiro entrou
        // um opt-in por geracao (campaign.reference_face_authorized).
        // 21/09: a Fullstop assumiu o consentimento pelos termos de uso do cliente e pediu o padrao
        // invertido: com campaign.reference_image_url o rosto e' reproduzido SEM flag, e so' um
        // reference_face_authorized:false explicito devolve a clausula de 17/09. O default vive no
        // mapeamento (ext_map_campaign, generate-ads.php); aqui a checagem segue !empty(), entao uma
        // campanha sem a chave (dado antigo, outro caminho) continua bloqueando. Nada aqui valida
        // identidade nem consentimento. A liberacao e' so' da imagem 1: rostos em brand_posts, site e
        // imagens de produto seguem sem ser recriados (extc_legenda_refs e $ctxRostos).
        $heroRef = !empty($campaign['composeHeroRef']);
        $rostoAutorizado = !empty($campaign['referenceFaceAuthorized']);
        // Com autorizacao a frase nao some: vira o contrario dela. So' apagar a ressalva devolveria o
        // comportamento de antes de 17/09, em que a referencia era ambigua e o rosto aparecia ou nao
        // conforme o humor do modelo; dizer explicitamente que a pessoa pode aparecer e' o que faz o
        // rosto voltar de forma confiavel, que e' o ponto do pedido. (O modelo de imagem ainda pode
        // recusar por politica propria sobre pessoas reais - isso e' da OpenAI, nao ha' como forcar
        // daqui; a recusa volta como batch falho com o motivo da API.)
        $clausulaRosto = $rostoAutorizado
            ? " ABOUT THE PERSON IN IT: the client supplied this photo deliberately, as the reference for this piece, and answers for the right to show the person in it. So the person is not something to avoid here - if the composition calls for them, keep their face and likeness faithful to the reference, while their pose, expression, clothing and surroundings are yours to adapt to this piece. This applies to THIS image only: people who appear in any other attachment are never to be depicted."
            : " CRITICAL SAFETY RULE, overrides everything else about this reference: take ONLY its STYLE - composition, framing, colour palette, lighting, mood, and any non-human elements (props, setting, typographic treatment). If it features a real person, you must NOT reproduce, recreate or make that specific person's face or likeness recognisable anywhere in the output - not photorealistically, not stylised, not built out of letters or words, not as a silhouette or outline. This is a real individual's photo, not a model release; you have no right to depict their likeness. If the reference's subject is a person, either leave people out of this piece entirely, or use a generic, anonymous figure that bears no resemblance to them.";
        // 18/09: reclamacao de carrossel saindo com slides que nao combinam entre si. O heroRef ja'
        // priorizava a referencia certo (forge_debug confirma ref_prioritaria), mas so' pedia
        // "estilo/composicao/paleta" em termos vagos - o suficiente pra uma peca isolada, fraco
        // demais pra fazer duas pecas parecerem da MESMA sessao/serie quando a referencia de uma
        // e' literalmente a imagem gerada da outra (caso em que o chamador reusa o slide anterior
        // como reference_image_url pro proximo - o mecanismo de heroRef ja' suporta isso, sem
        // payload novo). $clausulaContinuidade aperta a exigencia pra elementos TECNICOS
        // (grade de cor, direcao/dureza de luz, lente, staging) em vez de so' "estilo" generico.
        // Condicional de proposito: o heroRef tambem e' uma foto de inspiracao comum que o cliente
        // manda, e ai' "copie a execucao tecnica" superaria a intencao (estilo, nao clone). Sem flag
        // no payload, quem decide e' o modelo, olhando se a referencia e' uma peca pronta da serie.
        // 23/09: a clausula pedia tambem "o mesmo staging e a mesma logica de enquadramento", e era
        // demais - com ela o carrossel passou do problema de 18/09 (slides que nao combinam) pro
        // oposto, N variacoes da mesma peca. Continuidade e' tecnica (grade, luz, lente, acabamento);
        // composicao e' justamente o que tem de mudar de slide pra slide, senao nao ha' serie, ha'
        // repeticao. Ver tambem $blocoCarrossel, que diz isso com indice e total na mao.
        $clausulaContinuidade = " CONTINUITY, only if it applies: if this reference is itself a finished piece from the same set as this one (for example, another slide of the same carousel - recognisable by the same brand layout, type and treatment), match its exact execution as closely as you can - the same colour grade and white balance, the same lighting direction and hardness, the same lens character and depth of field, the same level of polish - so the two read as one shoot or one design system, not a loosely related idea. What you must NOT carry over is the composition: this piece needs its own crop, its own subject distance and its own framing, or the set reads as the same slide sent twice. If it is instead a general inspiration image (a photo, a mood, someone else's post), ignore this sentence and use it only as the direction described above.";
        // 21/09: o prompt dizia so' "a primeira e' a referencia, as demais sao contexto" - ate' 5
        // imagens de marca sem dizer o que cada uma era, e o modelo as pesava por igual (caso FIAP:
        // a referencia do cliente nao guiava a peca). Com os papeis calculados pelo worker, cada
        // posicao ganha uma linha do que e' e do que NAO pode tirar dela.
        // 21/09: a referencia do cliente nao entrava na cena. O prompt a tratava como direcao de
        // ESTILO e ainda dava "liberdade total" sobre a cena, entao o modelo podia (e fazia) montar
        // uma peca sem o assunto dela. Aqui o assunto vira obrigatorio e heroi. Quem decide se o
        // ROSTO de uma pessoa entra e' a flag reference_face_authorized (clausulaRosto): sem ela o
        // lugar do heroi vai pra uma figura anonima, nunca pro rosto real. A excecao e' a referencia
        // que e' uma peca pronta da mesma serie (slide anterior de carrossel): essa nao se cola.
        // 21/09 (tarde): com o rosto liberado a peca passou a sair como a FOTO da referencia com a copy
        // por cima - a identidade certa, mas fundo, pose, roupa e luz copiados. O heroi mantem so' a
        // IDENTIDADE (quem/o que e'); a cena em volta e' reencenada para o tema deste anuncio.
        $clausulaHeroi = " MANDATORY - THE REFERENCE'S SUBJECT MUST APPEAR IN THE SCENE: this image is not only style inspiration. What it depicts (the person, product, object or place) must be IN the finished piece as its HERO: large, unmistakable, the visual focus. Keep only its IDENTITY - who or what it is: for a person their face, hair, skin tone and build; for a product or object its shape, colours and details. Do NOT copy the reference's background, setting, framing, pose, clothing or lighting: re-stage the subject inside a scene designed for THIS ad's theme and copy - a fitting activity, pose, expression, wardrobe, environment and light - and integrate it naturally (matching perspective, light direction and shadows), so it looks made for this piece and not pasted from another photo. A piece that could have been made without ever seeing the subject has failed, and so has one that is just the reference photo with type on top. Never shrink the subject to a thumbnail, a background texture or a decorative detail. Exception: if Image 1 is itself a finished piece of the same set (a complete ad with type and layout, such as another slide of the same carousel), do not paste it in; follow the continuity rule below instead."
            . ($rostoAutorizado
                ? ''
                : " If its subject is a real person, the safety rule below decides how: the hero role goes to a generic, anonymous figure in the same role and setting, never to that person's likeness.");
        // Brand posts, site e imagens de produto sao contexto, nunca pedido do cliente: a liberacao do
        // rosto vale so' pra imagem de campaign.reference_image_url.
        $ctxRostos = " If any of these attachments shows a real person, do NOT reproduce or make that person's face or likeness recognisable - they are context, not something the client asked to have depicted.";
        $legendaRefs = $heroRef ? extc_legenda_refs((array)($campaign['composeRefRoles'] ?? []), $proxy) : '';
        $refs = !empty($campaign['ignoreReferences'])
            ? "NO REFERENCE IMAGES are attached for this piece, on purpose. Build it from the brand fields alone - the colours, the typeface and the direction above. Do not imitate any particular look you might assume this brand has."
            : ($heroRef && $legendaRefs !== ''
            ? "ABOUT THE ATTACHED IMAGES, in the order they are attached:\n- Image 1: the creative reference the CLIENT THEMSELVES chose specifically for THIS piece - it is the PRIMARY visual direction and must never be outweighed by the other attachments.{$clausulaHeroi}{$clausulaRosto}{$clausulaContinuidade}\n{$legendaRefs}\nEverything after Image 1 is secondary context. If it pulls in a different direction from Image 1, Image 1 wins."
            : ($heroRef
            ? ($proxy
                ? "ABOUT THE ATTACHED IMAGES: the FIRST attached image is the creative reference the CLIENT THEMSELVES chose specifically for THIS piece - it is the PRIMARY visual direction.{$clausulaHeroi}{$clausulaRosto}{$clausulaContinuidade} The remaining attached images are posts by OTHER companies in the same market, given only so you can see the conventions of the category - they are secondary context, not the direction. Take NO identity from them (not colour, not logo style, not typography, not graphic devices).{$ctxRostos}"
                : "ABOUT THE ATTACHED IMAGES: the FIRST attached image is the creative reference the CLIENT THEMSELVES chose specifically for THIS piece - it is the PRIMARY visual direction; do not let it be diluted by the other attachments.{$clausulaHeroi}{$clausulaRosto}{$clausulaContinuidade} The remaining attached images are this brand's own posts and, where present, a screenshot of its website - secondary context for the brand's graphic vocabulary (its devices, its photographic treatment, its rhythm), not the main direction for this piece.{$ctxRostos}")
            : ($proxy
            ? "ABOUT THE ATTACHED IMAGES: this client has NO posts of its own yet. They are posts by OTHER companies in the same market, attached ONLY so you can see the conventions of the category. Take NO identity from them - not their colour, not their logo style, not their typography, not their graphic devices. They are a briefing about the market, never a style guide.{$ctxRostos}"
            : "ABOUT THE ATTACHED IMAGES: these are the brand's OWN posts and, where present, a screenshot of its website. They are the source of truth for this brand's graphic vocabulary - its devices, its photographic treatment, its rhythm. Match that language.{$ctxRostos}")));

        $tipo = $fonte !== ''
            ? "TYPEFACE: set the text in {$fonte}, or the closest possible match to it."
            : "TYPEFACE: choose a typeface that belongs to this brand's world, and stay with one family throughout.";

        $copy = '';
        if ($numLista !== null) {
            if ($numLista['rotulo'] !== '') $copy .= "\"{$numLista['rotulo']}\" (small label beside the list number)\n";
            $copy .= "\"{$numLista['n']}\" (the list number - a graphic numeral, see below)\n";
        }
        if ($head !== '') $copy .= "\"{$head}\"\n";
        if ($sub !== '')  $copy .= "\"{$sub}\"\n";
        if ($cta !== '')  $copy .= "\"{$cta}\"";

        // 24/09: numero de lista como ELEMENTO, nao como caractere. O mesmo tratamento em todos os
        // slides numerados e' o que faz o numero mostrar o progresso da leitura.
        $blocoNumero = $numLista === null ? '' : (
            "LIST NUMBER: this slide is item {$numLista['n']} of a numbered sequence. Render the number {$numLista['n']} as a GRAPHIC ELEMENT of its own, never as a character inside the headline: an oversized numeral, or the numeral inside a solid seal or badge, sitting next to or above the headline. It is the one graphic element allowed to be bigger than the headline - it reads as a shape, while the headline stays the loudest TEXT in the frame."
            . ($numLista['rotulo'] !== '' ? " The word \"{$numLista['rotulo']}\" goes small beside or above the numeral, as its label." : '')
            . " Use the same numeral treatment - style, size, colour and position - on every numbered slide of the set: the number is what shows the viewer how far they are in the list."
        );

        // 24/09: o apoio dos slides do meio pode vir mais longo (ate' ~120) pra ensinar alguma
        // coisa. Sem esta linha o modelo tende a esmagar texto longo em letra miuda ou a quebrar
        // em blocos soltos, e as duas coisas custam legibilidade no celular.
        $blocoApoioLongo = mb_strlen($sub) > 70
            ? "THE SUPPORT TEXT IS LONG - a short explanatory paragraph. Set it as body copy in two or three comfortable lines, in one block, clearly smaller than the headline but still readable at phone size. Never shrink it into fine print and never split it into separate floating pieces."
            : '';

        // Direcao de arte. Os dois campos ja' chegavam mapeados ate' aqui e
        // nunca eram lidos — mandar "minimal" ou "bold" dava exatamente a mesma peca. Entra logo
        // depois do paragrafo de liberdade total para qualifica-lo, em vez de ser engolido por ele.
        $estilo     = trim((string)($campaign['preferredStyle'] ?? ''));
        $estrategia = trim((string)($campaign['creativeStrategy'] ?? ''));

        // De onde veio o estilo muda o peso da frase. creativeStrategy so' existe se alguem
        // digitou no payload — e' sempre pedido. preferredStyle nao: o scrapeWebsite.php o
        // DEDUZ do site do cliente e o cadastro guarda isso, entao o enrich (helpers.php,
        // setIfEmpty) pode preencher o campo sem ninguem ter pedido nada. Mandar o modelo
        // obedecer "o que o cliente pediu" quando o dado e' um palpite de scraper e' mentira
        // justamente no caso em que ele e' mais fraco.
        // is_array antes de indexar: 'theme' vem de JSON de terceiro. Em PHP 8 indexar uma
        // string com chave de texto e' TypeError, e uma excecao aqui derruba o batch inteiro.
        $temaDaEmpresa = is_array($company['theme'] ?? null) ? $company['theme'] : [];
        $estiloDoCadastro = trim((string)(
            (is_string($temaDaEmpresa['style'] ?? null) ? $temaDaEmpresa['style'] : null)
            ?? (is_string($company['preferredStyle'] ?? null) ? $company['preferredStyle'] : '')
        ));
        $estiloPedido = $estilo !== '' && strcasecmp($estilo, $estiloDoCadastro) !== 0;

        $direcao = '';
        if ($estilo !== '' || $estrategia !== '') {
            $l = [($estrategia !== '' || $estiloPedido)
                ? 'ART DIRECTION requested by the client. It outranks your own instinct:'
                : "ART DIRECTION read from this brand's own material - nobody asked for it. Treat it as a strong hint, not an order: follow it unless the idea is clearly better without it:"];
            if ($estilo !== '') {
                $l[] = $estiloPedido
                    ? "- Visual style: {$estilo}."
                    : "- Visual style: {$estilo} (read from the brand, not requested).";
            }
            if ($estrategia !== '') { $l[] = "- Creative strategy: {$estrategia}."; }
            $direcao = implode("\n", $l);
        }

        // O que a imagem MOSTRA. Eixo independente do preferredStyle, que governa o TRATAMENTO:
        // "minimal lifestyle" e "minimal flat lay" sao pecas muito diferentes, e ate' aqui nao
        // havia controle nenhum sobre esse eixo. Entra logo depois da direcao de arte porque e'
        // o mais concreto dos dois.
        $generos = [
            'lifestyle'     => 'a real person using or benefiting from this, in a natural everyday setting',
            'product'       => 'the product or service artefact itself as the hero, studio-lit, no people',
            'flat_lay'      => 'an overhead flat-lay arrangement of objects on a surface',
            'behind_scenes' => 'a candid, unpolished behind-the-scenes moment of the team at work',
            'illustration'  => 'an illustration or graphic composition, not a photograph',
            'typographic'   => 'type as the image itself: no photography, the composition is built from the words',
            'place'         => 'the physical place or environment where this business operates',
        ];
        // Valor desconhecido cai no vazio de proposito: o array_filter(..., 'strlen') do return
        // apaga o bloco, e um genero digitado errado nao vira instrucao sem sentido no prompt.
        $g = strtolower(trim((string)($campaign['imageGenre'] ?? '')));
        $blocoGenero = isset($generos[$g])
            ? ("WHAT THE IMAGE SHOWS, chosen by the client: {$generos[$g]}.\n"
               . "This decides the subject. You still decide the styling, the crop and the light.")
            : '';

        // COMO a peca e' montada. Terceiro eixo, independente dos dois de cima: o genero diz o
        // que aparece, o estilo diz o tratamento, e este diz onde a copy mora e como o quadro se
        // divide. O campo ja' chegava mapeado (ext_map_campaign) e o worker ja' o validava contra
        // esta mesma lista de 12, mas so' o caminho Gemini o consumia — aposentado o Gemini, o
        // valor viajava ate' aqui e morria. E' o eixo que trava a continuidade de um carrossel:
        // fixar o mesmo token nos N slides da' a eles a mesma logica de composicao.
        // Lista identica a' $VALID_LAYOUTS do generate-ads-worker.php: se uma mudar, a outra tem
        // de mudar junto, senao o worker apaga um token que aqui seria valido.
        $layouts = [
            'hero-full-bleed'        => 'one image bleeding to all four edges, with the copy sitting directly on top of it',
            'top-image-bottom-text'  => 'the image occupies the upper portion, the copy sits below it on a clean field',
            'bold-headline-first'    => 'the headline is the dominant object in the frame and everything else yields to it',
            'centered-minimal'       => 'everything centred on a generous, quiet field, with a lot of empty space',
            'left-panel-right-image' => 'a vertical panel on the left carries the copy, the image fills the right',
            'diagonal-split'         => 'the frame is cut by a diagonal, copy on one side and image on the other',
            'top-left-editorial'     => 'the copy is anchored to the top-left, ranged left, like a magazine opener',
            'top-right-editorial'    => 'the copy is anchored to the top-right, like a magazine opener',
            'bottom-right-editorial' => 'the copy is anchored to the bottom-right, like a magazine caption',
            'frame-product'          => 'a border or frame surrounds the subject, and the copy lives in that margin',
            'vertical-story-stack'   => 'the copy is stacked vertically, one line above the other, reading top to bottom',
            'floating-islands'       => 'the copy sits in separate blocks that float apart over the image, not in one column',
        ];
        // Mesmo contrato do genero: token desconhecido vira '' e o array_filter do return apaga o
        // bloco, em vez de mandar ao modelo uma instrucao de layout que ninguem escreveu.
        $lay = strtolower(trim((string)($campaign['textLayout'] ?? '')));
        $blocoLayout = isset($layouts[$lay])
            ? ("HOW THE PIECE IS LAID OUT, chosen by the client: {$layouts[$lay]}.\n"
               . "This decides the skeleton — where the copy lives and how the frame divides. "
               . "Inside it you still decide the scene, the crop, the type scale and the colour.")
            : '';

        // CARROSSEL (campaign.carousel_index / carousel_total). 23/09: "melhorar a coerencia E a
        // variabilidade dos carrossel". Os dois problemas sao o mesmo problema — ate' aqui cada
        // slide era um job isolado que nao sabia ser parte de nada, e a unica amarra era o chamador
        // passar o slide anterior como reference_image_url. Ou a referencia nao pegava (slides que
        // nao combinam) ou pegava demais (N variacoes da mesma peca). Um carrossel bom e' o
        // contrario dos dois: sistema IDENTICO, composicao DIFERENTE em cada slide. So' da' pra
        // pedir isso sabendo qual slide e' de quantos — dai' os dois campos novos.
        $cIdx = (int)($campaign['carouselIndex'] ?? 0);
        $cTot = (int)($campaign['carouselTotal'] ?? 0);
        $blocoCarrossel = '';
        if ($cIdx >= 1 && $cTot >= 2 && $cIdx <= $cTot) {
            // O papel muda o que o slide PRECISA fazer, e e' o que impede N slides intercambiaveis:
            // o primeiro e' o unico que todo mundo ve, o ultimo e' o unico que pede a acao, e os do
            // meio existem pra sustentar um argumento cada.
            // 24/09 (Fullstop): o fechamento e' o convite pro WhatsApp e tem de ser o slide MAIS LIMPO
            // e visivelmente diferente dos outros - fundo chapado na cor da marca, pouca ou nenhuma
            // foto. Continua valendo o sistema (tipografia, hierarquia), o que muda e' o campo.
            $primCarr = preg_match('/^#[0-9a-f]{6}$/i', trim((string)($company['primaryColor'] ?? '')))
                ? strtolower(trim((string)$company['primaryColor'])) : '';
            // O campo segue a folha de estilo da serie (chapado ou o mesmo gradiente) - o fechamento
            // se diferencia por tirar a foto, nao por trocar o tratamento de fundo.
            $campoFecho = "the series background from the style sheet above, filling the whole frame with nothing over it";
            // Icone so' quando o texto fala de WhatsApp: fora disso o convite pode ser pra outro
            // canal, e um icone de WhatsApp ao lado de "agende no site" seria desinformacao.
            $falaWhats = (bool)preg_match('/whats|\bzap\b|\bwpp\b/iu', $head . ' ' . $sub . ' ' . $cta);
            $papel = $cIdx === 1
                ? "the HOOK. It is the only slide everyone sees, so it has to stop the thumb on its own: the strongest image and the largest, loudest headline of the whole set. Do not spend it on explanation."
                : ($cIdx === $cTot
                    ? "the CLOSE - the invitation to act, and the CLEANEST slide of the set. It must look different from the others: {$campoFecho}, little or no photography (at most a small cut-out or a soft texture - for this slide only this overrides any rule above about showing the reference's subject as a large hero), the copy large, calm and direct, nothing in the frame competing with the action being asked for. Type, hierarchy and margins stay those of the set; only the field changes."
                        . ($falaWhats ? " Right next to the call to action, a simple WhatsApp glyph (the speech bubble with a phone handset), small, in white or in a colour that contrasts with the field - an icon beside the words, not a button." : '')
                    : "ONE argument, and one only. It is a middle slide: it does not restate the hook and it does not try to close - it develops a single idea and hands the viewer to the next slide.");

            // Pedido 2: sinal de "continua" em todo slide menos o ultimo, sempre no mesmo lugar.
            $sinal = $cIdx < $cTot
                ? "- SWIPE CUE: in the bottom-right, sitting just above the thread line described below, set the small text \"{$cIdx}/{$cTot}\" followed by a thin arrow pointing right. Discreet - about 2.5% of the frame height - but legible, in the same size, position and style on every slide except the last. It must never compete with the copy."
                : "- NO SWIPE CUE on this slide: it is the last one, so no page number, no \"{$cIdx}/{$cTot}\", no arrow pointing onward.";

            // Pedido 3: continuidade entre slides. Cada slide e' uma chamada separada, entao um
            // elemento "livre" que sai por uma borda e entra pela outra nao casa - o modelo nao ve o
            // vizinho. O que casa e' uma geometria FIXA dita em numeros: a mesma linha, na mesma
            // altura, tocando as bordas certas conforme a posicao do slide. Ao deslizar, a ponta
            // da direita de um encontra a ponta da esquerda do proximo.
            // Nao usa a primaria: com a folha de estilo (abaixo) o campo da serie e' a primaria, e a
            // linha sumiria nele. Acento, senao secundaria, senao a cor do texto da serie.
            $acLinha  = preg_match('/^#[0-9a-f]{6}$/i', trim((string)($company['accentColor'] ?? ''))) ? strtolower(trim((string)$company['accentColor'])) : '';
            $secLinha = preg_match('/^#[0-9a-f]{6}$/i', trim((string)($company['secondaryColor'] ?? ''))) ? strtolower(trim((string)$company['secondaryColor'])) : '';
            $corLinha = $acLinha !== '' ? "the ACCENT colour {$acLinha}"
                : ($secLinha !== '' ? "the SECONDARY colour {$secLinha}" : "the same colour as the series' text");
            $trecho = $cIdx === 1
                ? "on this FIRST slide it starts about a third of the way in from the left and runs OFF the right edge"
                : ($cIdx === $cTot
                    ? "on this LAST slide it enters from the left edge and stops about two thirds of the way across"
                    : "on this middle slide it runs the FULL width, entering at the left edge and leaving at the right edge");
            $linha = "- THE THREAD, which ties the set together: one straight horizontal line in {$corLinha}, about 0.6% of the frame height thick, at exactly 88% of the height from the top. {$trecho}. Same height, thickness and colour on every slide, so that as the viewer swipes it reads as one line continuing from slide to slide. No text crosses it; the copy lives above it.";

            $estruturas = [
                'lista'         => 'a numbered list - after the hook, each slide is one item of it',
                'passo_a_passo' => 'a step-by-step - after the hook, each slide is one step, in order',
                'explicacao'    => 'a quick explanation - each slide moves the explanation one step forward',
                'mito'          => 'myth or truth - the slides set up a belief and then correct it',
                'case'          => 'a case study - before, challenge, what was done, after',
                'narrativa'     => 'a story told in chronological order',
                'opiniao'       => 'a strong opinion, argued slide by slide',
                'checklist'     => 'a checklist the viewer saves to consult later',
            ];
            $est = (string)($campaign['carouselStructure'] ?? '');
            $linhaEstrutura = isset($estruturas[$est]) ? "- THE SET IS {$estruturas[$est]}.\n" : '';
            // Quando ha' token de layout, ele ja' fixou o esqueleto pra serie inteira: mandar variar
            // "onde a copy mora" aqui seria mandar desobedecer o bloco de cima. Nesse caso a variacao
            // acontece DENTRO do esqueleto (corte, distancia, angulo, escala). Sem token, a
            // composicao inteira e' livre pra mudar de slide pra slide.
            $varia = $blocoLayout !== ''
                ? "the layout instruction above fixes the skeleton for the whole set, so vary INSIDE it - the crop and how close the subject is (wide, medium, close), the angle, which part of the frame carries the weight, the scale of what is shown."
                : "change the composition outright - the crop and how close the subject is (wide, medium, close), the angle, where the mass sits in the frame, and where the copy lives inside it.";
            // 24/09: "as cores entre eles nao estao alinhadas, o primeiro parecido com os posts da
            // empresa, os outros nao, uns com gradiente outros sem". O "IDENTICAL" logo abaixo mandava
            // repetir um sistema que ninguem definia - cada chamada e' cega aos outros slides, entao
            // cada uma inventava o seu (gradiente aqui, chapado ali). E com reference_image_url o
            // bloco de paleta passa a deixar a referencia mandar na cor da cena, entao so' o slide
            // sem referencia saia com a cara da marca. A folha abaixo DECIDE o sistema aqui, com
            // texto identico nos N slides: so' entra o que nao varia entre eles (cadastro de cores,
            // brief visual da marca), nada que dependa do indice ou da referencia do slide.
            $hexC = function ($v) { $v = trim((string)$v); return preg_match('/^#[0-9a-f]{6}$/i', $v) ? strtolower($v) : ''; };
            $secC = $hexC($company['secondaryColor'] ?? '');
            $acC  = $hexC($company['accentColor'] ?? '');
            $bgC  = $hexC($campaign['backgroundColorRequested'] ?? '');
            $campoC = $bgC !== '' ? $bgC : $primCarr;
            // Cor do texto decidida pela luminancia do campo, pra nao ficar a criterio de cada slide.
            $corTextoC = '';
            if ($campoC !== '') {
                $lumC = hexdec(substr($campoC, 1, 2)) * 0.21 + hexdec(substr($campoC, 3, 2)) * 0.72 + hexdec(substr($campoC, 5, 2)) * 0.07;
                $corTextoC = $lumC < 140 ? 'white or a very light tint' : 'near-black or a very dark shade of the primary';
            }
            // Brief visual da marca: o worker o calcula a partir dos proprios posts e nada no Caminho
            // C o lia. E' a mesma fonte pros N slides, entao ancora todos na cara da marca, nao so' o 1o.
            $briefC = trim(preg_replace('/\s+/u', ' ', (string)($campaign['brandVisualBrief'] ?? '')));
            if (mb_strlen($briefC) > 700) $briefC = rtrim(mb_substr($briefC, 0, 700)) . '...';
            // Gradiente ou chapado: decisao unica pra serie. So' vira gradiente se o brief da marca
            // disser que ela usa gradiente (e nao "sem gradiente"); na duvida, chapado, que e' o
            // tratamento que o modelo mais consegue repetir igual de uma chamada pra outra.
            $usaGrad = $briefC !== ''
                && preg_match('/gradient|degrad/iu', $briefC)
                && !preg_match('/\b(no|sem|without|avoid\w*|evit\w*|never|nunca)\s+(\S+\s+){0,2}(gradient|degrad)/iu', $briefC);
            $nomeCampo = $campoC !== '' ? $campoC : "the brand's main colour";
            $fundoC = $usaGrad
                ? "one linear gradient, top to bottom, from {$nomeCampo} to " . ($secC !== '' ? $secC : 'a deeper shade of that same colour') . " - the same two colours, the same direction and the same smoothness on every slide. No other gradient anywhere, no vignette, no glow."
                : "FLAT colour - the field is a solid {$nomeCampo}. NO gradients of any kind, no vignettes, no glows, no light leaks, no colour fades, on any slide.";
            $folha = ["SERIES STYLE SHEET - the same sheet is given to every slide of this carousel, word for word, so follow it literally: it is what makes the slides match. On colour and background it outranks every attached image, including another slide of the set and the client's reference - if an attachment shows other colours or another background treatment, follow this sheet, not the image."];
            $folha[] = "- Background treatment: {$fundoC}";
            $folha[] = "- Dominant field colour: {$nomeCampo}. Wherever the slide is not photograph, it is this field.";
            if ($corTextoC !== '') $folha[] = "- Headline and support text: {$corTextoC}, on every slide.";
            if ($acC !== '') $folha[] = "- Accent {$acC}: only for one highlighted word or small device per slide, never as a field.";
            if ($secC !== '' && !$usaGrad) $folha[] = "- Secondary {$secC}: only for a card or block, the same way on every slide it appears.";
            $folha[] = "- Photography: the same natural, neutral colour grade on every slide - no filters, no tints, no duotone, nothing that pulls the image away from the colours above.";
            if ($briefC !== '') $folha[] = "- The brand's own look, read from its real posts - EVERY slide follows it, not only the first: {$briefC}";
            $folhaEstilo = implode("\n", $folha);

            $blocoCarrossel =
                $folhaEstilo . "\n\n"
                . "THIS PIECE IS SLIDE {$cIdx} OF {$cTot} OF ONE CAROUSEL. The viewer swipes the whole set in a few seconds, so it has to read as one piece of work in {$cTot} parts - never as {$cTot} unrelated posts, and never as the same post {$cTot} times.\n"
                . "- IDENTICAL on every slide, no exceptions: the palette and which colour does what, the typeface and the type hierarchy (the same relationship between headline, support and call to action), the margins and the safe area, the corner left free for the logo, and the photographic treatment - the same colour grade and white balance, the same lighting direction and hardness, the same lens character, the same level of polish. If a reference attached here is another slide of this same set, match all of that to it exactly.\n"
                . "- DIFFERENT on this slide, and this weighs as much as the line above: {$varia} Two slides of one carousel with the same crop, the same subject distance and the same block of type in the same place read as a duplicate, not as a series.\n"
                . $linhaEstrutura
                . "- THIS SLIDE'S JOB: {$papel}\n"
                . $sinal . "\n"
                . $linha . "\n"
                // Pedido 6: no Instagram os pontinhos do carrossel ficam sobre a base da imagem.
                . "- PLATFORM STRIP: keep the bottom 6% of the frame free of text, logo, the swipe cue and anything essential - the platform draws its carousel dots there. The background may run through it.";
        }

        // O canto que o prompt manda deixar livre tem de ser o MESMO que o extc_poe_logo() vai
        // carimbar, senao o modelo limpa um canto e a logo cai noutro. Sem pedido no payload,
        // BOTTOM-RIGHT dos dois lados: aqui e' o canto reservado, e la' e' o candidato que abre a
        // lista e leva bonus de pontuacao — um so' acordo, escrito em dois lugares.
        $mapaCanto = [
            'top-left'     => 'TOP-LEFT',    'top-right'    => 'TOP-RIGHT',
            'top-center'   => 'TOP-CENTRE',  'bottom-left'  => 'BOTTOM-LEFT',
            'bottom-right' => 'BOTTOM-RIGHT',
        ];
        $canto = $mapaCanto[trim((string)($campaign['logoPosition'] ?? ''))]
                 ?? 'BOTTOM-RIGHT';

        // De que TOM o canto reservado precisa ser pra logo se ler em cima dele. O worker mede a
        // tinta da logo (extc_logo_luminancia) e deixa em logoLuminancia; sem medida, nao se
        // inventa exigencia de tom — o carimbo ainda escolhe o melhor canto disponivel depois.
        // Faixa morta no meio (95..160): logo de tom medio se vira nos dois extremos, e mandar
        // "escureca" uma peca clara por causa dela estragaria mais do que resolve.
        $lumLogoPrompt = $campaign['logoLuminancia'] ?? null;
        $tomCanto = '';
        if (is_numeric($lumLogoPrompt)) {
            $lumLogoPrompt = (float)$lumLogoPrompt;
            if ($lumLogoPrompt > 160) {
                $tomCanto = " The logo that lands there is a LIGHT one, so that corner has to be clearly DARK - a deep, saturated or shadowed field, never white, pale or washed out, or the logo disappears into it.";
            } elseif ($lumLogoPrompt < 95) {
                $tomCanto = " The logo that lands there is a DARK one, so that corner has to be clearly LIGHT - a bright, clean field, never black, deep or heavily shadowed, or the logo disappears into it.";
            }
        }

        // O prompt dizia "square" pra qualquer formato - o 4:5 do carrossel (1080x1350) incluso.
        $fw = max(1, (int)($fmt['width'] ?? 1080)); $fh = max(1, (int)($fmt['height'] ?? 1080));
        $forma = $fw / $fh >= 1.05 ? 'landscape' : ($fw / $fh <= 0.95 ? 'portrait' : 'square');
        // Sinal de "deslize" e icone do WhatsApp sao desenhados pelo modelo, e a trava de baixo
        // proibe exatamente isso (palavras inventadas, logo falsa) - sem a excecao as duas regras
        // brigam e o modelo escolhe uma ao acaso.
        $excecaoCarr = $blocoCarrossel !== ''
            ? ' The only exceptions are the ones this brief itself asks for above: the swipe cue and, where requested, the WhatsApp glyph.'
            : '';

        $partes = [
            "You are a senior art director at a top creative agency. Create a finished {$forma} advertisement"
                . ($prod !== '' ? " for {$prod}" : '') . ($pub !== '' ? ", sold to {$pub}" : '') . ".",
            $sobreNegocio,
            $refs,
            extc_openai_paleta($company, $campaign),
            "Make the best advertisement you can for this theme. You have complete freedom over the scene, composition, cropping, lighting, staging, typography, scale, and how and where the copy lives in the image. Integrate the type with the scene however serves the idea - in front of it, behind it, cut out of it, on a surface. Surprise me." . ($blocoCarrossel !== '' ? " This piece is part of a carousel, so that freedom covers the scene and the composition only: colour and background treatment are fixed by the SERIES STYLE SHEET below." : '') . ($heroRef && empty($campaign['ignoreReferences']) ? " The one thing that is NOT free: the subject of the client's reference image must appear as the hero, as described above." : ''),
            $direcao,
            $blocoGenero,
            $blocoLayout,
            $blocoCarrossel,
            $blocoNumero,
            extc_bloco_rede($fmt),
            "FIRST RULE, absolute: these texts must appear EXACTLY as written, character for character, in {$lang}, every accent intact. Not paraphrased, not translated, nothing added or dropped:\n" . $copy,
            "SECOND RULE, and it outranks every creative instinct: LEGIBILITY.\n"
                . "- Every text must read INSTANTLY at thumbnail size, scrolling past on a phone. That is how this ad will be seen.\n"
                . "- Contrast between the type and whatever sits behind it must be unmistakable. Judge it by the colour actually behind each word: over a light field use dark type, over a dark field use light type.\n"
                . "- No letter swallowed by a busy area, a highlight, a face, or a colour close to its own.\n"
                . "- The headline is the loudest thing in the frame.",
            $blocoApoioLongo,
            $tipo,
            // 23/09: "a logo ainda sai em lugar nao visivel". Metade do problema e' o carimbo
            // (extc_poe_logo, reescrito no mesmo dia), a outra metade e' esta linha: pedir o canto
            // "livre" nao dizia tamanho nem que tipo de fundo serve, entao vinha canto com gradiente
            // forte, aresta de objeto ou um pedaco de foto clara embaixo de uma logo clara. Agora a
            // reserva tem medida e tem exigencia de fundo — e' area de servico da peca, nao sobra.
            "Invent no other words: no watermark, no signature, no fake logo, no brand name, no text on props.{$excecaoCarr}\n"
                . "RESERVED AREA FOR THE LOGO: the real logo is composited over the {$canto} corner after you deliver, so that corner is not yours. Keep a band of roughly a quarter of the width and a fifth of the height in that corner as plain, even, uninterrupted surface - one flat or very softly graded colour. Nothing essential there: no text, no face, no product edge, no hard boundary between light and dark, no busy texture or detail.{$tomCanto} The rest of the frame stays entirely yours.",
        ];
        return implode("\n\n", array_filter($partes, 'strlen'));
    }

    /**
     * Converte o formato pedido num tamanho que a API aceita: lados multiplos de 16,
     * proporcao ate 3:1, e total de pixels entre 655.360 e 8.294.400. Preserva a proporcao
     * original o mais perto possivel — 1080x1080 vira 1024x1024, e 1080x1920 vira 1152x2048,
     * que e 9:16 exato.
     */
    function extc_tamanho_openai(int $w, int $h): string {
        $w = max(1, $w);
        $h = max(1, $h);
        $prop = $w / $h;
        if ($prop > 3) $prop = 3.0;
        if ($prop < 1 / 3) $prop = 1 / 3;
        $alvo = 1400000; // area confortavel dentro da faixa permitida
        $nw = sqrt($alvo * $prop);
        $nh = $nw / $prop;
        $arred = function (float $v): int { return max(512, (int)(round($v / 16) * 16)); };
        $nw = $arred($nw);
        $nh = $arred($nh);
        $px = $nw * $nh;
        if ($px < 655360 || $px > 8294400) return '1024x1024';
        return $nw . 'x' . $nh;
    }
    /**
     * Gera a peca. Devolve os bytes da imagem, ou null em qualquer problema — nunca lanca,
     * para que a falha reprove o batch em vez de derrubar o job inteiro.
     *
     * $motivo sai preenchido com a CAUSA sempre que o retorno e' null. Sem ele a unica pista
     * de por que uma peca nao saiu pela OpenAI ficava no error_log do servidor, que quem chama
     * a API externa nao le — foi exatamente esse buraco que deixou um desvio de motor passar
     * despercebido ate' alguem reparar na arte.
     */
    function extc_openai_gerar(string $apiKey, array $refUrls, string $prompt, string $qualidade = 'medium', string $tamanho = '1024x1024', ?string &$motivo = null, ?array &$refsInfo = null): ?string {
        $motivo = null;
        $refsInfo = [];
        if ($apiKey === '')             { $motivo = 'sem-chave-openai'; return null; }
        if (!function_exists('curl_init')) { $motivo = 'sem-curl';      return null; }

        $nl = "\r\n";
        $bound = '----chiliforge' . bin2hex(random_bytes(8));
        $campo = function (string $nome, string $valor) use ($bound, $nl): string {
            return '--' . $bound . $nl . 'Content-Disposition: form-data; name="' . $nome . '"' . $nl . $nl . $valor . $nl;
        };

        $corpo  = $campo('model', 'gpt-image-2');
        $corpo .= $campo('prompt', $prompt);
        $corpo .= $campo('size', $tamanho);
        $corpo .= $campo('quality', $qualidade);
        $corpo .= $campo('n', '1');

        $anexadas = 0;
        foreach (array_slice(array_values($refUrls), 0, 6) as $pos => $u) {
            $bytes = extgd_fetch_bytes((string)$u);
            // So' as 6 primeiras seguem pro modelo, e uma que nao baixa e' pulada em silencio -
            // sem este registro "refs: 10, ref_prioritaria: true" nao distingue "a referencia foi
            // anexada" de "a referencia falhou e o primeiro anexo virou outra imagem".
            $refsInfo[] = [
                'pos'     => $pos,
                'arquivo' => basename((string)parse_url((string)$u, PHP_URL_PATH)),
                'bytes'   => strlen($bytes),
                'anexada' => $bytes !== '',
                'ordem'   => $bytes !== '' ? $anexadas : null,
            ];
            if ($bytes === '') continue;
            $png = (stripos((string)$u, '.png') !== false);
            $corpo .= '--' . $bound . $nl
                . 'Content-Disposition: form-data; name="image[]"; filename="ref' . $anexadas . ($png ? '.png' : '.jpg') . '"' . $nl
                . 'Content-Type: ' . ($png ? 'image/png' : 'image/jpeg') . $nl . $nl
                . $bytes . $nl;
            $anexadas++;
        }
        // Sem NENHUMA referencia pedida (ignore_references) a peca nasce do zero — e o
        // /images/edits exige pelo menos um image[], entao esse caso tem de ir para
        // /images/generations, que so' aceita JSON. Sem esta troca o "cria do zero" abortava
        // aqui e o batch caia de volta no Gemini, que anexa as referencias de novo: o pedido
        // do cliente virava exatamente o oposto do que ele pediu.
        // Se referencias FORAM pedidas e nenhuma baixou, o aborto de sempre continua valendo —
        // ali e' falha de download, nao escolha de quem chamou.
        $doZero = empty($refUrls);
        if ($anexadas === 0 && !$doZero) { $motivo = 'nenhuma-referencia-baixou'; error_log('[caminho-c] nenhuma referencia baixou; abortando'); return null; }
        $corpo .= '--' . $bound . '--' . $nl;

        $url   = 'https://api.openai.com/v1/images/edits';
        $ctype = 'multipart/form-data; boundary=' . $bound;
        if ($doZero) {
            $url   = 'https://api.openai.com/v1/images/generations';
            $ctype = 'application/json';
            $corpo = json_encode([
                'model'   => 'gpt-image-2',
                'prompt'  => $prompt,
                'size'    => $tamanho,
                'quality' => $qualidade,
                'n'       => 1,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $corpo,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 240,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: ' . $ctype,
            ],
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false || $code < 200 || $code >= 300) {
            $motivo = 'openai-http-' . ($code > 0 ? $code : 'sem-resposta');
            error_log('[caminho-c] OpenAI HTTP ' . $code . ': ' . substr((string)$resp, 0, 300));
            return null;
        }
        $j = json_decode((string)$resp, true);
        $b64 = is_array($j) ? ($j['data'][0]['b64_json'] ?? '') : '';
        if (!is_string($b64) || $b64 === '') { $motivo = 'resposta-sem-imagem'; error_log('[caminho-c] resposta sem imagem'); return null; }

        // Custo real, lido do proprio campo de uso da chamada.
        $u = is_array($j) ? ($j['usage'] ?? []) : [];
        $inTxt = (int)($u['input_tokens_details']['text_tokens'] ?? 0);
        $inImg = (int)($u['input_tokens_details']['image_tokens'] ?? 0);
        $out   = (int)($u['output_tokens'] ?? 0);
        $usd   = ($inTxt / 1000000) * 5 + ($inImg / 1000000) * 8 + ($out / 1000000) * 30;
        error_log(sprintf('[caminho-c] ok refs=%d in_txt=%d in_img=%d out=%d ~USD %.4f', $anexadas, $inTxt, $inImg, $out, $usd));

        $bytes = base64_decode($b64, true);
        if ($bytes === false || $bytes === '') { $motivo = 'base64-invalido'; return null; }
        return $bytes;
    }

    /**
     * Luminancia media da TINTA da logo (0..255), ignorando pixel quase-transparente. null quando
     * nao ha' logo, o download falha ou a imagem nao decodifica.
     *
     * 23/09: existe porque o modelo de imagem nunca ve' a logo — ela e' composta depois, em PHP.
     * Entao ele reservava o canto "livre" as cegas e, em metade dos casos, entregava um canto claro
     * pra uma logo clara (ou escuro pra escura): a logo sumia sem nenhum dos dois lados estar
     * errado. Medindo aqui da' pra dizer ao modelo, em palavras, de que tom o canto reservado
     * precisa ser. Mesma conta que o extc_poe_logo() usa pra pontuar os cantos, pra que a instrucao
     * do prompt e a escolha do carimbo falem da mesma coisa.
     */
    function extc_logo_luminancia(string $logoUrl): ?float {
        if (trim($logoUrl) === '' || !function_exists('imagecreatetruecolor')) return null;
        try {
            $lb = extgd_fetch_bytes($logoUrl);
            if ($lb === '') return null;
            $logo = extgd_image_from_bytes($lb);
            if ($logo === false) return null;
            $lw = imagesx($logo); $lh = imagesy($logo);
            $soma = 0.0; $n = 0;
            for ($yy = 0; $yy < $lh; $yy += 2) {
                for ($xx = 0; $xx < $lw; $xx += 2) {
                    $c = imagecolorat($logo, $xx, $yy);
                    if ((($c >> 24) & 0x7F) > 40) continue;
                    $soma += (($c >> 16 & 255) * 0.21 + ($c >> 8 & 255) * 0.72 + ($c & 255) * 0.07);
                    $n++;
                }
            }
            imagedestroy($logo);
            return $n ? $soma / $n : null;
        } catch (Throwable $e) {
            return null;
        }
    }

    /**
     * Poe a logo REAL no canto onde ela mais se LE da imagem pronta — calmo e' condicao, nao
     * criterio: o que decide e' o contraste contra a tinta da propria logo. Sempre ancorada na
     * margem de um dos cantos, nunca solta no meio do quadro. Mede uma caixa MAIOR que a logo de
     * proposito: sem essa folga, um canto liso vizinho de um bloco de texto e' escolhido como
     * "calmo" e a logo encosta na primeira letra — aconteceu no teste.
     */
    // $cantoEscolhido sai por referencia com o canto que o carimbo REALMENTE usou ('bottom-right',
    // 'top-left', ...) ou null se a logo nao foi composta. Existe porque a reclamacao recorrente e'
    // "a logo saiu num lugar estranho" e ate' aqui nao havia como saber, olhando a peca pronta, se
    // ela caiu ali por pontuacao ou por um logo_position que veio no payload sem querer.
    function extc_poe_logo(string $imgBytes, string $logoUrl, int $q = 92, string $canto = '', ?string &$cantoEscolhido = null): string {
        if ($logoUrl === '' || !function_exists('imagecreatetruecolor')) return $imgBytes;
        try {
            $base = extgd_image_from_bytes($imgBytes);
            if ($base === false) return $imgBytes;
            $lb = extgd_fetch_bytes($logoUrl);
            if ($lb === '') { imagedestroy($base); return $imgBytes; }
            $logo = extgd_image_from_bytes($lb);
            if ($logo === false) { imagedestroy($base); return $imgBytes; }
            imagealphablending($logo, true);
            imagesavealpha($logo, true);

            $W = imagesx($base); $H = imagesy($base);
            $lw = imagesx($logo); $lh = imagesy($logo);
            if ($lw < 4 || $lh < 4) { imagedestroy($base); imagedestroy($logo); return $imgBytes; }

            $esc = ($W * 0.19) / $lw;
            $nw = max(1, (int)round($lw * $esc));
            $nh = max(1, (int)round($lh * $esc));
            $m = (int)round($W * 0.05);
            // Padding so' pra AMOSTRAR o fundo em volta do carimbo. Era 6% da largura porque o
            // mesmo valor servia de passo do deslize; sem deslize, 2% e' o bastante pra pegar a
            // vizinhanca imediata sem diluir a leitura do canto com meia peca.
            $folga = (int)round($W * 0.02);

            // 17/09: "tira todo tipo de overlay, quero APENAS A LOGO no melhor lugar possivel" —
            // sem placa nem filete de cor por baixo. A UNICA defesa contra a logo sumir num fundo
            // ruim passou a ser o POSICIONAMENTO, e a tentativa daquele dia foi deslizar cada canto
            // pra DENTRO da imagem, em ate' 3 passos de 6% da largura, ficando com o ponto menos
            // colidido entre todos.
            //
            // 23/09: era esse deslize que punha a logo "no meio da tela". 3 passos = 18% da largura
            // em CADA eixo: numa peca de 1024, a logo (195px) largava o canto e parava perto de
            // (250,250) — nao e' canto, nao e' centro, e' boiando sobre a arte. Logo de anuncio mora
            // ANCORADA na margem; um carimbo solto no meio do quadro le como erro de montagem, nao
            // como design. Os candidatos voltam a ser SO' os cantos, e o que decide entre eles deixa
            // de ser "onde colide menos" e passa a ser CONTRASTE de verdade contra a cor da propria
            // logo (pontuacao abaixo) — que e' o que faz a logo aparecer.
            $pedidos = [
                'top-left'     => [$m, $m],
                'top-right'    => [$W - $m - $nw, $m],
                'top-center'   => [(int)round(($W - $nw) / 2), $m],
                'bottom-left'  => [$m, $H - $m - $nh],
                'bottom-right' => [$W - $m - $nw, $H - $m - $nh],
            ];
            $pedido = strtolower(trim($canto));
            $cantoForcado = isset($pedidos[$pedido]);
            // Sem pedido no payload, o prompt mandou o modelo deixar livre o BOTTOM-RIGHT
            // (extc_openai_prompt(), $canto) — e' o unico canto que a arte foi desenhada contando
            // com a logo. Ate' aqui a lista comecava no top-right e a pontuacao nao sabia disso, ou
            // seja: o modelo reservava um canto e o carimbo caia noutro, em cima de conteudo. Agora
            // o canto reservado abre a lista E leva bonus na pontuacao; os outros tres so' ganham
            // se o modelo tiver ignorado a reserva e enchido o canto que ele mesmo devia poupar.
            $reservado = $cantoForcado ? $pedido : 'bottom-right';
            $chaves = $cantoForcado ? [$pedido] : ['bottom-right', 'top-right', 'top-left', 'bottom-left'];

            // Cor media da propria logo (só pixels que não são quase-transparentes) — usada so'
            // pra PONTUAR o canto (distancia de cor e contraste de luminancia, abaixo), nunca pra
            // desenhar nada: a logo entra como veio, sem placa, filete ou qualquer overlay.
            $somaRLogo = 0.0; $somaGLogo = 0.0; $somaBLogo = 0.0; $nLumLogo = 0;
            for ($yy = 0; $yy < $lh; $yy += 2) {
                for ($xx = 0; $xx < $lw; $xx += 2) {
                    $c = imagecolorat($logo, $xx, $yy);
                    if ((($c >> 24) & 0x7F) > 40) continue; // pixel quase-transparente, ignora
                    $r = ($c >> 16) & 255; $g2 = ($c >> 8) & 255; $b = $c & 255;
                    $somaRLogo += $r; $somaGLogo += $g2; $somaBLogo += $b;
                    $nLumLogo++;
                }
            }
            $logoR = $nLumLogo ? $somaRLogo / $nLumLogo : 128.0;
            $logoG = $nLumLogo ? $somaGLogo / $nLumLogo : 128.0;
            $logoB = $nLumLogo ? $somaBLogo / $nLumLogo : 128.0;
            // Luminancia media da tinta da logo. E' o que faltava pra medir VISIBILIDADE: a
            // distancia de cor sozinha aprova casos que somem na peca — uma logo branca sobre um
            // cinza claro liso da' distancia ~95 (passa no teste de 70) e na pratica nao se le.
            $lumLogo = $logoR * 0.21 + $logoG * 0.72 + $logoB * 0.07;

            $melhor = $pedidos[$chaves[0]];
            $melhorNome = $chaves[0];
            $mv = INF;
            foreach ($chaves as $k) {
                [$x, $y] = $pedidos[$k];
                $s2 = 0.0; $n = 0; $parecidos = 0; $somaLumFundo = 0.0;
                for ($yy = max(0, $y - $folga); $yy < min($H, $y + $nh + $folga) - 1; $yy += 3) {
                    for ($xx = max(0, $x - $folga); $xx < min($W, $x + $nw + $folga) - 1; $xx += 3) {
                        $c1 = imagecolorat($base, $xx, $yy);
                        $c2 = imagecolorat($base, $xx + 1, $yy + 1);
                        $l1 = (($c1 >> 16 & 255) * 0.21 + ($c1 >> 8 & 255) * 0.72 + ($c1 & 255) * 0.07);
                        $l2 = (($c2 >> 16 & 255) * 0.21 + ($c2 >> 8 & 255) * 0.72 + ($c2 & 255) * 0.07);
                        $g = abs($l1 - $l2);
                        $s2 += $g * $g; $n++;
                        $somaLumFundo += $l1;

                        // Distancia de COR (nao so' luminancia) entre este pixel de fundo e a
                        // cor da logo — pega o caso em que so' um TRECHO do canto tem a cor que
                        // engole a logo (ex.: uma faixa diagonal cruzando so' metade do carimbo),
                        // que uma media do canto inteiro dilui e deixa passar.
                        $r1 = ($c1 >> 16) & 255; $gg1 = ($c1 >> 8) & 255; $b1 = $c1 & 255;
                        $dist = sqrt((($r1 - $logoR) ** 2) + (($gg1 - $logoG) ** 2) + (($b1 - $logoB) ** 2));
                        if ($dist < 70) $parecidos++;
                    }
                }
                // Pontuacao (menor = melhor), tres termos + um bonus:
                //  1. agitacao: RMS da diferenca de luminancia entre vizinhos. Fundo picotado
                //     engole a logo mesmo com cor boa.
                //  2. fracao de pixels perto da COR da logo: pega a faixa que cruza so' metade do
                //     carimbo, que uma media do canto inteiro dilui.
                //  3. CONTRASTE de luminancia entre o fundo do canto e a tinta da logo — o termo
                //     novo, e o unico que responde direto por "a logo sai em lugar nao visivel".
                //     Abaixo de 90 (de 255) penaliza progressivamente; acima disso ja' se le e nao
                //     ha' premio por passar de bom pra otimo, senao um canto muito contrastado mas
                //     picotado ganharia de um canto limpo e legivel.
                //  + bonus do canto reservado: a arte foi desenhada pra ele. So' perde se o modelo
                //     tiver ignorado a reserva — 10 pontos e' mais ou menos "um canto visivelmente
                //     mais sujo que o outro", nao um passe livre.
                $fracaoParecida = $n ? $parecidos / $n : 0.0;
                $lumFundo = $n ? $somaLumFundo / $n : 128.0;
                $contraste = abs($lumFundo - $lumLogo);
                $v = ($n ? sqrt($s2 / $n) : INF)
                     + $fracaoParecida * 40
                     + max(0.0, 90.0 - $contraste) * 0.9
                     + ($k === $reservado ? -10.0 : 0.0);
                if ($v < $mv) { $mv = $v; $melhor = [$x, $y]; $melhorNome = $k; }
            }
            $cantoEscolhido = $melhorNome;

            imagealphablending($base, true);
            imagecopyresampled($base, $logo, $melhor[0], $melhor[1], 0, 0, $nw, $nh, $lw, $lh);
            ob_start();
            imagejpeg($base, null, $q);
            $saida = (string)ob_get_clean();
            imagedestroy($base);
            imagedestroy($logo);
            return $saida !== '' ? $saida : $imgBytes;
        } catch (Throwable $e) {
            error_log('[caminho-c] logo nao composta: ' . $e->getMessage());
            return $imgBytes;
        }
    }
}
