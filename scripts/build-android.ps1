param(
    [string]$VersionName = '3.0.2',
    [int]$VersionCode = 3000200,
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Root 'client\android'
$Work = Join-Path $Project '.build'
if (-not $OutputPath) { $OutputPath = Join-Path $Root ("dist\DTAM-Android-v{0}.apk" -f $VersionName) }

$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:USERPROFILE 'scoop\apps\android-clt\current'),
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'platforms')) }
if (-not $sdkCandidates) { throw 'Android SDK not found.' }
$Sdk = $sdkCandidates[0]
$AndroidJar = Join-Path $Sdk 'platforms\android-35\android.jar'
if (-not (Test-Path $AndroidJar)) { throw "Missing $AndroidJar" }

$BuildToolsDir = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory |
    Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $BuildToolsDir) { throw 'Android build-tools not found.' }

$Aapt2 = Join-Path $BuildToolsDir 'aapt2.exe'
$D8 = Join-Path $BuildToolsDir 'd8.bat'
$ZipAlign = Join-Path $BuildToolsDir 'zipalign.exe'
$ApkSigner = Join-Path $BuildToolsDir 'apksigner.bat'
foreach ($tool in @($Aapt2,$D8,$ZipAlign,$ApkSigner)) { if (-not (Test-Path $tool)) { throw "Missing tool: $tool" } }

$javaExe = (Get-Command java.exe -ErrorAction Stop).Source
$JavaHome = Split-Path -Parent (Split-Path -Parent $javaExe)
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Jar = Join-Path $JavaHome 'bin\jar.exe'
$KeyTool = Join-Path $JavaHome 'bin\keytool.exe'
$env:JAVA_HOME = $JavaHome

if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Work, (Join-Path $Work 'classes'), (Join-Path $Work 'dex'), (Split-Path -Parent $OutputPath) | Out-Null

$Unsigned = Join-Path $Work 'base-unsigned.apk'
$WithDex = Join-Path $Work 'base-dex.apk'
$Aligned = Join-Path $Work 'base-aligned.apk'
$ClassesJar = Join-Path $Work 'classes.jar'

& $Aapt2 link -I $AndroidJar --manifest (Join-Path $Project 'AndroidManifest.xml') --min-sdk-version 26 --target-sdk-version 35 --version-code $VersionCode --version-name $VersionName -o $Unsigned
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed: $LASTEXITCODE" }

$sources = @(Get-ChildItem (Join-Path $Project 'src') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
if (-not $sources.Count) { throw 'No Android Java sources found.' }
$javacArgs = @('-encoding','UTF-8','-source','8','-target','8','-classpath',$AndroidJar,'-d',(Join-Path $Work 'classes')) + $sources
& $Javac @javacArgs
if ($LASTEXITCODE -ne 0) { throw "javac failed: $LASTEXITCODE" }

& $Jar --create --file $ClassesJar -C (Join-Path $Work 'classes') .
if ($LASTEXITCODE -ne 0) { throw "jar failed: $LASTEXITCODE" }
& $D8 --lib $AndroidJar --min-api 26 --output (Join-Path $Work 'dex') $ClassesJar
if ($LASTEXITCODE -ne 0) { throw "d8 failed: $LASTEXITCODE" }

Copy-Item $Unsigned $WithDex -Force
& $Jar uf $WithDex -C (Join-Path $Work 'dex') classes.dex
if ($LASTEXITCODE -ne 0) { throw "APK dex insertion failed: $LASTEXITCODE" }
& $ZipAlign -f -p 4 $WithDex $Aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign failed: $LASTEXITCODE" }

$SignDir = Join-Path $env:USERPROFILE '.dtam-signing'
$KeyStore = Join-Path $SignDir 'android-release.p12'
$PassFile = Join-Path $SignDir 'android-release.pass'
New-Item -ItemType Directory -Force -Path $SignDir | Out-Null
if (-not (Test-Path $PassFile)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $pass = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]','').Substring(0,32)
    Set-Content -LiteralPath $PassFile -Value $pass -NoNewline -Encoding ascii
}
$storePass = (Get-Content -LiteralPath $PassFile -Raw).Trim()
if (-not (Test-Path $KeyStore)) {
    & $KeyTool -genkeypair -noprompt -keystore $KeyStore -storetype PKCS12 -storepass $storePass -keypass $storePass -alias dtam -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=DTAM Android, O=LunarLab, C=GB'
    if ($LASTEXITCODE -ne 0) { throw "keytool failed: $LASTEXITCODE" }
}

if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
$env:DTAM_ANDROID_SIGNING_PASS = $storePass
& $ApkSigner sign --ks $KeyStore --ks-key-alias dtam --ks-pass 'env:DTAM_ANDROID_SIGNING_PASS' --key-pass 'env:DTAM_ANDROID_SIGNING_PASS' --out $OutputPath $Aligned
Remove-Item Env:DTAM_ANDROID_SIGNING_PASS -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { throw "apksigner failed: $LASTEXITCODE" }
& $ApkSigner verify --verbose --print-certs $OutputPath
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed: $LASTEXITCODE" }

$hash = (Get-FileHash -Algorithm SHA256 $OutputPath).Hash.ToLowerInvariant()
$item = Get-Item $OutputPath
Write-Host ("APK={0}" -f $item.FullName)
Write-Host ("SIZE={0}" -f $item.Length)
Write-Host ("SHA256={0}" -f $hash)
