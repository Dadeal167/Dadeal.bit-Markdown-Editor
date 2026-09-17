/**
 * 生成「开始使用.bat」/「停止助手.bat」，并把便携版 Node 放进 runtime\。
 *
 * 为什么：以前用助手要三步（双击 bat、留着黑窗口、再把令牌粘进面板）。
 * 现在双击**一个**「开始使用.bat」就行：
 *   后台悄悄启动助手（没有黑窗口）→ 等它就绪 → 自动打开编辑器 → 顺手把令牌带过去
 *   （放在地址栏 hash 里，编辑器读到就存下来并立刻抹掉，见 ZhihuEditor.tsx）。
 * 文件夹里带一份 node.exe，别人拿到不用装 Node。
 *
 * .bat 内容**只用 ASCII**（中文在 cmd 下要配合代码页，写不好就是一片乱码，
 * 干脆不写中文；writeLauncherFiles 会强制检查，写了中文直接报错）。
 *
 * ⚠️ 这些 .bat 模板都是**反引号字符串**：模板里**绝对不能出现反引号**，
 * 否则字符串当场被截断，报的是莫名其妙的 "Unexpected identifier"（踩过两次，两次都白测了一轮）。
 * 注释里要举例就用普通引号。
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CRLF = (s) => s.replace(/\n/g, '\r\n')

/**
 * 关掉后台助手：按命令行匹配（不看端口，改过端口也找得到）。
 * 同时关掉助手专用配置目录的 msedge —— 配置目录被占着，下次启动浏览器会失败。
 * `$_.ProcessId -ne $PID` 是为了别把正在执行这条命令的 powershell 自己算进去
 * （它自己的命令行里就有 zhihu-assistant.mjs 这个字符串）。
 */
const STOP_PS = `powershell -NoProfile -Command "$n=0; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*zhihu-assistant.mjs*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*dadealbit*zhihu-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; if($n -gt 0){ Write-Host '   Assistant stopped.' } else { Write-Host '   Assistant was not running.' }"`

/** 端口上有没有人在听（不依赖 Get-NetTCPConnection，老系统也能跑） */
const PORT_PS = `powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{ $c.Connect('127.0.0.1',%PORT%); $c.Close(); exit 0 }catch{ exit 1 }"`

