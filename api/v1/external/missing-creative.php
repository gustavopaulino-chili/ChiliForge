<?php
/**
 * Missing-creative responder.
 *
 * The .htaccess internally rewrites requests for image/video files under
 * /projects/** that DO NOT exist on disk to this script. Without it, those
 * requests fall through to the SPA shell (/index.html) and return HTTP 200 +
 * text/html — the React login page. External fetchers such as the Meta Graph
 * API crawler (facebookexternalhit) then cache that HTML as "the media" and
 * reject the URL with "Only photo or video can be accepted as media type"
 * (code 9004 / subcode 2207052).
 *
 * Returning a real 404 (never a 200 web page) lets the crawler fail cleanly and
 * retry later, once the creative file has actually been written.
 */

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Robots-Tag: noindex');
echo "Not Found";
