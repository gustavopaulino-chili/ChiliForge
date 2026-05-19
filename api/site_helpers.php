<?php

function sanitize_slug($value) {
    $slug = strtolower(trim((string)$value));
    $slug = preg_replace('/[^a-z0-9-]+/', '-', $slug);
    $slug = preg_replace('/-+/', '-', $slug);
    $slug = trim($slug, '-');

    return $slug !== '' ? $slug : 'site';
}

function is_javascript_file_reference($value) {
    if (!is_string($value) || trim($value) === '') {
        return false;
    }

    $normalized = strtolower(trim($value));
    $path = strtolower((string)(parse_url($normalized, PHP_URL_PATH) ?: $normalized));

    return (bool)preg_match('/(^|\/)(script|app|main|bundle|index)[^\/]*\.js$/i', $path)
        || str_ends_with($path, '.js');
}

function normalize_asset_url($url) {
    if (!is_string($url)) {
        return '';
    }

    $normalized = trim($url);
    $normalized = str_replace('\/', '/', $normalized);
    $normalized = preg_replace('/\\+(?=$|["\'])/', '', $normalized);
    $normalized = trim((string)$normalized, " \t\n\r\0\x0B\"'");

    return is_string($normalized) ? $normalized : '';
}

function strip_editor_bridge_artifacts($html) {
    if (!is_string($html) || trim($html) === '') {
        return is_string($html) ? $html : '';
    }

    $clean = $html;

    // Remove injected editor bridge style/script blocks if present.
    $clean = preg_replace('/<style[^>]*id=["\']cf-editor-bridge-style["\'][^>]*>[\s\S]*?<\/style>/i', '', $clean);
    $clean = preg_replace('/<script[^>]*id=["\']cf-editor-bridge-script["\'][^>]*>[\s\S]*?<\/script>/i', '', $clean);
    $clean = preg_replace('/<base[^>]*id=["\']cf-editor-base["\'][^>]*>/i', '', $clean);

    // Remove editor element-marker attributes.
    $clean = preg_replace('/\s+data-cf-editor-id=["\'][^"\']*["\']/i', '', $clean);

    // Remove temporary selection classes from elements.
    $clean = preg_replace_callback('/\bclass=("|\')([^"\']*)(\1)/i', function ($matches) {
        $raw = trim((string)$matches[2]);
        if ($raw === '') {
            return $matches[0];
        }

        $classes = preg_split('/\s+/', $raw) ?: [];
        $filtered = array_values(array_filter($classes, function ($name) {
            return $name !== 'cf-editor-hover' && $name !== 'cf-editor-selected';
        }));

        if (count($filtered) === 0) {
            return '';
        }

        return 'class=' . $matches[1] . implode(' ', $filtered) . $matches[1];
    }, $clean);

    return is_string($clean) ? $clean : $html;
}

function is_inline_asset_data($value) {
    if (!is_string($value)) {
        return false;
    }

    return (bool)preg_match('/^data:(image|video|audio)\//i', trim($value));
}

function is_supported_asset_url($url) {
    $normalized = normalize_asset_url($url);
    if ($normalized === '') {
        return false;
    }

    if (is_inline_asset_data($normalized)) {
        return true;
    }

    if (!filter_var($normalized, FILTER_VALIDATE_URL)) {
        return false;
    }

    if (is_javascript_file_reference($normalized)) {
        return false;
    }

    // Only treat URLs as downloadable assets when they point to a media file.
    // Plain page URLs (social profiles, SVG namespaces, etc.) must not be mirrored.
    $path = strtolower((string)(parse_url($normalized, PHP_URL_PATH) ?: ''));
    $mediaExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif',
                        'heic', 'heif', 'bmp', 'tif', 'tiff',
                        'mp4', 'webm', 'ogg', 'mp3', 'wav',
                        'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'ico'];
    $ext = ltrim((string)pathinfo($path, PATHINFO_EXTENSION), '.');

    if (in_array($ext, $mediaExtensions, true)) {
        return true;
    }

    // Also accept URLs that have NO extension but come from known image CDN hosts,
    // or whose path looks like a CDN asset (UUID/hash-based paths, no file extension at all).
    // These are real image assets served by headless CMS / CDN platforms.
    $host = strtolower((string)(parse_url($normalized, PHP_URL_HOST) ?: ''));
    $knownImageCdns = [
        'datocms-assets.com', 'images.ctfassets.net', 'cdn.sanity.io',
        'res.cloudinary.com', 'assets.imgix.net', 'cdn.shopify.com',
        'images.squarespace-cdn.com', 'static.wixstatic.com',
        'storage.googleapis.com', 'amazonaws.com', 's3.amazonaws.com',
        'cdn.prod.website-files.com', 'framerusercontent.com',
        'media.graphassets.com', 'media.graphcms.com',
    ];
    foreach ($knownImageCdns as $cdnHost) {
        if ($host === $cdnHost || str_ends_with($host, '.' . $cdnHost)) {
            return true;
        }
    }

    // If no extension at all and path looks like a media asset slug (not a page URL),
    // accept it — download_remote_asset will detect the real type via Content-Type.
    if ($ext === '' && !str_contains($path, '.')) {
        // Reject obvious non-asset paths
        if (preg_match('#^/((?:article|post|page|blog|tag|category|author|search|feed|sitemap)(?:/|$))#i', $path)) {
            return false;
        }
        return true;
    }

    return false;
}