/** 启动器：后台拉起助手 → 等就绪 → 打开编辑器（令牌随 URL 带过去） */
const START_BAT = `@echo off
setlocal
cd /d "%~dp0"
set "PORT=5174"
if not "%DADEALBIT_PORT%"=="" set "PORT=%DADEALBIT_PORT%"
set "TOKENFILE=%USERPROFILE%\\.dadealbit\\token.txt"
set "READY=%~dp0_dadealbit_ready.tmp"

rem --- prefer the node.exe shipped in this folder, fall back to a system one ---
set "NODE="
if exist "%~dp0runtime\\node.exe" set "NODE=%~dp0runtime\\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if errorlevel 1 goto :nonode
  set "NODE=node"
)
if not exist "assistant\\zhihu-assistant.mjs" goto :nofile
if not exist "assistant\\node_modules\\playwright-core" goto :nodeps

rem --- find the editor html. Its file name is Chinese, and a .bat must stay
rem     ASCII-only, so we match it with wildcards instead of spelling it out.
rem     (a wildcard with no match still runs the body once with the literal
rem      pattern, hence the "exist" check below) ---
set "HTMLF="
for %%f in ("%~dp0Dadealbit*.html") do if not defined HTMLF set "HTMLF=%%~nxf"
if not defined HTMLF goto :nohtml
if not exist "%~dp0%HTMLF%" goto :nohtml

rem --- already running (and the token in token.txt still matches)? then just open ---
call :probe 8
if not errorlevel 1 goto :ready

rem --- something on the port that does not answer our token = a leftover instance ---
call :stale
if errorlevel 1 goto :startit
echo.
echo   An old assistant is holding the port; stopping it first...
${STOP_PS}
powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul 2>nul

:startit
echo.
echo   Starting the assistant in the background (no window)...
powershell -NoProfile -Command "Start-Process -FilePath '%NODE%' -ArgumentList 'assistant\\zhihu-assistant.mjs','--port','%PORT%' -WorkingDirectory '%~dp0' -WindowStyle Hidden" >nul 2>nul

rem --- wait until it answers (up to ~50s: first run may be slow) ---
call :probe 70
if errorlevel 1 goto :failed

:ready
set "TOKEN="
set /p TOKEN=<"%READY%"
del "%READY%" >nul 2>nul

rem --- If this folder was moved or renamed, the autostart entry in the Windows Startup
rem     folder still points at the OLD location (that file must hold an absolute path),
rem     so the assistant would silently fail to start after the next login. Fix it here.
rem     NOTE: a .bat must stay pure ASCII, so the Chinese-named autostart .bat is found
rem     with a wildcard instead of being spelled out. ---
if exist "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\dadealbit-assistant.vbs" (
  powershell -NoProfile -Command "$s=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\dadealbit-assistant.vbs'; $t=[IO.File]::ReadAllText($s,[Text.Encoding]::Unicode); $d='%~dp0'.TrimEnd('\\'); if($t -like ('*'+$d+'*')){ exit 0 } else { exit 3 }" >nul 2>nul
  if errorlevel 3 (
    echo   Autostart entry pointed to an old folder ^(the folder was moved^); updating it...
    for %%b in ("%~dp0*autostart-on.bat") do call "%%~fb" --silent
  )
)

if "%DADEALBIT_NO_OPEN%"=="1" (
  rem no parentheses in here: cmd parses "(" inside an if-block as a block end
  echo   Assistant is up on port %PORT%. Editor not opened: DADEALBIT_NO_OPEN=1
  exit /b 0
)
rem --- Open the editor through the shipped helper (_open-editor.ps1): it builds a proper
rem     file:// URL and hands it to the DEFAULT BROWSER the way Windows itself does.
rem     Measured on Windows 11 + Edge (all four tried): "start <url>" -> Access is denied;
rem     rundll32 url.dll,FileProtocolHandler -> silently nothing; explorer.exe <file:// url>
rem     -> treats it as Explorer's own scheme and opens a FOLDER window; the registry route
rem     (http UserChoice -> ProgId -> shell\open\command) -> works.
rem     The HTML file is passed as a parameter instead of being spelled out, so a .bat that
rem     must stay pure ASCII never has to contain the Chinese file name. ---
echo   Opening the editor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_open-editor.ps1" -Html "%~dp0%HTMLF%" -Token "%TOKEN%" -Port %PORT%
if errorlevel 1 goto :nobrowser
exit /b 0

:nobrowser
echo   [x] Could not hand the editor to a browser automatically.
echo       Just double-click the "Dadealbit*.html" file in this folder yourself - the token
echo       is printed right here; paste it into the Zhihu panel if it asks.
echo   token: %TOKEN%
pause
exit /b 1

rem --- the assistant writes a fresh token to token.txt on every start, and EVERY
rem     route (even /status) needs it in the x-dadealbit-token header. So "ready"
rem     means: token file readable AND /status answers 200 with it. On success the
rem     token is stashed in %READY% for the caller.  %1 = attempts (0.7s each) ---
:probe
powershell -NoProfile -Command "$f='%TOKENFILE%'; $o='%READY%'; Remove-Item $o -ErrorAction SilentlyContinue; for($i=0;$i -lt %1;$i++){ $t=$null; try{ $t=(Get-Content -Raw -ErrorAction Stop $f) }catch{ $t=$null }; if($t){ $t=$t.Trim() }; if($t){ try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Headers @{'x-dadealbit-token'=$t} 'http://127.0.0.1:%PORT%/status'; if($r.StatusCode -eq 200){ Set-Content -Path $o -Value $t -NoNewline; exit 0 } }catch{} }; Start-Sleep -Milliseconds 700 }; exit 1" >nul 2>nul
exit /b %errorlevel%

:stale
${PORT_PS} >nul 2>nul
exit /b %errorlevel%

:nonode
echo.
echo   [x] Node.js not found (and runtime\\node.exe is missing).
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1

:nodeps
echo.
echo   [x] Missing dependency: assistant\\node_modules\\playwright-core
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1

:nofile
echo.
echo   [x] Missing file: assistant\\zhihu-assistant.mjs
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1

:nohtml
echo.
echo   [x] No editor found in this folder (expected a "Dadealbit...html" file).
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1

:failed
del "%READY%" >nul 2>nul
echo.
echo   [x] The assistant did not start.
echo       Try the manual launcher: the .bat file in this folder whose window stays open
echo       (it prints the reason on screen). The .bat files here are:
dir /b "%~dp0*.bat"
echo.
echo       If an old assistant is stuck, run the stop .bat first.
echo.
pause
exit /b 1
`

