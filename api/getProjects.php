<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
header("Expires: 0");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$user_id = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
$user_email = isset($_GET['user_email']) ? trim((string)$_GET['user_email']) : '';
$has_valid_email = $user_email !== '' && filter_var($user_email, FILTER_VALIDATE_EMAIL);
$include_html = isset($_GET['include_html']) && in_array(strtolower((string)$_GET['include_html']), ['1', 'true', 'yes', 'on'], true);

if ($user_id <= 0 && !$has_valid_email) {
    http_response_code(400);
    echo json_encode(["error" => "Valid user_id or user_email is required"]);
    exit;
}

include "db.php";

$project_id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$generatedHtmlSelect = $include_html ? "l.generated_html" : "'' AS generated_html";
$hasGeneratedHtmlSelect = "TRIM(COALESCE(l.generated_html, '')) <> '' AS has_generated_html";

// Latest campaign per project (for ad_creative projects whose data lives in ads_campaign)
$acJoin = "LEFT JOIN (
    SELECT ac1.project_id, ac1.public_url, ac1.form_data, ac1.current_step
    FROM ads_campaign ac1
    INNER JOIN (SELECT MAX(id) AS max_id FROM ads_campaign GROUP BY project_id) acm ON acm.max_id = ac1.id
) ac ON ac.project_id = p.id";

$cols = "p.id, p.user_id, p.name,
    CASE
        WHEN COALESCE(p.project_type, 'landing_page') = 'project'    THEN COALESCE(NULLIF(p.public_url, ''), '')
        WHEN COALESCE(p.project_type, 'landing_page') = 'ad_creative' THEN COALESCE(NULLIF(ac.public_url, ''), NULLIF(l.public_url, ''), '')
        ELSE COALESCE(NULLIF(l.public_url, ''), '')
    END AS public_url,
    CASE
        WHEN COALESCE(p.project_type, 'landing_page') = 'project'    THEN COALESCE(NULLIF(p.folder_path, ''), '')
        WHEN NULLIF(l.folder_path, '') IS NOT NULL                    THEN l.folder_path
        WHEN COALESCE(p.project_type, 'landing_page') = 'ad_creative' AND NULLIF(ac.public_url, '') IS NOT NULL
            THEN CONCAT('/public', TRIM(TRAILING '/' FROM ac.public_url))
        ELSE ''
    END AS folder_path,
    CASE
        WHEN COALESCE(p.project_type, 'landing_page') = 'project'    THEN COALESCE(NULLIF(p.company_form_data, ''), '{}')
        WHEN COALESCE(p.project_type, 'landing_page') = 'ad_creative' THEN COALESCE(NULLIF(ac.form_data, ''), NULLIF(l.form_data, ''), '{}')
        ELSE COALESCE(NULLIF(l.form_data, ''), '{}')
    END AS form_data,
    COALESCE(NULLIF(p.company_form_data, ''), '{}') AS company_form_data,
    COALESCE(p.context, '') AS context,
    COALESCE(NULLIF(l.public_url, ''), '') AS lp_public_url,
    COALESCE(NULLIF(ac.public_url, ''), '') AS ad_public_url,
    {$generatedHtmlSelect},
    {$hasGeneratedHtmlSelect},
    CASE
        WHEN COALESCE(p.project_type, 'landing_page') = 'ad_creative' THEN COALESCE(ac.current_step, l.current_step, 0)
        ELSE COALESCE(l.current_step, 0)
    END AS current_step,
    p.created_at,
    COALESCE(p.project_type, 'landing_page') AS project_type,
    p.company_project_id";

if ($project_id > 0 && $user_id > 0 && $has_valid_email) {
    $stmt = $conn->prepare("SELECT {$cols} FROM projects p LEFT JOIN lps l ON l.project_id = p.id {$acJoin} LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ? AND (p.user_id = ? OR LOWER(u.email) = LOWER(?))");
    $stmt->bind_param("iis", $project_id, $user_id, $user_email);
} elseif ($project_id > 0 && $user_id > 0) {
    $stmt = $conn->prepare("SELECT {$cols} FROM projects p LEFT JOIN lps l ON l.project_id = p.id {$acJoin} WHERE p.id = ? AND p.user_id = ?");
    $stmt->bind_param("ii", $project_id, $user_id);
} elseif ($user_id > 0 && $has_valid_email) {
    $stmt = $conn->prepare("SELECT {$cols} FROM projects p LEFT JOIN lps l ON l.project_id = p.id {$acJoin} LEFT JOIN users u ON u.id = p.user_id WHERE p.user_id = ? OR LOWER(u.email) = LOWER(?) ORDER BY p.id DESC");
    $stmt->bind_param("is", $user_id, $user_email);
} elseif ($user_id > 0) {
    $stmt = $conn->prepare("SELECT {$cols} FROM projects p LEFT JOIN lps l ON l.project_id = p.id {$acJoin} WHERE p.user_id = ? ORDER BY p.id DESC");
    $stmt->bind_param("i", $user_id);
} else {
    // Fallback for legacy/inconsistent client sessions where user_id is unavailable but email is known.
    $stmt = $conn->prepare("SELECT {$cols} FROM projects p LEFT JOIN lps l ON l.project_id = p.id {$acJoin} INNER JOIN users u ON u.id = p.user_id WHERE LOWER(u.email) = LOWER(?) ORDER BY p.id DESC");
    $stmt->bind_param("s", $user_email);
}

if (!$stmt) {
    http_response_code(500);
    echo json_encode(["error" => "Falha ao preparar query de projetos", "details" => $conn->error]);
    $conn->close();
    exit;
}
$stmt->execute();
$stmt->store_result();
$stmt->bind_result($projectId, $projectUserId, $projectName, $projectUrl, $projectPath, $projectFormData, $projectCompanyFormData, $projectContext, $lpPublicUrl, $adPublicUrl, $projectGeneratedHtml, $projectHasGeneratedHtml, $projectCurrentStep, $projectCreatedAt, $projectType, $projectCompanyProjectId);

$projects = [];

while ($stmt->fetch()) {
    $projects[] = [
        "id" => $projectId,
        "user_id" => (int)$projectUserId,
        "name" => $projectName,
        "public_url" => $projectUrl,
        "folder_path" => $projectPath,
        "form_data" => json_decode((string)($projectFormData ?? '{}'), true),
        "company_form_data" => json_decode((string)($projectCompanyFormData ?? '{}'), true),
        "context" => $projectContext,
        "lp_public_url" => $lpPublicUrl,
        "ad_public_url" => $adPublicUrl,
        "generated_html" => $include_html ? $projectGeneratedHtml : "",
        "has_generated_html" => (bool)$projectHasGeneratedHtml,
        "currentStep" => (int)$projectCurrentStep,
        "created_at" => $projectCreatedAt,
        "project_type" => $projectType ?? 'landing_page',
        "company_project_id" => $projectCompanyProjectId ? (int)$projectCompanyProjectId : null,
    ];
}

echo json_encode($projects);

$stmt->close();
$conn->close();
?>
