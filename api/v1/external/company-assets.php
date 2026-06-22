<?php
/**
 * External API — add/replace COMPANY assets & info (reference images + logo + brand fields).
 *
 * POST { api_key | Authorization: Bearer, phone, company?, logo_url?, reference_images?[] }
 *   - Finds/creates the company (project_type='project') by (user_id, phone).
 *   - Mirrors logo + reference images to the company's assets folder (URLs OR data: URIs are
 *     converted to hosted files — NO base64 is ever stored or sent to Gemini: anti-base64).
 *   - Persists them in company_form_data (logoUrl/images.logo, referenceImages[],
 *     images.productImages[]) so EVERY future generation consults them.
 *   - Re-syncs the company Gemini File Search store once per call (cost-aware).
 *   - Rate limited per API key.
 *
 * The reference images become the brand's compose references: generate-ads.php bridges
 * referenceImages -> campaignData.composeCompanyRefs and defaults the compose background to
 * "company" when references exist, so they are always used.
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

const CAA_MAX_IMAGES   = 12;          // per request
const CAA_MAX_BYTES    = 8000000;     // 8 MB per image (decoded)
const CAA_MAX_STORED   = 24;          // cap referenceImages kept on the company
const CAA_RATE_LIMIT   = 20;          // requests
const CAA_RATE_WINDOW  = 60;          // per seconds

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

// ── Rate limit (sliding window per key) ──────────────────────────────────────
// Wrapped: mysqli runs in EXCEPTION mode here, so if the api_rate_limit table hasn't been
// created yet, the queries throw — we then skip enforcement (the endpoint still works) until
// the table exists. The 429 path uses caa_fail() which exits cleanly.
try {
    $now = time(); $ws = 0; $cnt = 0; $exists = false;
    $rs = $conn->prepare("SELECT window_start, count FROM api_rate_limit WHERE api_key = ? LIMIT 1");
    $rs->bind_param('s', $apiKey); $rs->execute(); $rs->bind_result($ws, $cnt);
    if ($rs->fetch()) $exists = true;
    $rs->close();
    if (!$exists || ($now - (int)$ws) >= CAA_RATE_WINDOW) {
        $w = $conn->prepare("INSERT INTO api_rate_limit (api_key, window_start, count) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE window_start = VALUES(window_start), count = 1");
        $w->bind_param('si', $apiKey, $now); $w->execute(); $w->close();
    } elseif ((int)$cnt >= CAA_RATE_LIMIT) {
        header('Retry-After: ' . (CAA_RATE_WINDOW - ($now - (int)$ws)));
        caa_fail(429, 'Rate limit exceeded. Try again shortly.', 'rate_limited');
    } else {
        $w = $conn->prepare("UPDATE api_rate_limit SET count = count + 1 WHERE api_key = ?");
        $w->bind_param('s', $apiKey); $w->execute(); $w->close();
    }
} catch (Throwable $rlErr) {
    error_log('[company-assets] rate limit inactive (run the api_rate_limit migration): ' . $rlErr->getMessage());
}

// ── Validate input ───────────────────────────────────────────────────────────
$phone = trim((string)($body['phone'] ?? ''));
if ($phone === '') caa_fail(400, 'phone is required (company identifier).', 'missing_phone');

$company = is_array($body['company'] ?? null) ? $body['company'] : [];
$refInputs = [];
if (is_array($body['reference_images'] ?? null)) $refInputs = $body['reference_images'];
$logoInput = trim((string)($body['logo_url'] ?? ($company['logo_url'] ?? ($company['logo'] ?? ''))));

if (count($refInputs) > CAA_MAX_IMAGES) caa_fail(400, 'Too many reference_images (max ' . CAA_MAX_IMAGES . ' per call).', 'too_many');

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

    // ── Reference images ──────────────────────────────────────────────────────
    $newRefs = [];
    $n = 1;
    foreach ($refInputs as $ref) {
        $r = $storeImage($ref, 'ref', $n++);
        if (isset($r['url'])) $newRefs[] = $r['url'];
        elseif (isset($r['skip'])) $skipped[] = ['type' => 'reference', 'reason' => $r['reason']];
    }

    // Merge with existing, dedupe, cap. referenceImages drive compose; productImages keep
    // the existing pipeline (productImageUrl) working too.
    $existingRefs = is_array($formData['referenceImages'] ?? null) ? $formData['referenceImages'] : [];
    $allRefs = array_values(array_unique(array_filter(array_merge($existingRefs, $newRefs), 'strlen')));
    if (count($allRefs) > CAA_MAX_STORED) $allRefs = array_slice($allRefs, -CAA_MAX_STORED);
    if (!empty($allRefs)) {
        $formData['referenceImages'] = $allRefs;
        $existingProd = is_array($formData['images']['productImages'] ?? null) ? $formData['images']['productImages'] : [];
        $formData['images']['productImages'] = array_values(array_unique(array_filter(array_merge($existingProd, $newRefs), 'strlen')));
    }

    // ── Persist company_form_data ─────────────────────────────────────────────
    $formJson = json_encode($formData, JSON_UNESCAPED_UNICODE);
    if ($u = $conn->prepare("UPDATE projects SET company_form_data = ? WHERE id = ?")) {
        $u->bind_param('si', $formJson, $companyId); $u->execute(); $u->close();
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
        'success'          => true,
        'company_id'       => $companyId,
        'store_name'       => (string)$storeName,
        'logo_url'         => $logoUrl ?: ($formData['logoUrl'] ?? ''),
        'reference_images' => $allRefs,
        'reference_count'  => count($allRefs),
        'added'            => count($newRefs),
        'skipped'          => $skipped,
        'store_warning'    => $storeWarning,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    error_log('[company-assets] ' . $e->getMessage());
    caa_fail(500, $e->getMessage());
}
