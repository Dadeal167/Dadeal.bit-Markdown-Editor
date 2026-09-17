/**
 * 打出「知乎助手包」：给 GitHub Release 下载用的一份**开箱即用**压缩包。
 *
 * 为什么单独一个脚本：自用交付包里带的编辑器是**特效版**（含鼠标特效和那枚从游戏里提取的指针素材），
 * 那些东西不能发布。所以这里复用同一套装配流程（助手 + 便携 Node + 启动器），
 * 只把里面的编辑器换成**分享版那个纯净 HTML**（对外发布的那份）。
 *
 * 产出：`.probe/release/Dadealbit-Zhihu-Assistant-v<版本>.zip`
 *
 * ⚠️ 资产名必须**纯 ASCII**：GitHub 会把 Release 资产名里的中文抹掉
 * （实测 `Dadealbit-知乎助手包-v1.0.0.zip` 上传后变成 `Dadealbit-.-v1.0.0.zip`），
 * 所以文件名用英文，中文说明放在包内的「使用说明.txt」和 Release 描述里。
 *
 * 内容：
 *   Dadealbit Markdown 编辑器.html    ← 分享版（纯净，无特效、无游戏素材）
 *   开始使用.bat / 停止助手.bat / 安装助手自启 / 取消助手自启
 *   启动知乎助手.bat（手动那条老路，窗口里会打印令牌）
 *   assistant/zhihu-assistant.mjs + assistant/node_modules/playwright-core
 *   runtime/node.exe                  ← 便携 Node，用户不用自己装
 *   使用说明.txt
 *
 * 用法：node scripts/make-assistant-bundle.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { bundleNodeRuntime, writeLauncherFiles } from './make-launcher.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const VERSION = 'v1.0.0'
const OUT_DIR = resolve(ROOT, '.probe', 'release')
const STAGE = resolve(OUT_DIR, '知乎助手包')
const ZIP = resolve(OUT_DIR, `Dadealbit-Zhihu-Assistant-${VERSION}.zip`)

const PURE_HTML = resolve(ROOT, 'Dadealbit Markdown 编辑器.html')
const ASSIST = resolve(ROOT, 'scripts', 'zhihu-assistant.mjs')
const PW_CORE = resolve(ROOT, 'node_modules', 'playwright-core')

/* ---------- 0. 前置检查：产物必须在、且里面不能有特效/游戏素材 ---------- */
if (!existsSync(PURE_HTML)) {
  console.error('先跑 pnpm build（缺 Dadealbit Markdown 编辑器.html）')
  process.exit(1)
}
{
  const html = readFileSync(PURE_HTML, 'utf-8')
  const leaked = ['sparkCanvas', 'fx-cursor', 'zh-fx__', 'md-editor-mouse-effect', '特效'].filter((m) => html.includes(m))
  if (leaked.length) {
    console.error(`这份 HTML 里带着自用版才该有的东西：${leaked.join('、')} —— 不能发布，先跑 pnpm build:pure`)
    process.exit(1)
  }
}

/* ---------- 1. 清空暂存目录，重新装配 ---------- */
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

// 编辑器：分享版（纯净）
cpSync(PURE_HTML, resolve(STAGE, 'Dadealbit Markdown 编辑器.html'))

// 手动那条老路：双击它，窗口里会打印令牌
const ASSIST_BAT = `@echo off
title Dadealbit Zhihu Draft Assistant
rem --- this .bat lives in the launcher subfolder; assistant/ and runtime/ are one level up ---
cd /d "%~dp0..\\assistant"

rem --- prefer the node.exe shipped next to this folder (a machine without Node still works) ---
set "NODE=node"
if exist "%~dp0..\\..\\runtime\\node.exe" set "NODE=%~dp0..\\..\\runtime\\node.exe"

where node >nul 2>nul
if not errorlevel 1 goto :haveNode
if not exist "%~dp0..\\..\\runtime\\node.exe" goto :nonode
:haveNode
if not exist "node_modules\\playwright-core" goto :nodeps
if not exist "zhihu-assistant.mjs" goto :nofile
echo.
echo   Starting the Zhihu draft assistant...
echo   Keep this window open while you use it.
echo.
"%NODE%" zhihu-assistant.mjs
echo.
echo   Assistant stopped. Press any key to close.
pause >nul
exit /b 0
:nonode
echo   [x] Node.js not found. Use the bundled runtime\\node.exe or install Node.js.
pause >nul
exit /b 1
:nodeps
echo   [x] Missing dependency: assistant\\node_modules\\playwright-core
pause >nul
exit /b 1
:nofile
echo   [x] Missing file: assistant\\zhihu-assistant.mjs
pause >nul
exit /b 1
`
// .bat 统一放进「启动器」子文件夹（根目录只留编辑器、说明和两个数据文件夹）
mkdirSync(resolve(STAGE, '启动器'), { recursive: true })
writeFileSync(resolve(STAGE, '启动器', '启动知乎助手.bat'), ASSIST_BAT.replace(/\n/g, '\r\n'), 'ascii')

