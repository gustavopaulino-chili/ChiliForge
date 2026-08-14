<?php
// TEMPORARIO: descobre o telefone gravado das empresas para acertar o alvo do teste.
// Somente leitura. APAGAR depois de usar.
include __DIR__ . '/../../db.php';
if (($_GET['s'] ?? '') !== 'k7f2q9') { http_response_code(403); exit('no'); }
header('Content-Type: application/json; charset=utf-8');
$sql = "SELECT id, name, phone, folder_path,
        CASE WHEN company_form_data LIKE '%logoUrl%' THEN 1 ELSE 0 END AS tem_logo,
        CASE WHEN company_form_data LIKE '%primaryColor%' THEN 1 ELSE 0 END AS tem_cor
        FROM projects WHERE project_type = 'project' ORDER BY id DESC LIMIT 40";
$r = $conn->query($sql);
$out = [];
while ($r && ($x = $r->fetch_assoc())) $out[] = $x;
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
