<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . DIRECTORY_SEPARATOR . 'site_helpers.php';

$data = json_decode(file_get_contents("php://input"), true);
if (!$data || !isset($data['project_id']) || !isset($data['user_id']) || !isset($data['company_project_id'])) {
    http_response_code(400);
    echo json_encode(["error" => "project_id, user_id and company_project_id are required"]);
    exit;
}

$projectId = (int)$data['project_id'];
$userId = (int)$data['user_id'];
$companyProjectId = (int)$data['company_project_id'];

if ($projectId <= 0 || $userId <= 0 || $companyProjectId <= 0 || $projectId === $companyProjectId) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid project/company identifiers"]);
    exit;
}

function move_project_replace_recursive($value, string $oldPrefix, string $newPrefix) {
    if ($oldPrefix === '' || $oldPrefix === $newPrefix) {
        return $value;
    }

    if (is_string($value)) {
        return str_replace($oldPrefix, $newPrefix, $value);
    }

    if (is_array($value)) {
        foreach ($value as $key => $item) {
            $value[$key] = move_project_replace_recursive($item, $oldPrefix, $newPrefix);
        }
    }

    return $value;
}

function move_project_rewrite_file_prefixes(string $dir, string $oldPrefix, string $newPrefix): void {
    foreach (['index.html', 'style.css', 'script.js'] as $fileName) {
        $path = $dir . DIRECTORY_SEPARATOR . $fileName;
        if (is_file($path)) {
            $content = file_get_contents($path);
            if (is_string($content) && str_contains($content, $oldPrefix)) {
                file_put_contents($path, str_replace($oldPrefix, $newPrefix, $content));
            }
        }
    }

    $entries = @scandir($dir);
    if (!is_array($entries)) {
        return;
    }

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $child = $dir . DIRECTORY_SEPARATOR . $entry;
        if (is_dir($child)) {
            move_project_rewrite_file_prefixes($child, $oldPrefix, $newPrefix);
        }
    }
}

function move_project_rewrite_form_data($value, string $oldPrefix, string $newPrefix): string {
    if (is_string($value)) {
        return str_replace($oldPrefix, $newPrefix, $value);
    }

    $rewritten = move_project_replace_recursive($value, $oldPrefix, $newPrefix);
    $json = json_encode($rewritten, JSON_UNESCAPED_UNICODE);
    return is_string($json) && $json !== '' ? $json : '{}';
}

include "db.php";

