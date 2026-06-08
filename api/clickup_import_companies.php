<?php
// Creates Forge companies from selected ClickUp entries (after the user confirmed
// the site URL and reviewed the scraped profile in the UI — the gated flow).
// Reuses the existing company pipeline: path helpers + agents_sync_company_store
// (the same store sync createProject.php uses). Idempotent: a re-import of a
// company whose clickup_list_ids overlap an existing clickup company UPDATES it
// (merges channels/list_ids) instead of duplicating.
//
// POST JSON:
//   { user_id, companies: [ { company, channels:[], list_ids:[], website_url, form_data:{} } ] }
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

include "db.php";
require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'accountType.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'v1' . DIRECTORY_SEPARATOR . 'agents' . DIRECTORY_SEPARATOR . 'helpers.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . 'clickup_common.php';

$data = json_decode(file_get_contents("php://input"), true);
$userId    = isset($data['user_id']) ? (int)$data['user_id'] : 0;
$companies = isset($data['companies']) && is_array($data['companies']) ? $data['companies'] : [];
if ($userId <= 0 || empty($companies)) {
    http_response_code(400);
    echo json_encode(["error" => "user_id and a non-empty companies[] are required"]);
    exit;
}

clickup_ensure_schema($conn);

// Account type (for the store sync).
$accountType = 'user';
if ($eStmt = $conn->prepare("SELECT email, account_type FROM users WHERE id = ? LIMIT 1")) {
    $eStmt->bind_param('i', $userId);
    $eStmt->execute();
    $eStmt->bind_result($uEmail, $uAcct);
    $eStmt->fetch();
    $eStmt->close();
    $resolved = resolve_account_type_by_domain($uEmail ?? '', $uAcct ?? 'user');
    $accountType = $resolved['accountType'] ?? 'user';
}

// If any company attaches ClickUp Docs (wikis), load the connection (token + workspace).
$ccToken = ''; $ccWorkspace = ''; $needDocs = false;
foreach ($companies as $c) { if (is_array($c) && !empty($c['doc_ids'])) { $needDocs = true; break; } }
if ($needDocs) {
    $cc = clickup_get_connection($conn, $userId);
    if ($cc) {
        $ccToken = (string)$cc['access_token'];
        $ccWorkspace = (string)($cc['workspace_id'] ?? '');
        if ($ccWorkspace === '' && $ccToken !== '') {
            $tr = clickup_api_request($ccToken, 'GET', '/team');
            if (!empty($tr['data']['teams'][0]['id'])) $ccWorkspace = (string)$tr['data']['teams'][0]['id'];
        }
    }
}

// Ingest selected ClickUp Docs into a company's store (sanitized, origin=clickup).
$ingestDocs = function (int $companyProjectId, string $storeName, array $docIds) use ($conn, $ccToken, $ccWorkspace, $accountType, $userId): int {
    if ($ccToken === '' || $ccWorkspace === '' || $storeName === '' || empty($docIds)) return 0;
    $count = 0;
    foreach ($docIds as $docId) {
        $docId = (string)$docId;
        if ($docId === '') continue;
        $md = clickup_fetch_doc_markdown($ccToken, $ccWorkspace, $docId);
        if ($md === '') continue;
        $md = agents_strip_base64_images($md); // NEVER push base64 into the store
        $doc = "# ClickUp Doc (origem: clickup)\n\n" . $md . "\n";
        try {
            $up = agents_call_edge_function('agents-store', [
                'action'      => 'upload_file',
                'storeName'   => $storeName,
                'fileBase64'  => base64_encode($doc),
                'mimeType'    => 'text/markdown',
                'displayName' => 'ClickUp Doc ' . substr($docId, 0, 8),
                'accountType' => $accountType,
            ]);
            if (!empty($up['error'])) continue;
            $count++;
            try {
                if (function_exists('agents_ensure_company_store_files_table')) agents_ensure_company_store_files_table($conn);
                $docName = function_exists('agents_extract_document_name') ? agents_extract_document_name($up) : '';
                $rt = 'uploaded_file'; $dn = 'ClickUp Doc ' . substr($docId, 0, 8); $on = $dn; $mt = 'text/markdown'; $fs = strlen($doc);
                $insF = $conn->prepare("INSERT INTO company_store_files (company_project_id, gemini_file_uri, gemini_store_name, record_type, display_name, original_name, mime_type, file_size_bytes, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)");
                if ($insF) { $insF->bind_param('issssssii', $companyProjectId, $docName, $storeName, $rt, $dn, $on, $mt, $fs, $userId); $insF->execute(); $insF->close(); }
            } catch (Throwable $te) { /* tracking row is best-effort */ }
        } catch (Throwable $e) { error_log('[clickup_import] doc ingest ' . $docId . ': ' . $e->getMessage()); }
    }
    return $count;
};

// Pre-load this user's existing ClickUp companies for idempotency.
$existing = []; // [ ['id'=>, 'list_ids'=>[], 'channels'=>[], 'form'=>[] ] ]
if ($exRes = $conn->query("SELECT id, clickup_list_ids, channels, company_form_data FROM projects WHERE user_id = " . (int)$userId . " AND source = 'clickup' AND project_type = 'project'")) {
    while ($r = $exRes->fetch_assoc()) {
        $existing[] = [
            'id'       => (int)$r['id'],
            'list_ids' => array_map('strval', (array)(json_decode((string)($r['clickup_list_ids'] ?? '[]'), true) ?: [])),
            'channels' => array_map('strval', (array)(json_decode((string)($r['channels'] ?? '[]'), true) ?: [])),
            'form'     => (array)(json_decode((string)($r['company_form_data'] ?? '{}'), true) ?: []),
        ];
    }
    $exRes->free();
}