function resolve_sites_base_path() {
    $projectRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
    if ($projectRoot === false) {
        throw new RuntimeException('Could not resolve project root');
    }

    $publicRoot = $projectRoot . DIRECTORY_SEPARATOR . 'public';
    if (is_dir($publicRoot)) {
        return $publicRoot . DIRECTORY_SEPARATOR . 'projects';
    }

    return $projectRoot . DIRECTORY_SEPARATOR . 'projects';
}

function ensure_directory($path) {
    if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
        throw new RuntimeException('Failed to create directory: ' . $path);
    }
}

function ensure_unique_slug($slug, $basePath) {
    $candidate = sanitize_slug($slug);
    $suffix = 1;

    while (is_dir($basePath . DIRECTORY_SEPARATOR . $candidate)) {
        $candidate = sanitize_slug($slug) . '-' . $suffix;
        $suffix++;
    }

    return $candidate;
}

function extract_extension_from_url($url, $contentType = null) {
    $normalizedUrl = normalize_asset_url($url);
    if (is_inline_asset_data($normalizedUrl) && preg_match('/^data:([^;,]+)/i', $normalizedUrl, $matches)) {
        $contentType = $matches[1];
    }

    $map = [
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
        'image/svg+xml' => 'svg',
        'image/avif' => 'avif',
        'image/bmp' => 'bmp',
        'image/x-bmp' => 'bmp',
        'image/tiff' => 'tiff',
        'image/x-tiff' => 'tiff',
        'image/heic' => 'heic',
        'image/heif' => 'heif',
        'image/x-icon' => 'ico',
        'image/vnd.microsoft.icon' => 'ico',
        'video/mp4' => 'mp4',
        'video/webm' => 'webm',
        'video/ogg' => 'ogv',
        'audio/mpeg' => 'mp3',
        'audio/mp3' => 'mp3',
        'audio/wav' => 'wav',
        'audio/ogg' => 'ogg',
        'application/javascript' => 'js',
        'text/javascript' => 'js',
        'text/css' => 'css',
    ];

    // Determine extension from Content-Type first if provided.
    $ctExt = null;
    if ($contentType !== null && $contentType !== '') {
        $ctNorm = strtolower(trim(explode(';', (string)$contentType)[0]));
        $ctExt = $map[$ctNorm] ?? null;
    }

    // Determine extension from the URL path.
    $path = parse_url($normalizedUrl, PHP_URL_PATH) ?: '';
    $urlExt = preg_replace('/[^a-z0-9]+/', '', strtolower(pathinfo($path, PATHINFO_EXTENSION)));

    if ($urlExt !== '') {
        // CDNs commonly serve WebP/AVIF via format negotiation: the URL says .jpg but
        // Content-Type says image/webp. Trust Content-Type for these modern formats so
        // the file is saved with the correct extension and browsers can decode it.
        if ($ctExt !== null && $urlExt !== $ctExt && in_array($ctExt, ['webp', 'avif'], true)) {
            return $ctExt;
        }
        return $urlExt;
    }

    return $ctExt ?? 'bin';
}

function detect_asset_content_type($body, $fallbackContentType = null) {
    $fallback = '';
    if (is_string($fallbackContentType) && trim($fallbackContentType) !== '') {
        $fallback = strtolower(trim(explode(';', $fallbackContentType)[0]));
    }

    if (is_string($body) && trim(substr($body, 0, 512)) !== '') {
        $prefix = ltrim(substr($body, 0, 512));
        if (preg_match('/^<svg[\s>]/i', $prefix)) {
            return 'image/svg+xml';
        }
        if (preg_match('/^<(?:!doctype\s+html|html|head|body)\b/i', $prefix)) {
            return 'text/html';
        }
    }

    if (function_exists('finfo_open') && is_string($body) && $body !== '') {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $detected = finfo_buffer($finfo, $body);
            finfo_close($finfo);
            if (is_string($detected) && $detected !== '' && $detected !== 'application/octet-stream') {
                return strtolower($detected);
            }
        }
    }

    return $fallback ?: 'application/octet-stream';
}

