/**
 * 打出两个交付文件夹：
 *   Dadealbit Markdown编辑器/   —— 只放编辑器本体，拷给别人用
 *   自用/                        —— 编辑器 + 知乎助手（含依赖，开箱即用）
 *
 * 用法：node scripts/make-packages.mjs [输出目录]
 *   默认输出到桌面；两个文件夹会被整体覆盖。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

import { bundleNodeRuntime, writeLauncherFiles } from './make-launcher.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(process.argv[2] ?? resolve(homedir(), 'Desktop'))
const PUB = resolve(OUT, 'Dadealbit Markdown编辑器')
const MINE = resolve(OUT, '自用')

const HTML = resolve(ROOT, 'Dadealbit Markdown 编辑器.html')
const ASSIST = resolve(ROOT, 'scripts', 'zhihu-assistant.mjs')
const PW_CORE = resolve(ROOT, 'node_modules', 'playwright-core')

for (const [what, p] of [
  ['单文件 HTML（先跑 pnpm build）', HTML],
  ['助手脚本', ASSIST],
  ['playwright-core（先跑 pnpm install）', PW_CORE],
]) {
  if (!existsSync(p)) {
    console.error(`缺少 ${what}：${p}`)
    process.exit(1)
  }
}

/* ---------- 文件内容 ---------- */
const ASSIST_BAT = `@echo off
title Dadealbit Zhihu Draft Assistant
cd /d "%~dp0assistant"

rem --- prefer the node.exe shipped next to this folder (a machine without Node still works) ---
set "NODE="
if exist "%~dp0..\\runtime\\node.exe" set "NODE=%~dp0..\\runtime\\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if errorlevel 1 goto :nonode
  set "NODE=node"
)
if not exist "zhihu-assistant.mjs" goto :nofile
if not exist "node_modules\\playwright-core" goto :nodeps

echo.
echo   Starting the Zhihu draft assistant...
echo   Keep this window open while uploading.
echo   The token is printed below and copied to your clipboard.
echo.
"%NODE%" zhihu-assistant.mjs
echo.
echo   Assistant stopped. Press any key to close.
pause >nul
exit /b 0

:nonode
echo   [x] Node.js not found.
echo       Install it from https://nodejs.org (LTS version), then run this again.
echo.
pause
exit /b 1

:nodeps
echo   [x] Missing dependency: assistant\\node_modules\\playwright-core
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1

:nofile
echo   [x] Missing file: assistant\\zhihu-assistant.mjs
echo       This folder looks incomplete. Re-copy the whole folder.
echo.
pause
exit /b 1
`

const ASSIST_PKG = `{
  "name": "dadealbit-zhihu-assistant",
  "private": true,
  "type": "module",
  "description": "Dadealbit Markdown 编辑器 · 存到知乎草稿箱用的本机助手",
  "scripts": {
    "start": "node zhihu-assistant.mjs"
  },
  "dependencies": {
    "playwright-core": "^1.49.0"
  }
}
`

