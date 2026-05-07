$repoPath = "C:\Users\ativa\Downloads\ChiliForge"

$interval = 10
$idleTime = 300

cd $repoPath

$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "dev") {
    Write-Host "⚠️ Vá para a branch dev antes de rodar"
    exit
}

$lastChange = Get-Date
$hadChanges = $false

while ($true) {

    $status = git status --porcelain

    if ($status -and -not $hadChanges) {
        $lastChange = Get-Date
        $hadChanges = $true
        Write-Host "🟡 Mudança detectada (iniciando contagem)..."
    }

    $now = Get-Date
    $diffSeconds = ($now - $lastChange).TotalSeconds

    if ($hadChanges -and $diffSeconds -ge $idleTime) {

        $files = git diff --name-only

        $type = "chore"

        if ($files -match "\.php") { $type = "fix(api)" }
        elseif ($files -match "\.(js|ts|tsx)") { $type = "feat(front)" }
        elseif ($files -match "\.(css|scss)") { $type = "style" }

        $summary = ($files | Select-Object -First 3) -join ", "
        $time = Get-Date -Format "HH:mm"

        $message = "${type}: auto commit ($time)"

        git add .
        git commit -m "$message"
        git push origin dev

        Write-Host "✅ Commit feito: $message"

        # reset
        $hadChanges = $false
    }

    Start-Sleep -Seconds $interval
}