function is_safe_asset_content_type($contentType) {
    $normalized = strtolower(trim(explode(';', (string)$contentType)[0]));
    if ($normalized === '') {
        return false;
    }

    if (str_starts_with($normalized, 'image/')) {
        return true;
    }

    return in_array($normalized, [
        'application/pdf',
        'font/woff',
        'font/woff2',
        'font/ttf',
        'font/otf',
        'application/font-woff',
        'application/font-woff2',
        'application/vnd.ms-fontobject',
        'video/mp4',
        'video/webm',
        'video/ogg',
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
    ], true);
}

function download_remote_asset($url) {
    $normalizedUrl = normalize_asset_url($url);
    if (is_inline_asset_data($normalizedUrl)) {
        if (!preg_match('/^data:([^;,]+)(;base64)?,(.*)$/is', $normalizedUrl, $matches)) {
            return null;
        }

        $contentType = trim((string)$matches[1]) ?: 'application/octet-stream';
        $encodedBody = $matches[3] ?? '';
        $body = isset($matches[2]) && $matches[2] === ';base64'
            ? base64_decode($encodedBody, true)
            : rawurldecode($encodedBody);

        if ($body === false || $body === '') {
            return null;
        }

        return [
            'body' => $body,
            'content_type' => $contentType,
        ];
    }

    if (!filter_var($normalizedUrl, FILTER_VALIDATE_URL)) {
        return null;
    }

    $headers = [];
    $body = false;

    if (function_exists('curl_init')) {
        $ch = curl_init($normalizedUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; ChiliForgeSitePublisher/1.0)',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_HTTPHEADER => [
                'Accept: image/webp,image/avif,image/jpeg,image/png,image/*,*/*;q=0.8',
                'Accept-Language: en-US,en;q=0.9',
                'Referer: https://chiliforgepublisher.com/',
            ],
            CURLOPT_HEADERFUNCTION => function ($curl, $headerLine) use (&$headers) {
                $length = strlen($headerLine);
                $parts = explode(':', $headerLine, 2);
                if (count($parts) === 2) {
                    $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return $length;
            },
        ]);

        $body = curl_exec($ch);
        $statusCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($body === false || $statusCode >= 400) {
            curl_close($ch);
            return null;
        }
        curl_close($ch);
    } else {
        $context = stream_context_create([
            'http' => [
                'timeout' => 20,
                'ignore_errors' => true,
                'header' => "User-Agent: ChiliForgeSitePublisher/1.0\r\n",
            ],
        ]);
        $body = @file_get_contents($normalizedUrl, false, $context);
        if ($body === false) {
            return null;
        }
    }

    $contentType = detect_asset_content_type($body, $headers['content-type'] ?? null);

    return [
        'body' => $body,
        'content_type' => $contentType,
    ];
}

function extract_javascript_references_from_content($content) {
    if (!is_string($content) || trim($content) === '') {
        return [];
    }

    $found = [];

    if (preg_match_all('/<script[^>]+src=["\']([^"\']+\.js(?:\?[^"\']*)?)["\'][^>]*><\/script>/i', $content, $matches)) {
        foreach ($matches[1] as $match) {
            if (is_string($match) && trim($match) !== '') {
                $found[] = trim($match);
            }
        }
    }

    if (preg_match_all('/(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']/i', $content, $matches)) {
        foreach ($matches[1] as $match) {
            if (is_string($match) && trim($match) !== '') {
                $found[] = trim($match);
            }
        }
    }

    return array_values(array_unique(array_filter($found, 'is_javascript_file_reference')));
}

function rewrite_javascript_references_to_root_script($content) {
    if (!is_string($content) || trim($content) === '') {
        return $content;
    }

    $content = preg_replace('/<script[^>]+src=["\'][^"\']+\.js(?:\?[^"\']*)?["\'][^>]*><\/script>/i', '', $content);
    $content = preg_replace('/((?:src|href)=["\'])[^"\']+\.js(?:\?[^"\']*)?(["\'])/i', '$1script.js$2', $content);

    return $content;
}

function build_root_script_content($js, $javascriptReferences) {
    $inlineJs = is_string($js) ? trim($js) : '';
    if ($inlineJs !== '') {
        return $inlineJs;
    }

    $downloadedScripts = [];
    foreach ($javascriptReferences as $reference) {
        if (!filter_var($reference, FILTER_VALIDATE_URL)) {
            continue;
        }

        $downloaded = download_remote_asset($reference);
        if ($downloaded === null || !isset($downloaded['body'])) {
            continue;
        }

        $body = trim((string)$downloaded['body']);
        if ($body !== '') {
            $downloadedScripts[] = $body;
        }
    }

    return implode("\n\n", $downloadedScripts);
}

