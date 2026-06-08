<?php
// LEAD MAILER CONFIG — TEMPLATE.
// The Forge LP generator copies this kit into each LP project and writes a real
// `config.php` next to it (filled from the project's lead-capture settings).
// NEVER commit a filled config.php; keep real credentials out of the repo/frontend.
return [
    // 'test' -> sends to `to_test` (safe while the LP is a draft / being edited).
    // 'live' -> sends to `to_live` with the client's real SMTP. Set on publish.
    'mode' => 'test',

    // SMTP transport. Use 465 (SSL) or 587 (TLS) — never 25.
    'smtp_host'   => '',
    'smtp_port'   => 587,
    'smtp_secure' => 'tls',   // 'ssl' (465) | 'tls' (587)
    'smtp_user'   => '',
    'smtp_pass'   => '',

    // Message envelope.
    'from'             => ['email' => '', 'name' => ''],
    'reply_to'         => '',                  // optional; falls back to the lead's email
    'subject_template' => 'Novo lead: {name}', // {field} placeholders from the form

    // Recipients.
    'to_live' => '', // client's real inbox OR a CRM "email-to-lead" address
    'to_test' => '', // sandbox/test inbox

    // Optional: form field => human label (controls order + labels in the email).
    // Empty = include every submitted field (auto-labelled).
    'field_map' => [],

    // CORS: the LP's own origin. Empty = same-origin only.
    'allowed_origin' => '',

    // Transport selector — only 'smtp' for now (webhook later).
    'transport' => 'smtp',
];