/**
 * 打开编辑器的小助手（PowerShell）。
 *
 * 为什么要单独一个文件、而不是在 .bat 里写一长串：cmd 里套引号的长 PowerShell 命令既难写又难查
 * （自启那段注释里记过这个教训）。这里只做一件事：拼出带令牌的 file:// URL，然后**按 Windows
 * 自己的办法**交给默认浏览器 —— 从注册表取 http 关联的 ProgId，再取它的 shell\open\command。
 * 实测（Windows 11 + Edge）：start 会 Access is denied、rundll32 静默无效、
 * explorer.exe 会把 file:// 当自己的协议去开文件夹窗口，只有注册表这条路真的打开了页面。
 *
 * 纯 ASCII：cmd 那边用 -File 调用，不经过代码页转换。DADEALBIT_DRY_RUN=1 时只打印地址（测试用）。
 */
const OPEN_PS1 = `param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Port
)
$ErrorActionPreference = 'Continue'
$url = ([uri]$Html).AbsoluteUri + '#zhihu-token=' + $Token + '&zhihu-addr=http://127.0.0.1:' + $Port

if ($env:DADEALBIT_DRY_RUN -eq '1') {
  Write-Output ('Would open: ' + $url)
  exit 0
}

function Start-WithDefaultBrowser([string]$u) {
  try {
    $progId = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -ErrorAction Stop).ProgId
    if (-not $progId) { return $false }
    $cmd = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\' + $progId + '\\shell\\open\\command') -ErrorAction Stop).'(default)'
    if (-not $cmd) { return $false }
    $line = $cmd.Replace('%1', $u).Replace('%*', $u)
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', $line -WindowStyle Hidden
    return $true
  } catch {
    return $false
  }
}

function Start-WithKnownBrowser([string]$u) {
  $candidates = @(
    (Join-Path \${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),
    (Join-Path \${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Mozilla Firefox\\firefox.exe')
  )
  foreach ($exe in $candidates) {
    if ($exe -and (Test-Path $exe)) {
      Start-Process -FilePath $exe -ArgumentList $u
      return $true
    }
  }
  return $false
}

if (Start-WithDefaultBrowser $url) {
  Write-Output ('Opened: ' + $url)
  exit 0
}
if (Start-WithKnownBrowser $url) {
  Write-Output ('Opened: ' + $url)
  exit 0
}
Write-Output 'Could not find a browser to open the editor.'
exit 1
`

/** 开机静默自启：往 Windows「启动」文件夹放一个 .vbs，登录后助手就在后台跑着。
 *  为什么用 .vbs 而不是直接把 bat 丢进去：VBS 的 `Run ..., 0, False` 能把窗口藏掉（0 = 隐藏），
 *  双击 bat 反而会弹黑窗口。整个操作不需要管理员权限，删除也只是一个文件。 */