$sitesBasePath = resolve_sites_base_path();
ensure_directory($sitesBasePath);

$results = [];
foreach ($companies as $entry) {
    if (!is_array($entry)) continue;
    $name     = trim((string)($entry['company'] ?? ''));
    $listIds  = array_values(array_unique(array_map('strval', (array)($entry['list_ids'] ?? []))));
    $channels = array_values(array_unique(array_map('strval', (array)($entry['channels'] ?? []))));
    $website  = trim((string)($entry['website_url'] ?? ''));
    $formData = is_array($entry['form_data'] ?? null) ? $entry['form_data'] : [];
    $docIds   = array_values(array_filter(array_map('strval', (array)($entry['doc_ids'] ?? []))));
    if ($name === '') { $results[] = ['company' => '', 'status' => 'skipped', 'reason' => 'empty name']; continue; }

    // Ensure minimum form fields so the store doc + scrape pipeline have context.
    if (trim((string)($formData['businessName'] ?? '')) === '') $formData['businessName'] = $name;
    if ($website !== '' && trim((string)($formData['sourceWebsite'] ?? '')) === '') $formData['sourceWebsite'] = $website;

    // ── Idempotency: overlap with an existing ClickUp company by list_ids ────
    $match = null;
    foreach ($existing as &$ex) {
        if (array_intersect($ex['list_ids'], $listIds)) { $match = &$ex; break; }
    }
    unset($ex);

    try {
        if ($match !== null) {
            $mergedListIds = array_values(array_unique(array_merge($match['list_ids'], $listIds)));
            $mergedChannels = array_values(array_unique(array_merge($match['channels'], $channels)));
            $mergedForm = array_merge($match['form'], $formData); // new scrape wins on overlap
            $listJson = json_encode($mergedListIds, JSON_UNESCAPED_UNICODE);
            $chanJson = json_encode($mergedChannels, JSON_UNESCAPED_UNICODE);
            $formJson = json_encode($mergedForm, JSON_UNESCAPED_UNICODE);

            $upd = $conn->prepare("UPDATE projects SET clickup_list_ids = ?, channels = ?, company_form_data = ?, updated_at = NOW() WHERE id = ?");
            $upd->bind_param('sssi', $listJson, $chanJson, $formJson, $match['id']);
            $upd->execute();
            $upd->close();

            $storeName = '';
            try { $storeName = agents_sync_company_store($conn, $match['id'], $mergedForm, $accountType, $userId, null); }
            catch (Throwable $se) { error_log('[clickup_import] store sync (update) ' . $match['id'] . ': ' . $se->getMessage()); }
            $docsIn = $ingestDocs($match['id'], (string)$storeName, $docIds);

            $match['list_ids'] = $mergedListIds;
            $match['channels'] = $mergedChannels;
            $match['form']     = $mergedForm;
            $results[] = ['company' => $name, 'status' => 'updated', 'project_id' => $match['id'], 'docs_ingested' => $docsIn];
            continue;
        }

        // ── Create new company project ──────────────────────────────────────
        $relativePath = ensure_unique_slug(sanitize_slug($name) ?: 'company', $sitesBasePath);
        $publicUrl    = project_public_url_from_relative($relativePath);
        $folderPath   = project_folder_path_from_relative($relativePath);
        ensure_directory(project_directory_from_relative($relativePath));

        $formJson = json_encode($formData, JSON_UNESCAPED_UNICODE);
        $listJson = json_encode($listIds, JSON_UNESCAPED_UNICODE);
        $chanJson = json_encode($channels, JSON_UNESCAPED_UNICODE);
        $context  = trim((string)($formData['businessDescription'] ?? ''));

        $ins = $conn->prepare(
            "INSERT INTO projects (user_id, name, public_url, folder_path, company_form_data, context, project_type, source, channels, clickup_list_ids, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'project', 'clickup', ?, ?, NOW())"
        );
        if (!$ins) throw new RuntimeException('prepare failed: ' . $conn->error);
        $ins->bind_param('isssssss', $userId, $name, $publicUrl, $folderPath, $formJson, $context, $chanJson, $listJson);
        if (!$ins->execute()) throw new RuntimeException('insert failed: ' . $ins->error);
        $projectId = (int)$conn->insert_id;
        $ins->close();

        $storeName = '';
        try { $storeName = agents_sync_company_store($conn, $projectId, $formData, $accountType, $userId, null); }
        catch (Throwable $se) { error_log('[clickup_import] store sync (create) ' . $projectId . ': ' . $se->getMessage()); }
        $docsIn = $ingestDocs($projectId, (string)$storeName, $docIds);

        // Track so a duplicate within the same request also dedups.
        $existing[] = ['id' => $projectId, 'list_ids' => $listIds, 'channels' => $channels, 'form' => $formData];
        $results[] = ['company' => $name, 'status' => 'created', 'project_id' => $projectId, 'public_url' => $publicUrl, 'docs_ingested' => $docsIn];
    } catch (Throwable $e) {
        error_log('[clickup_import] ' . $name . ': ' . $e->getMessage());
        $results[] = ['company' => $name, 'status' => 'error', 'reason' => $e->getMessage()];
    }
}

echo json_encode(["success" => true, "results" => $results], JSON_UNESCAPED_UNICODE);
$conn->close();