// 助手本体 + 依赖（dereference：pnpm 里 playwright-core 是符号链接，不解引用会拷成空壳）
const asstDir = resolve(STAGE, 'assistant')
mkdirSync(resolve(asstDir, 'node_modules'), { recursive: true })
cpSync(ASSIST, resolve(asstDir, 'zhihu-assistant.mjs'))
cpSync(PW_CORE, resolve(asstDir, 'node_modules', 'playwright-core'), { recursive: true, dereference: true })
writeFileSync(
  resolve(asstDir, 'package.json'),
  JSON.stringify(
    { name: 'dadealbit-zhihu-assistant', version: VERSION.replace(/^v/, ''), private: true, type: 'module', scripts: { start: 'node zhihu-assistant.mjs' }, dependencies: { 'playwright-core': '^1.54.1' } },
    null,
    2,
  ) + '\n',
  'utf8',
)

// 双击一个 bat 就能用：后台起助手 + 自动带令牌 + 打开编辑器；不用装 Node
writeLauncherFiles(STAGE)
bundleNodeRuntime(STAGE)

// 说明文件（UTF-8 with BOM，记事本不乱码）
const README = `Dadealbit Markdown 编辑器 · 知乎助手包 ${VERSION}
================================================

这个包 = 编辑器（分享版，纯净无特效） + 「存到知乎草稿箱」要用的本机助手。
已经带了便携版 Node（runtime\\node.exe），所以**不用自己装 Node.js**。

【怎么用】
1. 解压到任意文件夹（**别放在只读目录**，助手要往自己的目录里写东西）
2. 双击「启动器」文件夹里的「开始使用.bat」——它会在后台悄悄启动助手（不弹黑窗口）、自动带上令牌、并打开编辑器
3. 编辑器里点工具栏「知乎」，看到「✅ 助手已连接」就能用了
4. 写完后点「存到草稿箱」：它只存草稿、**不会发布**，你到知乎里接着改、确认没问题再自己发

【不想每次都双击？】
双击一次「启动器」里的「安装助手自启 autostart-on.bat」，以后开机它就在后台静默跑着；
不想要了就双击「启动器」里的「取消助手自启 autostart-off.bat」。想临时关掉：双击「启动器」里的「停止助手.bat」。

【出问题怎么办】
· 「开始使用.bat」报错 → 改双击「启动器」里的「启动知乎助手.bat」，它会把窗口留着，里面能看到原因
· 「更多 → 使用反馈」可以直接给作者发邮件（会自动带上字数和用时，不带你的文档内容）
· 助手需要电脑里的 Microsoft Edge（Windows 自带），登录一次知乎即可，登录态记在本机
· 面板里有「检查一下能不能用（自检）」：它会真拿一篇临时草稿跑一遍正文/公式/图片/表格
· 存草稿失败时面板会提示"失败现场已存下来"，点「复制路径」把那个文件夹发给开发者即可

【不想用助手？】
也行：编辑器点「保存 → 知乎用 .md」，在「图床设置」里填一次 GitHub 令牌（图片换成公开网址），
再到知乎写文章页用「导入文档」。没有令牌也能导出，只是那几张图上面会多一行提示、需要手动补。

【说明】
· 助手是通过驱动 Edge 操作知乎网页来实现的（知乎没有开放这个能力的官方接口），
  所以知乎改版后可能需要更新，遇到问题欢迎反馈
· 助手只在本机 127.0.0.1 上跑，不联网上传你的内容
`
writeFileSync(resolve(STAGE, '使用说明.txt'), '\ufeff' + README, 'utf8')

/* ---------- 2. 统计 + 打包 ---------- */
function dirStats(dir) {
  let bytes = 0
  let files = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = dirStats(full)
      bytes += sub.bytes
      files += sub.files
    } else {
      bytes += statSync(full).size
      files += 1
    }
  }
  return { bytes, files }
}
const stats = dirStats(STAGE)
console.log(`装配完成：${stats.files} 个文件，${(stats.bytes / 1048576).toFixed(1)} MB`)

rmSync(ZIP, { force: true })
const zip = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${ZIP}' -Force`],
  { encoding: 'utf-8' },
)
if (!existsSync(ZIP)) {
  console.error('打包失败：', zip.stdout ?? '', zip.stderr ?? '')
  process.exit(1)
}
console.log(`压缩包：${ZIP}（${(statSync(ZIP).size / 1048576).toFixed(1)} MB）`)
