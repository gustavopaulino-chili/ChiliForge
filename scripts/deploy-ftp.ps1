<#
  Deploy manual ChiliForge -> Hostinger (FTPS via curl).

  ESTE e o unico mecanismo de deploy do projeto (NAO existe mais GitHub Actions).
  Rodar ao final de TODO request que altere arquivos.

  Credenciais: lidas de .deploy.env na raiz do repo (gitignorado). Formato:
    FTP_HOST=195.35.41.130
    FTP_USER=seu_usuario_ftp
    FTP_PASS=sua_senha_ftp

  Uso:
    # 1) PHP / API - enviar arquivos especificos (caminhos relativos ao repo)
    powershell -File scripts/deploy-ftp.ps1 api/v1/agents/helpers.php api/site_helpers.php

    # 2) Frontend React - buildar antes e enviar dist/ inteiro p/ public_html
    npm run build
    powershell -File scripts/deploy-ftp.ps1 -Frontend

    # 3) Os dois juntos
    npm run build
    powershell -File scripts/deploy-ftp.ps1 -Frontend api/algumarquivo.php

    # 4) Sem args e sem -Frontend: envia o conjunto PHP padrao do pipeline base64/storageKey
    powershell -File scripts/deploy-ftp.ps1

  Obs: a Supabase (supabase/functions/*) NAO entra aqui - usar 'npx supabase functions deploy <name>'.
#>

param(
    [switch] $Frontend,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Files
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Carrega credenciais de .deploy.env
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

$script:fail = 0

function Send-File {
    param([string] $LocalPath, [string] $RemoteRel)
    $RemoteRel = ($RemoteRel -replace '\\', '/').TrimStart('/')
    if (-not (Test-Path $LocalPath)) {
        Write-Host "  SKIP (nao existe): $RemoteRel" -ForegroundColor Yellow
        return
    }
    $remote = "ftp://$ftpHost/$RemoteRel"
    Write-Host "  -> $RemoteRel" -NoNewline
    & curl.exe --silent --show-error --ssl-reqd --insecure --ftp-create-dirs `
        -T "$LocalPath" "$remote" --user "${ftpUser}:${ftpPass}"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
    } else {
        Write-Host "  FALHOU (curl exit $LASTEXITCODE)" -ForegroundColor Red
        $script:fail++
    }
}

Write-Host "Deploy -> ftp://$ftpHost (usuario: $ftpUser)" -ForegroundColor Cyan

# Frontend: dist/ -> raiz (public_html)
if ($Frontend) {
    $distDir = Join-Path $repoRoot 'dist'
    if (-not (Test-Path $distDir)) {
        Write-Error "dist/ nao existe. Rode 'npm run build' antes de -Frontend."
    }
    Write-Host "Frontend (dist/ -> public_html):" -ForegroundColor Cyan
    $distFiles = Get-ChildItem -Path $distDir -Recurse -File
    foreach ($f in $distFiles) {
        $rel = $f.FullName.Substring($distDir.Length + 1)
        Send-File -LocalPath $f.FullName -RemoteRel $rel
    }
    Write-Host "  (nota: bundles antigos com hash nao sao removidos do servidor)" -ForegroundColor DarkGray
}

# Lista de arquivos (PHP/API ou outros)
$list = $Files
if ((-not $list -or $list.Count -eq 0) -and -not $Frontend) {
    $list = @(
        'api/v1/agents/helpers.php',
        'api/site_helpers.php',
        'api/createProject.php',
        'api/updateProjectContent.php',
        'api/updateAdCreativeContent.php',
        'api/publishSite.php'
    )
}
if ($list -and $list.Count -gt 0) {
    Write-Host "Arquivos:" -ForegroundColor Cyan
    foreach ($rel in $list) {
        $relClean = ($rel -replace '\\', '/').TrimStart('/')
        $local = Join-Path $repoRoot ($relClean -replace '/', [IO.Path]::DirectorySeparatorChar)
        Send-File -LocalPath $local -RemoteRel $relClean
    }
}

if ($script:fail -gt 0) {
    Write-Error "$($script:fail) arquivo(s) falharam no upload."
} else {
    Write-Host "Deploy concluido." -ForegroundColor Green
}
