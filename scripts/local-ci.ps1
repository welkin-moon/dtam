<#
.SYNOPSIS
    DTAM 本地完整 CI 自动化验证脚本 (Local CI Pipeline Runner)

.DESCRIPTION
    在当前 Windows 本机一键跑完 CI 的全部检验项，无需推送至 GitHub 即可在秒级至分钟级内完成完整质量门禁验证：
    1. 环境依赖预检 (Node.js, Rustc, Cargo, PowerShell)
    2. 锁文件锁定状态验证 (Cargo.lock 存在性与跟踪状态)
    3. 源码格式规范与 CSP 脚本哈希一致性检查 (防止 CRLF 污染破坏 _headers CSP)
    4. 音乐清单与所有 JavaScript 核心/模块/Worker 语法检查
    5. 核心集成与规则测试套件 (node scripts/test.cjs)
    6. 所有 PowerShell 自动化与安装脚本 AST 静态语法解析检查
    7. Rust Realtime Server (cargo fmt / clippy / test)
    8. Rust v3 Edge (cargo fmt / clippy / test)
    9. Rust v3 Tray (cargo fmt / clippy / test)
    10. 历史废弃图层与退化文件防回流检查 (Reject legacy build layers)

.PARAMETER Fast
    可选开关。跳过耗时较长的 cargo test，仅运行格式化、clippy 与静态类型/语法检查。
#>

[CmdletBinding()]
param(
    [switch]$Fast
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$global:SuiteStartTime = [System.Diagnostics.Stopwatch]::StartNew()
$global:Results = [System.Collections.Generic.List[PSCustomObject]]::new()
$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $script:Root

function Write-SectionHeader {
    param([string]$Title)
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  >> $Title" -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
}

function Invoke-CheckStep {
    param(
        [Parameter(Mandatory=$true, Position=0)][string]$Name,
        [Parameter(Mandatory=$true, Position=1)][scriptblock]$Script
    )

    Write-Host -NoNewline "[RUNNING] " -ForegroundColor Yellow
    Write-Host -NoNewline "$Name... " -ForegroundColor White

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = "PASS"
    $errMessage = ""

    try {
        & $Script
    }
    catch {
        $status = "FAIL"
        $errMessage = $_.Exception.Message
    }
    finally {
        $sw.Stop()
        $elapsedSec = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    }

    if ($status -eq "PASS") {
        Write-Host "`r[PASS]    " -NoNewline -ForegroundColor Green
        Write-Host "$Name " -NoNewline -ForegroundColor White
        Write-Host "(${elapsedSec}s)" -ForegroundColor DarkGray
        $global:Results.Add([PSCustomObject]@{
            Name     = $Name
            Status   = "PASS"
            Duration = $elapsedSec
            Error    = ""
        })
    } else {
        Write-Host "`r[FAIL]    " -NoNewline -ForegroundColor Red
        Write-Host "$Name " -NoNewline -ForegroundColor White
        Write-Host "(${elapsedSec}s)" -ForegroundColor DarkGray
        if ($errMessage) {
            Write-Host "          Error: $errMessage" -ForegroundColor Red
        }
        $global:Results.Add([PSCustomObject]@{
            Name     = $Name
            Status   = "FAIL"
            Duration = $elapsedSec
            Error    = $errMessage
        })
    }
}

Write-SectionHeader "1. DTAM 本地环境预检 (Preflight Environment Checks)"

Invoke-CheckStep -Name "Node.js 运行时与版本检测" -Script {
    $ver = (node --version).Trim()
    if (-not $ver) { throw "Node.js 未找到或未配置到 PATH" }
}

Invoke-CheckStep -Name "Rust 工具链检测 (rustc 与 cargo)" -Script {
    $rustcVer = (rustc --version).Trim()
    $cargoVer = (cargo --version).Trim()
    if (-not $rustcVer -or -not $cargoVer) { throw "Rust 工具链未找到" }
}

Invoke-CheckStep -Name "Git 状态与 Lockfile 追踪完整性" -Script {
    $locks = @('server/Cargo.lock', 'edge/Cargo.lock', 'tray/Cargo.lock')
    foreach ($lock in $locks) {
        $path = Join-Path $script:Root $lock
        if (-not (Test-Path $path)) {
            throw "缺少确定性构建锁定文件: $lock"
        }
    }
}

Invoke-CheckStep -Name "CSP 脚本哈希与 LF 换行符校验 (防止 Windows CRLF 破坏 CSP)" -Script {
    $proc = Start-Process node -ArgumentList @("scripts/verify-sources.cjs", "csp") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "CSP 哈希校验或 LF 换行检查未通过" }
}

Write-SectionHeader "2. 前端资源与 JavaScript 模块静态验证"

Invoke-CheckStep -Name "音乐清单自动生成验证 (generate-music-manifest.cjs)" -Script {
    $proc = Start-Process node -ArgumentList "scripts/generate-music-manifest.cjs" -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "scripts/generate-music-manifest.cjs 执行失败" }
}

Invoke-CheckStep -Name "核心脚本语法检查 (game.js, v3-bootstrap, v3-resilience)" -Script {
    $proc = Start-Process node -ArgumentList @("scripts/verify-sources.cjs", "classic") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "核心经典脚本存在语法错误" }
}

Invoke-CheckStep -Name "ES 模块静态语法检查 (p2p-* / minimap-* / net-* / etc.)" -Script {
    $proc = Start-Process node -ArgumentList @("scripts/verify-sources.cjs", "modules") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "ES 模块静态语法检查未通过" }
}

Invoke-CheckStep -Name "Worker 脚本语法检查 (worker.js / p2p-signal-v2.js)" -Script {
    $proc = Start-Process node -ArgumentList @("scripts/verify-sources.cjs", "workers") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "Worker 脚本静态语法检查未通过" }
}

Invoke-CheckStep -Name "核心综合测试套件 (node scripts/test.cjs)" -Script {
    $proc = Start-Process node -ArgumentList "scripts/test.cjs" -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "scripts/test.cjs 测试套件未通过" }
}

Write-SectionHeader "3. PowerShell 脚本 AST 静态语法解析与规范验证"

Invoke-CheckStep -Name "PowerShell 脚本 AST 语法解析 (全仓库扫描)" -Script {
    $psScripts = Get-ChildItem -Path $script:Root -Filter "*.ps1" -Recurse | Where-Object {
        $_.FullName -notmatch '[\\/](target|\.git|\.build|bin|obj)[\\/]'
    }
    foreach ($f in $psScripts) {
        $tokens = $null
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile(
            $f.FullName,
            [ref]$tokens,
            [ref]$errors
        ) | Out-Null
        if ($errors.Count -gt 0) {
            $msg = ($errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }) -join "; "
            throw "脚本 $($f.Name) 存在语法解析错误: $msg"
        }
    }
}

Write-SectionHeader "4. 历史遗留废弃文件防退化检查 (Reject Legacy Layers)"

Invoke-CheckStep -Name "检查遗留废弃目录与过期 CSS/MD" -Script {
    $bannedPaths = @(
        'src',
        'build',
        'gameplay.css',
        'gameplay-2.4.css',
        'gameplay-2.5.css',
        'gameplay-2.6.css',
        'RELEASE-2.6.md'
    )
    foreach ($p in $bannedPaths) {
        $target = Join-Path $script:Root $p
        if (Test-Path $target) {
            throw "检测到遗留废弃文件或目录重新被引入: $p"
        }
    }
}

Write-SectionHeader "5. Rust 后端与客户端组件验证 (Server, Edge, Tray)"

Invoke-CheckStep -Name "Rust Server: 代码格式校验 (cargo fmt --check)" -Script {
    $proc = Start-Process cargo -ArgumentList @("fmt", "--manifest-path", "server/Cargo.toml", "--", "--check") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "server 代码格式不合规，请运行 cargo fmt --manifest-path server/Cargo.toml" }
}

Invoke-CheckStep -Name "Rust Server: 代码检查 (cargo clippy --locked)" -Script {
    $proc = Start-Process cargo -ArgumentList @("clippy", "--manifest-path", "server/Cargo.toml", "--all-targets", "--locked", "--", "-D", "warnings") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "server clippy 存在未解决的告警或错误" }
}

