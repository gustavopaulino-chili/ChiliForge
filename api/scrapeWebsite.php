<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, apikey");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

const FETCH_TIMEOUT_SECONDS = 12;
const AI_TIMEOUT_SECONDS    = 25;
const CACHE_TTL_SECONDS     = 600;
const MAX_TEXT_CHARS        = 5000;

// ── Environment ──────────────────────────────────────────────────────────────
function load_dotenv_if_available() {
    $candidates = [
        dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env',
        __DIR__         . DIRECTORY_SEPARATOR . '.env',
    ];
    foreach ($candidates as $path) {
        if (!is_file($path) || !is_readable($path)) continue;
        $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) continue;
        foreach ($lines as $line) {
            $line = trim((string)$line);
            if ($line === '' || str_starts_with($line, '#')) continue;
            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) continue;
            [$k, $v] = $parts;
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
load_dotenv_if_available();

function env_value($key, $default = '') {
    $v = getenv($key);
    if (is_string($v) && $v !== '') return $v;
    if (isset($_ENV[$key])    && is_string($_ENV[$key])    && $_ENV[$key]    !== '') return $_ENV[$key];
    if (isset($_SERVER[$key]) && is_string($_SERVER[$key]) && $_SERVER[$key] !== '') return $_SERVER[$key];
    return $default;
}

function normalize_account_type($value) {
    return $value === 'admin' ? 'admin' : 'testing';
}

// ── API key & model ──────────────────────────────────────────────────────────
function get_gemini_api_key_candidates($accountType) {
    $prod    = env_value('GEMINI_API_KEY_PRODUCTION', env_value('GEMINI_API_KEY'));
    $testing = env_value('GEMINI_API_KEY_TESTING');
    if ($accountType === 'admin') {
        if ($prod === '') throw new RuntimeException('GEMINI_API_KEY_PRODUCTION is not configured');
        return [$prod];
    }
    $candidates = [];
    if ($testing !== '') $candidates[] = $testing;
    if ($prod !== '') $candidates[] = $prod;
    if (!$candidates) throw new RuntimeException('No Gemini API key is configured for scraper');
    return array_values(array_unique($candidates));
}

function get_scrape_model($accountType) {
    $envKey = ($accountType === 'admin') ? 'GEMINI_SCRAPE_MODEL_PRODUCTION' : 'GEMINI_SCRAPE_MODEL_TESTING';
    $model  = env_value($envKey, env_value('GEMINI_SCRAPE_MODEL', 'gemini-2.5-flash'));
    // Block non-Gemini models (e.g. gemma) — they cause timeouts on this endpoint
    return str_starts_with($model, 'gemini-') ? $model : 'gemini-2.5-flash';
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function fetch_url($url, $headers, $timeoutSeconds, $method = 'GET', $body = null) {
    if (!function_exists('curl_init')) throw new RuntimeException('cURL extension is not available');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 8,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT        => $timeoutSeconds,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 ChiliForgeScraper/1.0',
        CURLOPT_ENCODING       => '',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    if (strtoupper((string)$method) !== 'GET') curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper((string)$method));
    if (is_string($body)) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);

    $responseBody = curl_exec($ch);
    $status       = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error        = curl_error($ch);

    if ($responseBody === false && $error !== '' && preg_match('/SSL|certificate|tls/i', $error)) {
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        $responseBody = curl_exec($ch);
        $status       = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $retryErr     = curl_error($ch);
        if ($retryErr !== '') $error .= ' | ssl-retry: ' . $retryErr;
    }
    curl_close($ch);
    return [
        'ok'     => $responseBody !== false && $status >= 200 && $status < 300,
        'status' => $status,
        'body'   => is_string($responseBody) ? $responseBody : '',
        'error'  => $error,
    ];
}

