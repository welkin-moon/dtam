<#
.SYNOPSIS
    DTAM GitHub Actions Self-Hosted Runner Setup Script
.DESCRIPTION
    Configures this Windows PC as a dedicated Self-Hosted Runner for welkin-moon/dtam.
#>

[CmdletBinding()]
param(
    [string]$RunnerDir = "C:\actions-runner",
    [switch]$InstallService
)

$ErrorActionPreference = 'Stop'

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  >> Setting up DTAM GitHub Actions Self-Hosted Runner" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. Verify gh CLI
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) not found. Please install gh and ensure you are authenticated."
}

# 2. Retrieve runner registration token
Write-Host "[1/4] Retrieving runner registration token via GitHub CLI..." -ForegroundColor Yellow
$tokenJson = gh api --method POST -H "Accept: application/vnd.github+json" /repos/welkin-moon/dtam/actions/runners/registration-token | ConvertFrom-Json
$regToken = $tokenJson.token
if (-not $regToken) {
    throw "Failed to obtain runner registration token."
}
Write-Host "      Token obtained successfully! Expires at: $($tokenJson.expires_at)" -ForegroundColor Green

# 3. Create runner directory and download
if (-not (Test-Path $RunnerDir)) {
    New-Item -ItemType Directory -Path $RunnerDir -Force | Out-Null
}
Set-Location $RunnerDir

$runnerVersion = "2.322.0"
$runnerZip = "actions-runner-win-x64-$runnerVersion.zip"
$runnerUrl = "https://github.com/actions/runner/releases/download/v$runnerVersion/$runnerZip"

if (-not (Test-Path "config.cmd")) {
    Write-Host "[2/4] Downloading GitHub Actions Runner ($runnerVersion)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $runnerUrl -OutFile $runnerZip -UseBasicParsing
    Write-Host "      Extracting runner package..." -ForegroundColor Yellow
    Expand-Archive -Path $runnerZip -DestinationPath $RunnerDir -Force
    Remove-Item -Path $runnerZip -Force
} else {
    Write-Host "[2/4] Runner files already exist, skipping download." -ForegroundColor Green
}

# 4. Configure runner
Write-Host "[3/4] Registering runner with welkin-moon/dtam..." -ForegroundColor Yellow
$runnerName = "$($env:COMPUTERNAME)-dtam-runner"
$configArgs = @(
    "--url", "https://github.com/welkin-moon/dtam",
    "--token", $regToken,
    "--name", $runnerName,
    "--labels", "windows,self-hosted,dtam",
    "--work", "_work",
    "--unattended",
    "--replace"
)
& .\config.cmd @configArgs

Write-Host "[4/4] Runner registration complete!" -ForegroundColor Green
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Cyan

if ($InstallService) {
    Write-Host "Installing Windows Service for persistent background execution..." -ForegroundColor Yellow
    & .\config.cmd install
    & .\config.cmd start
    Write-Host "Service started successfully!" -ForegroundColor Green
} else {
    Write-Host "To start the runner manually in foreground, run:" -ForegroundColor Cyan
    Write-Host "  cd $RunnerDir" -ForegroundColor White
    Write-Host "  .\run.cmd" -ForegroundColor White
    Write-Host "To install as a background Windows service, run: .\scripts\setup-self-hosted-runner.ps1 -InstallService" -ForegroundColor DarkGray
}