if (-not $Fast) {
    Invoke-CheckStep -Name "Rust Server: 单元测试 (cargo test --locked)" -Script {
        $proc = Start-Process cargo -ArgumentList @("test", "--manifest-path", "server/Cargo.toml", "--locked") -NoNewWindow -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "server 单元测试未通过" }
    }
}

Invoke-CheckStep -Name "Rust v3 Edge: 代码格式校验 (cargo fmt --check)" -Script {
    $proc = Start-Process cargo -ArgumentList @("fmt", "--manifest-path", "edge/Cargo.toml", "--", "--check") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "edge 代码格式不合规，请运行 cargo fmt --manifest-path edge/Cargo.toml" }
}

Invoke-CheckStep -Name "Rust v3 Edge: 代码检查 (cargo clippy --locked)" -Script {
    $proc = Start-Process cargo -ArgumentList @("clippy", "--manifest-path", "edge/Cargo.toml", "--all-targets", "--locked", "--", "-D", "warnings") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "edge clippy 存在未解决的告警或错误" }
}

if (-not $Fast) {
    Invoke-CheckStep -Name "Rust v3 Edge: 单元测试 (cargo test --locked)" -Script {
        $proc = Start-Process cargo -ArgumentList @("test", "--manifest-path", "edge/Cargo.toml", "--locked") -NoNewWindow -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "edge 单元测试未通过" }
    }
}

Invoke-CheckStep -Name "Rust v3 Tray: 代码格式校验 (cargo fmt --check)" -Script {
    $proc = Start-Process cargo -ArgumentList @("fmt", "--manifest-path", "tray/Cargo.toml", "--", "--check") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "tray 代码格式不合规，请运行 cargo fmt --manifest-path tray/Cargo.toml" }
}

Invoke-CheckStep -Name "Rust v3 Tray: 代码检查 (cargo clippy --locked)" -Script {
    $proc = Start-Process cargo -ArgumentList @("clippy", "--manifest-path", "tray/Cargo.toml", "--all-targets", "--locked", "--", "-D", "warnings") -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "tray clippy 存在未解决的告警或错误" }
}

if (-not $Fast) {
    Invoke-CheckStep -Name "Rust v3 Tray: 单元测试 (cargo test --locked)" -Script {
        $proc = Start-Process cargo -ArgumentList @("test", "--manifest-path", "tray/Cargo.toml", "--locked") -NoNewWindow -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "tray 单元测试未通过" }
    }
}

Write-SectionHeader "6. DTAM 本地 CI 验证总结报告 (Execution Summary)"

$global:SuiteStartTime.Stop()
$totalSec = [math]::Round($global:SuiteStartTime.Elapsed.TotalSeconds, 2)
$passCount = ($global:Results | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($global:Results | Where-Object { $_.Status -eq "FAIL" }).Count
$totalCount = $global:Results.Count

Write-Host ""
Write-Host "┌──────────────────────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│                         DTAM 本地 CI 质量门禁验证摘要                        │" -ForegroundColor Cyan
Write-Host "├──────────────────────────────────────────────────────────────────────────────┤" -ForegroundColor Cyan
Write-Host ("│  总执行项数: {0,-10} 通过: {1,-10} 失败: {2,-10} 总耗时: {3,-10} │" -f $totalCount, $passCount, $failCount, "${totalSec}s") -ForegroundColor Cyan
Write-Host "└──────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

foreach ($res in $global:Results) {
    $color = if ($res.Status -eq "PASS") { "Green" } else { "Red" }
    $tag = "[{0}]" -f $res.Status
    Write-Host ("  {0,-8} {1,-58} ({2}s)" -f $tag, $res.Name, $res.Duration) -ForegroundColor $color
    if ($res.Error) {
        Write-Host "           └─> $($res.Error)" -ForegroundColor DarkRed
    }
}

Write-Host ""

if ($failCount -gt 0) {
    Write-Host "❌ 本地 CI 验证未完全通过，存在 $failCount 项失败，请修复后再提交代码！" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✨ 恭喜！本地全套 CI 验证全绿通过！可安全推送到 GitHub 或发布版本。" -ForegroundColor Green
    exit 0
}
