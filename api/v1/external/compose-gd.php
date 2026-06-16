<?php
/**
 * Browserless creative compositor (PHP GD).
 *
 * The external API server has no headless browser, so it cannot rasterize the
 * compose HTML. Instead, Gemini generates ONLY the background scene, and this
 * compositor draws the EXACT brand logo + the campaign copy on top with GD —
 * guaranteeing a pixel-exact logo and typo-free text (no model-painted letters).
 *
 * Public entry point:
 *   extgd_compose_to_jpeg(string $bgSrc, array $cd, array $fmt, ?array $rec, string $outJpgPath): bool
 *     $bgSrc      background image: http(s) URL, data: URL, or local file path ('' = solid brand color)
 *     $cd         campaignData (mainHeadline, subheadline/offer, ctaText, logoUrl, primaryColor, platform)
 *     $fmt        ['width','height','platform','format']
 *     $rec        optional {headlineScale: 0.7-1.4, align: left|center|right} hint from the image model
 *     $outJpgPath absolute path to write the JPEG
 *   Returns true on success. Throws RuntimeException on a hard failure (no font, no GD).
 */

if (!function_exists('extgd_font')) {
    function extgd_font(bool $bold): string {
        $bundled = __DIR__ . '/fonts/' . ($bold ? 'OpenSans-Bold.ttf' : 'OpenSans-Regular.ttf');
        if (is_file($bundled)) return $bundled;
        $sys = $bold
            ? ['/usr/share/fonts/urw-base35/NimbusSans-Bold.otf', '/usr/share/fonts/google-droid/DroidSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
            : ['/usr/share/fonts/urw-base35/NimbusSans-Regular.otf', '/usr/share/fonts/google-droid/DroidSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
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
        if (is_file($src)) {
            $b = @file_get_contents($src);
            return $b === false ? '' : $b;
        }
        return '';
    }
}

if (!function_exists('extgd_hex_to_rgb')) {
    function extgd_hex_to_rgb(?string $hex, array $fallback = [17, 17, 17]): array {
        $hex = ltrim(trim((string)$hex), '#');
        if (strlen($hex) === 3) $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) return $fallback;
        return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
    }
}

if (!function_exists('extgd_wrap_lines')) {
    /** Greedy word-wrap using real glyph metrics. Returns array of lines that fit $maxW. */
    function extgd_wrap_lines(string $text, string $font, float $size, int $maxW): array {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        if ($text === '') return [];
        $words = explode(' ', $text);
        $lines = [];
        $cur = '';
        foreach ($words as $w) {
            $try = $cur === '' ? $w : $cur . ' ' . $w;
            $bb = imagettfbbox($size, 0, $font, $try);
            $width = abs($bb[2] - $bb[0]);
            if ($width <= $maxW || $cur === '') {
                $cur = $try;
            } else {
                $lines[] = $cur;
                $cur = $w;
            }
        }
        if ($cur !== '') $lines[] = $cur;
        return $lines;
    }
}

if (!function_exists('extgd_text_block')) {
    /**
     * Draw a wrapped text block with a soft shadow. Returns the total height drawn.
     * $align: left|center|right within [$x, $x+$maxW].
     */
    function extgd_text_block($img, array $lines, string $font, float $size, int $x, int $y, int $maxW, array $rgb, string $align, float $lineH = 1.18): int {
        if (empty($lines)) return 0;
        $shadow = imagecolorallocatealpha($img, 0, 0, 0, 35);
        $fill   = imagecolorallocate($img, $rgb[0], $rgb[1], $rgb[2]);
        $lineGap = (int)round($size * $lineH);
        $cy = $y;
        foreach ($lines as $line) {
            $bb = imagettfbbox($size, 0, $font, $line);
            $lineW = abs($bb[2] - $bb[0]);
            $ascent = abs($bb[7]);
            if ($align === 'center')      $lx = $x + (int)(($maxW - $lineW) / 2);
            elseif ($align === 'right')   $lx = $x + ($maxW - $lineW);
            else                          $lx = $x;
            $baseline = $cy + $ascent;
            imagettftext($img, $size, 0, $lx + 2, $baseline + 2, $shadow, $font, $line);
            imagettftext($img, $size, 0, $lx, $baseline, $fill, $font, $line);
            $cy += $lineGap;
        }
        return $cy - $y;
    }
}

if (!function_exists('extgd_measure_block')) {
    function extgd_measure_block(array $lines, float $size, float $lineH = 1.18): int {
        return empty($lines) ? 0 : (int)round($size * $lineH) * count($lines);
    }
}

if (!function_exists('extgd_compose_to_jpeg')) {
    function extgd_compose_to_jpeg(string $bgSrc, array $cd, array $fmt, ?array $rec, string $outJpgPath): bool {
        if (!extension_loaded('gd')) throw new RuntimeException('GD extension not available.');
        $fontBold = extgd_font(true);
        $fontReg  = extgd_font(false);
        if ($fontBold === '') throw new RuntimeException('No TTF/OTF font available for GD text rendering.');
        if ($fontReg === '') $fontReg = $fontBold;

        $W = max(1, min(4096, (int)($fmt['width']  ?? 1080)));
        $H = max(1, min(4096, (int)($fmt['height'] ?? 1080)));

        $canvas = imagecreatetruecolor($W, $H);
        imagealphablending($canvas, true);
        imagesavealpha($canvas, false);

        // ── Background: cover-fit the generated scene, else solid brand color ──
        $primary = extgd_hex_to_rgb($cd['primaryColor'] ?? null, [24, 24, 27]);
        imagefilledrectangle($canvas, 0, 0, $W, $H, imagecolorallocate($canvas, $primary[0], $primary[1], $primary[2]));
        $bgBytes = extgd_fetch_bytes($bgSrc);
        if ($bgBytes !== '') {
            $bg = @imagecreatefromstring($bgBytes);
            if ($bg !== false) {
                $bw = imagesx($bg); $bh = imagesy($bg);
                $scale = max($W / $bw, $H / $bh);
                $nw = (int)ceil($bw * $scale); $nh = (int)ceil($bh * $scale);
                $dx = (int)(($W - $nw) / 2); $dy = (int)(($H - $nh) / 2);
                imagecopyresampled($canvas, $bg, $dx, $dy, 0, 0, $nw, $nh, $bw, $bh);
                imagedestroy($bg);
            }
        }

        // ── Scrim: darken the bottom for white-text legibility ──
        // Bottom ~62% gets a vertical gradient from transparent (top) to ~72% black (bottom).
        $scrimTop = (int)($H * 0.38);
        for ($yy = $scrimTop; $yy < $H; $yy++) {
            $t = ($yy - $scrimTop) / max(1, $H - $scrimTop);   // 0..1
            $alpha = (int)round(127 - (min(0.72, $t * 0.85) * 127)); // 127=transp .. ~35=72% black
            $col = imagecolorallocatealpha($canvas, 0, 0, 0, max(0, min(127, $alpha)));
            imagefilledrectangle($canvas, 0, $yy, $W, $yy, $col);
        }

        $pad = (int)round($W * 0.06);
        $contentW = $W - 2 * $pad;
        $white = [255, 255, 255];
        $align = in_array(($rec['align'] ?? 'left'), ['left', 'center', 'right'], true) ? $rec['align'] : 'left';
        $scale = max(0.7, min(1.4, (float)($rec['headlineScale'] ?? 1)));

        // ── Logo (EXACT): top-left, contain, ~24% width ──
        $logoBytes = extgd_fetch_bytes((string)($cd['logoUrl'] ?? ''));
        if ($logoBytes !== '') {
            $logo = @imagecreatefromstring($logoBytes);
            if ($logo !== false) {
                imagealphablending($logo, true);
                $lw = imagesx($logo); $lh = imagesy($logo);
                $maxLW = (int)round($W * 0.24);
                $maxLH = (int)round($H * 0.13);
                $ls = min($maxLW / $lw, $maxLH / $lh, 1.0);
                if ($ls <= 0) $ls = $maxLW / $lw;
                $dlw = max(1, (int)round($lw * $ls)); $dlh = max(1, (int)round($lh * $ls));
                $logoCanvas = imagecreatetruecolor($dlw, $dlh);
                imagealphablending($logoCanvas, false);
                imagesavealpha($logoCanvas, true);
                imagefilledrectangle($logoCanvas, 0, 0, $dlw, $dlh, imagecolorallocatealpha($logoCanvas, 0, 0, 0, 127));
                imagealphablending($logoCanvas, true);
                imagecopyresampled($logoCanvas, $logo, 0, 0, 0, 0, $dlw, $dlh, $lw, $lh);
                imagecopy($canvas, $logoCanvas, $pad, $pad, 0, 0, $dlw, $dlh);
                imagedestroy($logo); imagedestroy($logoCanvas);
            }
        }

        // ── Type sizing (relative to the binding dimension) ──
        $base = min($W, $H);
        $headlineSize = max(26, (int)round($base * 0.072 * $scale));
        $subSize      = max(15, (int)round($headlineSize * 0.46));
        $ctaSize      = max(14, (int)round($headlineSize * 0.40));

        $headline = trim((string)($cd['mainHeadline'] ?? $cd['valueProposition'] ?? ''));
        $sub      = trim((string)($cd['subheadline'] ?? $cd['offer'] ?? ''));
        $cta      = trim((string)($cd['ctaText'] ?? ''));

        // Fit headline: shrink until it uses at most 4 lines.
        $hlLines = extgd_wrap_lines($headline, $fontBold, $headlineSize, $contentW);
        $guard = 0;
        while (count($hlLines) > 4 && $headlineSize > 22 && $guard++ < 12) {
            $headlineSize = (int)round($headlineSize * 0.92);
            $hlLines = extgd_wrap_lines($headline, $fontBold, $headlineSize, $contentW);
        }
        $subLines = extgd_wrap_lines($sub, $fontReg, $subSize, $contentW);
        if (count($subLines) > 3) $subLines = array_slice($subLines, 0, 3);

        // ── Vertical stack anchored to the bottom ──
        $ctaH = $cta !== '' ? (int)round($ctaSize * 2.4) : 0;
        $gapSmall = (int)round($headlineSize * 0.35);
        $gapCta   = (int)round($headlineSize * 0.55);
        $hlH  = extgd_measure_block($hlLines, $headlineSize);
        $subH = extgd_measure_block($subLines, $subSize);
        $blockH = $hlH + ($subH ? $gapSmall + $subH : 0) + ($ctaH ? $gapCta + $ctaH : 0);
        $bottomPad = (int)round($H * 0.08);
        $y = $H - $bottomPad - $blockH;
        $minY = (int)round($H * 0.40);
        if ($y < $minY) $y = $minY;

        $y += extgd_text_block($canvas, $hlLines, $fontBold, $headlineSize, $pad, $y, $contentW, $white, $align);
        if ($subH) {
            $y += $gapSmall;
            $y += extgd_text_block($canvas, $subLines, $fontReg, $subSize, $pad, $y, $contentW, [235, 235, 235], $align);
        }

        // ── CTA pill button ──
        if ($cta !== '') {
            $y += $gapCta;
            $bb = imagettfbbox($ctaSize, 0, $fontBold, $cta);
            $txtW = abs($bb[2] - $bb[0]);
            $txtH = abs($bb[7] - $bb[1]);
            $padX = (int)round($ctaSize * 0.95);
            $padY = (int)round($ctaSize * 0.62);
            $btnW = $txtW + 2 * $padX;
            $btnH = $txtH + 2 * $padY;
            if ($align === 'center')    $btnX = $pad + (int)(($contentW - $btnW) / 2);
            elseif ($align === 'right') $btnX = $pad + ($contentW - $btnW);
            else                        $btnX = $pad;
            $btnY = $y;
            $btnBg = imagecolorallocate($canvas, 255, 255, 255);
            extgd_filled_round_rect($canvas, $btnX, $btnY, $btnX + $btnW, $btnY + $btnH, (int)round($btnH * 0.28), $btnBg);
            $dark = extgd_hex_to_rgb($cd['primaryColor'] ?? null, [17, 17, 17]);
            // Ensure the label is readable on the white pill.
            if (($dark[0] + $dark[1] + $dark[2]) > 620) $dark = [17, 17, 17];
            $txtColor = imagecolorallocate($canvas, $dark[0], $dark[1], $dark[2]);
            $baseline = $btnY + $padY + abs($bb[7]);
            imagettftext($canvas, $ctaSize, 0, $btnX + $padX, $baseline, $txtColor, $fontBold, $cta);
        }

        $dir = dirname($outJpgPath);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        imageinterlace($canvas, true);
        $ok = imagejpeg($canvas, $outJpgPath, 90);
        imagedestroy($canvas);
        return (bool)$ok && is_file($outJpgPath) && filesize($outJpgPath) > 0;
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
