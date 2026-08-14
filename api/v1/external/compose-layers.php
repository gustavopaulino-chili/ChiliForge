<?php
/**
 * Measured scrim — decides the darkening layer from the PIXELS, not from a fixed rule.
 *
 * WHY THIS EXISTS
 * The engine emits a full-canvas gradient under the copy on EVERY ad, with roughly the same
 * opacity every time, because it cannot see the image it is writing over. That guarantees
 * legibility and it is also the single biggest reason every creative looks like the same
 * template: the identical dark fade at the bottom is the first thing the eye reads.
 *
 * Here we have the actual JPEG, so we can stop guessing. For each copy block we sample the
 * background underneath it, compute the WCAG contrast the ink would really get, and solve for
 * the MINIMUM scrim alpha that reaches the target. On a dark or calm photo that number is zero
 * and the gradient is deleted outright — the ad finally looks like a photograph with type on
 * it. On a bright or busy photo the number goes up and the copy stays readable.
 *
 * This runs in PHP, at compose time, on purpose: it is the only place in the pipeline that
 * holds both the rendered HTML and the background bytes.
 *
 * Entry point:
 *   extd_tune_scrim(string $bannerHtml, int $canvasW, int $canvasH, array &$diag = []): string
 *
 * Never throws and never fails a generation: on any doubt it returns the HTML untouched, which
 * is exactly today's behaviour.
 */

require_once __DIR__ . '/compose-gd.php';

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