function replace_asset_paths($content, $map) {
    if (!$content || empty($map)) {
        return $content;
    }

    $search = [];
    $replace = [];

    foreach ($map as $originalUrl => $relativePath) {
        $normalizedUrl = normalize_asset_url($originalUrl);
        if ($normalizedUrl === '') {
            continue;
        }

        $replacementCandidates = [
            $originalUrl,
            $normalizedUrl,
            addslashes($normalizedUrl),
            str_replace('/', '\/', $normalizedUrl),
            $originalUrl . '\\',
            $normalizedUrl . '\\',
            addslashes($normalizedUrl) . '\\',
            str_replace('/', '\/', $normalizedUrl) . '\\',
        ];

        foreach ($replacementCandidates as $candidate) {
            if (!is_string($candidate) || $candidate === '' || in_array($candidate, $search, true)) {
                continue;
            }

            $search[] = $candidate;
            $replace[] = $relativePath;
        }
    }

    return str_replace($search, $replace, $content);
}

function is_placeholder_asset_url($url) {
    $normalized = normalize_asset_url($url);
    if ($normalized === '') {
        return false;
    }

    // NOTE: Pexels images (images.pexels.com, www.pexels.com) are intentionally excluded —
    // they are real image assets that should be downloaded and mirrored like any other image.
    return (bool)preg_match('/^https?:\/\/(?:placehold\.co|via\.placeholder\.com|picsum\.photos|images\.unsplash\.com|source\.unsplash\.com|cdn\.pixabay\.com|pixabay\.com|images\.freepik\.com|img\.freepik\.com)\b/i', $normalized);
}

function replace_placeholder_asset_paths($content, $fallbackPaths) {
    if (!is_string($content) || trim($content) === '' || !is_array($fallbackPaths) || count($fallbackPaths) === 0) {
        return $content;
    }

    $paths = array_values(array_unique(array_filter($fallbackPaths, 'strlen')));
    if (count($paths) === 0) {
        return $content;
    }

    $index = 0;
    $nextPath = function () use (&$index, $paths) {
        $path = $paths[min($index, count($paths) - 1)];
        $index++;
        return $path;
    };

    $content = preg_replace_callback(
        '/((?:src|data-src|poster)=["\'])(https?:\/\/[^"\']+)(["\'])/i',
        function ($matches) use ($nextPath) {
            return is_placeholder_asset_url($matches[2])
                ? $matches[1] . $nextPath() . $matches[3]
                : $matches[0];
        },
        $content
    );

    $content = preg_replace_callback(
        '/(url\((["\']?))(https?:\/\/[^"\')\s]+)((?:["\']?)\))/i',
        function ($matches) use ($nextPath) {
            return is_placeholder_asset_url($matches[3])
                ? $matches[1] . $nextPath() . $matches[4]
                : $matches[0];
        },
        $content
    );

    $content = preg_replace_callback('/srcset=["\']([^"\']+)["\']/i', function ($matches) use ($nextPath) {
        $entries = explode(',', $matches[1]);
        $rewritten = [];
        foreach ($entries as $entry) {
            $parts = preg_split('/\s+/', trim($entry));
            $candidate = $parts[0] ?? '';
            $descriptor = isset($parts[1]) ? ' ' . $parts[1] : '';
            if (is_placeholder_asset_url($candidate)) {
                $rewritten[] = $nextPath() . $descriptor;
            } else {
                $rewritten[] = trim($entry);
            }
        }
        return 'srcset="' . implode(', ', $rewritten) . '"';
    }, $content);

    return $content;
}

function extract_asset_urls_from_content($content) {
    if (!is_string($content) || trim($content) === '') {
        return [];
    }

    $found = [];
    $patterns = [
        '/(?:src|data-src|poster)=["\'](https?:\/\/[^"\']+)["\']/i',
        '/(?:src|data-src|poster)=["\'](data:(?:image|video|audio)\/[^"\']+)["\']/i',
        '/srcset=["\']([^"\']+)["\']/i',
        '/url\((["\']?)(https?:\/\/[^"\')\s]+)\1\)/i',
        '/url\((["\']?)(data:(?:image|video|audio)\/[^"\')\s]+)\1\)/i',
    ];

    foreach ($patterns as $pattern) {
        if (!preg_match_all($pattern, $content, $matches, PREG_SET_ORDER)) {
            continue;
        }

        foreach ($matches as $match) {
            if (stripos($pattern, 'srcset=') !== false) {
                $entries = explode(',', $match[1]);
                foreach ($entries as $entry) {
                    $parts = preg_split('/\s+/', trim($entry));
                    $candidate = !empty($parts[0]) ? normalize_asset_url($parts[0]) : '';
                    if ($candidate !== '' && (filter_var($candidate, FILTER_VALIDATE_URL) || is_inline_asset_data($candidate))) {
                        if (!is_javascript_file_reference($candidate)) {
                            $found[] = $candidate;
                        }
                    }
                }
                continue;
            }

            $candidate = normalize_asset_url((string)end($match));
            if ($candidate !== '' && (filter_var($candidate, FILTER_VALIDATE_URL) || is_inline_asset_data($candidate)) && !is_javascript_file_reference($candidate)) {
                $found[] = $candidate;
            }
        }
    }

    return array_values(array_unique($found));
}

