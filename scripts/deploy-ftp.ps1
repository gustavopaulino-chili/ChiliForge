<#
  Deploy manual ChiliForge -> Hostinger (FTPS via curl).

  Fallback ao GitHub Actions: envia arquivos direto ao servidor, espelhando o
  caminho do repo (FTP root = public_html). Ex.: api/v1/agents/helpers.php ->
  ftp://HOST/api/v1/agents/helpers.php

  Credenciais: lidas de .deploy.env na raiz do repo (gitignorado). Formato:
    FTP_HOST=195.35.41.130
    FTP_USER=seu_usuario_ftp
    FTP_PASS=sua_senha_ftp

  Uso:
    # deploy do conjunto padrao (PHP do pipeline de base64/storageKey)
    powershell -File scripts/deploy-ftp.ps1

    # deploy de arquivos especificos (caminhos relativos ao repo)
    powershell -File scripts/deploy-ftp.ps1 api/v1/agents/helpers.php api/site_helpers.php
#>

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Files
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# ── Carrega credenciais de .deploy.env ───────────────────────────────
$envFile = Join-Path $repoRoot '.deploy.env'
if (-not (Test-Path $envFile)) {
    Write-Error "Credenciais nao encontradas: crie $envFile (veja .deploy.env.example)."
}
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
    $k, $v = $t.Split('=', 2)
    $cfg[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
}
$ftpHost = $cfg['FTP_HOST']; if (-not $ftpHost) { $ftpHost = '195.35.41.130' }
$ftpUser = $cfg['FTP_USER']
$ftpPass = $cfg['FTP_PASS']
if (-not $ftpUser -or -not $ftpPass) {
    Write-Error "FTP_USER / FTP_PASS ausentes em $envFile."
}

# ── Lista padrao (pipeline base64 -> arquivo + storageKey do compose) ─
if (-not $Files -or $Files.Count -eq 0) {
    $Files = @(
        'api/v1/agents/helpers.php',
        'api/site_helpers.php',
        'api/createProject.php',
        'api/updateProjectContent.php',
        'api/updateAdCreativeContent.php',
        'api/publishSite.php'
    )
}

Write-Host "Deploy -> ftp://$ftpHost (usuario: $ftpUser)" -ForegroundColor Cyan
$fail = 0
foreach ($rel in $Files) {
    $relClean = ($rel -replace '\\', '/').TrimStart('/')
    $local = Join-Path $repoRoot ($relClean -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $local)) {
        Write-Host "  SKIP (nao existe): $relClean" -ForegroundColor Yellow
        continue
    }
    $remote = "ftp://$ftpHost/$relClean"
    Write-Host "  -> $relClean" -NoNewline
    # FTPS explicito, sem verificar certificado (igual ao workflow), cria dirs.
    & curl.exe --silent --show-error --ssl-reqd --insecure --ftp-create-dirs `
        -T "$local" "$remote" --user "${ftpUser}:${ftpPass}"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
    } else {
        Write-Host "  FALHOU (curl exit $LASTEXITCODE)" -ForegroundColor Red
        $fail++
    }
}

if ($fail -gt 0) {
    Write-Error "$fail arquivo(s) falharam no upload."
} else {
    Write-Host "Deploy concluido." -ForegroundColor Green
}
