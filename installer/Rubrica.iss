; Instalador de Rúbrica (Inno Setup 6)
; Compilar:  iscc /DMyAppVersion=1.0.0 /DPublishDir=..\publish [/DArch=arm64] installer\Rubrica.iss
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\publish"
#endif
#define MyAppName "Rúbrica"
#define MyAppPublisher "ZMA Inversiones"
#define MyAppURL "https://github.com/ArgetlamZMA/Rubrica"
#define MyAppExe "Rubrica.exe"

[Setup]
AppId={{B6E2D9A4-5C71-4F2E-9D3A-7A1C0E4B8F25}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\Rubrica
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Instalación por usuario (sin permisos de administrador); se puede elegir «para todos».
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
#if Arch == "arm64"
; Windows en ARM (por ejemplo, portátiles con Snapdragon): ejecutable nativo ARM64
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
OutputBaseFilename=Rubrica-Setup-{#MyAppVersion}-arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=Rubrica-Setup-{#MyAppVersion}
#endif
OutputDir=..\dist-installer
SetupIconFile=app.ico
UninstallDisplayIcon={app}\{#MyAppExe}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
LicenseFile=..\LICENSE
ShowLanguageDialog=auto

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"; InfoBeforeFile: "privacidad.txt"
Name: "english"; MessagesFile: "compiler:Default.isl"; InfoBeforeFile: "privacy-en.txt"
Name: "portuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"; InfoBeforeFile: "privacidade-pt.txt"

[CustomMessages]
spanish.AssocTask=Agregar Rúbrica a «Abrir con» para archivos PDF
spanish.FilesGroup=Archivos:
spanish.PdfDoc=Documento PDF
spanish.WV2Installing=Instalando Microsoft Edge WebView2 Runtime…
spanish.WV2Missing=Rúbrica necesita «Microsoft Edge WebView2 Runtime» y no se pudo instalar automáticamente.%n%n¿Abrir la página de descarga de Microsoft?
english.AssocTask=Add Rúbrica to "Open with" for PDF files
english.FilesGroup=Files:
english.PdfDoc=PDF document
english.WV2Installing=Installing Microsoft Edge WebView2 Runtime…
english.WV2Missing=Rúbrica needs "Microsoft Edge WebView2 Runtime" and it could not be installed automatically.%n%nOpen Microsoft's download page?
portuguese.AssocTask=Adicionar o Rúbrica a "Abrir com" para arquivos PDF
portuguese.FilesGroup=Arquivos:
portuguese.PdfDoc=Documento PDF
portuguese.WV2Installing=Instalando o Microsoft Edge WebView2 Runtime…
portuguese.WV2Missing=O Rúbrica precisa do "Microsoft Edge WebView2 Runtime" e não foi possível instalá-lo automaticamente.%n%nAbrir a página de download da Microsoft?

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "pdfassoc"; Description: "{cm:AssocTask}"; GroupDescription: "{cm:FilesGroup}"

[InstallDelete]
; Restos de la versión 1.0, que se llamaba «PDF Studio»
Type: files; Name: "{app}\PdfStudio.exe"
Type: files; Name: "{app}\PdfStudio.dll"
Type: files; Name: "{autoprograms}\PDF Studio.lnk"
Type: files; Name: "{autodesktop}\PDF Studio.lnk"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Registry]
; Se registra como opción de «Abrir con»; no cambia el programa predeterminado del usuario.
Root: HKA; Subkey: "Software\Classes\Rubrica.Document"; ValueType: string; ValueData: "{cm:PdfDoc}"; Flags: uninsdeletekey; Tasks: pdfassoc
Root: HKA; Subkey: "Software\Classes\Rubrica.Document\DefaultIcon"; ValueType: string; ValueData: "{app}\{#MyAppExe},0"; Tasks: pdfassoc
Root: HKA; Subkey: "Software\Classes\Rubrica.Document\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: pdfassoc
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "Rubrica.Document"; ValueData: ""; Flags: uninsdeletevalue; Tasks: pdfassoc
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExe}\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""; Flags: uninsdeletekey; Tasks: pdfassoc
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#MyAppName}"; Tasks: pdfassoc

Root: HKA; Subkey: "Software\Classes\PDFStudio.Document"; ValueType: none; Flags: deletekey dontcreatekey
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: none; ValueName: "PDFStudio.Document"; Flags: deletevalue dontcreatekey
Root: HKA; Subkey: "Software\Classes\Applications\PdfStudio.exe"; ValueType: none; Flags: deletekey dontcreatekey

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
; Tras una actualización silenciosa, volver a abrir la aplicación
Filename: "{app}\{#MyAppExe}"; Flags: nowait; Check: WizardSilent

[Code]
function WebView2Installed(): Boolean;
var v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  Result := Result and (v <> '') and (v <> '0.0.0.0');
end;

// Si falta WebView2, se descarga e instala el «bootstrapper» oficial de Microsoft (unos 2 MB).
procedure CurStepChanged(CurStep: TSetupStep);
var ErrorCode, ResultCode: Integer; ok: Boolean;
begin
  if (CurStep <> ssPostInstall) or WebView2Installed() then exit;
  ok := False;
  try
    WizardForm.StatusLabel.Caption := CustomMessage('WV2Installing');
    DownloadTemporaryFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '', nil);
    ok := Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and WebView2Installed();
  except
    ok := False;
  end;
  if (not ok) and (not WizardSilent) then
    if MsgBox(CustomMessage('WV2Missing'), mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;