// ── Website fetching ─────────────────────────────────────────────────────────
function fetch_website_html($formattedUrl) {
    $origin  = parse_url($formattedUrl, PHP_URL_SCHEME) . '://' . parse_url($formattedUrl, PHP_URL_HOST);
    $browserHeaders = [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
        'Referer: ' . $origin,
        'Sec-Fetch-Dest: document',
        'Sec-Fetch-Mode: navigate',
        'Sec-Fetch-Site: none',
        'Cache-Control: max-age=0',
        'Upgrade-Insecure-Requests: 1',
    ];

    $result = fetch_url($formattedUrl, $browserHeaders, FETCH_TIMEOUT_SECONDS);
    if ($result['ok'] && trim($result['body']) !== '') return ['body' => $result['body'], 'isHtml' => true];

    $result = fetch_url($formattedUrl, ['Accept: text/html,*/*;q=0.8'], FETCH_TIMEOUT_SECONDS);
    if ($result['ok'] && trim($result['body']) !== '') return ['body' => $result['body'], 'isHtml' => true];

    // Jina.ai reader fallback — returns clean plain text from any site
    $jinaUrl = 'https://r.jina.ai/' . $formattedUrl;
    $jina    = fetch_url($jinaUrl, ['Accept: text/plain, */*;q=0.8'], FETCH_TIMEOUT_SECONDS);
    if ($jina['ok'] && trim($jina['body']) !== '') return ['body' => $jina['body'], 'isHtml' => false];

    throw new RuntimeException('Failed to fetch website content');
}

function has_usable_content($content, $isHtml) {
    if ($isHtml) return (bool)preg_match('/<html[\s>]|<!doctype html|<body[\s>]|<head[\s>]/i', $content);
    return str_word_count(strip_tags($content)) >= 20;
}

// ── PHP pre-extraction (zero AI tokens used) ─────────────────────────────────
function make_absolute_url($url, $base) {
    $url = trim((string)$url);
    if ($url === '' || str_starts_with($url, 'data:')) return $url;
    if (preg_match('/^https?:\/\//i', $url)) return $url;
    if (str_starts_with($url, '//')) return 'https:' . $url;
    $p = parse_url($base);
    $origin = ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '');
    if (str_starts_with($url, '/')) return $origin . $url;
    return rtrim($base, '/') . '/' . ltrim($url, '/');
}

function extract_meta_content($html, $attr, $value) {
    $v = preg_quote($value, '/');
    if (preg_match('/<meta\b[^>]*\b' . $attr . '\s*=\s*["\']' . $v . '["\'][^>]*\bcontent\s*=\s*["\']([^"\']*)["\'][^>]*>/i', $html, $m))
        return html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5);
    if (preg_match('/<meta\b[^>]*\bcontent\s*=\s*["\']([^"\']*)["\'][^>]*\b' . $attr . '\s*=\s*["\']' . $v . '["\'][^>]*>/i', $html, $m))
        return html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5);
    return '';
}

function extract_img_src($imgTag, $base) {
    foreach (['src', 'data-src', 'data-lazy', 'data-lazy-src', 'data-original'] as $attr) {
        if (preg_match('/\b' . $attr . '\s*=\s*["\']([^"\']+)["\']/', $imgTag, $m)) {
            $url = trim($m[1]);
            // Skip placeholders, data GIFs (used by lazy loaders), very short strings
            if ($url !== '' && !preg_match('/^data:image\/gif/i', $url) && strlen($url) > 5)
                return make_absolute_url($url, $base);
        }
    }
    if (preg_match('/\bsrcset\s*=\s*["\']([^"\']+)["\']/', $imgTag, $m)) {
        $parts = preg_split('/\s*,\s*/', trim((string)$m[1]));
        foreach ($parts as $part) {
            $candidate = trim((string)preg_split('/\s+/', $part)[0]);
            if ($candidate !== '' && !preg_match('/^data:image\/gif/i', $candidate) && strlen($candidate) > 5) {
                return make_absolute_url($candidate, $base);
            }
        }
    }
    return '';
}