const README_PUB = `Dadealbit Markdown 编辑器 · 使用说明
========================================

【怎么打开】
双击本文件夹里的「Dadealbit Markdown 编辑器.html」。
它是一个自包含的文件，不需要安装任何东西、不需要联网、也不会弹出任何黑窗口。
可以把它拷给别人，对方双击就能用。

【怎么用】
· 直接打字就行，所见即所得（不用懂 Markdown 语法）。
· 插公式：点工具栏「公式」→ 左边分类里点符号，或在输入框里敲（有自动补全）→ 确定。
· 改字号 / 字体 / 文字颜色：工具栏「字体」。
· 浅色 / 深色：工具栏「主题」。
· 多篇笔记：工具栏最左边「文档」。
· 存成文件：点「保存」（工具栏上，或右下角那个）→ 选格式，一共四种：
    知乎用 .md（发知乎，图片自动上传换成网址）· 网页（.html，图片在里面）
    · PDF（打印对话框里选「另存为 PDF」）· 存一份自己看的 .md（纯文本存档，给自己看 / 备份）
  ⚠️ 最后那种（自己看的 .md）图片是内嵌的，**不要拿去知乎导入**（知乎只会抓图片网址，内嵌的会丢）；
     要发知乎就选第一项「导出知乎用 .md」。

【导入别人发来的 .md】
如果里面的图片打不开、或者公式显示不出来，编辑器会自己浮出一条提示，
跟着点一下就能修好（图片需要选中那个装着 assets 文件夹的目录）。
也可以随时用「更多 → 检查图片与公式」重新体检。

【传到知乎】
点工具栏最右边「知乎」→ 点「导出知乎 .md」→ 打开知乎写文章页，
用编辑器右上角的「导入」选这个文件即可（标题用面板里的「复制标题」）。
注意：普通 .md 直接导入知乎是不认公式的，这个导出会把公式换成知乎认的写法。

图片要留意：网上来的图片（https 链接，比如原来就在知乎上的图）能跟着导入过去；
你自己插的本机图片（截图、照片）知乎的「导入」抓不到——这是知乎的限制。

让本机图片也能跟过去（一次性设置，不用装任何东西）：
点面板里的「图床设置」→ 填「图床仓库 + GitHub 令牌」→ 保存。
以后导出时图片会自动上传到你的图床、换成公开网址写进文件，知乎导入时就能把图一起带过去。
  · 图床仓库默认 Dadeal167/Dadeal.bit-ImageBed（想换成自己的仓库就改这一栏）
  · GitHub 令牌：github.com → Settings → Developer settings → Personal access tokens →
    Fine-grained tokens → 只勾选图床这一个仓库，权限选 Contents: Read and write
  · 令牌只存在这台电脑的浏览器里，只发给 api.github.com，不会写进导出的文件
  · 图片会公开在那个仓库里；不想公开就别填 —— 那样图片会留在文件里，
    每张图上面有一行提示，导入知乎后手动把图拖进去

【不用手动保存】
内容自动存在这台电脑的浏览器里，关掉浏览器下次打开还在
（包括所有文档、字号设置、主题选择、快捷键设置）。

【说明】
这是一个单文件程序，拷给别人也能直接用。
`

const README_MINE = `Dadealbit Markdown 编辑器（自用版）· 使用说明
========================================

【怎么打开】
双击本文件夹里的「开始使用.bat」。
它会一口气做完三件事：后台悄悄启动「知乎助手」（不弹黑窗口）→ 等它就绪 →
自动打开编辑器，并且把令牌一起带过去（面板里不用再粘令牌）。

不需要装 Node.js —— 文件夹里的 runtime\\node.exe 就是。
（如果你的电脑上已经装了别的版本也没关系，它优先用文件夹里这份。）

【用完关掉】
双击「停止助手.bat」：关掉后台助手，顺带关掉助手专用的那个浏览器窗口。
编辑器和平时一样，直接叉掉就行（内容自动保存在浏览器里）。

【万一「开始使用.bat」报错】
双击「启动知乎助手.bat」——这个会留一个黑窗口，窗口里会打印令牌。
然后手动打开编辑器 → 工具栏最右「知乎」→ 粘贴令牌 → 「重新检测助手」。
出错提示一般就写在黑窗口里，照着做就行。

【和分享版的区别】
这一版多了「存到知乎草稿箱」用的本机助手（assistant 文件夹），
编辑器本体和分享版完全一样。

【存到知乎草稿箱】（可选）
1. 先双击「开始使用.bat」（助手就在后台跑着了，令牌也自动填好了）。
2. 编辑器里点工具栏最右边的「知乎」→ 看到「助手已连接」就行。
3. 点「存到草稿箱」，等它跑完。完成后去知乎的草稿箱就能看到这篇。
   速度参考：纯文字约 30–40 秒；公式多也不慢（整篇一次写入）；
   只有图片慢一些，一张几秒到十几秒（第一张最慢）。

说明：
· 只存草稿，不会发布，发布由你自己在知乎点。
· 同一个文档重复上传会更新同一篇草稿，不会在草稿箱里堆一堆。
· 第一次用需要登录知乎：点面板里的「登录知乎 / 检查登录」，在弹出的窗口扫码一次。
· 有图片时会上传得慢一些，并且会临时占用剪贴板（贴图要用它）。
· 登录信息存在 C:\\Users\\<你的用户名>\\.dadealbit\\ 里，只在这台电脑上，不会外传。
· 助手只监听本机 127.0.0.1，外面连不进来。

【不用手动保存】
内容自动存在这台电脑的浏览器里，关掉浏览器下次打开还在。
`

