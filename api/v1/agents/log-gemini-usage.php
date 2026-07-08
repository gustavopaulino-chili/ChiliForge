<?php
/**
 * Internal usage sink — records ONE Gemini call's cost into the gemini_usage table.
 *
 * Called server-to-server by the Supabase edge functions (agents-ads, agents-lp, …) right
 * after each Gemini response, sending the RAW usageMetadata so PHP stays the single pricing
 * authority. PHP-native calls (chat, setup-wizard) persist directly via gemini_record_usage().
 *
 * Auth: shared secret in body {"secret":"…"} or header X-Usage-Secret, matched against
 * getenv('USAGE_LOG_SECRET'). This is NOT a public endpoint.
 *
 * Body JSON: { secret, source, model, usage:{promptTokenCount,candidatesTokenCount,thoughtsTokenCount,…},
 *              job_id?, meta? }
 */

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Usage-Secret");
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo json_encode(['error' => 'POST only']); exit; }

set_time_limit(10);
ini_set('memory_limit', '32M');

include __DIR__ . '/../../db.php';
include __DIR__ . '/helpers.php';

$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'invalid json']); exit; }

// ── Auth (shared secret) ────────────────────────────────────────────────────
$expected = (string) getenv('USAGE_LOG_SECRET');
$provided = (string) ($body['secret'] ?? $_SERVER['HTTP_X_USAGE_SECRET'] ?? '');
if ($expected === '' || !hash_equals($expected, $provided)) {
    http_response_code(401); echo json_encode(['error' => 'unauthorized']); exit;
}

$source = mb_substr(trim((string) ($body['source'] ?? 'edge')), 0, 60);
$model  = mb_substr(trim((string) ($body['model']  ?? '')), 0, 60);
$usage  = is_array($body['usage'] ?? null) ? $body['usage'] : [];
$jobId  = isset($body['job_id']) && $body['job_id'] !== null ? (int) $body['job_id'] : null;
$meta   = isset($body['meta']) ? (string) $body['meta'] : null;

if ($model === '') { http_response_code(400); echo json_encode(['error' => 'model required']); exit; }

$usd = gemini_record_usage($source, $model, $usage, $jobId, $meta, $conn);
echo json_encode(['ok' => true, 'usd' => round($usd, 6)]);