function pre_extract_from_html($html, $baseUrl) {
    $d = array_fill_keys([
        'businessName', 'businessDescription',
        'logoUrl',
        'heroImage1', 'heroImage1Context',
        'heroImage2', 'heroImage2Context',
        'brandImage', 'brandImageContext',
        'sectionImage1', 'sectionImage1Context',
        'sectionImage2', 'sectionImage2Context',
        'sectionImage3', 'sectionImage3Context',
        'phone', 'email', 'whatsapp',
        'facebook', 'instagram', 'twitter', 'linkedin', 'youtube',
        'headingFont', 'bodyFont',
        'primaryColor',
    ], '');

    // Business name: og:title -> twitter:title -> <title> tag
    $d['businessName'] = extract_meta_content($html, 'property', 'og:title')
        ?: extract_meta_content($html, 'name', 'twitter:title');
    if (!$d['businessName'] && preg_match('/<title[^>]*>([^<]+)<\/title>/i', $html, $m)) {
        $t = html_entity_decode(trim(strip_tags($m[1])), ENT_QUOTES | ENT_HTML5);
        $t = preg_replace('/\s*[-–|]\s*.{2,}$/', '', $t);
        $d['businessName'] = trim((string)$t);
    }

    // Description: og:description -> twitter:description -> meta description
    $d['businessDescription'] = extract_meta_content($html, 'property', 'og:description')
        ?: extract_meta_content($html, 'name', 'twitter:description')
        ?: extract_meta_content($html, 'name', 'description');

    // Hero image: og:image -> twitter:image
    $ogImage = extract_meta_content($html, 'property', 'og:image')
            ?: extract_meta_content($html, 'name', 'twitter:image');
    if ($ogImage) {
        $d['heroImage1']        = make_absolute_url($ogImage, $baseUrl);
        $d['heroImage1Context'] = 'Main brand/hero image';
    }

    // Logo: JSON-LD/itemprop/logo img/header img -> apple-touch-icon
    if (preg_match('/<script[^>]+type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/i', $html, $m)) {
        $jsonText = trim((string)$m[1]);
        $json = json_decode($jsonText, true);
        if (is_array($json)) {
            $logoField = $json['logo']['url'] ?? $json['logo'] ?? $json['image']['url'] ?? $json['image'] ?? '';
            if (is_string($logoField) && trim($logoField) !== '') {
                $d['logoUrl'] = make_absolute_url(trim($logoField), $baseUrl);
            }
        }
    }
    if (!$d['logoUrl']) {
        $schemaLogo = extract_meta_content($html, 'itemprop', 'logo');
        if ($schemaLogo) $d['logoUrl'] = make_absolute_url($schemaLogo, $baseUrl);
    }

    preg_match_all('/<img\b[^>]*>/i', $html, $imgTags);
    $allImgTags = $imgTags[0] ?? [];
    if (!$d['logoUrl']) {
        foreach ($allImgTags as $imgTag) {
            if (preg_match('/logo|marca|brand|logotipo|custom-logo|site-logo|navbar-brand|itemprop=["\']logo["\']/i', $imgTag)) {
                $src = extract_img_src($imgTag, $baseUrl);
                if ($src && !preg_match('/\.ico$/i', $src)) { $d['logoUrl'] = $src; break; }
            }
        }
    }
    if (!$d['logoUrl']) {
        if (preg_match('/<(?:header|nav)\b[^>]*>[\s\S]{0,3000}/i', $html, $headerMatch)) {
            preg_match_all('/<img\b[^>]*>/i', $headerMatch[0], $headerImgs);
            foreach (($headerImgs[0] ?? []) as $imgTag) {
                $src = extract_img_src($imgTag, $baseUrl);
                if ($src && !preg_match('/\.ico$/i', $src)) { $d['logoUrl'] = $src; break; }
            }
        }
    }
    if (!$d['logoUrl']) {
        if (preg_match('/<link\b[^>]*rel=["\'][^"\']*apple-touch-icon[^"\']*["\'][^>]*href=["\'](.*?)["\'][^>]*>/i', $html, $m))
            $d['logoUrl'] = make_absolute_url(trim($m[1]), $baseUrl);
    }

    // Section images: up to 5 non-logo, non-icon images
    $sectionImgs = [];
    $seenUrls = array_fill_keys(array_filter([$d['logoUrl'], $d['heroImage1'], '']), true);
    foreach ($allImgTags as $imgTag) {
        $src = extract_img_src($imgTag, $baseUrl);
        if (!$src || isset($seenUrls[$src])) continue;
        if (preg_match('/\.(ico|svg)$/i', $src)) continue;
        if (preg_match('/logo|icon|avatar|sprite|pixel|1x1|blank|placeholder/i', $imgTag)) continue;
        $alt = '';
        if (preg_match('/\balt\s*=\s*["\']([^"\']*)["\']/', $imgTag, $am)) $alt = trim($am[1]);
        $seenUrls[$src] = true;
        $sectionImgs[] = ['url' => $src, 'alt' => $alt];
        if (count($sectionImgs) >= 5) break;
    }
    $imgSlots = [
        ['heroImage2', 'heroImage2Context'],
        ['brandImage', 'brandImageContext'],
        ['sectionImage1', 'sectionImage1Context'],
        ['sectionImage2', 'sectionImage2Context'],
        ['sectionImage3', 'sectionImage3Context'],
    ];
    foreach ($imgSlots as $i => [$urlKey, $ctxKey]) {
        $d[$urlKey] = $sectionImgs[$i]['url'] ?? '';
        $d[$ctxKey] = $sectionImgs[$i]['alt'] ?? '';
    }

    // Contact: tel, mailto, WhatsApp wa.me link
    if (preg_match('/href=["\']tel:([^"\']+)["\']/', $html, $m))
        $d['phone'] = trim(urldecode((string)$m[1]));
    if (preg_match('/href=["\']mailto:([^"\'?]+)["\']/', $html, $m))
        $d['email'] = trim((string)$m[1]);
    if (preg_match('/href=["\'](https?:\/\/(?:api\.)?wa\.me\/([+\d]+))["\']/', $html, $m)) {
        $num = ltrim((string)$m[2], '+');
        $d['whatsapp'] = '+' . $num;
    }

    // Social links (profile pages only, not share buttons)
    $socialRe = [
        'facebook'  => 'https?:\/\/(?:www\.)?facebook\.com\/(?!sharer)[^\s"\'?#]+',
        'instagram' => 'https?:\/\/(?:www\.)?instagram\.com\/[^\s"\'?#]+',
        'twitter'   => 'https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"\'?#]+',
        'linkedin'  => 'https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^\s"\'?#]+',
        'youtube'   => 'https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|@|user)[^\s"\'?#]+',
    ];
    foreach ($socialRe as $k => $re) {
        if (preg_match('/href=["\']('. $re .')["\']/', $html, $m)) $d[$k] = trim((string)$m[1]);
    }

    // Google Fonts (actual font names, more reliable than AI inference)
    preg_match_all('/fonts\.googleapis\.com\/css2?\?[^"\'\s)]+/i', $html, $fm);
    $fonts = [];
    foreach (($fm[0] ?? []) as $fontUrl) {
        if (preg_match_all('/family=([^&"\'\s:]+)/i', $fontUrl, $families)) {
            foreach ($families[1] as $f) {
                $f = trim(str_replace('+', ' ', urldecode((string)$f)));
                if ($f) $fonts[] = $f;
            }
        }
    }
    $fonts = array_values(array_unique($fonts));
    if ($fonts) { $d['headingFont'] = $fonts[0]; $d['bodyFont'] = $fonts[1] ?? $fonts[0]; }

    // Theme color from meta tag
    $tc = extract_meta_content($html, 'name', 'theme-color');
    if (preg_match('/(#[0-9a-fA-F]{3,6})/', $tc, $m)) $d['primaryColor'] = $m[1];

    return $d;
}