function extract_unmirrored_asset_urls_from_content($content) {
    if (!is_string($content) || trim($content) === '') {
        return [];
    }

    $found = [];
    if (preg_match_all('/https?:\/\/[^"\'\s)]+/i', $content, $matches)) {
        foreach ($matches[0] as $match) {
            $candidate = normalize_asset_url($match);
            if (is_supported_asset_url($candidate) || is_placeholder_asset_url($candidate)) {
                $found[] = $candidate;
            }
        }
    }

    return array_values(array_unique($found));
}

function extract_asset_urls_from_form_data($formData) {
    if (!is_array($formData)) {
        return [];
    }

    $found = [];
    $collectCandidate = function ($value) use (&$found) {
        if (!is_string($value)) {
            return;
        }

        $candidate = normalize_asset_url($value);
        if ($candidate !== '' && is_supported_asset_url($candidate)) {
            $found[] = $candidate;
        }
    };

    foreach (['logoUrl', 'productImageUrl', 'backgroundImageUrl'] as $key) {
        $collectCandidate($formData[$key] ?? '');
    }

    foreach (['productImageVariants', 'backgroundImageVariants'] as $key) {
        if (!isset($formData[$key]) || !is_array($formData[$key])) {
            continue;
        }

        foreach ($formData[$key] as $value) {
            $collectCandidate($value);
        }
    }

    if (isset($formData['logoVariants']) && is_array($formData['logoVariants'])) {
        foreach ($formData['logoVariants'] as $variant) {
            if (is_array($variant)) {
                $collectCandidate($variant['url'] ?? '');
            } else {
                $collectCandidate($variant);
            }
        }
    }

    if (isset($formData['images']) && is_array($formData['images'])) {
        $images = $formData['images'];

        foreach ($images as $key => $value) {
            if (str_ends_with((string)$key, 'Width') || str_ends_with((string)$key, 'Height')) {
                continue;
            }

            if (is_string($value)) {
                $collectCandidate($value);
                continue;
            }

            if (is_array($value)) {
                foreach ($value as $item) {
                    if (is_string($item)) {
                        $collectCandidate($item);
                    } elseif (is_array($item)) {
                        $collectCandidate($item['url'] ?? '');
                    }
                }
            }
        }
    }

    if (isset($formData['downloadFiles']) && is_array($formData['downloadFiles'])) {
        foreach ($formData['downloadFiles'] as $fileItem) {
            if (!is_array($fileItem)) {
                continue;
            }
            $collectCandidate($fileItem['url'] ?? '');
        }
    }

    return array_values(array_unique($found));
}

function replace_remaining_remote_assets_with_placeholder($content, $placeholderPath) {
    if (!is_string($content) || trim($content) === '') {
        return $content;
    }

    $content = preg_replace('/((?:src|data-src)=["\'])https?:\/\/[^"\']+(["\'])/i', '$1' . $placeholderPath . '$2', $content);
    $content = preg_replace('/(url\((["\']?))https?:\/\/[^"\')\s]+((?:["\']?)\))/i', '$1' . $placeholderPath . '$3', $content);
    $content = preg_replace_callback('/srcset=["\']([^"\']+)["\']/i', function ($matches) use ($placeholderPath) {
        $entries = explode(',', $matches[1]);
        $rewritten = [];
        foreach ($entries as $entry) {
            $parts = preg_split('/\s+/', trim($entry));
            $descriptor = isset($parts[1]) ? ' ' . $parts[1] : '';
            $rewritten[] = $placeholderPath . $descriptor;
        }
        return 'srcset="' . implode(', ', $rewritten) . '"';
    }, $content);

    return $content;
}

function build_hosted_html($title, $html, $css, $js) {
    $safeTitle = htmlspecialchars($title ?: 'Generated Site', ENT_QUOTES, 'UTF-8');
    $bodyHtml = trim((string)$html) !== '' ? rewrite_javascript_references_to_root_script($html) : '<div>Fallback</div>';

    return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>{$safeTitle}</title>\n  <script>\n    (function () {\n      var p = window.location.pathname || '';\n      if (p && !p.endsWith('/') && !/\\.[a-z0-9]+$/i.test(p)) {\n        window.location.replace(p + '/' + window.location.search + window.location.hash);\n      }\n    })();\n  </script>\n  <link rel=\"stylesheet\" href=\"./style.css\">\n</head>\n<body>\n{$bodyHtml}\n<script src=\"./script.js\"></script>\n</body>\n</html>\n";
}

function path_starts_with($path, $prefix) {
    $normalizedPath = str_replace('\\', '/', (string)$path);
    $normalizedPrefix = str_replace('\\', '/', (string)$prefix);
    return strncmp($normalizedPath, $normalizedPrefix, strlen($normalizedPrefix)) === 0;
}

