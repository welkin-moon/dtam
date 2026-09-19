param(
    [Parameter(Mandatory = $false)]
    [string]$Root
)

$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'DTAM Rust Server'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Get-Process -Name 'dtam-server' -ErrorAction SilentlyContinue | Stop-Process -Force

# server.json and data are deliberately not deleted. They are user/runtime data,
# not installer-owned files, so Inno Setup leaves them behind for recovery/reinstall.
