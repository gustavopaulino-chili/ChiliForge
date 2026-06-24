<?php
/**
 * External API — add/replace COMPANY assets & info (reference images + logo + brand fields).
 *
 * POST {
 *   api_key | Authorization: Bearer,
 *   phone,
 *   company?,
 *   logo_url?,
 *   reference_images?[],      — generic reference images (legacy)
 *   brand_posts?[],           — Instagram posts from the brand's own profile (up to 12)
 *   competitor_posts?[],      — Instagram posts from a competitor's profile (up to 8)
 *   gemini_api_key?,          — required when brand_posts or competitor_posts are provided
 * }
 *
 * - Finds/creates the company (project_type='project') by (user_id, phone).
 * - Mirrors all images to the company's assets folder (URLs OR data: URIs → hosted files).
 *   Anti-base64: NO base64 is ever stored or forwarded to Gemini.
 * - brand_posts are analyzed by Gemini (brand_visual mode) → produces a rich 300-400 word
 *   visual identity brief stored as brandVisualBrief in company_form_data. This brief drives
 *   every future compose generation, giving the image model the brand's real aesthetic DNA
 *   (motifs, depth treatment, color system, design devices) from the Instagram profile.
 * - competitor_posts are analyzed for LAYOUT PATTERNS ONLY — competitor brand identity never
 *   bleeds into the brand's ads.
 * - brandVisualBrief accumulates across calls (new posts merged with existing).
 * - Re-syncs the company Gemini File Search store once per call (cost-aware).
 */
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

set_time_limit(180);
ini_set('memory_limit', '256M');

include __DIR__ . '/../../db.php';
include __DIR__ . '/../agents/helpers.php';
include __DIR__ . '/../../site_helpers.php';

const CAA_MAX_IMAGES        = 12;   // per request (reference_images)
const CAA_MAX_BRAND_POSTS   = 12;   // brand_posts per request
const CAA_MAX_COMP_POSTS    = 8;    // competitor_posts per request
const CAA_MAX_BYTES         = 8000000; // 8 MB per image (decoded)
const CAA_MAX_STORED        = 24;   // cap referenceImages kept on the company
const CAA_MAX_BRAND_STORED  = 20;   // cap brandPostImages accumulated on the company
const CAA_MAX_COMP_STORED   = 12;   // cap competitorPostImages accumulated on the company
// No custom request rate limit: the only upstream cost here is the Gemini store sync, which
// already handles Gemini's own 429/rate-limit gracefully (kept as a warning, never fatal).

