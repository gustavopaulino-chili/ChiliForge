<#
  Deploy LIVE (PRODUCAO) — server live do ChiliForge (FTPS via curl).

  ATENCAO: publica no SERVER LIVE. Rode SOMENTE quando explicitamente pedido.
  Foco principal: a API externa (api/v1/external/*). Os switches -Frontend / -AllApi
  permitem um deploy completo do app quando necessario (setup do live).

  NUNCA envia (regra fixa de seguranca do live):
    - qualquer *.env            (segredos / config por ambiente)
    - api/db.php                (credenciais do banco — enviado UMA vez no setup, nunca mais)
    - arquivos temporarios _gd-test.php
    - dist/projects/**          (sites gerados ficam so no servidor; nao clobberar)

  Credenciais: .deploy.live.env na raiz (gitignorado): FTP_HOST/FTP_USER/FTP_PASS, REMOTE_BASE opcional.

  Uso:
    powershell -File scripts/deploy-live.ps1                       # so a API externa (api/v1/external/*)
    powershell -File scripts/deploy-live.ps1 arquivo1.php ...      # arquivos especificos
    powershell -File scripts/deploy-live.ps1 -Frontend            # dist/ -> raiz (rode npm run build antes)
    powershell -File scripts/deploy-live.ps1 -AllApi              # todo api/** (exceto db.php/.env/temp)
    powershell -File scripts/deploy-live.ps1 -Frontend -AllApi    # deploy completo do app

  Supabase (supabase/functions/*) e compartilhada e NAO entra aqui — usar a CLI.
#>

param(
    [switch] $Frontend,
    [switch] $AllApi,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Files
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$envFile = Join-Path $repoRoot '.deploy.live.env'
if (-not (Test-Path $envFile)) {
    Write-Error "Credenciais LIVE nao encontradas: crie $envFile (veja .deploy.live.env.example)."
}
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
    $k, $v = $t.Split('=', 2)
    $cfg[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
}
$ftpHost = $cfg['FTP_HOST']; $ftpUser = $cfg['FTP_USER']; $ftpPass = $cfg['FTP_PASS']
$remoteBase = $cfg['REMOTE_BASE']
if (-not $ftpHost -or -not $ftpUser -or -not $ftpPass) { Write-Error "FTP_HOST / FTP_USER / FTP_PASS ausentes em $envFile." }
$remoteBase = if ($remoteBase) { $remoteBase.Trim('/') + '/' } else { '' }

# Regra fixa: arquivos/paths que NUNCA vao pro live.
function Test-LiveBlocked {
    param([string] $Rel)
    $r = ($Rel -replace '\\', '/').TrimStart('/')
    if ($r -match '\.env$') { return $true }
    if ($r -ieq 'api/db.php') { return $true }
    if ($r -match '/_gd-test\.php$' -or $r -match '^_gd-test\.php$') { return $true }
    if ($r -match '^dist/projects/' -or $r -match '/projects/') { return $true }
    return $false
}

$script:fail = 0
function Send-File {
    param([string] $LocalPath, [string] $RemoteRel)
    $RemoteRel = ($RemoteRel -replace '\\', '/').TrimStart('/')
    if (Test-LiveBlocked -Rel $RemoteRel) {
        Write-Host "  BLOQUEADO (regra live): $RemoteRel" -ForegroundColor DarkYellow
        return
    }
    if (-not (Test-Path $LocalPath)) {
        Write-Host "  SKIP (nao existe): $RemoteRel" -ForegroundColor Yellow
        return
    }
    $remote = "ftp://$ftpHost/$remoteBase$RemoteRel"
    Write-Host "  -> $RemoteRel" -NoNewline
    & curl.exe --silent --show-error --ssl-reqd --insecure --ftp-create-dirs `
        -T "$LocalPath" "$remote" --user "${ftpUser}:${ftpPass}"
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green }
    else { Write-Host "  FALHOU (curl exit $LASTEXITCODE)" -ForegroundColor Red; $script:fail++ }
}

Write-Host "Deploy LIVE -> ftp://$ftpHost/$remoteBase (usuario: $ftpUser)" -ForegroundColor Magenta

# Frontend: dist/ -> raiz (public_html), exceto dist/projects/**
if ($Frontend) {
    $distDir = Join-Path $repoRoot 'dist'
    if (-not (Test-Path $distDir)) { Write-Error "dist/ nao existe. Rode 'npm run build' antes de -Frontend." }
    Write-Host "Frontend (dist/ -> raiz):" -ForegroundColor Cyan
    foreach ($f in Get-ChildItem -Path $distDir -Recurse -File) {
        Send-File -LocalPath $f.FullName -RemoteRel ($f.FullName.Substring($distDir.Length + 1))
    }
}

# AllApi: todo api/** (Test-LiveBlocked tira db.php / *.env / temp)
if ($AllApi) {
    $apiDir = Join-Path $repoRoot 'api'
    if (-not (Test-Path $apiDir)) { Write-Error "api/ nao existe." }
    Write-Host "API (api/** -> api/):" -ForegroundColor Cyan
    foreach ($f in Get-ChildItem -Path $apiDir -Recurse -File) {
        Send-File -LocalPath $f.FullName -RemoteRel ('api/' + $f.FullName.Substring($apiDir.Length + 1))
    }
}

# Arquivos explicitos, ou (sem switch e sem args) so a API externa.
$list = $Files
if ((-not $list -or $list.Count -eq 0) -and -not $Frontend -and -not $AllApi) {
    $extDir = Join-Path $repoRoot (Join-Path 'api' (Join-Path 'v1' 'external'))
    if (-not (Test-Path $extDir)) { Write-Error "Pasta da API externa nao encontrada: $extDir" }
    $list = Get-ChildItem -Path $extDir -Recurse -File | ForEach-Object { $_.FullName.Substring($repoRoot.Length + 1) -replace '\\', '/' }
    Write-Host "Sem args: enviando a API externa (api/v1/external/*)." -ForegroundColor Cyan
}
if ($list -and $list.Count -gt 0) {
    Write-Host "Arquivos:" -ForegroundColor Cyan
    foreach ($rel in $list) {
        $relClean = ($rel -replace '\\', '/').TrimStart('/')
        Send-File -LocalPath (Join-Path $repoRoot ($relClean -replace '/', [IO.Path]::DirectorySeparatorChar)) -RemoteRel $relClean
    }
}

if ($script:fail -gt 0) { Write-Error "$($script:fail) arquivo(s) falharam no upload." }
else { Write-Host "Deploy LIVE concluido." -ForegroundColor Green }