// ── Text extraction for AI ───────────────────────────────────────────────────
function extract_text_for_ai($html) {
    $t = preg_replace('/<!--[\s\S]*?-->/', ' ', $html);
    $t = preg_replace('/<script\b[^>]*>[\s\S]*?<\/script>/i', ' ', (string)$t);
    $t = preg_replace('/<style\b[^>]*>[\s\S]*?<\/style>/i', ' ', (string)$t);
    $t = preg_replace('/<noscript\b[^>]*>[\s\S]*?<\/noscript>/i', ' ', (string)$t);
    $t = preg_replace('/<svg\b[^>]*>[\s\S]*?<\/svg>/i', ' ', (string)$t);
    $t = strip_tags((string)$t);
    $t = preg_replace('/[ \t]+/', ' ', (string)$t);
    $t = preg_replace('/[\r\n]+/', "\n", (string)$t);
    $t = preg_replace('/\n{3,}/', "\n\n", (string)$t);
    return trim((string)$t);
}

// ── AI call ──────────────────────────────────────────────────────────────────
function extract_response_text($payload) {
    $parts = $payload['candidates'][0]['content']['parts'] ?? null;
    if (!is_array($parts)) return null;
    $texts = [];
    foreach ($parts as $part) {
        if (!is_array($part) || !isset($part['text']) || !is_string($part['text'])) continue;
        if (!empty($part['thought'])) continue;
        $texts[] = $part['text'];
    }
    $joined = trim(implode("\n", $texts));
    return $joined !== '' ? $joined : null;
}

