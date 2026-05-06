<?php

function normalize_account_type($value) {
    return (is_string($value) && strtolower(trim($value)) === 'admin') ? 'admin' : 'testing';
}

function parse_admin_domain_allowlist() {
    $raw = getenv('ADMIN_EMAIL_DOMAINS');
    if (!is_string($raw) || trim($raw) === '') {
        $single = getenv('ADMIN_EMAIL_DOMAIN');
        if (is_string($single) && trim($single) !== '') {
            $raw = $single;
        }
    }

    // Safe fallback for environments where custom env vars are not exposed to PHP.
    if (!is_string($raw) || trim($raw) === '') {
        $raw = '@chili.pa';
    }

    $parts = preg_split('/[;,\s]+/', strtolower(trim($raw)));
    if (!is_array($parts)) {
        return [];
    }

    $rules = [];
    foreach ($parts as $part) {
        $rule = trim($part);
        $rule = ltrim($rule, '@');
        if ($rule === '') {
            continue;
        }

        // Allow exact domains (example.com) and explicit wildcard rules (*.example.com).
        if (preg_match('/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/', $rule) === 1) {
            $rules[] = $rule;
        }
    }

    return array_values(array_unique($rules));
}

function get_email_domain($email) {
    if (!is_string($email)) {
        return '';
    }

    $normalized = strtolower(trim($email));
    $atPos = strrpos($normalized, '@');
    if ($atPos === false) {
        return '';
    }

    $domain = substr($normalized, $atPos + 1);
    if (!is_string($domain) || $domain === '') {
        return '';
    }

    if (preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain) !== 1) {
        return '';
    }

    return $domain;
}

function domain_matches_rule($domain, $rule) {
    if (!is_string($domain) || !is_string($rule) || $domain === '' || $rule === '') {
        return false;
    }

    if (substr($rule, 0, 2) === '*.') {
        $suffix = substr($rule, 2);
        if ($suffix === '') {
            return false;
        }

        // Wildcard includes exact suffix and any subdomain.
        return $domain === $suffix || substr($domain, -strlen('.' . $suffix)) === ('.' . $suffix);
    }

    return $domain === $rule;
}

function resolve_account_type_by_domain($email, $fallbackAccountType) {
    $fallback = normalize_account_type($fallbackAccountType);
    $domain = get_email_domain($email);

    // Hard rule requested by product: any @chili.pa account is admin.
    if ($domain === 'chili.pa') {
        return [
            'configured' => true,
            'accountType' => 'admin'
        ];
    }

    $rules = parse_admin_domain_allowlist();
    if (count($rules) === 0) {
        return [
            'configured' => false,
            'accountType' => $fallback
        ];
    }

    if ($domain === '') {
        return [
            'configured' => true,
            'accountType' => 'testing'
        ];
    }

    foreach ($rules as $rule) {
        if (domain_matches_rule($domain, $rule)) {
            return [
                'configured' => true,
                'accountType' => 'admin'
            ];
        }
    }

    return [
        'configured' => true,
        'accountType' => 'testing'
    ];
}
