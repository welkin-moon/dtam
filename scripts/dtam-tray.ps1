#requires -version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$mutexName = 'Local\DTAM-V3-Tray'
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) {
    $mutex.Dispose()
    exit 0
}

$serverRoot = 'D:\server'
$gameUrl = 'https://d1.lunarlab.uk'
$coreHealth = 'http://127.0.0.1:28727/health'
$edgeHealth = 'http://127.0.0.1:28729/health'
$pollMs = 5000

$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromMilliseconds(1200)

function Get-HealthJson {
    param([Parameter(Mandatory = $true)][string]$Uri)
    try {
        $response = $http.GetAsync($Uri).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            return $null
        }
        $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }
        return $raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-NetworkAddressText {
    try {
        $ipv4 = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike '127.*' -and
                ($_.IPAddress -like '10.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
            } |
            Select-Object -ExpandProperty IPAddress -Unique |
            Select-Object -First 3

        $ipv6 = Get-NetIPAddress -AddressFamily IPv6 -AddressState Preferred -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -ne '::1' -and
                $_.IPAddress -notmatch '^fe80:'
            } |
            Select-Object -ExpandProperty IPAddress -Unique |
            Select-Object -First 3

        $v4Text = if ($ipv4) { $ipv4 -join ', ' } else { '无私网 IPv4' }
        $v6Text = if ($ipv6) { $ipv6 -join ', ' } else { '无可用 IPv6' }
        return "IPv4: $v4Text · IPv6: $v6Text"
    }
    catch {
        return 'IPv4/IPv6: 无法读取'
    }
}

function Open-PathSafe {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        if (Test-Path -LiteralPath $Path) {
            Start-Process explorer.exe -ArgumentList @($Path)
        }
    }
    catch {}
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Text = '正在读取服务状态...'
$statusItem.Enabled = $false
[void]$menu.Items.Add($statusItem)

$networkItem = New-Object System.Windows.Forms.ToolStripMenuItem
$networkItem.Text = Get-NetworkAddressText
$networkItem.Enabled = $false
[void]$menu.Items.Add($networkItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$openGameItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openGameItem.Text = '打开游戏'
$openGameItem.Add_Click({ Start-Process $gameUrl })
[void]$menu.Items.Add($openGameItem)

$openServerItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openServerItem.Text = '打开 D:\server'
$openServerItem.Add_Click({ Open-PathSafe $serverRoot })
[void]$menu.Items.Add($openServerItem)

$openLogsItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openLogsItem.Text = '打开日志目录'
$openLogsItem.Add_Click({ Open-PathSafe (Join-Path $serverRoot 'logs') })
[void]$menu.Items.Add($openLogsItem)

$refreshItem = New-Object System.Windows.Forms.ToolStripMenuItem
$refreshItem.Text = '立即刷新'
[void]$menu.Items.Add($refreshItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = '退出托盘（不停止服务）'
[void]$menu.Items.Add($exitItem)

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = 'DTAM v3 Server'
$notify.Visible = $true
$notify.ContextMenuStrip = $menu

$script:lastState = ''
$script:stopping = $false

function Update-TrayState {
    if ($script:stopping) {
        return
    }

    $networkItem.Text = Get-NetworkAddressText

    $core = Get-HealthJson $coreHealth
    $edge = Get-HealthJson $edgeHealth
    $coreOk = $null -ne $core -and $core.ok -eq $true
    $edgeOk = $null -ne $edge -and $edge.ok -eq $true
    $active = if ($edgeOk -and $null -ne $edge.activeSessions) { [int]$edge.activeSessions } else { 0 }
    $node = if ($edgeOk -and $edge.nodeId) { [string]$edge.nodeId } else { 'shanghai-a' }

    if ($coreOk -and $edgeOk) {
        $statusItem.Text = "Core 在线 · Edge $node 在线 · $active 条会话"
        $notify.Text = "DTAM v3 · 在线 · $active 会话"
        $notify.Icon = [System.Drawing.SystemIcons]::Application
        $state = 'online'
    }
    elseif ($coreOk) {
        $statusItem.Text = 'Core 在线 · Edge 离线（仅 Tunnel/v2.8 可用）'
        $notify.Text = 'DTAM v3 · Edge 离线'
        $notify.Icon = [System.Drawing.SystemIcons]::Warning
        $state = 'edge-down'
    }
    elseif ($edgeOk) {
        $statusItem.Text = 'Core 离线 · Edge 在线但无法提供游戏'
        $notify.Text = 'DTAM v3 · Core 离线'
        $notify.Icon = [System.Drawing.SystemIcons]::Error
        $state = 'core-down'
    }
    else {
        $statusItem.Text = 'Core 离线 · Edge 离线'
        $notify.Text = 'DTAM v3 · 服务离线'
        $notify.Icon = [System.Drawing.SystemIcons]::Error
        $state = 'offline'
    }

    if ($state -ne $script:lastState -and $script:lastState -ne '') {
        $notify.BalloonTipTitle = 'DTAM v3 服务状态'
        $notify.BalloonTipText = $statusItem.Text
        $notify.BalloonTipIcon = if ($state -eq 'online') {
            [System.Windows.Forms.ToolTipIcon]::Info
        }
        else {
            [System.Windows.Forms.ToolTipIcon]::Warning
        }
        $notify.ShowBalloonTip(2500)
    }
    $script:lastState = $state
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $pollMs
$timer.Add_Tick({ Update-TrayState })
$refreshItem.Add_Click({ Update-TrayState })

$notify.Add_DoubleClick({ Start-Process $gameUrl })
$exitItem.Add_Click({
    $script:stopping = $true
    $timer.Stop()
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

try {
    Update-TrayState
    $timer.Start()
    [System.Windows.Forms.Application]::Run()
}
finally {
    $script:stopping = $true
    $timer.Stop()
    $timer.Dispose()
    $notify.Visible = $false
    $notify.Dispose()
    $menu.Dispose()
    $http.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