function extract_slug_from_public_url($publicUrl) {
    if (!is_string($publicUrl) || trim($publicUrl) === '') {
        return '';
    }

    $path = parse_url($publicUrl, PHP_URL_PATH);
    if (!is_string($path) || trim($path) === '') {
        $path = $publicUrl;
    }

    $trimmed = trim(str_replace('\\', '/', $path));
    $trimmed = preg_replace('#/index\.html$#i', '/', $trimmed);
    $trimmed = trim((string)$trimmed, '/');
    if ($trimmed === '') {
        return '';
    }

    $segments = array_values(array_filter(explode('/', $trimmed), 'strlen'));
    if (count($segments) < 2) {
        return '';
    }

    if (strtolower($segments[0]) !== 'projects') {
        return '';
    }

    return sanitize_slug($segments[1]);
}

function extract_project_relative_path_from_public_url($publicUrl) {
    if (!is_string($publicUrl) || trim($publicUrl) === '') {
        return '';
    }

    $path = parse_url($publicUrl, PHP_URL_PATH);
    if (!is_string($path) || trim($path) === '') {
        $path = $publicUrl;
    }

    $trimmed = trim(str_replace('\\', '/', $path));
    $trimmed = preg_replace('#/index\.html$#i', '/', $trimmed);
    $segments = array_values(array_filter(explode('/', trim((string)$trimmed, '/')), 'strlen'));
    if (count($segments) < 2 || strtolower((string)$segments[0]) !== 'projects') {
        return '';
    }

    $relativeSegments = [];
    foreach (array_slice($segments, 1) as $segment) {
        $safe = sanitize_slug((string)$segment);
        if ($safe !== '') {
            $relativeSegments[] = $safe;
        }
    }

    return implode('/', $relativeSegments);
}

function extract_project_relative_path_from_folder_path($folderPath) {
    if (!is_string($folderPath) || trim($folderPath) === '') {
        return '';
    }

    $normalized = trim(str_replace('\\', '/', $folderPath));
    $normalized = preg_replace('#/index\.html$#i', '', (string)$normalized);
    $normalized = trim((string)$normalized, '/');
    if ($normalized === '' || strpos($normalized, '..') !== false) {
        return '';
    }

    if (path_starts_with($normalized, 'public/projects/')) {
        $normalized = substr($normalized, strlen('public/projects/'));
    } elseif (path_starts_with($normalized, 'projects/')) {
        $normalized = substr($normalized, strlen('projects/'));
    } else {
        $parts = array_values(array_filter(explode('/', $normalized), 'strlen'));
        $projectsIndex = -1;
        foreach ($parts as $index => $part) {
            if (strtolower((string)$part) === 'projects') {
                $projectsIndex = $index;
            }
        }
        if ($projectsIndex >= 0) {
            $normalized = implode('/', array_slice($parts, $projectsIndex + 1));
        }
    }

    $segments = array_values(array_filter(explode('/', trim((string)$normalized, '/')), 'strlen'));
    $safeSegments = [];
    foreach ($segments as $segment) {
        $safe = sanitize_slug((string)$segment);
        if ($safe !== '') {
            $safeSegments[] = $safe;
        }
    }

    return implode('/', $safeSegments);
}

function project_public_prefix_from_folder_path($folderPath, $publicUrl = '') {
    $relative = extract_project_relative_path_from_folder_path($folderPath);
    if ($relative === '') {
        $relative = extract_project_relative_path_from_public_url($publicUrl);
    }

    return $relative !== '' ? '/projects/' . trim($relative, '/') . '/' : '';
}

function project_folder_path_from_relative($relativePath) {
    $relative = trim(str_replace('\\', '/', (string)$relativePath), '/');
    return $relative !== '' ? '/public/projects/' . $relative : '';
}

function project_public_url_from_relative($relativePath) {
    $relative = trim(str_replace('\\', '/', (string)$relativePath), '/');
    return $relative !== '' ? '/projects/' . $relative . '/' : '';
}

function project_directory_from_relative($relativePath) {
    $relative = trim(str_replace('\\', '/', (string)$relativePath), '/');
    if ($relative === '' || strpos($relative, '..') !== false) {
        throw new RuntimeException('Invalid project path.');
    }

    return resolve_sites_base_path() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
}