/* ---------- 开始打包 ----------
   注意：这个分支只有干净版（没有鼠标特效），所以**默认只打「分享版」那个文件夹**。
   带特效的「自用」文件夹是在本地分支 `自用` 上用它的 make-packages.mjs 打的——
   在这里顺手重打会把那份带特效的覆盖成干净版（曾经就是这么差点搞丢的）。
   真想要一个"干净版 + 知乎助手"的本地副本，再加 --also-mine。 */
const ALSO_MINE = process.argv.includes('--also-mine')
console.log(`输出目录：${OUT}${ALSO_MINE ? '（分享版 + 本地副本）' : '（只打分享版）'}`)

/**
 * 清空并重建一个交付文件夹。
 * Windows 上如果「知乎助手」正开着，那个文件夹就是它的工作目录，删不掉（EPERM）——
 * 这时改成"就地覆盖"，照样能把新文件写进去，不用逼用户先关窗口。
 */
function resetDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.log(`  （${basename(dir)} 正被占用，改成覆盖更新：${e.code || e.message}）`)
  }
  mkdirSync(dir, { recursive: true })
}

for (const dir of ALSO_MINE ? [PUB, MINE] : [PUB]) {
  resetDir(dir)
}

// 分享版：只有 HTML + 说明（说明用 UTF-8 with BOM，记事本打开中文不乱码）
cpSync(HTML, resolve(PUB, 'Dadealbit Markdown 编辑器.html'))
writeFileSync(resolve(PUB, '使用说明.txt'), '\ufeff' + README_PUB, 'utf8')

if (ALSO_MINE) {
  // 本地副本：HTML + 说明 + 助手（含依赖，开箱即用）+ 一键启动器 + 便携 Node
  cpSync(HTML, resolve(MINE, 'Dadealbit Markdown 编辑器.html'))
  writeFileSync(resolve(MINE, '使用说明.txt'), '\ufeff' + README_MINE, 'utf8')
  writeFileSync(resolve(MINE, '启动知乎助手.bat'), ASSIST_BAT.replace(/\n/g, '\r\n'), 'ascii')

  const asstDir = resolve(MINE, 'assistant')
  mkdirSync(resolve(asstDir, 'node_modules'), { recursive: true })
  cpSync(ASSIST, resolve(asstDir, 'zhihu-assistant.mjs'))
  // dereference: pnpm 的 node_modules 里 playwright-core 是符号链接，
  // 直接拷会尝试建链接（EPERM，且拷出来是个空壳），必须解引用拷真实文件
  cpSync(PW_CORE, resolve(asstDir, 'node_modules', 'playwright-core'), { recursive: true, dereference: true })
  writeFileSync(resolve(asstDir, 'package.json'), ASSIST_PKG, 'utf8')

  // 双击一个 bat 就能用：后台起助手 + 自动带令牌 + 打开编辑器；不用装 Node
  writeLauncherFiles(MINE)
  bundleNodeRuntime(MINE)
}

/* ---------- 汇总 ---------- */
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

for (const [name, dir] of [
  ['Dadealbit Markdown编辑器', PUB],
  ...(ALSO_MINE ? [['自用（干净版 + 助手）', MINE]] : []),
]) {
  const { bytes, files } = dirStats(dir)
  console.log(`  ${name}：${files} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB`)
}
console.log(
  ALSO_MINE ? '打包完成。' : '打包完成（带鼠标特效的「自用」文件夹请在本地分支 `自用` 上用它的脚本打）。',
)
