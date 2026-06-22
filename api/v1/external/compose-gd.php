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

if (!function_exists('extgd_font')) {
    // Pick the bundled font closest to the requested CSS font-weight, then fall back to
    // system sans. 900/800 → ExtraBold, 600-700 → Bold, else Regular.
    function extgd_font(int $weight = 400): string {
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
            $ctx = stream_context_create(['http' => ['timeout' => 25, 'follow_location' => 1], 'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
            $b = @file_get_contents($src, false, $ctx);
            return $b === false ? '' : $b;
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
    /** calc(min(Acqh, Bcqw) * N) → px relative to the banner box; or Npx. */
    function extgd_font_px(?string $fs, int $W, int $H): float {
        $fs = (string)$fs;
        if (preg_match('/min\(\s*([\d.]+)cqh\s*,\s*([\d.]+)cqw\s*\)\s*\*\s*([\d.]+)/i', $fs, $m)) {
            return min((float)$m[1] / 100 * $H, (float)$m[2] / 100 * $W) * (float)$m[3] * EXTGD_TEXT_SCALE;
        }
        if (preg_match('/([\d.]+)px/', $fs, $m)) return (float)$m[1] * EXTGD_TEXT_SCALE;
        return max(14, $H * 0.05) * EXTGD_TEXT_SCALE;
    }
}

if (!function_exists('extgd_wrap_lines')) {
    function extgd_wrap_lines(string $text, string $font, float $size, float $maxW): array {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        if ($text === '') return [];
        $lines = []; $cur = '';
        foreach (explode(' ', $text) as $w) {
            $try = $cur === '' ? $w : $cur . ' ' . $w;
            $bb = imagettfbbox($size, 0, $font, $try);
            if (abs($bb[2] - $bb[0]) <= $maxW || $cur === '') { $cur = $try; }
            else { $lines[] = $cur; $cur = $w; }
        }
        if ($cur !== '') $lines[] = $cur;
        return $lines;
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
            // ── Scrim (z-index:1, gradient, empty) ──
            if ($tag === 'div' && (($st['z-index'] ?? '') === '1') && $node->textContent === '') {
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
                $text = trim(preg_replace('/\s+/', ' ', $node->textContent));
                if ($text === '') continue;
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
                $cy = $y0;
                foreach ($lines as $line) {
                    $bb = imagettfbbox($fpx, 0, $font, $line);
                    $lw2 = abs($bb[2] - $bb[0]); $asc = abs($bb[7]);
                    if ($el['align'] === 'center')    $lx = $bx + ($bw2 - $lw2) / 2;
                    elseif ($el['align'] === 'right') $lx = $bx + ($bw2 - $lw2);
                    else                              $lx = $bx;
                    imagettftext($canvas, $fpx, 0, (int)$lx + 2, $cy + (int)$asc + 2, $shadow, $font, $line);
                    imagettftext($canvas, $fpx, 0, (int)$lx, $cy + (int)$asc, $fill, $font, $line);
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
