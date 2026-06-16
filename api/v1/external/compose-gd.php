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
        if (is_file($src)) { $b = @file_get_contents($src); return $b === false ? '' : $b; }
        return '';
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

if (!function_exists('extgd_font_px')) {
    /** calc(min(Acqh, Bcqw) * N) → px relative to the banner box; or Npx. */
    function extgd_font_px(?string $fs, int $W, int $H): float {
        $fs = (string)$fs;
        if (preg_match('/min\(\s*([\d.]+)cqh\s*,\s*([\d.]+)cqw\s*\)\s*\*\s*([\d.]+)/i', $fs, $m)) {
            return min((float)$m[1] / 100 * $H, (float)$m[2] / 100 * $W) * (float)$m[3];
        }
        if (preg_match('/([\d.]+)px/', $fs, $m)) return (float)$m[1];
        return max(14, $H * 0.05);
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

if (!function_exists('extgd_draw_scrim')) {
    /** Approximate the compose scrim: a directional dark gradient over a region. */
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
        // Peak darkness from the strongest rgba alpha in the gradient (fallback .6).
        $peak = 0.6;
        if (preg_match_all('/rgba?\([^)]*?,\s*([\d.]+)\s*\)/', $bg, $am)) {
            foreach ($am[1] as $a) $peak = max($peak, (float)$a);
        }
        $dir = 'to top';
        if (preg_match('/linear-gradient\(\s*(to [a-z ]+|[\d.]+deg)/i', $bg, $dm)) $dir = strtolower(trim($dm[1]));
        $radial = stripos($bg, 'radial-gradient') !== false;

        if ($radial) {
            $cx = ($x1 + $x2) / 2; $cy = ($y1 + $y2) / 2;
            $maxd = sqrt((($x2 - $x1) / 2) ** 2 + (($y2 - $y1) / 2) ** 2);
            for ($y = $y1; $y < $y2; $y++) for ($x = $x1; $x < $x2; $x += 1) {
                $d = sqrt(($x - $cx) ** 2 + ($y - $cy) ** 2) / max(1, $maxd);
                $al = (int)round((1 - min(1, $d)) * $peak * 127);
                if ($al <= 0) continue;
                imagesetpixel($img, $x, $y, imagecolorallocatealpha($img, 0, 0, 0, 127 - $al));
            }
            return;
        }
        // Linear: in CSS the first (dark) stop sits OPPOSITE the arrow direction. So
        // "to top" → dark at bottom; "to bottom" → dark at top; "to right" → dark at left;
        // "to left" → dark at right. darkAtStart = dark at the low coord (top / left).
        $vertical = (strpos($dir, 'top') !== false || strpos($dir, 'bottom') !== false || preg_match('/(0|180)deg/', $dir));
        $darkAtStart = (strpos($dir, 'bottom') !== false || strpos($dir, 'right') !== false);
        for ($i = ($vertical ? $y1 : $x1); $i < ($vertical ? $y2 : $x2); $i++) {
            $frac = $vertical ? ($i - $y1) / max(1, $y2 - $y1) : ($i - $x1) / max(1, $x2 - $x1);
            $dark = $darkAtStart ? (1 - $frac) : $frac;
            $al = (int)round($dark * $peak * 127);
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

        $canvas = imagecreatetruecolor($W, $H);
        imagealphablending($canvas, true); imagesavealpha($canvas, false);
        imagefilledrectangle($canvas, 0, 0, $W, $H, imagecolorallocate($canvas, 20, 20, 24));

        // Walk children in document order (= z-order): bg, scrim, logo, headline, sub, cta.
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
                    $bg = @imagecreatefromstring($bytes);
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
                $logo = @imagecreatefromstring($bytes);
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
                continue;
            }
            // ── Text / CTA div ──
            if ($tag === 'div') {
                $text = trim(preg_replace('/\s+/', ' ', $node->textContent));
                if ($text === '') continue;
                $fontPx = extgd_font_px($st['font-size'] ?? null, $W, $H);
                $weight = (int)($st['font-weight'] ?? 400);
                $font = extgd_font($weight);
                if ($font === '') $font = $fontReg;
                $col = extgd_color($st['color'] ?? '#ffffff', [255, 255, 255, 0]);
                $align = strtolower($st['text-align'] ?? 'left');
                $left = extgd_pct($st['left'] ?? null, $W); $right = extgd_pct($st['right'] ?? null, $W);
                $top = extgd_pct($st['top'] ?? null, $H); $bottom = extgd_pct($st['bottom'] ?? null, $H);
                $center = isset($st['transform']) && stripos($st['transform'], 'translatex(-50%)') !== false;
                $hasBtn = isset($st['background']) && stripos($st['background'], 'transparent') === false;

                if ($hasBtn) {
                    // CTA button: white/brand pill with padded label.
                    $bb = imagettfbbox($fontPx, 0, $font, $text);
                    $tw = abs($bb[2] - $bb[0]); $th = abs($bb[7] - $bb[1]);
                    $padX = (int)round($fontPx * 0.90); $padY = (int)round($fontPx * 0.42);
                    $bw2 = $tw + 2 * $padX; $bh2 = $th + 2 * $padY;
                    $bx = $center ? (int)round(($left ?? $W / 2) - $bw2 / 2) : ($right !== null ? (int)round($W - $right - $bw2) : (int)round($left ?? $W * 0.05));
                    $by = $bottom !== null ? (int)round($H - $bottom - $bh2) : (int)round($top ?? $H * 0.8);
                    $bgc = extgd_color($st['background'], [255, 255, 255, 0]);
                    extgd_filled_round_rect($canvas, $bx, $by, $bx + $bw2, $by + $bh2, (int)round($fontPx * 0.38), imagecolorallocate($canvas, $bgc[0], $bgc[1], $bgc[2]));
                    $tc = imagecolorallocate($canvas, $col[0], $col[1], $col[2]);
                    imagettftext($canvas, $fontPx, 0, $bx + $padX, $by + $padY + abs($bb[7]), $tc, $font, $text);
                    continue;
                }

                // Wrapped text block (headline/sub/organic CTA).
                $bx = $left ?? ($W * 0.05);
                $bw2 = ($right !== null) ? max(40, $W - $right - $bx) : ($W - $bx - $W * 0.05);
                $lines = extgd_wrap_lines($text, $font, $fontPx, $bw2);
                $lineH = (float)($st['line-height'] ?? 1.18);
                if ($lineH > 3) $lineH = $lineH / $fontPx; // px line-height → ratio
                $step = (int)round($fontPx * max(1.05, $lineH));
                $blockH = $step * count($lines);
                $y0 = $bottom !== null ? (int)round($H - $bottom - $blockH) : (int)round($top ?? $H * 0.5);
                $shadow = imagecolorallocatealpha($canvas, 0, 0, 0, 45);
                $fill = imagecolorallocatealpha($canvas, $col[0], $col[1], $col[2], $col[3]);
                $cy = $y0;
                foreach ($lines as $line) {
                    $bb = imagettfbbox($fontPx, 0, $font, $line);
                    $lw2 = abs($bb[2] - $bb[0]); $asc = abs($bb[7]);
                    if ($align === 'center')    $lx = $bx + ($bw2 - $lw2) / 2;
                    elseif ($align === 'right') $lx = $bx + ($bw2 - $lw2);
                    else                        $lx = $bx;
                    imagettftext($canvas, $fontPx, 0, (int)$lx + 2, $cy + (int)$asc + 2, $shadow, $font, $line);
                    imagettftext($canvas, $fontPx, 0, (int)$lx, $cy + (int)$asc, $fill, $font, $line);
                    $cy += $step;
                }
                continue;
            }
        }

        $dir = dirname($outJpgPath);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        imageinterlace($canvas, true);
        $ok = imagejpeg($canvas, $outJpgPath, 90);
        imagedestroy($canvas);
        return (bool)$ok && is_file($outJpgPath) && filesize($outJpgPath) > 0;
    }
}