try {
    $project = find_project_for_user($conn, $projectId, $userId, 'p.id');
    if (!$project) {
        throw new RuntimeException('Project not found');
    }
    if (($project['project_type'] ?? '') === 'project') {
        throw new RuntimeException('Company projects cannot be moved into another company.');
    }

    $companyStmt = $conn->prepare(
        "SELECT id, public_url, folder_path
         FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project'
         LIMIT 1"
    );
    if (!$companyStmt) {
        throw new RuntimeException('Could not prepare company lookup: ' . $conn->error);
    }
    $companyStmt->bind_param("ii", $companyProjectId, $userId);
    $companyStmt->execute();
    $companyResult = $companyStmt->get_result();
    $company = ($companyResult !== false) ? $companyResult->fetch_assoc() : null;
    $companyStmt->close();

    if (!$company) {
        throw new RuntimeException('Target company not found');
    }

    $oldFolderPath = (string)($project['folder_path'] ?? '');
    $oldPublicUrl = (string)($project['public_url'] ?? '');
    $oldProjectDir = resolve_project_directory_from_folder_path($oldFolderPath, $oldPublicUrl);
    $oldRelative = extract_project_relative_path_from_folder_path($oldFolderPath);
    if ($oldRelative === '') {
        $oldRelative = extract_project_relative_path_from_public_url($oldPublicUrl);
    }
    if ($oldRelative === '') {
        throw new RuntimeException('Could not resolve current project path');
    }

    $companyRelative = extract_project_relative_path_from_folder_path((string)($company['folder_path'] ?? ''));
    if ($companyRelative === '') {
        $companyRelative = extract_project_relative_path_from_public_url((string)($company['public_url'] ?? ''));
    }
    if ($companyRelative === '') {
        throw new RuntimeException('Could not resolve target company folder');
    }

    $currentParent = implode('/', array_slice(explode('/', trim($oldRelative, '/')), 0, -1));
    if ($currentParent === trim($companyRelative, '/')) {
        $updateOnly = $conn->prepare("UPDATE projects SET company_project_id = ? WHERE id = ? AND user_id = ?");
        if (!$updateOnly) {
            throw new RuntimeException('Could not prepare project update: ' . $conn->error);
        }
        $updateOnly->bind_param("iii", $companyProjectId, $projectId, $userId);
        $updateOnly->execute();
        $updateOnly->close();
        echo json_encode([
            "success" => true,
            "id" => $projectId,
            "company_project_id" => $companyProjectId,
            "public_url" => $oldPublicUrl,
            "folder_path" => $oldFolderPath,
        ]);
        $conn->close();
        exit;
    }

    $oldSlug = basename($oldProjectDir);
    $companyDir = project_directory_from_relative($companyRelative);
    ensure_directory($companyDir);
    $newSlug = !is_dir($companyDir . DIRECTORY_SEPARATOR . $oldSlug)
        ? $oldSlug
        : ensure_unique_slug($oldSlug, $companyDir);
    $newRelative = trim($companyRelative, '/') . '/' . $newSlug;
    $newProjectDir = project_directory_from_relative($newRelative);
    $newPublicUrl = project_public_url_from_relative($newRelative);
    $newFolderPath = project_folder_path_from_relative($newRelative);
    $oldPrefix = project_public_url_from_relative($oldRelative);

    if (!@rename($oldProjectDir, $newProjectDir)) {
        throw new RuntimeException('Could not move project folder');
    }

    move_project_rewrite_file_prefixes($newProjectDir, $oldPrefix, $newPublicUrl);

    $conn->begin_transaction();

    $updProject = $conn->prepare("UPDATE projects SET company_project_id = ?, public_url = ?, folder_path = ? WHERE id = ? AND user_id = ?");
    if (!$updProject) {
        throw new RuntimeException('Could not prepare project update: ' . $conn->error);
    }
    $updProject->bind_param("issii", $companyProjectId, $newPublicUrl, $newFolderPath, $projectId, $userId);
    $updProject->execute();
    $updProject->close();

    if (($project['project_type'] ?? '') === 'ad_creative') {
        $rewrittenFormData = move_project_rewrite_form_data($project['form_data'] ?? [], $oldPrefix, $newPublicUrl);
        $updCampaign = $conn->prepare("UPDATE ads_campaign SET public_url = ?, form_data = ?, updated_at = NOW() WHERE project_id = ?");
        if ($updCampaign) {
            $updCampaign->bind_param("ssi", $newPublicUrl, $rewrittenFormData, $projectId);
            $updCampaign->execute();
            $updCampaign->close();
        }

        $creativeResult = $conn->query("SELECT id, public_url, generated_html FROM ads_creatives WHERE project_id = " . (int)$projectId);
        if ($creativeResult) {
            while ($creative = $creativeResult->fetch_assoc()) {
                $oldCreativeUrl = (string)($creative['public_url'] ?? '');
                $newCreativeUrl = str_starts_with($oldCreativeUrl, $oldPrefix)
                    ? $newPublicUrl . ltrim(substr($oldCreativeUrl, strlen($oldPrefix)), '/')
                    : $oldCreativeUrl;
                $newHtml = str_replace($oldPrefix, $newPublicUrl, (string)($creative['generated_html'] ?? ''));
                $updCreative = $conn->prepare("UPDATE ads_creatives SET public_url = ?, generated_html = ?, updated_at = NOW() WHERE id = ? AND project_id = ?");
                if ($updCreative) {
                    $creativeId = (int)$creative['id'];
                    $updCreative->bind_param("ssii", $newCreativeUrl, $newHtml, $creativeId, $projectId);
                    $updCreative->execute();
                    $updCreative->close();
                }
            }
        }
    } else {
        $rewrittenFormData = move_project_rewrite_form_data($project['form_data'] ?? [], $oldPrefix, $newPublicUrl);
        $updLp = $conn->prepare(
            "UPDATE lps
             SET public_url = ?, folder_path = ?, form_data = ?, generated_html = REPLACE(COALESCE(generated_html, ''), ?, ?)
             WHERE project_id = ?"
        );
        if ($updLp) {
            $updLp->bind_param("sssssi", $newPublicUrl, $newFolderPath, $rewrittenFormData, $oldPrefix, $newPublicUrl, $projectId);
            $updLp->execute();
            $updLp->close();
        }
    }

    $conn->commit();

    echo json_encode([
        "success" => true,
        "id" => $projectId,
        "company_project_id" => $companyProjectId,
        "public_url" => $newPublicUrl,
        "folder_path" => $newFolderPath,
    ]);
} catch (Throwable $error) {
    if (isset($conn) && $conn instanceof mysqli) {
        try { $conn->rollback(); } catch (Throwable $ignored) {}
    }
    http_response_code(500);
    echo json_encode([
        "error" => "Failed to move project",
        "details" => $error->getMessage(),
    ]);
}

$conn->close();
?>
