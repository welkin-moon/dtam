param(
    [string]$VersionName = '3.0.2',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$MacDir = Join-Path $Root 'client\mac'
if (-not $OutputPath) {
    $OutputPath = Join-Path $Root ("dist\DTAM-macOS-v{0}.zip" -f $VersionName)
}
$DistDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Force -Path $DistDir | Out-Null }

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "        DTAM macOS 客户端自动化打包脚本 (v$VersionName)         " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# Check critical files
$required = @(
    (Join-Path $MacDir 'DTAM.command'),
    (Join-Path $MacDir 'DTAM.app\Contents\Info.plist'),
    (Join-Path $MacDir 'DTAM.app\Contents\PkgInfo'),
    (Join-Path $MacDir 'DTAM.app\Contents\MacOS\DTAM'),
    (Join-Path $MacDir 'DTAM.app\Contents\Resources\AppIcon.icns'),
    (Join-Path $MacDir 'README.md')
)

foreach ($file in $required) {
    if (-not (Test-Path $file)) {
        throw "缺少必要文件: $file"
    }
}

Write-Host "✓ 所有必需文件验证通过" -ForegroundColor Green
Write-Host "正在调用 Python zipfile 打包并嵌入 Unix 可执行权限 (0755)..." -ForegroundColor Yellow

# Use Python to preserve POSIX executable attributes (0755) in the zip
$pyScript = @"
import os, sys, zipfile, stat

src_dir = r'$MacDir'
out_zip = r'$OutputPath'

if os.path.exists(out_zip):
    os.remove(out_zip)

executable_files = {
    'DTAM.command',
    'DTAM',
    'DTAM.app/Contents/MacOS/DTAM',
    'build-mac.sh'
}

with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, src_dir)
            norm_rel = rel_path.replace('\\', '/')
            
            with open(full_path, 'rb') as f:
                data = f.read()
            
            info = zipfile.ZipInfo(norm_rel)
            is_exec = (norm_rel in executable_files or os.path.basename(norm_rel) in executable_files)
            mode = 0o755 if is_exec else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            z.writestr(info, data)

size = os.path.getsize(out_zip)
print(f'SUCCESS: {out_zip} ({size} bytes)')
"@

$tmpPy = [System.IO.Path]::GetTempFileName() + ".py"
try {
    [System.IO.File]::WriteAllText($tmpPy, $pyScript, [System.Text.Encoding]::UTF8)
    $output = & python $tmpPy
    if ($LASTEXITCODE -ne 0) { throw "Python 打包失败: $output" }
    Write-Host $output -ForegroundColor Green
} finally {
    if (Test-Path $tmpPy) { Remove-Item $tmpPy -Force }
}

$hash = (Get-FileHash -Algorithm SHA256 $OutputPath).Hash.ToLowerInvariant()
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🎉 macOS 客户端打包完成！" -ForegroundColor Green
Write-Host "  产物路径 : $OutputPath" -ForegroundColor White
Write-Host "  SHA-256  : $hash" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan
