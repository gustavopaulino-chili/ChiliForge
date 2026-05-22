<?php
// Shared helpers for all agents endpoints

if (!function_exists('agents_starts_with')) {
    function agents_starts_with(string $haystack, string $needle): bool {
        return $needle === '' || strpos($haystack, $needle) === 0;
    }
}

if (!function_exists('agents_contains')) {
    function agents_contains(string $haystack, string $needle): bool {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}

if (!function_exists('agents_env_value')) {
    function agents_env_value(string $key, string $default = ''): string {
        $value = getenv($key);

        if ((!is_string($value) || trim($value) === '') && isset($_ENV[$key])) {
            $value = $_ENV[$key];
        }

        if (!is_string($value) || trim($value) === '') {
            $envPath = realpath(__DIR__ . '/../../../.env');
            if ($envPath && is_readable($envPath)) {
                $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines ?: [] as $line) {
                    $line = trim($line);
                    if ($line === '' || agents_starts_with($line, '#') || !agents_contains($line, '=')) {
                        continue;
                    }

                    [$envKey, $envValue] = explode('=', $line, 2);
                    if (trim($envKey) === $key) {
                        $value = trim($envValue);
                        break;
                    }
                }
            }
        }

        if (!is_string($value) || trim($value) === '') {
            return $default;
        }

        return trim(trim($value), "\"'");
    }
}

if (!function_exists('agents_is_jwt')) {
    function agents_is_jwt(string $value): bool {
        return substr_count($value, '.') === 2;
    }
}

if (!function_exists('agents_call_edge_function')) {
    function agents_call_edge_function(string $name, array $payload): array {
        $baseUrl = rtrim(agents_env_value('SUPABASE_URL', 'https://vehowvyqxhelyfdesmog.supabase.co'), '/');
        $key     = agents_env_value('SUPABASE_SERVICE_ROLE_KEY');

        if ($key === '' || !agents_is_jwt($key)) {
            throw new RuntimeException('SUPABASE_SERVICE_ROLE_KEY is missing or is not a JWT. Configure the service role JWT on the PHP server; sb_publishable keys cannot call protected Edge Functions as Bearer tokens.');
        }

        $url     = $baseUrl . '/functions/v1/' . $name;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 580,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'apikey: '               . $key,
                'Authorization: Bearer ' . $key,
            ],
        ]);

        $body     = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        unset($ch);

        if ($body === false) throw new RuntimeException("curl error calling {$name}: {$curlErr}");
        if ($httpCode >= 400) throw new RuntimeException("Edge function {$name} returned HTTP {$httpCode}: " . substr((string)$body, 0, 400));

        $decoded = json_decode((string)$body, true);
        if ($decoded === null) throw new RuntimeException("Invalid JSON from {$name}: " . substr((string)$body, 0, 200));
        return $decoded;
    }
}

if (!function_exists('agents_delete_gemini_file_search_document')) {
    function agents_delete_gemini_file_search_document(string $documentName): bool {
        $documentName = trim($documentName);
        if ($documentName === '') return false;

        $apiKey = agents_env_value('GEMINI_API_KEY_PRODUCTION') ?: agents_env_value('GEMINI_API_KEY_TESTING');
        if ($apiKey === '') {
            throw new RuntimeException('GEMINI_API_KEY_PRODUCTION or GEMINI_API_KEY_TESTING is required to delete File Search documents');
        }

        $url = 'https://generativelanguage.googleapis.com/v1beta/' . $documentName . '?key=' . rawurlencode($apiKey);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => 'DELETE',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 60,
        ]);

        $body = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        unset($ch);

        if ($body === false) throw new RuntimeException("curl error deleting Gemini document: {$curlErr}");
        if ($httpCode === 404) return false;
        if ($httpCode >= 400) throw new RuntimeException('Gemini document delete returned HTTP ' . $httpCode . ': ' . substr((string)$body, 0, 300));
        return true;
    }
}

if (!function_exists('agents_extract_document_name')) {
    function agents_extract_document_name(array $storeResult): ?string {
        if (isset($storeResult['document']['documentName']) && is_string($storeResult['document']['documentName'])) {
            return $storeResult['document']['documentName'];
        }
        if (isset($storeResult['document']['name']) && is_string($storeResult['document']['name'])) {
            return $storeResult['document']['name'];
        }
        if (isset($storeResult['operationName']) && is_string($storeResult['operationName'])) {
            return $storeResult['operationName'];
        }
        return null;
    }
}

