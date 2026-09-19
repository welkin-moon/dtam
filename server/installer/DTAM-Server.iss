#define MyAppName "DTAM Server"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{A44D2E18-4B46-4A46-95AF-41AD329B9666}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
UninstallDisplayName={#MyAppName}
DefaultDirName={code:GetDefaultDirName}
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SourceDir=..\..
OutputDir=.
OutputBaseFilename=DTAM-Server-Setup-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
SetupLogging=yes
CloseApplications=no
RestartIfNeededByRun=no
WizardStyle=modern

[Dirs]
Name: "{app}\bin"
Name: "{app}\config"
Name: "{app}\data"
Name: "{app}\installer"

[Files]
Source: "server\installer\dtam-server.exe"; DestDir: "{app}\bin"; DestName: "dtam-server.exe"; Flags: ignoreversion
Source: "server\config.example.json"; DestDir: "{app}\config"; DestName: "config.example.json"; Flags: ignoreversion
Source: "server\installer\run-server.ps1"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "server\installer\install-server.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "server\installer\uninstall-server.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\installer\install-server.ps1"" -Root ""{app}"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; StatusMsg: "Registering DTAM Rust Server..."

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\installer\uninstall-server.ps1"" -Root ""{app}"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated

[Code]
function GetDefaultDirName(Param: String): String;
begin
  if DirExists('C:\server') then
    Result := 'C:\server'
  else if DirExists('D:\server') then
    Result := 'D:\server'
  else
    Result := ExpandConstant('{sd}\server');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "DTAM Rust Server"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM dtam-server.exe /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