const AUTOSTART_BAT = `@echo off
setlocal
cd /d "%~dp0"
rem --- --silent: used by the main launcher to silently refresh this entry after the
rem     folder was moved (no pause, no popup, no immediate start) ---
set "SILENT="
if /i "%~1"=="--silent" set "SILENT=1"
set "NODE=%~dp0runtime\\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "assistant\\zhihu-assistant.mjs" goto :nofile
set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
if not exist "%STARTUP%" goto :nostartup

rem --- write a hidden launcher into the Windows Startup folder.
rem     Two gotchas (both measured):
rem       1. cscript reads .vbs as ANSI -> a UTF-8 file with a Chinese path inside dies with
rem          "The system cannot find the file specified". So the VBS must be UTF-16.
rem       2. Keeping a long PowerShell one-liner quoted correctly inside a .bat is hopeless,
rem          so we drop a small ASCII .ps1 next to this file and run that. It derives its own
rem          folder, so no Chinese literal is needed anywhere.
echo.
echo   Installing autostart (hidden)...
set "PS=%~dp0_autostart.ps1"
> "%PS%" echo $ErrorActionPreference = 'Stop'
>> "%PS%" echo $dir = Split-Path -Parent $MyInvocation.MyCommand.Path
>> "%PS%" echo $node = Join-Path $dir 'runtime\\node.exe'
>> "%PS%" echo if (-not (Test-Path $node)) { $node = 'node' }
>> "%PS%" echo $startup = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'
>> "%PS%" echo $vbs = Join-Path $startup 'dadealbit-assistant.vbs'
>> "%PS%" echo $q = [char]34
>> "%PS%" echo $vbs2 = $vbs
>> "%PS%" echo Remove-Item $vbs2 -ErrorAction SilentlyContinue
>> "%PS%" echo Add-Content -Path $vbs2 -Encoding Unicode -Value ('Set sh = CreateObject(' + $q + 'WScript.Shell' + $q + ')')
>> "%PS%" echo Add-Content -Path $vbs2 -Encoding Unicode -Value ('sh.CurrentDirectory = ' + $q + $dir + $q)
>> "%PS%" echo Add-Content -Path $vbs2 -Encoding Unicode -Value ('sh.Run ' + $q + $q + $q + $node + $q + $q + ' assistant\\zhihu-assistant.mjs --port 5174' + $q + ', 0, False')
>> "%PS%" echo Write-Output ('wrote ' + $vbs2)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS%" >nul 2>nul
del "%PS%" >nul 2>nul
if not exist "%STARTUP%\\dadealbit-assistant.vbs" goto :nowrite

if defined SILENT (
  echo   Autostart entry updated to this folder: %~dp0
  exit /b 0
)
echo   Done. The assistant will start automatically (hidden) next time you log in.
echo   Starting it right now too (nothing will pop up)...
cscript //nologo "%STARTUP%\\dadealbit-assistant.vbs" >nul 2>nul
powershell -NoProfile -Command "Start-Sleep -Seconds 4" >nul 2>nul
echo.
echo   Now open the editor (the .html file in this folder) - the Zhihu panel should
echo   show "assistant connected". If it does not, run the main launcher .bat instead.
echo.
echo   NOTE: this autostart entry remembers THIS folder. If you move or rename the
echo   folder later, just run the main launcher once - it will fix the entry by itself.
echo.
echo   To undo this autostart later, run the .bat whose name contains: autostart-off
echo.
pause
exit /b 0

:nofile
if defined SILENT exit /b 1
echo   [x] Missing assistant\\zhihu-assistant.mjs - re-copy the whole folder.
pause
exit /b 1

:nowrite
if defined SILENT exit /b 1
echo   [x] Could not write to the Windows Startup folder. Just use the main launcher .bat.
pause
exit /b 1

:nostartup
if defined SILENT exit /b 1
echo   [x] Cannot find the Windows Startup folder. Just use the main launcher .bat.
pause
exit /b 1
`