if (!function_exists('agents_ensure_company_store_files_table')) {
    function agents_ensure_company_store_files_table(mysqli $conn): void {
        $createSql = "CREATE TABLE IF NOT EXISTS company_store_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_project_id INT NOT NULL,
            gemini_file_uri VARCHAR(500) NULL,
            gemini_store_name VARCHAR(255) NULL,
            record_type ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file',
            display_name VARCHAR(255) NOT NULL,
            original_name VARCHAR(255) NULL,
            mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
            file_size_bytes INT NULL,
            storage_path VARCHAR(500) NULL,
            uploaded_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_csf_company (company_project_id),
            INDEX idx_csf_record_type (record_type)
        )";
        if (!$conn->query($createSql)) {
            throw new RuntimeException('Failed to ensure company_store_files table: ' . $conn->error);
        }

        $columns = [
            "gemini_store_name VARCHAR(255) NULL AFTER gemini_file_uri",
            "record_type ENUM('company_profile', 'uploaded_file') NOT NULL DEFAULT 'uploaded_file' AFTER gemini_store_name",
            "original_name VARCHAR(255) NULL AFTER display_name",
            "storage_path VARCHAR(500) NULL AFTER file_size_bytes",
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_store_files' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE company_store_files ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add company_store_files.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_ensure_ads_campaign_memory_columns')) {
    function agents_ensure_ads_campaign_memory_columns(mysqli $conn): void {
        $columns = [
            "creative_plans LONGTEXT NULL AFTER metadata",
            "gemini_memory_store VARCHAR(255) NULL DEFAULT NULL AFTER creative_plans",
            "gemini_good_examples_store VARCHAR(255) NULL DEFAULT NULL AFTER gemini_memory_store",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ads_campaign' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE ads_campaign ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add ads_campaign.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_save_campaign_creative_plan')) {
    function agents_save_campaign_creative_plan(mysqli $conn, int $campaignId, array $formData, string $creativePlanText, string $source = ''): void {
        $creativePlanText = trim($creativePlanText);
        if ($campaignId <= 0 || $creativePlanText === '') return;

        agents_ensure_ads_campaign_memory_columns($conn);

        $plansStmt = $conn->prepare("SELECT creative_plans FROM ads_campaign WHERE id = ? LIMIT 1");
        if (!$plansStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $plansStmt->bind_param('i', $campaignId);
        $plansStmt->execute();
        $plansStmt->bind_result($existingPlansJson);
        $plansStmt->fetch();
        $plansStmt->close();

        $plans = json_decode($existingPlansJson ?: '[]', true);
        if (!is_array($plans)) $plans = [];

        $selectedFormats = $formData['selectedFormats'] ?? [];
        $formatLabels = is_array($selectedFormats) ? array_values(array_filter(array_column($selectedFormats, 'label'))) : [];

        $nextPlan = [
            'date'    => date('Y-m-d H:i'),
            'plan'    => $creativePlanText,
            'formats' => $formatLabels,
        ];
        if ($source !== '') $nextPlan['source'] = $source;

        array_unshift($plans, $nextPlan);
        $plans = array_slice($plans, 0, 10);

        $jsonPlans = json_encode($plans, JSON_UNESCAPED_UNICODE);
        if (!$jsonPlans) throw new RuntimeException('Failed to encode creative plans');

        $updPlans = $conn->prepare("UPDATE ads_campaign SET creative_plans = ? WHERE id = ?");
        if (!$updPlans) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $updPlans->bind_param('si', $jsonPlans, $campaignId);
        $updPlans->execute();
        $updPlans->close();
    }
}

if (!function_exists('agents_ensure_campaign_examples_table')) {
    function agents_ensure_campaign_examples_table(mysqli $conn): void {
        $createSql = "CREATE TABLE IF NOT EXISTS ads_campaign_examples (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT NOT NULL,
            creative_id INT NOT NULL,
            gemini_store_name VARCHAR(255) NULL,
            gemini_document_name VARCHAR(500) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_campaign_example (campaign_id, creative_id),
            INDEX idx_campaign_examples_campaign (campaign_id),
            INDEX idx_campaign_examples_creative (creative_id)
        )";
        if (!$conn->query($createSql)) {
            throw new RuntimeException('Failed to ensure ads_campaign_examples table: ' . $conn->error);
        }

        $columns = [
            "gemini_store_name VARCHAR(255) NULL AFTER creative_id",
            "gemini_document_name VARCHAR(500) NULL AFTER gemini_store_name",
        ];

        foreach ($columns as $definition) {
            $column = trim(strtok($definition, ' '));
            $existsStmt = $conn->prepare(
                "SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ads_campaign_examples' AND COLUMN_NAME = ?"
            );
            if (!$existsStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $existsStmt->bind_param('s', $column);
            $existsStmt->execute();
            $existsStmt->bind_result($count);
            $existsStmt->fetch();
            $existsStmt->close();

            if ((int)$count === 0 && !$conn->query("ALTER TABLE ads_campaign_examples ADD COLUMN {$definition}")) {
                throw new RuntimeException('Failed to add ads_campaign_examples.' . $column . ': ' . $conn->error);
            }
        }
    }
}

if (!function_exists('agents_upsert_company_profile_record')) {
    function agents_upsert_company_profile_record(
        mysqli $conn,
        int $companyProjectId,
        string $storeName,
        ?string $documentName,
        int $userId = 0
    ): void {
        agents_ensure_company_store_files_table($conn);

        $recordType = 'company_profile';
        $displayName = 'Company Profile / Brand Guidelines';
        $mimeType = 'text/plain';
        $fileSize = null;
        $uploadedBy = $userId > 0 ? $userId : null;

        $selectStmt = $conn->prepare(
            "SELECT id FROM company_store_files
             WHERE company_project_id = ? AND record_type = 'company_profile'
             ORDER BY id DESC LIMIT 1"
        );
        if (!$selectStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $selectStmt->bind_param('i', $companyProjectId);
        $selectStmt->execute();
        $selectStmt->bind_result($existingId);
        $hasExisting = $selectStmt->fetch();
        $selectStmt->close();

        if ($hasExisting) {
            $updateStmt = $conn->prepare(
                "UPDATE company_store_files
                 SET gemini_file_uri = COALESCE(?, gemini_file_uri),
                     gemini_store_name = ?,
                     display_name = ?,
                     mime_type = ?,
                     uploaded_by = COALESCE(uploaded_by, ?)
                 WHERE id = ?"
            );
            if (!$updateStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $updateStmt->bind_param('ssssii', $documentName, $storeName, $displayName, $mimeType, $uploadedBy, $existingId);
            $updateStmt->execute();
            $updateStmt->close();
            return;
        }

        $insertStmt = $conn->prepare(
            "INSERT INTO company_store_files
             (company_project_id, gemini_file_uri, gemini_store_name, record_type, display_name, mime_type, file_size_bytes, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        if (!$insertStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $insertStmt->bind_param('isssssii', $companyProjectId, $documentName, $storeName, $recordType, $displayName, $mimeType, $fileSize, $uploadedBy);
        $insertStmt->execute();
        $insertStmt->close();
    }
}

if (!function_exists('agents_sync_company_store')) {
    function agents_sync_company_store(
        mysqli $conn,
        int $companyProjectId,
        array $companyFormData,
        string $accountType,
        int $userId = 0,
        ?string $existingStoreName = null
    ): string {
        $companyDocument = buildCompanyDocument($companyFormData);

        $storeResult = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'storeName'     => $existingStoreName ?: null,
            'displayName'   => 'company-' . $companyProjectId . '-brandguide',
            'documentText'  => $companyDocument,
            'documentLabel' => 'Brand Guidelines',
            'accountType'   => $accountType,
        ]);

        if (empty($storeResult['storeName'])) {
            throw new RuntimeException('agents-store did not return a storeName');
        }

        $storeName = (string)$storeResult['storeName'];
        $documentName = agents_extract_document_name($storeResult);

        $saveStmt = $conn->prepare("UPDATE projects SET gemini_store_name = ? WHERE id = ?");
        if (!$saveStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
        $saveStmt->bind_param('si', $storeName, $companyProjectId);
        $saveStmt->execute();
        $saveStmt->close();

        agents_upsert_company_profile_record($conn, $companyProjectId, $storeName, $documentName, $userId);

        return $storeName;
    }
}

if (!function_exists('buildCompanyDocument')) {
    function buildCompanyDocument(array $fd): string {
        $str = fn($v) => is_string($v) ? trim($v) : '';
        $arr = fn($v) => is_array($v) ? array_filter(array_map('strval', $v)) : [];

        $theme    = is_array($fd['theme']       ?? null) ? $fd['theme']       : [];
        $images   = is_array($fd['images']      ?? null) ? $fd['images']      : [];
        $contact  = is_array($fd['contact']     ?? null) ? $fd['contact']     : [];
        $social   = is_array($fd['socialLinks'] ?? null) ? $fd['socialLinks'] : [];
        $location = is_array($fd['location']    ?? null) ? $fd['location']    : [];

        $name = $str($fd['businessName'] ?? $fd['brandName'] ?? '');
        $doc  = "# {$name} — Brand & Marketing Guidelines\n\n";

        $industry = $str($fd['businessCategory'] ?? $fd['industry'] ?? '');
        if ($industry !== '') $doc .= "Industry: {$industry}\n\n";

        $desc = $str($fd['businessDescription'] ?? '');
        if ($desc !== '') $doc .= "## Company Overview\n{$desc}\n\n";

        $services = $arr($fd['services'] ?? []);
        if (!empty($services)) {
            $doc .= "## Products & Services\n" . implode("\n", array_map(fn($s) => "- {$s}", $services)) . "\n\n";
        }

        $audience = $str($fd['targetAudience']    ?? '');
        $value    = $str($fd['valueProposition']  ?? '');
        $diff     = implode(', ', $arr($fd['differentiators'] ?? []));
        if ($audience !== '' || $value !== '' || $diff !== '') {
            $doc .= "## Target Audience & Positioning\n";
            if ($audience !== '') $doc .= "Audience: {$audience}\n";
            if ($value    !== '') $doc .= "Value Proposition: {$value}\n";
            if ($diff     !== '') $doc .= "Differentiators: {$diff}\n";
            $doc .= "\n";
        }

        $tone        = $str($fd['toneOfVoice']      ?? '');
        $personality = $str($fd['brandPersonality'] ?? '');
        $keywords    = $str($fd['brandKeywords']    ?? '');
        $forbidden   = $str($fd['forbiddenWords']   ?? '');
        if ($tone !== '' || $personality !== '' || $keywords !== '' || $forbidden !== '') {
            $doc .= "## Brand Voice\n";
            if ($tone        !== '') $doc .= "Tone: {$tone}\n";
            if ($personality !== '') $doc .= "Personality: {$personality}\n";
            if ($keywords    !== '') $doc .= "Required keywords: {$keywords}\n";
            if ($forbidden   !== '') $doc .= "Forbidden words: {$forbidden}\n";
            $doc .= "\n";
        }

        $primary    = $str($theme['primary']    ?? $fd['primaryColor']    ?? '');
        $secondary  = $str($theme['secondary']  ?? $fd['secondaryColor']  ?? '');
        $accent     = $str($theme['accent']     ?? $fd['accentColor']     ?? '');
        $background = $str($theme['background'] ?? $fd['backgroundColor'] ?? '');
        $textColor  = $str($theme['text']       ?? $fd['textColor']       ?? '');
        $hFont      = $str($theme['headingFont'] ?? $fd['headingFont']    ?? '');
        $bFont      = $str($theme['bodyFont']   ?? $fd['bodyFont']        ?? '');
        $style      = $str($theme['style']      ?? $fd['preferredStyle']  ?? '');
        $logo       = $str($images['logo']      ?? $images['logoUrl']     ?? $fd['logoUrl']   ?? '');
        $hero       = $str($images['hero']      ?? $images['heroImage1']  ?? $fd['heroImage'] ?? '');

        if ($primary !== '' || $logo !== '' || $hFont !== '') {
            $doc .= "## Visual Identity\n";
            if ($primary    !== '') $doc .= "Primary color: {$primary}\n";
            if ($secondary  !== '') $doc .= "Secondary color: {$secondary}\n";
            if ($accent     !== '') $doc .= "Accent color: {$accent}\n";
            if ($background !== '') $doc .= "Background color: {$background}\n";
            if ($textColor  !== '') $doc .= "Text color: {$textColor}\n";
            if ($hFont      !== '') $doc .= "Heading font: {$hFont}\n";
            if ($bFont      !== '') $doc .= "Body font: {$bFont}\n";
            if ($style      !== '') $doc .= "Style: {$style}\n";
            if ($logo       !== '') $doc .= "Logo URL: {$logo}\n";
            if ($hero       !== '') $doc .= "Hero image URL: {$hero}\n";
            $doc .= "\n";
        }

        $sections = $arr($images['sections'] ?? $images['productImages'] ?? $fd['productImages'] ?? []);
        if (!empty($sections)) {
            $doc .= "## Additional Images\n" . implode("\n", array_map(fn($u) => "- {$u}", $sections)) . "\n\n";
        }

        $city    = $str($location['city']    ?? $fd['city']    ?? '');
        $country = $str($location['country'] ?? $fd['country'] ?? '');
        $email   = $str($contact['email']    ?? $fd['email']   ?? '');
        $phone   = $str($contact['phone']    ?? $fd['phone']   ?? '');
        $wa      = $str($contact['whatsapp'] ?? $fd['whatsapp'] ?? '');
        $website = $str($fd['sourceWebsite'] ?? '');
        $loc     = trim("{$city}, {$country}", ', ');

        if ($loc !== '' || $email !== '' || $phone !== '' || $wa !== '' || $website !== '') {
            $doc .= "## Contact & Location\n";
            if ($loc     !== '') $doc .= "Location: {$loc}\n";
            if ($email   !== '') $doc .= "Email: {$email}\n";
            if ($phone   !== '') $doc .= "Phone: {$phone}\n";
            if ($wa      !== '') $doc .= "WhatsApp: {$wa}\n";
            if ($website !== '') $doc .= "Website: {$website}\n";
            $doc .= "\n";
        }

        foreach ($social as $platform => $url) {
            if (is_string($url) && trim($url) !== '') {
                $doc .= strtoupper($platform) . ': ' . trim($url) . "\n";
            }
        }

        // Prescriptive rules for ad generation — consumed by the planner and HTML generator
        $adRules = [];
        if ($logo !== '') {
            $adRules[] = "Logo URL: {$logo} — render as <img> with object-fit:contain in every banner.";
        }
        if ($primary !== '') {
            $adRules[] = "Primary brand color: {$primary} — must appear on the dominant visual element.";
        }
        if ($accent !== '') {
            $adRules[] = "Accent color: {$accent} — use exclusively on CTA buttons and key highlights.";
        }
        if ($background !== '') {
            $adRules[] = "Base background color: {$background} — use when no background image is available.";
        }
        if (!empty($services)) {
            $top = implode(', ', array_slice($services, 0, 3));
            $adRules[] = "Feature these services/products when no specific product is in the campaign: {$top}";
        }
        if ($audience !== '') {
            $adRules[] = "Write all copy as if speaking directly to: {$audience}";
        }
        if ($tone !== '') {
            $adRules[] = "Tone of voice: {$tone} — apply to headline, subheadline, and CTA.";
        }
        if ($forbidden !== '') {
            $adRules[] = "Forbidden words/claims: {$forbidden} — never use these.";
        }

        $imgCatalog = [];
        if ($logo !== '') $imgCatalog[] = "Logo: {$logo}";
        if ($hero !== '') $imgCatalog[] = "Hero/brand image: {$hero}";
        foreach (array_slice($sections, 0, 3) as $url) $imgCatalog[] = "Product/brand image: {$url}";

        if (!empty($adRules) || !empty($imgCatalog)) {
            $doc .= "## Ad Generation Rules\n";
            foreach ($adRules as $rule) $doc .= "- {$rule}\n";
            if (!empty($adRules)) $doc .= "\n";
            if (!empty($imgCatalog)) {
                $doc .= "### Available Image Assets (use in <img src='...'>)\n";
                foreach ($imgCatalog as $asset) $doc .= "- {$asset}\n";
                $doc .= "\n";
            }
        }

        return trim($doc);
    }
}

if (!function_exists('agents_lazy_init_store')) {
    function agents_lazy_init_store(
        mysqli $conn,
        int $companyProjectId,
        ?string &$geminiStoreName,
        string $companyDocument,
        string $accountType,
        int $userId = 0
    ): void {
        if (!empty($geminiStoreName)) {
            agents_upsert_company_profile_record($conn, $companyProjectId, $geminiStoreName, null, $userId);
            return;
        }

        $storeResult = agents_call_edge_function('agents-store', [
            'action'        => 'get_or_create',
            'displayName'   => 'company-' . $companyProjectId . '-brandguide',
            'documentText'  => $companyDocument,
            'documentLabel' => 'Brand Guidelines',
            'accountType'   => $accountType,
        ]);

        if (!empty($storeResult['storeName'])) {
            $geminiStoreName = (string)$storeResult['storeName'];
            $documentName = agents_extract_document_name($storeResult);
            $saveStmt = $conn->prepare("UPDATE projects SET gemini_store_name = ? WHERE id = ?");
            if (!$saveStmt) throw new RuntimeException('DB prepare error: ' . $conn->error);
            $saveStmt->bind_param('si', $geminiStoreName, $companyProjectId);
            $saveStmt->execute();
            $saveStmt->close();
            agents_upsert_company_profile_record($conn, $companyProjectId, $geminiStoreName, $documentName, $userId);
        }
    }
}
