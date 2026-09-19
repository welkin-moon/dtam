$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$config = Join-Path $root 'config\server.json'
$server = Join-Path $PSScriptRoot 'dtam-server.exe'

$env:DTAM_CONFIG = $config
Set-Location $PSScriptRoot
& $server
exit $LASTEXITCODE
