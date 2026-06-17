<?php
// LP lead-capture mailer — status + configure/install endpoint for the Visual Editor.
//
// GET  ?project_id=&user_id=  -> { success, installed, hasPassword, leadCapture }   (password never returned)
// POST { project_id, user_id, leadCapture } -> persists the config into form_data,
//        (re)installs the PHP mailer kit into the LP folder, writes config.php and
//        rewrites the published index.html <form>s to POST the lead. Idempotent.
//
// Reuses the SAME provisioning engine used at publish time (site_helpers.php), so
// "install the kit" and "save the SMTP config" are one idempotent operation.

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

function lp_mailer_respond(array $payload, int $code = 200): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = [];
if ($method === 'POST') {
    $body = json_decode(file_get_contents("php://input"), true);
    if (!is_array($body)) $body = [];
}

$projectId = (int)($method === 'POST' ? ($body['project_id'] ?? 0) : ($_GET['project_id'] ?? 0));
$userId    = (int)($method === 'POST' ? ($body['user_id'] ?? 0)    : ($_GET['user_id'] ?? 0));

if ($projectId <= 0 || $userId <= 0) {
    lp_mailer_respond(["success" => false, "error" => "Invalid identifiers"], 400);
}

include "db.php";

$projectRow = find_project_for_user($conn, $projectId, $userId, 'p.id');
if (!$projectRow) {
    $conn->close();
    lp_mailer_respond(["success" => false, "error" => "Project not found"], 404);
}

$folderPath = (string)($projectRow['folder_path'] ?? '');
$publicUrl  = (string)($projectRow['public_url'] ?? '');
$effectiveUserId = (int)($projectRow['actual_user_id'] ?? $userId);

// Decode stored form_data + leadCapture.
$storedFormData = [];
$rawFd = $projectRow['form_data'] ?? '';
if (is_string($rawFd) && trim($rawFd) !== '') {
    $decoded = json_decode($rawFd, true);
    if (is_array($decoded)) $storedFormData = $decoded;
}
$storedLc = is_array($storedFormData['leadCapture'] ?? null) ? $storedFormData['leadCapture'] : [];

// Resolve project dir + detect whether the kit is installed.
$projectDir = '';
$kitInstalled = false;
if (trim($folderPath) !== '') {
    try {
        $projectDir = resolve_project_directory_from_folder_path($folderPath, $publicUrl);
        $kitInstalled = is_file($projectDir . DIRECTORY_SEPARATOR . 'mailer' . DIRECTORY_SEPARATOR . 'send_lead.php')
            && is_file($projectDir . DIRECTORY_SEPARATOR . 'mailer' . DIRECTORY_SEPARATOR . 'config.php');
    } catch (Throwable $e) {
        $projectDir = '';
    }
}

// ── GET: report status (never expose the SMTP password) ─────────────────────
if ($method === 'GET') {
    $hasPassword = trim((string)($storedLc['smtpPass'] ?? '')) !== '';
    $safeLc = $storedLc;
    unset($safeLc['smtpPass']);
    $conn->close();
    lp_mailer_respond([
        "success" => true,
        "installed" => $kitInstalled,
        "hasPassword" => $hasPassword,
        "leadCapture" => (object)$safeLc,
    ]);
}

// ── POST: persist config + provision kit + rewrite forms ────────────────────
$incoming = is_array($body['leadCapture'] ?? null) ? $body['leadCapture'] : null;
if ($incoming === null) {
    $conn->close();
    lp_mailer_respond(["success" => false, "error" => "Missing leadCapture"], 400);
}

// Preserve the existing password when the panel leaves it blank (it never receives it).
if (trim((string)($incoming['smtpPass'] ?? '')) === '' && trim((string)($storedLc['smtpPass'] ?? '')) !== '') {
    $incoming['smtpPass'] = $storedLc['smtpPass'];
}

$storedFormData['leadCapture'] = array_merge($storedLc, $incoming);
$mergedJson = json_encode($storedFormData, JSON_UNESCAPED_UNICODE);

// Provision kit + rewrite the published index.html forms (no-op when disabled).
$finalHtml = (string)($projectRow['generated_html'] ?? '');
$writeWarning = null;
if ($projectDir !== '') {
    try {
        ensure_directory($projectDir);
        $indexPath = $projectDir . DIRECTORY_SEPARATOR . 'index.html';
        $currentHtml = is_file($indexPath) ? (string)file_get_contents($indexPath) : $finalHtml;
        $rewritten = maybe_provision_lp_mailer($projectDir, $currentHtml, $storedFormData, $publicUrl);
        if (trim($rewritten) !== '') {
            $finalHtml = $rewritten;
            file_put_contents($indexPath, $finalHtml);
        }
        $kitInstalled = is_file($projectDir . DIRECTORY_SEPARATOR . 'mailer' . DIRECTORY_SEPARATOR . 'send_lead.php')
            && is_file($projectDir . DIRECTORY_SEPARATOR . 'mailer' . DIRECTORY_SEPARATOR . 'config.php');
    } catch (Throwable $e) {
        $writeWarning = $e->getMessage();
        error_log('[lpMailer] provisioning failed: ' . $e->getMessage());
    }
}

// Persist merged form_data + the (possibly) rewritten HTML.
$update = $conn->prepare(
    "INSERT INTO lps (project_id, public_url, folder_path, form_data, generated_html, current_step)
     SELECT p.id, ?, ?, ?, ?, COALESCE(l.current_step, 0)
     FROM projects p
     LEFT JOIN lps l ON l.project_id = p.id
     WHERE p.id = ? AND p.user_id = ?
     ON DUPLICATE KEY UPDATE
       form_data = VALUES(form_data),
       generated_html = VALUES(generated_html)"
);
if (!$update) {
    $conn->close();
    lp_mailer_respond(["success" => false, "error" => "Query preparation failed"], 500);
}
$update->bind_param("ssssii", $publicUrl, $folderPath, $mergedJson, $finalHtml, $projectId, $effectiveUserId);
if (!$update->execute()) {
    $err = $update->error;
    $update->close();
    $conn->close();
    lp_mailer_respond(["success" => false, "error" => "Failed to save", "details" => $err], 500);
}
$update->close();
$conn->close();

lp_mailer_respond([
    "success" => true,
    "installed" => $kitInstalled,
    "warning" => $writeWarning,
]);
