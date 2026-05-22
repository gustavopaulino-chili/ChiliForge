<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

set_time_limit(300);
ini_set('memory_limit', '256M');

require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/../../accountType.php';
require_once __DIR__ . '/helpers.php';
include   __DIR__ . '/../../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$userId           = (int)($body['user_id']            ?? 0);
$companyProjectId = (int)($body['company_project_id'] ?? 0);

if ($userId <= 0 || $companyProjectId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'user_id and company_project_id are required']);
    exit;
}

try {
    // 1. Load company project + verify ownership
    $stmt = $conn->prepare(
        "SELECT id, company_form_data, gemini_store_name FROM projects
         WHERE id = ? AND user_id = ? AND project_type = 'project' LIMIT 1"
    );
    if (!$stmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $stmt->bind_param('ii', $companyProjectId, $userId);
    $stmt->execute();
    $stmt->bind_result($projId, $companyFormDataJson, $geminiStoreName);
    if (!$stmt->fetch()) {
        $stmt->close();
        http_response_code(404);
        echo json_encode(['error' => 'Company project not found or access denied']);
        exit;
    }
    $stmt->close();

    $companyFormData = json_decode($companyFormDataJson ?: '{}', true) ?: [];

    // 2. Load LP_AGENT
    $agentStmt = $conn->prepare(
        "SELECT system_prompt, model, temperature, max_tokens, version
         FROM agents WHERE name = 'LP_AGENT' AND is_active = 1 LIMIT 1"
    );
    if (!$agentStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
    $agentStmt->execute();
    $agentStmt->bind_result($systemPrompt, $model, $temperature, $maxTokens, $agentVersion);
    if (!$agentStmt->fetch()) {
        $agentStmt->close();
        http_response_code(500);
        echo json_encode(['error' => 'LP_AGENT not found. Run the agents seed SQL first.']);
        exit;
    }
    $agentStmt->close();

    // 3. Determine account type
    $emailStmt = $conn->prepare("SELECT email FROM users WHERE id = ? LIMIT 1");
    $emailStmt->bind_param('i', $userId);
    $emailStmt->execute();
    $emailStmt->bind_result($userEmail);
    $emailStmt->fetch();
    $emailStmt->close();
    $accountTypeResult = resolve_account_type_by_domain($userEmail ?? '', 'user');
    $accountType = $accountTypeResult['accountType'];

    // 4. Read global LP store from system_settings
    $globalStore = '';
    $settingStmt = $conn->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_global_lp_store' LIMIT 1");
    if ($settingStmt) {
        $settingStmt->execute();
        $settingStmt->bind_result($globalStore);
        $settingStmt->fetch();
        $settingStmt->close();
    }

    // 5. Build company document (fallback text + store upload)
    $companyDocument = buildCompanyDocument($companyFormData);

    // 6. Lazy init File Search Store
    agents_lazy_init_store($conn, $companyProjectId, $geminiStoreName, $companyDocument, $accountType, $userId);

    // 7. Build generation choices. User form fields define WHAT to generate;
    // global/company File Search stores define HOW to apply reusable guidelines.
    $choices = [];
    $formData = is_array($body['form_data'] ?? null) ? $body['form_data'] : [];
    $str = fn($v) => is_string($v) ? trim($v) : '';
    $arr = fn($v) => is_array($v) ? array_values(array_filter(array_map('strval', $v))) : [];

    if (!empty($formData)) {
        $theme = is_array($formData['theme'] ?? null) ? $formData['theme'] : [];
        $images = is_array($formData['images'] ?? null) ? $formData['images'] : [];
        $contact = is_array($formData['contact'] ?? null) ? $formData['contact'] : [];
        $location = is_array($formData['location'] ?? null) ? $formData['location'] : [];
        $imageContexts = is_array($formData['imageContexts'] ?? null) ? $formData['imageContexts'] : [];
        $socialProof = is_array($formData['socialProofConfig'] ?? null) ? $formData['socialProofConfig'] : [];

        $choices[] = "=== CURRENT FORM BRIEF (HIGHEST PRIORITY USER INPUT) ===";
        if ($str($formData['landingPreset'] ?? '') !== '') $choices[] = 'Landing preset: ' . $str($formData['landingPreset']);
        if ($str($formData['generationObjective'] ?? '') !== '') $choices[] = 'Generation objective: ' . $str($formData['generationObjective']);
        if ($str($formData['businessCategory'] ?? '') !== '') $choices[] = 'Business category: ' . $str($formData['businessCategory']);
        if ($str($formData['conversionGoal'] ?? '') !== '') $choices[] = 'Conversion goal: ' . $str($formData['conversionGoal']);
        if ($str($formData['language'] ?? '') !== '') $choices[] = 'Language: ' . $str($formData['language']);
        if ($str($formData['brandPersonality'] ?? '') !== '') $choices[] = 'Brand personality: ' . $str($formData['brandPersonality']);
        if ($str($formData['toneOfVoice'] ?? '') !== '') $choices[] = 'Tone of voice: ' . $str($formData['toneOfVoice']);
        if ($str($formData['urgencyLevel'] ?? '') !== '') $choices[] = 'Urgency level: ' . $str($formData['urgencyLevel']);
        if ($str($formData['guarantee'] ?? '') !== '') $choices[] = 'Guarantee: ' . $str($formData['guarantee']);
        if ($str($formData['sessionsObjectiveContext'] ?? '') !== '') $choices[] = "Page/section direction:\n" . $str($formData['sessionsObjectiveContext']);

        $services = $arr($formData['services'] ?? []);
        if (!empty($services)) $choices[] = 'Services/offers: ' . implode(' | ', $services);
        $diffs = $arr($formData['differentiators'] ?? []);
        if (!empty($diffs)) $choices[] = 'Differentiators: ' . implode(' | ', $diffs);

        $choices[] = "=== BRAND EXECUTION FROM FORM ===";
        if ($str($theme['style'] ?? '') !== '') $choices[] = 'Visual style: ' . $str($theme['style']);
        foreach (['primary', 'secondary', 'accent', 'background', 'text', 'headingFont', 'bodyFont'] as $key) {
            if ($str($theme[$key] ?? '') !== '') $choices[] = $key . ': ' . $str($theme[$key]);
        }

        $choices[] = "=== FORM ASSETS AND CONTACT ===";
        foreach (['logo', 'hero', 'about', 'team'] as $key) {
            if ($str($images[$key] ?? '') !== '') $choices[] = strtoupper($key) . ' image URL: ' . $str($images[$key]);
        }
        $sectionImages = $arr($images['sections'] ?? []);
        if (!empty($sectionImages)) $choices[] = 'Section image URLs: ' . implode(' | ', $sectionImages);
        $productImages = $arr($images['products'] ?? []);
        if (!empty($productImages)) $choices[] = 'Product image URLs: ' . implode(' | ', $productImages);
        foreach ($imageContexts as $key => $value) {
            if ($str($value) !== '') $choices[] = 'Image context ' . $key . ': ' . $str($value);
        }
        if ($str($contact['email'] ?? '') !== '') $choices[] = 'Email: ' . $str($contact['email']);
        if ($str($contact['phone'] ?? '') !== '') $choices[] = 'Phone: ' . $str($contact['phone']);
        if ($str($contact['whatsapp'] ?? '') !== '') $choices[] = 'WhatsApp: ' . $str($contact['whatsapp']);
        if ($str($location['city'] ?? '') !== '' || $str($location['country'] ?? '') !== '') {
            $choices[] = 'Location: ' . trim($str($location['city'] ?? '') . ', ' . $str($location['country'] ?? ''), ', ');
        }

        $choices[] = "=== TRUST AND CONVERSION FLAGS ===";
        foreach (['socialProof', 'testimonials', 'trustBadges'] as $key) {
            if (array_key_exists($key, $socialProof)) $choices[] = $key . ': ' . (!empty($socialProof[$key]) ? 'enabled' : 'disabled');
        }
        if (array_key_exists('countdownTimer', $formData)) $choices[] = 'countdownTimer: ' . (!empty($formData['countdownTimer']) ? 'enabled' : 'disabled');
        if ($str($formData['sourceWebsite'] ?? '') !== '') $choices[] = 'Source website reference: ' . $str($formData['sourceWebsite']);
        if ($str($formData['designNotes'] ?? '') !== '') $choices[] = "Design notes:\n" . $str($formData['designNotes']);
    }

    if (!empty($body['objective']))       $choices[] = 'Campaign objective: '  . $body['objective'];
    if (!empty($body['conversion_goal'])) $choices[] = 'Conversion goal: '     . $body['conversion_goal'];
    if (!empty($body['hero_layout']))     $choices[] = 'Hero layout: '         . $body['hero_layout'];
    if (!empty($body['cta_label']))       $choices[] = 'Primary CTA label: "'  . $body['cta_label'] . '"';
    if (!empty($body['cta_href']))        $choices[] = 'Primary CTA href: '    . $body['cta_href'];
    if (!empty($body['offer_text']))      $choices[] = 'Offer to highlight: '  . $body['offer_text'];
    if (!empty($body['urgency_text']))    $choices[] = 'Urgency message: '     . $body['urgency_text'];
    if (!empty($body['design_notes']) && empty($formData)) $choices[] = 'Design notes: ' . $body['design_notes'];
    if (!empty($body['language']))        $choices[] = 'Language: '            . $body['language'];
    if (!empty($body['target_url']))      $choices[] = 'Target URL for CTAs: ' . $body['target_url'];
    if (!empty($body['sections']) && is_array($body['sections'])) {
        $choices[] = 'Include sections: ' . implode(', ', $body['sections']);
    }
    if (!empty($body['additional_images']) && is_array($body['additional_images'])) {
        $choices[] = 'Additional images: ' . implode(', ', $body['additional_images']);
    }

    $generationChoices = !empty($choices)
        ? implode("\n", $choices)
        : 'Generate the best possible landing page for this company.';

    // 8. Call agents-lp edge function
    $result = agents_call_edge_function('agents-lp', [
        'agentConfig' => [
            'systemPrompt' => $systemPrompt,
            'model'        => $model,
            'temperature'  => (float)$temperature,
            'maxTokens'    => (int)$maxTokens,
            'version'      => (int)$agentVersion,
        ],
        'globalStoreName'        => $globalStore ?: null,
        'companyStoreName'       => $geminiStoreName ?? '',
        'generationChoices'      => $generationChoices,
        'customSlug'             => !empty($body['custom_slug']) ? $body['custom_slug'] : null,
        'accountType'            => $accountType,
    ]);

    if (!empty($result['error'])) {
        throw new RuntimeException('agents-lp error: ' . $result['error']);
    }

    echo json_encode([
        'success'      => true,
        'html'         => $result['html']   ?? '',
        'slug'         => $result['slug']   ?? '',
        'assets'       => $result['assets'] ?? [],
        'agentVersion' => (int)$agentVersion,
        'usedStores'   => $result['usedStores'] ?? [],
        'groundingMetadata' => $result['groundingMetadata'] ?? null,
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    error_log('[agents/generate-landing] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
