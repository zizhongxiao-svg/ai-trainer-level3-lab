; ============================================================================
;  AI Trainer Level 3 Lab —— Windows 一键安装包 (Inno Setup 脚本)
;  生成一个 Setup.exe：把应用镜像 + 启动脚本装到本机，建桌面/开始菜单快捷方式。
;  底层运行仍走 Docker（社区版不内置 Docker 安装包，需用户自行安装 Docker Desktop）。
;
;  编译方法（在 Windows 上）：
;    1. 安装 Inno Setup 6  https://jrsoftware.org/isdl.php
;    2. 先在项目根目录跑  build_release.sh  生成镜像 tar.gz（见 build-windows-installer.md）
;    3. 把生成的 ai-trainer-level3-lab.tar.gz 放到  installer\payload\  下
;    4. 用 Inno Setup 打开本文件，点 Build → 在 installer\Output\ 得到 Setup.exe
;
;  说明：使用 ISPP 预处理（Inno Setup 6 自带）。若 payload 里没有镜像 tar.gz，
;  安装包仍可编译——首启时 start.bat 会回退到拉取/查找本机已有镜像。
; ============================================================================

#define MyAppName "AI训练师三级 备考通"
#define MyAppVersion "2026.06.15"
#define MyAppPublisher "ai-trainer-level3-lab"
#define MyAppURL "https://github.com/zizhongxiao-svg/ai-trainer-level3-lab"
#define MyLauncher "启动.bat"
#define MyStopper "停止.bat"

; 仓库根目录（相对本 .iss 所在的 installer\ 目录）
#define RepoDir ".."
; 镜像 tar.gz 的存放位置（编译前把 build_release.sh 产物拷到这里）
#define ImageTar "payload\ai-trainer-level3-lab.tar.gz"

[Setup]
AppId={{8E7C2F4A-1D2B-4E55-9A3F-A17C0B9E5D21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
; 装到当前用户可写目录：应用会在安装目录下写 persist\（账号/进度），
; 放 Program Files 会因权限写不进去，所以用 localappdata + 最低权限。
DefaultDirName={localappdata}\AITrainerLevel3Lab
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=AITrainer-Level3-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
; 用内置英文界面以免依赖额外的 ChineseSimplified.isl；可见文案/快捷方式仍是中文。
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: checkedonce

[Files]
; —— 运行所需的最小文件集（均来自仓库根）——
Source: "{#RepoDir}\docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\.env.example";       DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\start.bat";          DestDir: "{app}"; DestName: "{#MyLauncher}"; Flags: ignoreversion
Source: "{#RepoDir}\stop.bat";           DestDir: "{app}"; DestName: "{#MyStopper}";  Flags: ignoreversion
Source: "{#RepoDir}\README.md";          DestDir: "{app}"; Flags: ignoreversion isreadme
; —— 应用 Docker 镜像（体积大；编译前放到 installer\payload\ 下）——
#if FileExists(ImageTar)
Source: "{#ImageTar}"; DestDir: "{app}"; DestName: "ai-trainer-level3-lab.tar.gz"; Flags: ignoreversion
#else
#pragma message "提示：未找到 " + ImageTar + " —— 生成的安装包不含镜像，首启时 start.bat 会在本机查找已有镜像。"
#endif

[Icons]
Name: "{group}\{#MyAppName}";       Filename: "{app}\{#MyLauncher}"; WorkingDir: "{app}"
Name: "{group}\停止 {#MyAppName}";  Filename: "{app}\{#MyStopper}";  WorkingDir: "{app}"
Name: "{group}\卸载 {#MyAppName}";  Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyLauncher}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyLauncher}"; Description: "立即启动 {#MyAppName}"; Flags: postinstall shellexec skipifsilent nowait

[UninstallDelete]
; 卸载时不要删用户数据 persist\，避免误删账号/进度；仅清空安装目录其余内容由 Inno 处理。
Type: dirifempty; Name: "{app}"

[Code]
// 安装前友好提示：检测本机是否已装 Docker（社区版需要 Docker Desktop）。
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  HasDocker: Boolean;
begin
  Result := True;
  HasDocker := Exec('cmd.exe', '/C docker --version', '', SW_HIDE,
                    ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  if not HasDocker then
  begin
    if MsgBox('未检测到 Docker。' + #13#10 +
              '本软件依赖 Docker Desktop 运行（Windows 10/11 家庭版会自动启用 WSL2）。' + #13#10 + #13#10 +
              '请先到 https://www.docker.com/products/docker-desktop/ 安装并启动 Docker，' + #13#10 +
              '然后再运行本安装包。' + #13#10 + #13#10 +
              '仍要继续安装吗？（安装后需先装好 Docker 才能启动）',
              mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;
