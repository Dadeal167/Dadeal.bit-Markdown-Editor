/**
 * 验证打包出来的两个文件夹是不是真的能用
 *  A. 「Dadealbit Markdown编辑器」：纯净版 HTML 能打开、没有特效按钮、能打字
 *  B. 「自用」：完整版 HTML 有特效；打包进去的助手能启动并响应
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

/* ---------- A. 分享版 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)))
  await page.goto('file:///' + PUB.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('.zh-btn')].map((b) => (b.querySelector('.zh-btn__label')?.textContent || '').trim()),
    canvas: !!document.getElementById('sparkCanvas'),
    title: document.title,
  }))
  check('分享版能打开且标题正确', info.title.includes('Dadealbit'), info.title)
  // 分享版必须是干净版：23 个按钮、没有特效画布
  // （注：「导出」并进「保存」了，所以比最早的 24 个少一个）
  check('分享版 按钮齐全（23 个）', info.buttons.length === 23, `${info.buttons.length} 个`)
  check('分享版 没有「特效」按钮', !info.buttons.includes('特效'), `${info.buttons.length} 个按钮`)
  check('分享版 没有多余的画布覆盖层', info.canvas === false)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('打包验证')
  await page.waitForTimeout(300)
  const typed = await page.evaluate(() => document.querySelector('.ProseMirror').textContent.includes('打包验证'))
  check('分享版能正常打字', typed)
  check('分享版无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- B. 自用版 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)))
  await page.goto('file:///' + MINE.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('.zh-btn')].map((b) => (b.querySelector('.zh-btn__label')?.textContent || '').trim()),
    canvas: !!document.getElementById('sparkCanvas'),
  }))
  check('自用版有「特效」按钮', info.buttons.includes('特效'), `${info.buttons.length} 个按钮`)
  check('自用版 按钮数正常（干净版 23 + 特效 = 24）', info.buttons.length === 24, `${info.buttons.length} 个`)
  check('自用版有特效画布', info.canvas === true)

  // 特效面板能打开、参数在
  await page.locator('.zh-btn[title^="特效"]').click()
  await page.waitForSelector('.zh-fx', { timeout: 4000 })
  const panel = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.zh-fx__label')].map((el) => el.textContent.trim()),
    reset: !!document.querySelector('.zh-fx__reset'),
  }))
  check(
    '自用版特效面板参数齐全（含恢复默认设置）',
    panel.reset && ['缩放比例', '全局不透明度', '拖尾刷新率'].every((t) => panel.rows.includes(t)),
    panel.rows.join(' / '),
  )
  await page.keyboard.press('Escape')

  // 真的点一下看有没有画东西。
  // ⚠️ 别只等一个固定毫秒数就采样：波纹是"先扩开、再淡出"，采样早了（还没画）或晚了（已淡完）
  // 都会数到 0 个像素 —— 这一条以前就是这么偶发假失败的。改成在一段时间里反复采样取最大值。
  const paintAt = () =>
    page.evaluate(() => {
      const c = document.getElementById('sparkCanvas')
      if (!c) return -1
      const d = c.getContext('2d').getImageData(550, 350, 300, 300).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1
      return n
    })
  await page.mouse.click(700, 500)
  let painted = 0
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(60)
    painted = Math.max(painted, await paintAt())
    if (painted > 200) break
  }
  check('自用版点击真的有波纹（采样像素）', painted > 200, `${painted} 个像素`)
  check('自用版无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()

/* ---------- C. 打包进去的助手能不能启动 ---------- */
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
