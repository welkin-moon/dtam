param(
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$WindowsExe,
    [Parameter(Mandatory=$true)][string]$AndroidApk,
    [string]$NamespaceId = '449ee95eb3ff4051ae887fc7a4519c78',
    [int]$ChunkMiB = 20
)

$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw 'Version must be strict x.y.z semver.' }
$major=[int]$Matches[1]; $minor=[int]$Matches[2]; $patch=[int]$Matches[3]
$versionCode = $major * 1000000 + $minor * 10000 + $patch * 100
$chunkSize = [int64]$ChunkMiB * 1024 * 1024
if ($chunkSize -le 0 -or $chunkSize -gt 24MB) { throw 'Chunk size must be >0 and <=24 MiB for Workers KV.' }

$WindowsExe = (Resolve-Path $WindowsExe).Path
$AndroidApk = (Resolve-Path $AndroidApk).Path
$temp = Join-Path ([IO.Path]::GetTempPath()) ('dtam-update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

function Invoke-KvPut([string]$Key, [string]$Path) {
    $uploadOutput = & npx --yes wrangler kv key put $Key --namespace-id $NamespaceId --path $Path --remote 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $uploadOutput) { Write-Host $line }
    if ($code -ne 0) { throw "KV upload failed for $Key ($code)" }
}

function Publish-Asset([string]$Kind, [string]$Path) {
    $file = Get-Item $Path
    $hash = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
    $chunks = @()
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $index = 0
        $buffer = New-Object byte[] (1024 * 1024)
        while ($stream.Position -lt $stream.Length) {
            $chunkPath = Join-Path $temp ("{0}-{1:D3}.bin" -f $Kind,$index)
            $remaining = [Math]::Min($chunkSize, $stream.Length - $stream.Position)
            $out = [IO.File]::Open($chunkPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $written = [int64]0
                while ($written -lt $remaining) {
                    $want = [int][Math]::Min($buffer.Length, $remaining - $written)
                    $read = $stream.Read($buffer,0,$want)
                    if ($read -le 0) { throw 'Unexpected EOF while chunking update asset.' }
                    $out.Write($buffer,0,$read)
                    $written += $read
                }
            } finally { $out.Dispose() }
            $key = "releases/$Version/$Kind/part-$('{0:D3}' -f $index).bin"
            $chunkHash = (Get-FileHash -Algorithm SHA256 $chunkPath).Hash.ToLowerInvariant()
            Write-Host "Uploading $Kind chunk $index ($remaining bytes)..."
            Invoke-KvPut $key $chunkPath
            $chunks += [ordered]@{ key=$key; size=$remaining; sha256=$chunkHash }
            Remove-Item $chunkPath -Force
            $index++
        }
    } finally { $stream.Dispose() }
    return [ordered]@{
        version = $Version
        filename = $file.Name
        sha256 = $hash
        size = [int64]$file.Length
        chunks = $chunks
    }
}

try {
    $windows = Publish-Asset 'windows' $WindowsExe
    $android = Publish-Asset 'android' $AndroidApk
    $android['versionCode'] = $versionCode
    $manifest = [ordered]@{
        schema = 1
        version = $Version
        publishedAt = [DateTime]::UtcNow.ToString('o')
        windows = $windows
        android = $android
    }
    $manifestPath = Join-Path $temp 'latest.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Publishing latest.json last (atomic release pointer)...'
    Invoke-KvPut 'latest.json' $manifestPath
    Write-Host ("VERSION={0}" -f $Version)
    Write-Host ("WINDOWS_SHA256={0}" -f $windows.sha256)
    Write-Host ("WINDOWS_SIZE={0}" -f $windows.size)
    Write-Host ("ANDROID_SHA256={0}" -f $android.sha256)
    Write-Host ("ANDROID_SIZE={0}" -f $android.size)
    Write-Host ("ANDROID_VERSION_CODE={0}" -f $versionCode)
} finally {
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}