function call_gemini($requestBody, $apiKeys, $model) {
    $url     = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
    $lastErr = 'No API key produced a valid response';
    foreach ($apiKeys as $apiKey) {
        $headers  = ['Content-Type: application/json', 'x-goog-api-key: ' . $apiKey];
        $response = fetch_url($url, $headers, AI_TIMEOUT_SECONDS, 'POST', $requestBody);

        // Transport error: retry once unless it was a timeout (retrying a timeout just doubles wait time)
        $transportErr = trim((string)($response['error'] ?? ''));
        $isTimeout    = $transportErr !== '' && (stripos($transportErr, 'timed out') !== false || stripos($transportErr, 'timeout') !== false);
        if ((int)$response['status'] === 0 && $transportErr !== '' && !$isTimeout) {
            usleep(300000);
            $response = fetch_url($url, $headers, AI_TIMEOUT_SECONDS, 'POST', $requestBody);
        }

        if ($response['ok']) {
            $decoded = json_decode($response['body'], true);
            if (!is_array($decoded)) throw new RuntimeException('Invalid AI JSON response');
            return $decoded;
        }

        $status = (int)$response['status'];
        if ($status === 429) { usleep(500000); $lastErr = 'Rate limit exceeded. Please try again in a moment.'; continue; }
        if ($status === 402) throw new RuntimeException('AI usage limit reached. Please add credits.');
        if (in_array($status, [502, 503, 504], true)) {
            // Server overload: wait 1.5s and retry once
            usleep(1500000);
            $retry = fetch_url($url, $headers, AI_TIMEOUT_SECONDS, 'POST', $requestBody);
            if ($retry['ok']) {
                $decoded = json_decode($retry['body'], true);
                if (is_array($decoded)) return $decoded;
            }
            $lastErr = 'AI model ' . $model . ' unavailable (' . $status . ')';
            continue;
        }
        if ($status === 0 && $transportErr !== '') {
            $lastErr = 'AI transport error from ' . $model . ': ' . $transportErr;
            continue;
        }
        throw new RuntimeException('AI gateway error from ' . $model . ': ' . $status);
    }
    throw new RuntimeException($lastErr);
}

// ── Cache ────────────────────────────────────────────────────────────────────
function cache_path($key) {
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'chili_scrape_' . sha1($key) . '.json';
}

function read_cache($key, $allowStale = false) {
    $path = cache_path($key);
    if (!is_file($path)) return null;
    $mtime = filemtime($path);
    if ($mtime === false) return null;
    if ((time() - $mtime) > CACHE_TTL_SECONDS && !$allowStale) { @unlink($path); return null; }
    $raw = @file_get_contents($path);
    if (!is_string($raw) || $raw === '') return null;
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['extracted']) || !is_array($decoded['extracted'])) return null;
    return $decoded['extracted'];
}

function write_cache($key, $extracted) {
    @file_put_contents(cache_path($key), json_encode(['extracted' => $extracted], JSON_UNESCAPED_UNICODE));
}

function detect_website_type_from_text($text) {
    $lower = mb_strtolower((string)$text);
    if (preg_match('/\b(shop|cart|checkout|produto|comprar|buy now|store|loja)\b/u', $lower)) return 'ecommerce';
    if (preg_match('/\b(saas|software|platform|plataforma|dashboard|api)\b/u', $lower)) return 'saas';
    if (preg_match('/\b(portfolio|case study|projetos|works|galeria)\b/u', $lower)) return 'portfolio';
    if (preg_match('/\b(blog|artigo|not[ií]cia|post)\b/u', $lower)) return 'blog';
    if (preg_match('/\b(course|curso|aula|treinamento|webinar)\b/u', $lower)) return 'educational';
    if (preg_match('/\b(landing|lead|cta|agende|or[cç]amento|solicite)\b/u', $lower)) return 'landing';
    return 'corporate';
}

