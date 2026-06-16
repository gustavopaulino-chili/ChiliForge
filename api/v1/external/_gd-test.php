<?php
// TEMP visual test for the GD compositor. Delete after use.
require_once __DIR__ . '/../../site_helpers.php';
require_once __DIR__ . '/compose-gd.php';

$bg = $_GET['bg'] ?? 'https://testforge.chili.pa/projects/velora-skin/serum-glow-launch-5/1134/banner.png';
$cd = [
    'mainHeadline' => 'Promoção Imperdível: Renove sua Pele neste Inverno',
    'subheadline'  => 'Sérum com Vitamina C — até 50% de desconto por tempo limitado',
    'ctaText'      => 'Comprar agora',
    'logoUrl'      => $_GET['logo'] ?? '',
    'primaryColor' => $_GET['c'] ?? '#8a4fff',
    'platform'     => 'instagram',
];
$fmt = ['width' => (int)($_GET['w'] ?? 1080), 'height' => (int)($_GET['h'] ?? 1080), 'platform' => 'instagram', 'format' => 'square'];
$out = sys_get_temp_dir() . '/gdtest_' . md5($bg . $fmt['width'] . $fmt['height']) . '.jpg';
try {
    $ok = extgd_compose_to_jpeg($bg, $cd, $fmt, ['headlineScale' => 1.0, 'align' => 'left'], $out);
    if (!$ok) { http_response_code(500); echo 'compose returned false'; exit; }
    header('Content-Type: image/jpeg');
    header('Cache-Control: no-store');
    readfile($out);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo 'ERR: ' . $e->getMessage();
}