function resolve_project_directory_from_folder_path($folderPath, $publicUrl = '') {
    $sitesBasePath = resolve_sites_base_path();
    ensure_directory($sitesBasePath);

    $projectRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . '..');
    if ($projectRoot === false) {
        throw new RuntimeException('Could not resolve project root');
    }

    $publicProjectsPath = $projectRoot . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'projects';
    $projectsPath = $projectRoot . DIRECTORY_SEPARATOR . 'projects';

    $normalizedFolder = trim(str_replace('\\', '/', (string)$folderPath));
    $normalizedFolder = preg_replace('#/index\.html$#i', '', $normalizedFolder);
    $normalizedFolder = trim((string)$normalizedFolder, '/');

    $candidates = [];

    if ($normalizedFolder !== '') {
        $candidates[] = $normalizedFolder;

        if (path_starts_with($normalizedFolder, 'public/projects/')) {
            $candidates[] = substr($normalizedFolder, strlen('public/projects/'));
        }

        if (path_starts_with($normalizedFolder, 'projects/')) {
            $candidates[] = substr($normalizedFolder, strlen('projects/'));
        }

        $segments = array_values(array_filter(explode('/', $normalizedFolder), 'strlen'));
        if (!empty($segments)) {
            $candidates[] = end($segments);
        }
    }

    $relativeFromUrl = extract_project_relative_path_from_public_url($publicUrl);
    if ($relativeFromUrl !== '') {
        $candidates[] = $relativeFromUrl;
    }

    $slugFromUrl = extract_slug_from_public_url($publicUrl);
    if ($slugFromUrl !== '' && $slugFromUrl !== $relativeFromUrl) {
        $candidates[] = $slugFromUrl;
    }

    $candidates = array_values(array_unique(array_filter($candidates, 'strlen')));

    foreach ($candidates as $candidate) {
        $safe = trim(str_replace('\\', '/', (string)$candidate), '/');
        if ($safe === '' || strpos($safe, '..') !== false) {
            continue;
        }

        $tryPaths = [
            $sitesBasePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $safe),
            $publicProjectsPath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $safe),
            $projectsPath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $safe),
        ];

        foreach ($tryPaths as $tryPath) {
            if (is_dir($tryPath)) {
                return $tryPath;
            }
        }
    }

    throw new RuntimeException('Generated project directory was not found.');
}

function build_editor_document_from_project($projectDir, $fallbackHtml = '') {
    $projectDir = (string)$projectDir;
    $fallbackHtml = (string)$fallbackHtml;

    $indexPath = $projectDir . DIRECTORY_SEPARATOR . 'index.html';
    $html = is_file($indexPath) ? (string)file_get_contents($indexPath) : $fallbackHtml;

    return trim($html) !== '' ? $html : $fallbackHtml;
}

function sanitize_filename_component($value) {
    $name = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)$value);
    $name = trim((string)$name, '-_. ');
    return $name !== '' ? $name : 'project';
}

function build_project_zip_archive($projectPath, $projectName) {
    if (!is_dir($projectPath)) {
        throw new RuntimeException('Project directory was not found.');
    }

    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('ZipArchive extension is not available on this server.');
    }

    $safeName = sanitize_filename_component($projectName);
    $tempFile = tempnam(sys_get_temp_dir(), 'chiliforge_zip_');
    if ($tempFile === false) {
        throw new RuntimeException('Could not create temporary zip file.');
    }

    $zipPath = $tempFile . '.zip';
    if (file_exists($zipPath)) {
        @unlink($zipPath);
    }

    $zip = new ZipArchive();
    $openResult = $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    if ($openResult !== true) {
        @unlink($tempFile);
        throw new RuntimeException('Failed to create zip archive.');
    }

    $baseLen = strlen(rtrim($projectPath, DIRECTORY_SEPARATOR)) + 1;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($projectPath, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    $fileCount = 0;
    foreach ($iterator as $fileInfo) {
        if (!$fileInfo->isFile()) {
            continue;
        }

        $absolutePath = $fileInfo->getPathname();
        $relativePath = substr($absolutePath, $baseLen);
        $relativePath = str_replace('\\', '/', $relativePath);
        if ($relativePath === '' || strpos($relativePath, '..') !== false) {
            continue;
        }

        $zip->addFile($absolutePath, $relativePath);
        $fileCount++;
    }

    $zip->close();
    @unlink($tempFile);

    if ($fileCount === 0) {
        @unlink($zipPath);
        throw new RuntimeException('Project directory is empty.');
    }

    return [
        'path' => $zipPath,
        'filename' => $safeName . '.zip',
    ];
}

/**
 * Find a project by ID for a given user.
 *
 * First tries exact user_id match (fast path). If that returns nothing, falls
 * back to an email-based join so that accounts whose numeric IDs drifted after
 * a database migration can still access their projects.
 *
 * Returns an associative array of the requested project columns plus
 * 'actual_user_id' (the real owner's user_id from the DB), or null when no
 * matching project exists.
 *
 * @param mysqli  $conn
 * @param int     $projectId
 * @param int     $userId     The user_id from the current session (may differ from DB after migration)
 * @param string  $columns    Comma-separated list of columns to SELECT (prefixed with p. as needed)
 */
function normalize_project_lookup_columns(string $columns): string {
    $normalized = $columns;
    $replacements = [
        'p.public_url' => 'COALESCE(NULLIF(l.public_url, \'\'), NULLIF(p.public_url, \'\')) AS public_url',
        'p.folder_path' => 'COALESCE(NULLIF(l.folder_path, \'\'), NULLIF(p.folder_path, \'\')) AS folder_path',
        'p.form_data' => 'l.form_data',
        'p.generated_html' => 'l.generated_html',
        'p.current_step' => 'l.current_step',
    ];

    foreach ($replacements as $from => $to) {
        $normalized = str_ireplace($from, $to, $normalized);
    }

    return trim($normalized) !== '' ? $normalized : 'p.id';
}