/** 取消自启（只是删掉启动文件夹里那个文件） */
const NOAUTOSTART_BAT = `@echo off
setlocal
set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
if exist "%STARTUP%\\dadealbit-assistant.vbs" del "%STARTUP%\\dadealbit-assistant.vbs" >nul 2>nul
echo.
echo   Autostart removed. (The assistant is still running right now -
echo   run the .bat whose name starts with the "stop" wording if you want it stopped.)
echo.
pause
exit /b 0
`

/** 停止助手：关掉后台助手 + 助手专用的浏览器窗口（不碰你日常用的浏览器） */
const STOP_BAT = `@echo off
setlocal
echo.
echo   Stopping the assistant...
${STOP_PS}
rem "timeout" needs a console on stdin; Start-Sleep always works
powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul 2>nul
exit /b 0
`

/**
 * 把启动器写进交付文件夹。
 * @param dir 交付文件夹（例如 桌面/自用）
 */
export function writeLauncherFiles(dir) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of [
    ['开始使用.bat', START_BAT],
    ['停止助手.bat', STOP_BAT],
    ['安装助手自启 autostart-on.bat', AUTOSTART_BAT],
    ['取消助手自启 autostart-off.bat', NOAUTOSTART_BAT],
  ]) {
    // 防止哪天顺手写了中文：.bat 以 ascii 写出会把中文变成 ???（cmd 下必然乱码）
    const bad = [...new Set([...text].filter((c) => c.charCodeAt(0) > 126))]
    if (bad.length) {
      throw new Error(`${name} 里有非 ASCII 字符，cmd 下会乱码：${bad.join(' ')}`)
    }
    writeFileSync(resolve(dir, name), CRLF(text), 'ascii')
  }
  // 打开编辑器的小助手（PowerShell，同样纯 ASCII）：.bat 用 -File 调它
  writeFileSync(resolve(dir, '_open-editor.ps1'), CRLF(OPEN_PS1), 'ascii')
  console.log('  ✓ 开始使用.bat（后台起助手 + 打开编辑器 + 自动带令牌）')
  console.log('  ✓ 停止助手.bat')
}

/**
 * 把当前这个 node.exe 复制进 <dir>/runtime/，别人就不用装 Node 了。
 * @returns 复制到的路径，或 null（复制失败时不影响其它文件）
 */
export function bundleNodeRuntime(dir) {
  const target = resolve(dir, 'runtime')
  mkdirSync(target, { recursive: true })
  const dest = resolve(target, 'node.exe')
  // 已经是一份了就别重复拷（80 多 MB，能省则省）
  try {
    if (existsSync(dest) && statSync(dest).size === statSync(process.execPath).size) {
      console.log('  ✓ runtime\\node.exe（已存在，跳过）')
      return dest
    }
  } catch {
    /* 比不了大小就照拷 */
  }
  try {
    copyFileSync(process.execPath, dest)
    writeFileSync(
      resolve(target, 'LICENSE-node.txt'),
      [
        'This folder contains a copy of the Node.js runtime (node.exe),',
        'so that the assistant runs without installing anything.',
        '',
        'Node.js is licensed under the MIT license.',
        'Copyright Node.js contributors. All rights reserved.',
        'Full license text: https://github.com/nodejs/node/blob/main/LICENSE',
        '',
        `Copied from: ${process.execPath}`,
        `Version: ${process.version}`,
        '',
      ].join('\n'),
      'utf8',
    )
    const mb = (statSync(dest).size / 1024 / 1024).toFixed(0)
    console.log(`  ✓ runtime\\node.exe（${mb} MB，别人不用装 Node）`)
    return dest
  } catch (e) {
    console.log(`  ⚠️ 没能带上 node 运行时（${e.code || e.message}）：目标机器需要自己装 Node`)
    return null
  }
}