function caa_fail(int $code, string $msg, string $errCode = ''): void {
    http_response_code($code);
    echo json_encode(array_filter(['success' => false, 'error' => $msg, 'code' => $errCode]), JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
$hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if ($hdr === '' && function_exists('getallheaders')) { $h = getallheaders(); $hdr = $h['Authorization'] ?? $h['authorization'] ?? ''; }
$apiKey = '';
if (preg_match('/Bearer\s+(.+)/i', (string)$hdr, $m)) $apiKey = trim($m[1]);

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) caa_fail(400, 'Invalid JSON body.');
if ($apiKey === '') $apiKey = trim((string)($body['api_key'] ?? ''));
if ($apiKey === '') caa_fail(401, 'Missing API key.', 'auth');

$authStmt = $conn->prepare("SELECT k.user_id, u.account_type FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.api_key = ? AND k.is_active = 1 LIMIT 1");
$authStmt->bind_param('s', $apiKey);
$authStmt->execute();
$authStmt->bind_result($userId, $accountType);
if (!$authStmt->fetch()) { $authStmt->close(); caa_fail(401, 'Invalid or inactive API key.', 'auth'); }
$authStmt->close();
$userId = (int)$userId;
$accountType = ($accountType === 'admin') ? 'admin' : 'testing';
if ($uu = $conn->prepare("UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = NOW() WHERE api_key = ?")) {
    $uu->bind_param('s', $apiKey); $uu->execute(); $uu->close();
}

// ── Validate input ───────────────────────────────────────────────────────────
$phone = trim((string)($body['phone'] ?? ''));
if ($phone === '') caa_fail(400, 'phone is required (company identifier).', 'missing_phone');

$company = is_array($body['company'] ?? null) ? $body['company'] : [];
$refInputs = [];
if (is_array($body['reference_images'] ?? null)) $refInputs = $body['reference_images'];
$logoInput = trim((string)($body['logo_url'] ?? ($company['logo_url'] ?? ($company['logo'] ?? ''))));

// Instagram post images — processed separately from generic reference_images.
// brand_posts: scraped from the brand's OWN Instagram profile. Gemini analyzes them
//   and produces a rich 300-400 word visual identity brief (brandVisualBrief) stored in
//   company_form_data. This brief drives every future compose generation.
// competitor_posts: scraped from a COMPETITOR's Instagram profile. Analyzed for layout
//   and composition patterns only — brand identity is never extracted from competitor content.
$brandPostInputs = is_array($body['brand_posts'] ?? null) ? array_values($body['brand_posts']) : [];
$compPostInputs  = is_array($body['competitor_posts'] ?? null) ? array_values($body['competitor_posts']) : [];
$geminiApiKey    = trim((string)($body['gemini_api_key'] ?? ''));

// Legacy text description fields (kept for backwards-compat; image-based analysis is preferred).
$brandVisualGuidelines = trim((string)($body['brand_visual_guidelines'] ?? ($company['brand_visual_guidelines'] ?? '')));
$competitorExamples    = trim((string)($body['competitor_examples']     ?? ($company['competitor_examples']     ?? '')));

if (count($refInputs) > CAA_MAX_IMAGES)
    caa_fail(400, 'Too many reference_images (max ' . CAA_MAX_IMAGES . ' per call).', 'too_many');
if (count($brandPostInputs) > CAA_MAX_BRAND_POSTS)
    caa_fail(400, 'Too many brand_posts (max ' . CAA_MAX_BRAND_POSTS . ' per call).', 'too_many_brand');
if (count($compPostInputs) > CAA_MAX_COMP_POSTS)
    caa_fail(400, 'Too many competitor_posts (max ' . CAA_MAX_COMP_POSTS . ' per call).', 'too_many_comp');
if ((!empty($brandPostInputs) || !empty($compPostInputs)) && $geminiApiKey === '')
    caa_fail(400, 'gemini_api_key is required when brand_posts or competitor_posts are provided.', 'missing_gemini_key');

try {
    // ── Find/create company (project_type='project') by (user_id, phone) ──────
    $compStmt = $conn->prepare(
        "SELECT id, gemini_store_name, company_form_data, folder_path, public_url
         FROM projects WHERE user_id = ? AND phone = ? AND project_type = 'project' LIMIT 1"
    );
    $compStmt->bind_param('is', $userId, $phone);
    $compStmt->execute();
    $compStmt->bind_result($companyId, $storeName, $formDataJson, $folderPath, $publicUrl);
    $found = $compStmt->fetch();
    $compStmt->close();

    $formData = $found ? (json_decode((string)$formDataJson, true) ?: []) : [];
    if (!is_array($formData)) $formData = [];

    if (!$found) {
        $companyName = trim((string)($company['name'] ?? 'Company')) ?: 'Company';
        $ctx = trim((string)($company['description'] ?? ''));
        $ins = $conn->prepare("INSERT INTO projects (user_id, name, project_type, phone, company_form_data, context) VALUES (?, ?, 'project', ?, ?, ?)");
        $emptyJson = '{}';
        $ins->bind_param('issss', $userId, $companyName, $phone, $emptyJson, $ctx);
        $ins->execute();
        $companyId = (int)$conn->insert_id;
        $ins->close();
        $storeName = '';
        $folderPath = ''; $publicUrl = '';
    }
    $companyId = (int)$companyId;

    // ── Merge incoming brand fields (only non-empty) ──────────────────────────
    $fieldMap = [
        'name' => 'businessName', 'industry' => 'businessCategory', 'description' => 'businessDescription',
        'language' => 'language', 'tone_of_voice' => 'toneOfVoice', 'brand_personality' => 'brandPersonality',
        'brand_keywords' => 'brandKeywords', 'forbidden_words' => 'forbiddenWords', 'target_audience' => 'targetAudience',
        'value_proposition' => 'valueProposition', 'primary_color' => 'primaryColor', 'secondary_color' => 'secondaryColor',
        'accent_color' => 'accentColor', 'background_color' => 'backgroundColor', 'text_color' => 'textColor',
        'heading_font' => 'headingFont', 'body_font' => 'bodyFont', 'website' => 'sourceWebsite',
    ];
    foreach ($fieldMap as $in => $out) {
        $v = trim((string)($company[$in] ?? ''));
        if ($v !== '') $formData[$out] = $v;
    }
    if (!is_array($formData['images'] ?? null)) $formData['images'] = [];

    // Brand visual guidelines from Instagram scraping — always overwrite (caller owns this).
    if ($brandVisualGuidelines !== '') $formData['brandVisualGuidelines']    = $brandVisualGuidelines;
    if ($competitorExamples    !== '') $formData['competitorLayoutExamples'] = $competitorExamples;

    // ── Company folder on disk ────────────────────────────────────────────────
    $companyRelPath = extract_project_relative_path_from_folder_path((string)$folderPath);
    if ($companyRelPath === '') $companyRelPath = extract_project_relative_path_from_public_url((string)$publicUrl);
    if ($companyRelPath === '') {
        $companyRelPath = ensure_unique_slug(sanitize_slug((string)($company['name'] ?? ('company-' . $companyId))), resolve_sites_base_path());
        $newFolder = project_folder_path_from_relative($companyRelPath);
        $newPublic = project_public_url_from_relative($companyRelPath);
        if ($u = $conn->prepare("UPDATE projects SET folder_path = ?, public_url = ? WHERE id = ?")) {
            $u->bind_param('ssi', $newFolder, $newPublic, $companyId); $u->execute(); $u->close();
        }
    }
    $companyDir = project_directory_from_relative($companyRelPath);
    $assetsDir  = $companyDir . DIRECTORY_SEPARATOR . 'assets';
    ensure_directory($assetsDir);
    $publicBase = rtrim(preg_replace('/\/index\.html$/i', '/', project_public_url_from_relative($companyRelPath)), '/') . '/';

    // ── Store ONE image (URL or data: URI) to the company assets → hosted URL ─
    // Anti-base64: data: URIs are decoded to a real file; NOTHING base64 is persisted.
    $storeImage = function ($input, string $slot, int $idx) use ($assetsDir, $publicBase): ?array {
        $input = trim((string)$input);
        if ($input === '') return null;
        $bytes = ''; $ctHint = null;
        if (preg_match('~^data:([^;,]+)?;base64,(.+)$~is', $input, $mm)) {
            $ctHint = $mm[1] ?? null;
            $bytes = base64_decode(preg_replace('/\s+/', '', $mm[2]), true) ?: '';
        } elseif (preg_match('~^https?://~i', $input)) {
            $norm = normalize_asset_url($input);
            if ($norm === '' || !is_supported_asset_url($norm)) return ['skip' => $input, 'reason' => 'unsupported url'];
            $d = download_remote_asset($norm);
            if ($d === null || !isset($d['body'])) return ['skip' => $input, 'reason' => 'download blocked'];
            $bytes = (string)$d['body']; $ctHint = $d['content_type'] ?? null;
        } else {
            return ['skip' => $input, 'reason' => 'not a url or data uri'];
        }
        if ($bytes === '' || strlen($bytes) > CAA_MAX_BYTES) return ['skip' => $input, 'reason' => 'empty or > ' . CAA_MAX_BYTES . ' bytes'];
        $type = detect_asset_content_type($bytes, $ctHint);
        if (!is_safe_asset_content_type($type)) return ['skip' => $input, 'reason' => 'not a supported image'];
        $ext = extract_extension_from_url('x', $type);
        if ($ext === 'bin' || $ext === '') return ['skip' => $input, 'reason' => 'unknown image type'];
        $name = $slot . '-' . $idx . '.' . $ext;
        $i = $idx;
        while (file_exists($assetsDir . DIRECTORY_SEPARATOR . $name)) { $i++; $name = $slot . '-' . $i . '.' . $ext; }
        if (@file_put_contents($assetsDir . DIRECTORY_SEPARATOR . $name, $bytes) === false) return ['skip' => $input, 'reason' => 'write failed'];
        return ['url' => $publicBase . 'assets/' . rawurlencode($name)];
    };

    $skipped = [];

    // ── Logo (main logo on the company) ───────────────────────────────────────
    $logoUrl = '';
    if ($logoInput !== '') {
        $r = $storeImage($logoInput, 'logo', 1);
        if (isset($r['url'])) {
            $logoUrl = $r['url'];
            $formData['logoUrl'] = $logoUrl;
            $formData['images']['logo'] = $logoUrl;
        } elseif (isset($r['skip'])) {
            $skipped[] = ['type' => 'logo', 'reason' => $r['reason']];
        }
    }

    // ── Reference images (legacy / generic) ──────────────────────────────────
    $newRefs = [];
    $n = 1;
    foreach ($refInputs as $ref) {
        $r = $storeImage($ref, 'ref', $n++);
        if (isset($r['url'])) $newRefs[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'reference', 'reason' => $r['reason']];
    }

    $existingRefs = is_array($formData['referenceImages'] ?? null) ? $formData['referenceImages'] : [];
    $allRefs = array_values(array_unique(array_filter(array_merge($existingRefs, $newRefs), 'strlen')));
    if (count($allRefs) > CAA_MAX_STORED) $allRefs = array_slice($allRefs, -CAA_MAX_STORED);
    if (!empty($allRefs)) {
        $formData['referenceImages'] = $allRefs;
        $existingProd = is_array($formData['images']['productImages'] ?? null) ? $formData['images']['productImages'] : [];
        $formData['images']['productImages'] = array_values(array_unique(array_filter(array_merge($existingProd, $newRefs), 'strlen')));
    }

    // ── Brand Instagram posts ─────────────────────────────────────────────────
    // Mirror brand post images to the company assets folder, accumulate with existing,
    // then call brand_visual to generate (or update) the visual identity brief.
    $newBrandUrls = [];
    $nb = 1;
    foreach ($brandPostInputs as $bp) {
        $r = $storeImage($bp, 'brand-post', $nb++);
        if (isset($r['url'])) $newBrandUrls[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'brand_post', 'reason' => $r['reason']];
    }

    $existingBrandPosts = is_array($formData['brandPostImages'] ?? null) ? $formData['brandPostImages'] : [];
    $allBrandPosts = array_values(array_unique(array_filter(array_merge($existingBrandPosts, $newBrandUrls), 'strlen')));
    if (count($allBrandPosts) > CAA_MAX_BRAND_STORED) $allBrandPosts = array_slice($allBrandPosts, -CAA_MAX_BRAND_STORED);
    if (!empty($allBrandPosts)) $formData['brandPostImages'] = $allBrandPosts;

    // ── Competitor Instagram posts ────────────────────────────────────────────
    $newCompUrls = [];
    $nc = 1;
    foreach ($compPostInputs as $cp) {
        $r = $storeImage($cp, 'comp-post', $nc++);
        if (isset($r['url'])) $newCompUrls[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'competitor_post', 'reason' => $r['reason']];
    }

    $existingCompPosts = is_array($formData['competitorPostImages'] ?? null) ? $formData['competitorPostImages'] : [];
    $allCompPosts = array_values(array_unique(array_filter(array_merge($existingCompPosts, $newCompUrls), 'strlen')));
    if (count($allCompPosts) > CAA_MAX_COMP_STORED) $allCompPosts = array_slice($allCompPosts, -CAA_MAX_COMP_STORED);
    if (!empty($allCompPosts)) $formData['competitorPostImages'] = $allCompPosts;

    // ── Persist company_form_data ─────────────────────────────────────────────
    $formJson = json_encode($formData, JSON_UNESCAPED_UNICODE);
    if ($u = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?")) {
        $u->bind_param('si', $formJson, $companyId); $u->execute(); $u->close();
    }

    // ── Brand visual brief (Gemini analysis of Instagram posts) ──────────────
    // Run when brand_posts were provided. Uses the ACCUMULATED set of posts (not just new
    // ones) so the brief always reflects the full brand profile. Non-fatal: a failed call
    // leaves the previously stored brief in place.
    $brandBriefResult = null;
    $briefWarning     = null;
    $briefEdgeCalled  = false; // true when the edge was invoked (even if brief came back empty)
    $briefEmptyReason = null;  // reason code returned by edge when brief is empty
    if (!empty($allBrandPosts) && $geminiApiKey !== '') {
        try {
            // Send up to 10 brand posts + up to 6 competitor posts to the edge function.
            $briefPayload = [
                'mode'                => 'brand_visual',
                'geminiApiKey'        => $geminiApiKey,
                'brandImageUrls'      => array_slice($allBrandPosts, -10),
                'competitorImageUrls' => array_slice($allCompPosts, -6),
            ];
            $bvRes = agents_call_edge_function('agents-ads', $briefPayload, $geminiApiKey);
            $briefEdgeCalled = true;
            $newBrief = trim((string)($bvRes['brief'] ?? ''));
            if ($newBrief !== '') {
                $formData['brandVisualBrief']     = $newBrief;
                $formData['brandVisualBriefHash'] = 'instagram-profile'; // sentinel → worker won't regenerate
                $fj2 = json_encode($formData, JSON_UNESCAPED_UNICODE);
                if ($fj2 && ($ub2 = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?"))) {
                    $ub2->bind_param('si', $fj2, $companyId); $ub2->execute(); $ub2->close();
                }
                $brandBriefResult = $newBrief;
            } else {
                $briefEmptyReason = trim((string)($bvRes['reason'] ?? '')) ?: 'empty_response';
                error_log('[company-assets] brand_visual returned empty brief, reason=' . $briefEmptyReason);
            }
        } catch (Throwable $bvErr) {
            $briefEdgeCalled = true;
            $briefWarning = $bvErr->getMessage();
            error_log('[company-assets] brand_visual failed (non-fatal): ' . $bvErr->getMessage());
        }
    }

    // ── Re-sync the Gemini company store (once per call) ──────────────────────
    $passKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING') ?: null;
    $storeWarning = null;
    try {
        $storeName = agents_sync_company_store($conn, $companyId, $formData, $accountType, $userId, ($storeName ?: null), $passKey);
    } catch (Throwable $se) {
        $storeWarning = $se->getMessage();
        error_log('[company-assets] store sync failed: ' . $se->getMessage());
    }

    echo json_encode([
        'success'                  => true,
        'company_id'               => $companyId,
        'store_name'               => (string)$storeName,
        'logo_url'                 => $logoUrl ?: ($formData['logoUrl'] ?? ''),
        'reference_images'         => $allRefs,
        'reference_count'          => count($allRefs),
        'added'                    => count($newRefs),
        'brand_posts_stored'       => count($allBrandPosts),
        'brand_posts_added'        => count($newBrandUrls),
        'competitor_posts_stored'  => count($allCompPosts),
        'competitor_posts_added'   => count($newCompUrls),
        'brand_visual_brief'       => $brandBriefResult !== null ? substr($brandBriefResult, 0, 200) . '...' : null,
        'brand_visual_status'      => $brandBriefResult !== null
                                        ? 'generated'
                                        : ($briefWarning !== null
                                            ? 'failed'
                                            : ($briefEdgeCalled
                                                ? 'empty_response'  // edge called but brief came back empty
                                                : (isset($formData['brandVisualBrief'])
                                                    ? 'cached'
                                                    : 'not_requested'))),
        'brief_empty_reason'       => $briefEmptyReason,
        'skipped'                  => $skipped,
        'brief_warning'            => $briefWarning,
        'store_warning'            => $storeWarning,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    error_log('[company-assets] ' . $e->getMessage());
    caa_fail(500, $e->getMessage());
}