function normalize_project_lookup_row(?array $row): ?array {
    if (!$row) {
        return null;
    }

    if (trim((string)($row['folder_path'] ?? '')) === '' && trim((string)($row['public_url'] ?? '')) !== '') {
        $relative = extract_project_relative_path_from_public_url((string)$row['public_url']);
        if ($relative !== '') {
            $row['folder_path'] = project_folder_path_from_relative($relative);
        }
    }

    return $row;
}

function find_latest_ad_campaign_for_project(mysqli $conn, int $projectId): ?array {
    if ($projectId <= 0) {
        return null;
    }

    $stmt = $conn->prepare(
        "SELECT id, form_data, public_url, current_step, status, metadata
         FROM ads_campaign
         WHERE project_id = ?
         ORDER BY id DESC
         LIMIT 1"
    );
    if (!$stmt) {
        return null;
    }

    $stmt->bind_param("i", $projectId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = ($result !== false) ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$row) {
        return null;
    }

    if (trim((string)($row['public_url'] ?? '')) !== '') {
        $relative = extract_project_relative_path_from_public_url((string)$row['public_url']);
        if ($relative !== '') {
            $row['folder_path'] = project_folder_path_from_relative($relative);
        }
    }

    return $row;
}

function find_project_for_user(mysqli $conn, int $projectId, int $userId, string $columns = 'p.id'): ?array {
    if ($projectId <= 0 || $userId <= 0) {
        return null;
    }

    $columns = normalize_project_lookup_columns($columns);
    $lpCols = "COALESCE(NULLIF(l.folder_path, ''), NULLIF(p.folder_path, '')) AS folder_path,
        COALESCE(NULLIF(l.public_url, ''), NULLIF(p.public_url, '')) AS public_url,
        l.form_data,
        l.generated_html,
        l.current_step,
        l.id AS lp_id,
        p.company_form_data,
        p.context,
        p.project_type";

    // Fast path: exact user_id match
    $stmt = $conn->prepare(
        "SELECT {$columns}, {$lpCols}, p.user_id AS actual_user_id
         FROM projects p
         LEFT JOIN lps l ON l.project_id = p.id
         WHERE p.id = ? AND p.user_id = ? LIMIT 1"
    );
    if (!$stmt) {
        return null;
    }
    $stmt->bind_param("ii", $projectId, $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = ($result !== false) ? $result->fetch_assoc() : null;
    $stmt->close();
    if ($row) {
        $row = normalize_project_lookup_row($row);
        if (($row['project_type'] ?? '') === 'ad_creative') {
            $campaign = find_latest_ad_campaign_for_project($conn, $projectId);
            if ($campaign) {
                $row['campaign_id'] = (int)($campaign['id'] ?? 0);
                $row['public_url'] = (string)($campaign['public_url'] ?? '');
                $row['folder_path'] = (string)($campaign['folder_path'] ?? '');
                $row['form_data'] = (string)($campaign['form_data'] ?? '{}');
                $row['current_step'] = (int)($campaign['current_step'] ?? 0);
            }
        }
        return $row;
    }

    // Email-based fallback: handles accounts whose numeric IDs drifted after a migration.
    $stmt2 = $conn->prepare(
        "SELECT {$columns}, {$lpCols}, p.user_id AS actual_user_id
         FROM projects p
         LEFT JOIN lps l ON l.project_id = p.id
         JOIN users pu ON pu.id = p.user_id
         JOIN users cu ON cu.id = ?
         WHERE p.id = ? AND LOWER(pu.email) = LOWER(cu.email)
         LIMIT 1"
    );
    if (!$stmt2) {
        return null;
    }
    $stmt2->bind_param("ii", $userId, $projectId);
    $stmt2->execute();
    $result2 = $stmt2->get_result();
    $row2 = ($result2 !== false) ? $result2->fetch_assoc() : null;
    $stmt2->close();
    $row2 = normalize_project_lookup_row($row2);
    if ($row2 && ($row2['project_type'] ?? '') === 'ad_creative') {
        $campaign = find_latest_ad_campaign_for_project($conn, $projectId);
        if ($campaign) {
            $row2['campaign_id'] = (int)($campaign['id'] ?? 0);
            $row2['public_url'] = (string)($campaign['public_url'] ?? '');
            $row2['folder_path'] = (string)($campaign['folder_path'] ?? '');
            $row2['form_data'] = (string)($campaign['form_data'] ?? '{}');
            $row2['current_step'] = (int)($campaign['current_step'] ?? 0);
        }
    }
    return $row2;
}
