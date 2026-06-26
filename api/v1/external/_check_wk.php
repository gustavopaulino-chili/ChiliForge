<?php
header('Content-Type: application/json');
$r = [];
$disabled = array_map('trim', explode(',', ini_get('disable_functions')));
$r['exec_ok'] = !in_array('exec', $disabled);
$r['shell_exec_ok'] = !in_array('shell_exec', $disabled);

// arch + OS
if ($r['shell_exec_ok']) {
    $r['uname'] = trim(shell_exec('uname -m 2>/dev/null') ?: '');
    $r['os'] = trim(shell_exec('cat /etc/os-release 2>/dev/null | head -3') ?: '');
    $r['convert'] = trim(shell_exec('which convert 2>/dev/null') ?: 'not found'); // ImageMagick
    $r['wk'] = trim(shell_exec('which wkhtmltoimage 2>/dev/null') ?: 'not found');
    $r['node'] = trim(shell_exec('which node 2>/dev/null || which nodejs 2>/dev/null') ?: 'not found');
    // Check if we can make files executable (key for binary upload)
    $tmp = tempnam(sys_get_temp_dir(), 'test');
    file_put_contents($tmp, '#!/bin/sh\necho ok');
    chmod($tmp, 0755);
    $can_exec_bin = (trim(shell_exec("$tmp 2>/dev/null") ?: '') === 'ok');
    unlink($tmp);
    $r['can_exec_uploaded_bin'] = $can_exec_bin;
    $r['tmpdir'] = sys_get_temp_dir();
    $r['home'] = trim(shell_exec('echo $HOME') ?: '');
}
echo json_encode($r, JSON_PRETTY_PRINT);
