param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root)
$binDir = Join-Path $Root 'bin'
$configDir = Join-Path $Root 'config'
$dataDir = Join-Path $Root 'data'
$installerDir = Join-Path $Root 'installer'
$configPath = Join-Path $configDir 'server.json'
$templatePath = Join-Path $configDir 'config.example.json'
$runnerPath = Join-Path $binDir 'run-server.ps1'
$serverPath = Join-Path $binDir 'dtam-server.exe'
$taskName = 'DTAM Rust Server'

foreach ($dir in @($binDir, $configDir, $dataDir, $installerDir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "DTAM server binary is missing: $serverPath"
}

if (-not (Test-Path -LiteralPath $configPath)) {
    if (-not (Test-Path -LiteralPath $templatePath)) {
        throw "DTAM config template is missing: $templatePath"
    }

    $cfg = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
    $cfg.data_dir = $dataDir
    $json = $cfg | ConvertTo-Json -Depth 16
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, $utf8NoBom)
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runnerPath + '"'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $binDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'DTAM authoritative Rust server. Configuration and data are preserved across upgrades.' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Milliseconds 600

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ("Installed {0} at {1}; task state={2}, lastResult={3}" -f $taskName, $Root, $task.State, $info.LastTaskResult)