function build_fallback_extracted($preExtracted, $textContent) {
    $text = trim((string)$textContent);
    $sentences = preg_split('/(?<=[.!?])\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $description = trim(implode(' ', array_slice($sentences, 0, 2)));
    $serviceCandidates = [];
    if (preg_match_all('/\b(?:services?|servi[cç]os?|solutions?|solu[cç][oõ]es|products?|produtos?)\b[:\-]?\s*([^\n\.]+)/iu', $text, $matches)) {
        foreach ($matches[1] as $chunk) {
            foreach (preg_split('/,|\||\/|;|\b(?:and|e)\b/iu', (string)$chunk) as $item) {
                $value = trim((string)$item);
                if ($value !== '' && mb_strlen($value) <= 50) {
                    $serviceCandidates[] = $value;
                }
            }
        }
    }
    $serviceCandidates = array_values(array_unique(array_slice($serviceCandidates, 0, 6)));

    return [
        'websiteType' => detect_website_type_from_text($text),
        'businessName' => (string)($preExtracted['businessName'] ?? ''),
        'businessDescription' => $description,
        'businessCategory' => '',
        'targetAudience' => '',
        'services' => $serviceCandidates,
        'valueProposition' => '',
        'differentiators' => [],
        'primaryColor' => (string)($preExtracted['primaryColor'] ?? ''),
        'secondaryColor' => '',
        'accentColor' => '',
        'textColor' => '',
        'backgroundColor' => '',
        'preferredStyle' => '',
        'logoUrl' => (string)($preExtracted['logoUrl'] ?? ''),
        'heroImage1' => (string)($preExtracted['heroImage1'] ?? ''),
        'heroImage1Context' => (string)($preExtracted['heroImage1Context'] ?? ''),
        'heroImage2' => (string)($preExtracted['heroImage2'] ?? ''),
        'heroImage2Context' => (string)($preExtracted['heroImage2Context'] ?? ''),
        'brandImage' => (string)($preExtracted['brandImage'] ?? ''),
        'brandImageContext' => (string)($preExtracted['brandImageContext'] ?? ''),
        'sectionImage1' => (string)($preExtracted['sectionImage1'] ?? ''),
        'sectionImage1Context' => (string)($preExtracted['sectionImage1Context'] ?? ''),
        'sectionImage2' => (string)($preExtracted['sectionImage2'] ?? ''),
        'sectionImage2Context' => (string)($preExtracted['sectionImage2Context'] ?? ''),
        'sectionImage3' => (string)($preExtracted['sectionImage3'] ?? ''),
        'sectionImage3Context' => (string)($preExtracted['sectionImage3Context'] ?? ''),
        'city' => '',
        'country' => '',
        'phone' => (string)($preExtracted['phone'] ?? ''),
        'whatsapp' => (string)($preExtracted['whatsapp'] ?? ''),
        'email' => (string)($preExtracted['email'] ?? ''),
        'facebook' => (string)($preExtracted['facebook'] ?? ''),
        'instagram' => (string)($preExtracted['instagram'] ?? ''),
        'twitter' => (string)($preExtracted['twitter'] ?? ''),
        'linkedin' => (string)($preExtracted['linkedin'] ?? ''),
        'youtube' => (string)($preExtracted['youtube'] ?? ''),
        'designNotes' => 'Fallback scraper result: structural data extracted without AI semantic enrichment.',
        'headingFont' => (string)($preExtracted['headingFont'] ?? ''),
        'bodyFont' => (string)($preExtracted['bodyFont'] ?? ''),
    ];
}

// ── Main ─────────────────────────────────────────────────────────────────────
try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) throw new RuntimeException('Invalid request payload');

    $url         = trim((string)($data['url'] ?? ''));
    $accountType = normalize_account_type($data['accountType'] ?? null);
    if ($url === '') throw new RuntimeException('URL is required');
    if (!preg_match('/^https?:\/\//i', $url)) $url = 'https://' . $url;
    if (!filter_var($url, FILTER_VALIDATE_URL)) throw new RuntimeException('Invalid URL');

    $cacheKey = $accountType . '::' . strtolower($url);
    $cached   = read_cache($cacheKey);
    if (is_array($cached)) {
        echo json_encode(['extracted' => $cached, 'cached' => true], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $apiKeys = get_gemini_api_key_candidates($accountType);
    $model   = get_scrape_model($accountType);
    $fetched = fetch_website_html($url);
    $rawBody = $fetched['body'];
    $isHtml  = $fetched['isHtml'];

    if (!has_usable_content($rawBody, $isHtml)) throw new RuntimeException('Fetched content is not usable HTML or text');

    // ── Step 1: PHP pre-extraction — no AI tokens consumed ─────────────────
    $preExtracted = $isHtml ? pre_extract_from_html($rawBody, $url) : [];

    // ── Step 2: Prepare compact text for AI ────────────────────────────────
    $textContent = $isHtml ? extract_text_for_ai($rawBody) : $rawBody;
    $textContent = mb_substr($textContent, 0, MAX_TEXT_CHARS);

    // Optional hints to steer the AI (avoids re-discovering what PHP already found)
    $hints = '';
    if (!empty($preExtracted['businessName']))   $hints .= "\nDETECTED_NAME: "          . $preExtracted['businessName'];
    if (!empty($preExtracted['headingFont']))    $hints .= "\nDETECTED_FONTS: heading=" . $preExtracted['headingFont'] . ', body=' . ($preExtracted['bodyFont'] ?? '');
    if (!empty($preExtracted['primaryColor']))   $hints .= "\nDETECTED_PRIMARY_COLOR: " . $preExtracted['primaryColor'];

    // ── Step 3: AI — semantic fields only (50% fewer tokens vs before) ──────
    $prompt =
        'You are a website analyst. Read the website text and return ONLY a valid JSON object. No markdown, no explanation.' .
        $hints . "\n" .
        'Return these fields (use "" for anything not determinable):' . "\n" .
        '{"websiteType":"corporate|landing|ecommerce|portfolio|saas|blog|educational",' .
        '"businessName":"company or brand name",' .
        '"businessDescription":"2-3 sentence description of what this business does",' .
        '"businessCategory":"industry or sector",' .
        '"targetAudience":"who this business serves",' .
        '"services":["service1","service2"],' .
        '"valueProposition":"main benefit or promise to customers",' .
        '"differentiators":["unique point 1","unique point 2"],' .
        '"preferredStyle":"modern|corporate|minimal|bold|premium",' .
        '"primaryColor":"dominant brand color as #hex or empty",' .
        '"secondaryColor":"secondary color as #hex or empty",' .
        '"accentColor":"CTA/accent color as #hex or empty",' .
        '"textColor":"main text color as #hex or empty",' .
        '"backgroundColor":"background color as #hex or empty",' .
        '"designNotes":"brief design analysis",' .
        '"headingFont":"heading font name or empty",' .
        '"bodyFont":"body font name or empty",' .
        '"city":"city name or empty",' .
        '"country":"country name or empty"}' . "\n\n" .
        'WEBSITE TEXT:' . "\n" . $textContent;

    $requestBody = json_encode([
        'contents'         => [['parts' => [['text' => $prompt]]]],
        'generationConfig' => [
            'temperature'    => 0.1,
            'maxOutputTokens' => 1500,
            'thinkingConfig'  => ['thinkingBudget' => 0],
        ],
    ], JSON_UNESCAPED_UNICODE);

    if (!is_string($requestBody) || $requestBody === '') throw new RuntimeException('Failed to build AI request payload');

    $usedFallbackExtraction = false;
    try {
        $aiPayload = call_gemini($requestBody, $apiKeys, $model);
        $aiText    = extract_response_text($aiPayload);
        if (!is_string($aiText) || trim($aiText) === '') throw new RuntimeException('No content in AI response');
        if (!preg_match('/\{[\s\S]*\}/', $aiText, $jsonMatch)) throw new RuntimeException('No JSON found in AI response');

        $aiResult = json_decode($jsonMatch[0], true);
        if (!is_array($aiResult)) throw new RuntimeException('AI JSON could not be parsed');
    } catch (Throwable $aiError) {
        $aiMessage = $aiError->getMessage();
        $isTransientAiFailure = stripos($aiMessage, 'Rate limit') !== false
            || stripos($aiMessage, 'transport error') !== false
            || stripos($aiMessage, 'unavailable') !== false
            || stripos($aiMessage, 'AI gateway') !== false
            || stripos($aiMessage, 'timed out') !== false
            || stripos($aiMessage, 'No Gemini API key') !== false
            || stripos($aiMessage, 'not configured') !== false;

        if (!$isTransientAiFailure) {
            throw $aiError;
        }

        $aiResult = build_fallback_extracted($preExtracted, $textContent);
        $usedFallbackExtraction = true;
    }

    // ── Step 4: Merge — AI fills semantics, PHP fills structural data ───────
    $defaults = [
        'websiteType' => '', 'businessName' => '', 'businessDescription' => '',
        'businessCategory' => '', 'targetAudience' => '', 'services' => [],
        'valueProposition' => '', 'differentiators' => [],
        'primaryColor' => '', 'secondaryColor' => '', 'accentColor' => '',
        'textColor' => '', 'backgroundColor' => '', 'preferredStyle' => '',
        'logoUrl' => '', 'heroImage1' => '', 'heroImage1Context' => '',
        'heroImage2' => '', 'heroImage2Context' => '',
        'brandImage' => '', 'brandImageContext' => '',
        'sectionImage1' => '', 'sectionImage1Context' => '',
        'sectionImage2' => '', 'sectionImage2Context' => '',
        'sectionImage3' => '', 'sectionImage3Context' => '',
        'city' => '', 'country' => '', 'phone' => '', 'whatsapp' => '',
        'email' => '', 'facebook' => '', 'instagram' => '', 'twitter' => '',
        'linkedin' => '', 'youtube' => '',
        'designNotes' => '', 'headingFont' => '', 'bodyFont' => '',
    ];
    $extracted = array_merge($defaults, $aiResult);

    // PHP structural data always overrides AI guesses for these fields
    $phpWins = [
        'logoUrl', 'heroImage1', 'heroImage1Context', 'heroImage2', 'heroImage2Context',
        'brandImage', 'brandImageContext', 'sectionImage1', 'sectionImage1Context',
        'sectionImage2', 'sectionImage2Context', 'sectionImage3', 'sectionImage3Context',
        'phone', 'email', 'whatsapp', 'facebook', 'instagram', 'twitter', 'linkedin', 'youtube',
    ];
    foreach ($phpWins as $f) {
        if (!empty($preExtracted[$f])) $extracted[$f] = $preExtracted[$f];
    }
    // Fonts: Google Fonts detection is the ground truth
    if (!empty($preExtracted['headingFont'])) $extracted['headingFont'] = $preExtracted['headingFont'];
    if (!empty($preExtracted['bodyFont']))    $extracted['bodyFont']    = $preExtracted['bodyFont'];
    // Primary color: meta theme-color is the actual brand color
    if (!empty($preExtracted['primaryColor'])) $extracted['primaryColor'] = $preExtracted['primaryColor'];

    write_cache($cacheKey, $extracted);
    echo json_encode([
        'extracted' => $extracted,
        'fallback' => $usedFallbackExtraction,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $error) {
    $message = $error->getMessage();
    $status  = 500;

    // Stale cache fallback on transient AI errors — return old data rather than failing
    if (isset($cacheKey) && is_string($cacheKey) && $cacheKey !== '') {
        $stale = read_cache($cacheKey, true);
        if (is_array($stale) && (
            stripos($message, 'Rate limit') !== false       ||
            stripos($message, 'transport error') !== false  ||
            stripos($message, 'unavailable') !== false      ||
            stripos($message, 'AI gateway') !== false       ||
            stripos($message, 'timed out') !== false
        )) {
            echo json_encode(['extracted' => $stale, 'cached' => true, 'stale' => true], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    if (stripos($message, 'Rate limit exceeded') !== false) $status = 429;
    elseif (stripos($message, 'usage limit') !== false || stripos($message, 'credits') !== false) $status = 402;
    elseif (stripos($message, 'unavailable') !== false
         || stripos($message, 'transport error') !== false
         || stripos($message, 'AI gateway') !== false) $status = 503;
    elseif (stripos($message, 'Failed to fetch') !== false
         || stripos($message, 'not usable') !== false
         || stripos($message, 'Invalid URL') !== false) $status = 502;

    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
}
