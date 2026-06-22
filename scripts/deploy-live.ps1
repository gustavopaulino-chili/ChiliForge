<#
  Deploy LIVE (PRODUCAO) — APENAS a API EXTERNA do ChiliForge (FTPS via curl).

  ATENCAO: este script publica no SERVER LIVE e e EXCLUSIVO para as coisas da nossa
  API externa (api/v1/external/*). NAO use para o app/dev — esse continua no
  scripts/deploy-ftp.ps1. Rode SOMENTE quando explicitamente pedido ("postar la").

  Credenciais: lidas de .deploy.live.env na raiz do repo (gitignorado). Formato:
    FTP_HOST=host_do_server_live
    FTP_USER=usuario_ftp_live
    FTP_PASS=senha_ftp_live
    # opcional: subpasta remota base, se a API externa nao estiver na raiz do FTP
    # REMOTE_BASE=public_html

  Uso:
    # 1) Sem args: envia TODA a pasta da API externa (api/v1/external/*)
    powershell -File scripts/deploy-live.ps1

    # 2) Arquivos especificos (caminhos relativos ao repo)
    powershell -File scripts/deploy-live.ps1 api/v1/external/company-assets.php

    # 3) Se a mudanca tocou helpers compartilhados de que a API externa depende,
    #    passe-os explicitamente:
    powershell -File scripts/deploy-live.ps1 api/site_helpers.php api/v1/agents/helpers.php

  Obs: Supabase (supabase/functions/*) e compartilhada e NAO entra aqui — usar
       'npx supabase functions deploy <name>'.
#>

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Files
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Credenciais LIVE (arquivo separado do dev)
$envFile = Join-Path $repoRoot '.deploy.live.env'
if (-not (Test-Path $envFile)) {
    Write-Error "Credenciais LIVE nao encontradas: crie $envFile (veja .deploy.live.env.example) e preencha FTP_HOST/FTP_USER/FTP_PASS do server live."
}
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
    $k, $v = $t.Split('=', 2)
    $cfg[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
}
$ftpHost = $cfg['FTP_HOST']
$ftpUser = $cfg['FTP_USER']
$ftpPass = $cfg['FTP_PASS']
$remoteBase = $cfg['REMOTE_BASE']
if (-not $ftpHost -or -not $ftpUser -or -not $ftpPass) {
    Write-Error "FTP_HOST / FTP_USER / FTP_PASS ausentes em $envFile."
}
$remoteBase = if ($remoteBase) { $remoteBase.Trim('/') + '/' } else { '' }

$script:fail = 0

function Send-File {
    param([string] $LocalPath, [string] $RemoteRel)
    $RemoteRel = ($RemoteRel -replace '\\', '/').TrimStart('/')
    if (-not (Test-Path $LocalPath)) {
        Write-Host "  SKIP (nao existe): $RemoteRel" -ForegroundColor Yellow
        return
    }
    $remote = "ftp://$ftpHost/$remoteBase$RemoteRel"
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

Write-Host "Deploy LIVE (API EXTERNA) -> ftp://$ftpHost/$remoteBase (usuario: $ftpUser)" -ForegroundColor Magenta

# Lista de arquivos: args explicitos, ou TODA a pasta da API externa por padrao.
$list = $Files
if (-not $list -or $list.Count -eq 0) {
    $extDir = Join-Path $repoRoot (Join-Path 'api' (Join-Path 'v1' 'external'))
    if (-not (Test-Path $extDir)) { Write-Error "Pasta da API externa nao encontrada: $extDir" }
    $list = Get-ChildItem -Path $extDir -Recurse -File | ForEach-Object {
        $_.FullName.Substring($repoRoot.Length + 1) -replace '\\', '/'
    }
    Write-Host "Sem args: enviando toda a API externa (api/v1/external/*)." -ForegroundColor Cyan
}

Write-Host "Arquivos:" -ForegroundColor Cyan
foreach ($rel in $list) {
    $relClean = ($rel -replace '\\', '/').TrimStart('/')
    $local = Join-Path $repoRoot ($relClean -replace '/', [IO.Path]::DirectorySeparatorChar)
    Send-File -LocalPath $local -RemoteRel $relClean
}

if ($script:fail -gt 0) {
    Write-Error "$($script:fail) arquivo(s) falharam no upload."
} else {
    Write-Host "Deploy LIVE concluido." -ForegroundColor Green
}
