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
        imagefilledrectangle($img, $x1 + $r, $y1, $x2 - $r, $y2, $color);
        imagefilledrectangle($img, $x1, $y1 + $r, $x2, $y2 - $r, $color);
        imagefilledellipse($img, $x1 + $r, $y1 + $r, $r * 2, $r * 2, $color);
        imagefilledellipse($img, $x2 - $r, $y1 + $r, $r * 2, $r * 2, $color);
        imagefilledellipse($img, $x1 + $r, $y2 - $r, $r * 2, $r * 2, $color);
        imagefilledellipse($img, $x2 - $r, $y2 - $r, $r * 2, $r * 2, $color);
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
        // primary/accent/secondary — pedir um fundo nao mudava um pixel. O da CAMPANHA vence o
        // do cadastro: e' a escolha daquela peca contra o padrao da marca.
        $bg = $hex($campaign['backgroundColor'] ?? '') ?: $hex($company['backgroundColor'] ?? '');
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
                return "BRAND COLOURS: the background below is registered by the client and is not negotiable. Read the REST of the palette from the attached brand references and stay strictly inside what is visibly theirs.\n" . $linhaFundo;
            }
            return "BRAND COLOURS: this client has no colour registered. Read the palette from the attached brand references and stay strictly inside it — do not invent a colour that is not visibly theirs.";
        }
        $l = ["BRAND COLOURS - these come from the client's registered brand fields, not from your reading of the references, and they are not negotiable:"];
        $l[] = "- PRIMARY {$p}. This is the dominant colour of the piece: the large fields, the panels, the mood.";
        if ($a !== '') $l[] = "- ACCENT {$a}. Use it sparingly - a highlighted word, a small device, the button.";
        if ($s !== '') $l[] = "- SECONDARY {$s}. Use it for a contrasting block, a card, or the button when the piece needs weight.";
        if ($linhaFundo !== '') $l[] = $linhaFundo;
        $l[] = "These are the entire palette. Introduce NO other brand colour. If a reference image pulls you elsewhere, ignore it - those are variations in a feed, not the brand.";
        return implode("\n", $l);
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
        $sub  = trim((string)($campaign['subheadline'] ?? ''));
        $cta  = trim((string)($campaign['ctaText'] ?? ''));
        $prod = trim((string)($campaign['productName'] ?? ($campaign['valueProposition'] ?? '')));
        $pub  = trim((string)($campaign['targetAudience'] ?? ''));
        $lang = trim((string)($campaign['language'] ?? 'pt-BR'));
        $proxy = !empty($company['brandPostsAreProxy']);
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
        $refs = !empty($campaign['ignoreReferences'])
            ? "NO REFERENCE IMAGES are attached for this piece, on purpose. Build it from the brand fields alone - the colours, the typeface and the direction above. Do not imitate any particular look you might assume this brand has."
            : ($proxy
            ? "ABOUT THE ATTACHED IMAGES: this client has NO posts of its own yet. They are posts by OTHER companies in the same market, attached ONLY so you can see the conventions of the category. Take NO identity from them - not their colour, not their logo style, not their typography, not their graphic devices. They are a briefing about the market, never a style guide."
            : "ABOUT THE ATTACHED IMAGES: these are the brand's OWN posts and, where present, a screenshot of its website. They are the source of truth for this brand's graphic vocabulary - its devices, its photographic treatment, its rhythm. Match that language.");

        $tipo = $fonte !== ''
            ? "TYPEFACE: set the text in {$fonte}, or the closest possible match to it."
            : "TYPEFACE: choose a typeface that belongs to this brand's world, and stay with one family throughout.";

        $copy = '';
        if ($head !== '') $copy .= "\"{$head}\"\n";
        if ($sub !== '')  $copy .= "\"{$sub}\"\n";
        if ($cta !== '')  $copy .= "\"{$cta}\"";

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

        // O canto que o prompt manda deixar livre tem de ser o MESMO que o extc_poe_logo() vai
        // carimbar, senao o modelo limpa um canto e a logo cai noutro. Sem pedido no payload,
        // BOTTOM-RIGHT: o carimbo escolhe o canto mais calmo, e o canto reservado e' o candidato
        // mais calmo por construcao.
        $mapaCanto = [
            'top-left'     => 'TOP-LEFT',    'top-right'    => 'TOP-RIGHT',
            'top-center'   => 'TOP-CENTRE',  'bottom-left'  => 'BOTTOM-LEFT',
            'bottom-right' => 'BOTTOM-RIGHT',
        ];
        $canto = $mapaCanto[trim((string)($campaign['logoPosition'] ?? ''))]
                 ?? 'BOTTOM-RIGHT';

        $partes = [
            "You are a senior art director at a top creative agency. Create a finished square advertisement"
                . ($prod !== '' ? " for {$prod}" : '') . ($pub !== '' ? ", sold to {$pub}" : '') . ".",
            $refs,
            extc_openai_paleta($company, $campaign),
            "Make the best advertisement you can for this theme. You have complete freedom over the scene, composition, cropping, lighting, staging, typography, scale, and how and where the copy lives in the image. Integrate the type with the scene however serves the idea - in front of it, behind it, cut out of it, on a surface. Surprise me.",
            $direcao,
            $blocoGenero,
            extc_bloco_rede($fmt),
            "FIRST RULE, absolute: these texts must appear EXACTLY as written, character for character, in {$lang}, every accent intact. Not paraphrased, not translated, nothing added or dropped:\n" . $copy,
            "SECOND RULE, and it outranks every creative instinct: LEGIBILITY.\n"
                . "- Every text must read INSTANTLY at thumbnail size, scrolling past on a phone. That is how this ad will be seen.\n"
                . "- Contrast between the type and whatever sits behind it must be unmistakable. Judge it by the colour actually behind each word: over a light field use dark type, over a dark field use light type.\n"
                . "- No letter swallowed by a busy area, a highlight, a face, or a colour close to its own.\n"
                . "- The headline is the loudest thing in the frame.",
            $tipo,
            "Invent no other words: no watermark, no signature, no fake logo, no brand name, no text on props.\nLeave the {$canto} corner free of anything that would be ruined by a logo placed over it afterwards.",
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
     * porque a falha aqui tem que cair de volta no caminho do Gemini sem derrubar o job.
     */
    function extc_openai_gerar(string $apiKey, array $refUrls, string $prompt, string $qualidade = 'medium', string $tamanho = '1024x1024'): ?string {
        if ($apiKey === '' || !function_exists('curl_init')) return null;

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
        foreach (array_slice(array_values($refUrls), 0, 6) as $u) {
            $bytes = extgd_fetch_bytes((string)$u);
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
        if ($anexadas === 0 && !$doZero) { error_log('[caminho-c] nenhuma referencia baixou; abortando'); return null; }
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
            error_log('[caminho-c] OpenAI HTTP ' . $code . ': ' . substr((string)$resp, 0, 300));
            return null;
        }
        $j = json_decode((string)$resp, true);
        $b64 = is_array($j) ? ($j['data'][0]['b64_json'] ?? '') : '';
        if (!is_string($b64) || $b64 === '') { error_log('[caminho-c] resposta sem imagem'); return null; }

        // Custo real, lido do proprio campo de uso da chamada.
        $u = is_array($j) ? ($j['usage'] ?? []) : [];
        $inTxt = (int)($u['input_tokens_details']['text_tokens'] ?? 0);
        $inImg = (int)($u['input_tokens_details']['image_tokens'] ?? 0);
        $out   = (int)($u['output_tokens'] ?? 0);
        $usd   = ($inTxt / 1000000) * 5 + ($inImg / 1000000) * 8 + ($out / 1000000) * 30;
        error_log(sprintf('[caminho-c] ok refs=%d in_txt=%d in_img=%d out=%d ~USD %.4f', $anexadas, $inTxt, $inImg, $out, $usd));

        $bytes = base64_decode($b64, true);
        return ($bytes === false || $bytes === '') ? null : $bytes;
    }

    /**
     * Poe a logo REAL no canto mais calmo da imagem pronta. Mede uma caixa MAIOR que a logo
     * de proposito: sem essa folga, um canto liso vizinho de um bloco de texto e' escolhido
     * como "calmo" e a logo encosta na primeira letra — aconteceu no teste.
     */
    function extc_poe_logo(string $imgBytes, string $logoUrl, int $q = 92, string $canto = ''): string {
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
            $folga = (int)round($W * 0.06);

            $cantos = [
                [$W - $m - $nw, $m], [$m, $m],
                [$W - $m - $nw, $H - $m - $nh], [$m, $H - $m - $nh],
            ];

            // Canto pedido no payload: e' o mesmo que o prompt mandou reservar, entao a logo cai
            // onde o modelo deixou espaco de proposito. Vira o UNICO candidato — a pontuacao por
            // agitacao continua rodando igual, so' que sem concorrente. Payload sem logoPosition
            // nao passa por aqui e a escolha automatica entre os quatro cantos fica intacta.
            $pedidos = [
                'top-left'     => [$m, $m],
                'top-right'    => [$W - $m - $nw, $m],
                'top-center'   => [(int)round(($W - $nw) / 2), $m],
                'bottom-left'  => [$m, $H - $m - $nh],
                'bottom-right' => [$W - $m - $nw, $H - $m - $nh],
            ];
            $pedido = strtolower(trim($canto));
            if (isset($pedidos[$pedido])) $cantos = [$pedidos[$pedido]];

            $melhor = $cantos[0];
            $mv = INF;
            foreach ($cantos as $c) {
                $x = $c[0]; $y = $c[1];
                $s2 = 0.0; $n = 0;
                for ($yy = max(0, $y - $folga); $yy < min($H, $y + $nh + $folga) - 1; $yy += 3) {
                    for ($xx = max(0, $x - $folga); $xx < min($W, $x + $nw + $folga) - 1; $xx += 3) {
                        $c1 = imagecolorat($base, $xx, $yy);
                        $c2 = imagecolorat($base, $xx + 1, $yy + 1);
                        $l1 = (($c1 >> 16 & 255) * 0.21 + ($c1 >> 8 & 255) * 0.72 + ($c1 & 255) * 0.07);
                        $l2 = (($c2 >> 16 & 255) * 0.21 + ($c2 >> 8 & 255) * 0.72 + ($c2 & 255) * 0.07);
                        $g = abs($l1 - $l2);
                        $s2 += $g * $g; $n++;
                    }
                }
                $v = $n ? sqrt($s2 / $n) : INF;
                if ($v < $mv) { $mv = $v; $melhor = [$x, $y]; }
            }

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
