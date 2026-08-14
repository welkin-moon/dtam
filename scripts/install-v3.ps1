#requires -version 5.1
#requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$ServerRoot = 'D:\server',
    [string]$RepoRoot = 'D:\server\dtam',
    [string]$TrayUser = "$env:COMPUTERNAME\meteo",
    [switch]$SkipBuild,
    [switch]$SkipRustUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$binDir = Join-Path $ServerRoot 'bin'
$configDir = Join-Path $ServerRoot 'config'
$logsDir = Join-Path $ServerRoot 'logs'
$edgeManifest = Join-Path $RepoRoot 'edge\Cargo.toml'
$edgeBuilt = Join-Path $RepoRoot 'edge\target\release\dtam-edge.exe'
$edgeExe = Join-Path $binDir 'dtam-edge.exe'
$trayManifest = Join-Path $RepoRoot 'tray\Cargo.toml'
$trayBuilt = Join-Path $RepoRoot 'tray\target\release\dtam-tray.exe'
$trayExe = Join-Path $binDir 'dtam-tray.exe'
$configExample = Join-Path $RepoRoot 'edge\config.example.json'
$configTarget = Join-Path $configDir 'edge.json'
$edgeTaskName = 'DTAM v3 Edge'
$trayTaskName = 'DTAM v3 Tray'
$firewallName = 'DTAM v3 Edge WebRTC UDP'

foreach ($dir in @($ServerRoot, $binDir, $configDir, $logsDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

foreach ($manifest in @($edgeManifest, $trayManifest)) {
    if (-not (Test-Path -LiteralPath $manifest)) {
        throw "Missing v3 Rust manifest: $manifest"
    }
}

if (-not $SkipBuild) {
    if (-not $SkipRustUpdate) {
        & rustup update stable --no-self-update
        if ($LASTEXITCODE -ne 0) { throw 'rustup update stable failed' }
        & rustup default stable
        if ($LASTEXITCODE -ne 0) { throw 'rustup default stable failed' }
    }

    foreach ($manifest in @($edgeManifest, $trayManifest)) {
        & cargo generate-lockfile --manifest-path $manifest
        if ($LASTEXITCODE -ne 0) { throw "cargo generate-lockfile failed: $manifest" }
        & cargo build --release --manifest-path $manifest --locked
        if ($LASTEXITCODE -ne 0) { throw "cargo release build failed: $manifest" }
    }
}

foreach ($binary in @($edgeBuilt, $trayBuilt)) {
    if (-not (Test-Path -LiteralPath $binary)) {
        throw "Missing built v3 binary: $binary"
    }
}

foreach ($taskName in @($edgeTaskName, $trayTaskName)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 250

foreach ($processName in @('dtam-edge', 'dtam-tray')) {
    $processes = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if ($processes) {
        $processes | Stop-Process -Force
    }
}
Start-Sleep -Milliseconds 350

Copy-Item -LiteralPath $edgeBuilt -Destination $edgeExe -Force
Copy-Item -LiteralPath $trayBuilt -Destination $trayExe -Force

if (-not (Test-Path -LiteralPath $configTarget)) {
    Copy-Item -LiteralPath $configExample -Destination $configTarget
    Write-Host "Created $configTarget from example."
}
else {
    Write-Host "Keeping existing $configTarget."
}

$oldFirewall = Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
if ($oldFirewall) {
    $oldFirewall | Remove-NetFirewallRule
}
New-NetFirewallRule `
    -DisplayName $firewallName `
    -Description 'Allow inbound WebRTC ICE/DTLS/SCTP UDP only for dtam-edge.exe.' `
    -Direction Inbound `
    -Program $edgeExe `
    -Protocol UDP `
    -Action Allow `
    -Profile Any | Out-Null

$edgeAction = New-ScheduledTaskAction -Execute $edgeExe -WorkingDirectory $ServerRoot
$edgeTrigger = New-ScheduledTaskTrigger -AtStartup
$edgePrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$edgeSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval ([TimeSpan]::FromMinutes(1))
Register-ScheduledTask `
    -TaskName $edgeTaskName `
    -Action $edgeAction `
    -Trigger $edgeTrigger `
    -Principal $edgePrincipal `
    -Settings $edgeSettings `
    -Description 'DTAM v3 WebRTC Edge gateway. Core remains the authoritative game server.' `
    -Force | Out-Null

$trayAction = New-ScheduledTaskAction -Execute $trayExe -WorkingDirectory $ServerRoot
$trayTrigger = New-ScheduledTaskTrigger -AtLogOn -User $TrayUser
$trayPrincipal = New-ScheduledTaskPrincipal -UserId $TrayUser -LogonType Interactive -RunLevel Limited
$traySettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 10 `
    -RestartInterval ([TimeSpan]::FromMinutes(1))
Register-ScheduledTask `
    -TaskName $trayTaskName `
    -Action $trayAction `
    -Trigger $trayTrigger `
    -Principal $trayPrincipal `
    -Settings $traySettings `
    -Description 'DTAM v3 native Rust notification-area companion. Exiting it does not stop server services.' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $edgeTaskName
Start-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'DTAM v3 local installation complete.'
Write-Host "  Edge:       $edgeExe"
Write-Host "  Config:     $configTarget"
Write-Host "  Tray:       $trayExe"
Write-Host "  Edge task:  $edgeTaskName (SYSTEM / AtStartup)"
Write-Host "  Tray task:  $trayTaskName ($TrayUser / AtLogOn)"
Write-Host "  Firewall:   $firewallName (UDP / program-scoped)"
Write-Host ''
Write-Host 'Cloudflare edge-d1 tunnel ingress and Pages rollout are intentionally separate deployment steps.'
