$repoPath = "C:\Users\ativa\Downloads\ChiliForge"

# tempo entre verificações (segundos)
$interval = 10

# tempo de inatividade para commitar (segundos) -> 5 min
$idleTime = 300

$lastChange = Get-Date

while ($true) {
    cd $repoPath

    git checkout dev | Out-Null

    # verifica mudanças
    $status = git status --porcelain

    if ($status) {
        $lastChange = Get-Date
        Write-Host "Mudança detectada..."
    }

    $now = Get-Date
    $diffSeconds = ($now - $lastChange).TotalSeconds

    # só commita se passou tempo sem mudanças
    if ($diffSeconds -ge $idleTime -and $status) {

        $files = git diff --name-only

        # tipo do commit
        $type = "chore"

        if ($files -match "\.php") {
            $type = "fix(api)"
        }
        elseif ($files -match "\.(js|ts|tsx)") {
            $type = "feat(front)"
        }
        elseif ($files -match "\.(css|scss)") {
            $type = "style"
        }
        elseif ($files -match "\.(md)") {
            $type = "docs"
        }

        # resumo dos arquivos (máx 3)
        $summary = ($files | Select-Object -First 3) -join ", "

        $time = Get-Date -Format "HH:mm"


        $message = "${type}: updates in $summary ($time)"

        git add .
        git commit -m "$message"
        git push origin dev

        Write-Host "Commit feito: $message"

        # reseta tempo
        $lastChange = Get-Date
    }

    Start-Sleep -Seconds $interval
}