/**
 * 验证打包出来的文件夹是不是真的能用
 *  A. 「Dadealbit Markdown编辑器」：HTML 能打开、能打字（必须是干净版：没有特效按钮/画布）
 *  B. 「自用」：HTML 正常；打包进去的知乎助手能启动并响应
 *
 * 注意：「自用」文件夹有两种可能——
 *   在这个分支上打出来的是**干净版 + 助手**；
 *   而用户实际在用的那份是本地分支 `自用` 上打的**带鼠标特效**版本。
 * 所以自用版只查"能打开、能打字、助手在"，特效有没有都算通过；
 * 干净版则严格要求没有特效（不然就是误把特效版发出去了）。
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// 默认检查桌面上那两个文件夹（也可以用参数指定别的目录）
const STAGE = resolve(process.argv[2] ?? resolve(homedir(), 'Desktop'))
const PUB = resolve(STAGE, 'Dadealbit Markdown编辑器', 'Dadealbit Markdown 编辑器.html')
const MINE = resolve(STAGE, '自用', 'Dadealbit Markdown 编辑器.html')
const ASSIST = resolve(STAGE, '自用', 'assistant', 'zhihu-assistant.mjs')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

for (const [label, file] of [
  ['分享版', PUB],
  ['自用版', MINE],
]) {
  if (!existsSync(file)) {
    check(`${label} HTML 存在`, false, file)
    continue
  }
  const clean = label === '分享版'
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)))
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('.zh-btn')].map((b) =>
      (b.querySelector('.zh-btn__label')?.textContent || '').trim(),
    ),
    canvas: !!document.getElementById('sparkCanvas'),
    title: document.title,
  }))
  check(`${label} 能打开且标题正确`, info.title.includes('Dadealbit'), info.title)
  if (clean) {
    // 分享版必须是干净版：23 个按钮、没有特效画布
    // （注：「导出」并进「保存」了，所以比最早的 24 个少一个）
    check('分享版 按钮齐全（23 个）', info.buttons.length === 23, `${info.buttons.length} 个`)
    check('分享版 没有多余的画布覆盖层', info.canvas === false)
  } else {
    // 自用版：干净版（23 个）或带特效（24 个 + 画布）都算正常
    const okButtons = info.buttons.length === 23 || (info.buttons.length === 24 && info.canvas)
    check(
      '自用版 按钮数正常（干净版 23 / 带特效 24）',
      okButtons,
      `${info.buttons.length} 个${info.canvas ? '，带特效画布' : ''}`,
    )
    check(
      '自用版 界面自洽（有画布就有「特效」按钮）',
      info.canvas === info.buttons.includes('特效'),
      info.canvas ? '带特效版' : '干净版',
    )
  }
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('打包验证')
  await page.waitForTimeout(300)
  const typed = await page.evaluate(() => document.querySelector('.ProseMirror').textContent.includes('打包验证'))
  check(`${label} 能正常打字`, typed)
  check(`${label} 无页面错误`, errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()

/* ---------- 打包进去的助手能不能启动 ---------- */
{
  const PORT = 5193
  const TOKEN = 'pkg-' + Date.now().toString(36)
  check('打包里有助手脚本', existsSync(ASSIST), ASSIST)
  check(
    '打包里有 playwright-core',
    existsSync(resolve(STAGE, '自用', 'assistant', 'node_modules', 'playwright-core')),
  )
  // 一键启动三件套（.bat 的实测在 check:launcher 里，这里只确认打进去了）
  check('打包里有「开始使用.bat」', existsSync(resolve(STAGE, '自用', '开始使用.bat')))
  check('打包里有「停止助手.bat」', existsSync(resolve(STAGE, '自用', '停止助手.bat')))
  check('打包里有便携 node（runtime\\node.exe）', existsSync(resolve(STAGE, '自用', 'runtime', 'node.exe')))
  const child = spawn('node', [ASSIST, '--port', String(PORT), '--token', TOKEN], {
    cwd: resolve(STAGE, '自用', 'assistant'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => (out += String(d)))
  child.stderr.on('data', (d) => (out += String(d)))
  let up = false
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-dadealbit-token': TOKEN } })
      if (r.ok) {
        up = true
        break
      }
    } catch {
      /* 等它起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  check('打包后的助手能启动并响应', up, up ? `端口 ${PORT}` : out.split('\n').slice(-4).join(' ').slice(0, 160))
  child.kill()
  await new Promise((r) => setTimeout(r, 500))
}

for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
