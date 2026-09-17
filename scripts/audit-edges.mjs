/**
 * 边角体检（测试覆盖不到的地方）：
 *  - 空文档 / 超长文档 / 极端文本的 Markdown 往返
 *  - localStorage 写满时的表现（不能崩、要有提示）
 *  - 快速切换主题 / 文档、快速操作不报错
 *  - 窄屏（1024）工具栏与弹窗
 *  - 关键界面在浅色 / 深色下的视觉检查（截图）
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
let page

const freshPage = async (width = 1360) => {
  if (page) await page.close()
  page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/bili-user-fingerprint|report is not found/i.test(t)) return
    errors.push(t)
  })
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1300)
}

const md = () => page.evaluate(() => window.__MD__())
const setMd = async (text) => {
  await page.evaluate((t) => window.__EDITOR__.commands.setContent(t), text)
  await page.waitForTimeout(400)
}

await freshPage()
await page.evaluate(() => {
  localStorage.removeItem('md-editor-docs-v1')
  localStorage.removeItem('md-editor-draft-v1')
})
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror')
await page.waitForTimeout(1200)

/* ---------- 1. 空文档：保存 / 导出 / 打印都不该崩 ---------- */
await page.evaluate(() => window.__EDITOR__.commands.clearContent())
await page.waitForTimeout(400)
const [emptyMd] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  // 「保存」和「导出」合并了：点保存 → 在菜单里选格式（按钮文字没变）
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
record('空文档能保存 .md', emptyMd.suggestedFilename().endsWith('.md'), emptyMd.suggestedFilename())
const [emptyHtml] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="html"]').click()),
])
record('空文档能导出 HTML', emptyHtml.suggestedFilename().endsWith('.html'), emptyHtml.suggestedFilename())

/* ---------- 2. 难缠文本的 Markdown 往返 ---------- */
const tricky = [
  '# 标题里有 $ 和 \\ 反斜杠',
  '',
  '美元符号 $x$ 行内公式 vs 只写一个 $ 符号',
  '',
  '反斜杠：\\alpha \\frac{1}{2} 和路径 C:\\Users\\test',
  '',
  '下划线 a_b_c 和星号 2*3*4 和井号 # 号',
  '',
  'HTML 片段 <span style="color:red">红</span> 与 <b>粗</b>',
  '',
  '竖线 | 在表格外',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| a\\|b | c$d$ |',
  '',
  '> 引用里的 $\\frac{1}{2}$',
  '',
  '- 列表项 1',
  '- 列表项 2 带 `代码`',
].join('\n')
await setMd(tricky)
const domBefore = await page.evaluate(() => document.querySelector('.ProseMirror').textContent)
const [trickyDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
const savedPath = await trickyDl.path()
const savedText = savedPath ? readFileSync(savedPath, 'utf-8') : ''
const roundTrip = resolve(tmpdir(), 'edge-roundtrip.md')
writeFileSync(roundTrip, savedText, 'utf-8')
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 6000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(roundTrip)
await page.waitForTimeout(1500)
const domAfter = await page.evaluate(() => document.querySelector('.ProseMirror').textContent)
// 判据用"读回来以后的正文文字"，不是 md 原文——md 里反斜杠是被转义的（C:\\Users\\test），是正常的
record(
  '难缠文本往返 .md 后文字完全一致',
  domAfter === domBefore,
  domAfter === domBefore ? `${domBefore.length} 字全一致` : `差异：${domBefore.length} → ${domAfter.length} 字`,
)
record(
  '行内公式变成公式节点、反斜杠路径保留为文字',
  (await page.locator('.math-node').count()) === 3 && domAfter.includes('C:\\Users\\test'),
  `${await page.locator('.math-node').count()} 个公式节点（$x$、c$d$、$\\frac{1}{2}$ 三个）`,
)
record('行内 HTML 颜色保留', savedText.includes('color'), savedText.includes('color') ? '存盘里有 color 声明' : '丢了')

/* ---------- 3. localStorage 真的写满时：要提示、不崩、状态栏常驻提醒 ---------- */
await page.evaluate(() => {
  window.__alerts = []
  window.alert = (m) => window.__alerts.push(String(m))
})
// 先用大块填，再用小块把尾巴也填满，直到连 4KB 都写不进去
const fill = await page.evaluate(() => {
  let n = 0
  const big = 'x'.repeat(256 * 1024)
  try {
    for (let i = 0; i < 60; i += 1) {
      localStorage.setItem(`__junk_${i}`, big)
      n = i + 1
    }
  } catch {
    /* 大块写不进去了 */
  }
  try {
    for (let i = 0; i < 400; i += 1) {
      localStorage.setItem(`__tail_${i}`, 'y'.repeat(4096))
      n += 1
    }
  } catch {
    /* 尾巴也满了 */
  }
  return n
})
const reallyFull = await page.evaluate(() => {
  try {
    localStorage.setItem('__t', 'x'.repeat(4096))
    localStorage.removeItem('__t')
    return false
  } catch {
    return true
  }
})
record('测试前提：存储确实写满了', reallyFull, `塞了 ${fill} 块`)

// 制造一次"大内容保存"（相当于贴了张图）
await page.evaluate(() => {
  window.__EDITOR__.commands.setContent(`# 配额测试\n\n${'占位文字'.repeat(6000)}`)
})
await page.waitForTimeout(2600)
const quotaAlerts = await page.evaluate(() => window.__alerts)
const alive = (await page.locator('.ProseMirror').count()) === 1
const statusWarn = await page.locator('.zh-statusbar__draft--warn').count()
record(
  '存储写满时：给提示、不崩、状态栏常驻提醒',
  alive && quotaAlerts.length === 1 && statusWarn === 1,
  `提示 ${quotaAlerts.length} 次；状态栏提醒 ${statusWarn} 处`,
)
// 再改一次，不该重复弹窗（否则每打几个字弹一次，没法用）
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('再试')
await page.waitForTimeout(2200)
const secondAlerts = await page.evaluate(() => window.__alerts.length)
record('存储写满后不再反复弹窗', secondAlerts === 1, `累计弹窗 ${secondAlerts} 次`)

await page.evaluate(() =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith('__junk_') || k.startsWith('__tail_'))
    .forEach((k) => localStorage.removeItem(k)),
)
await page.waitForTimeout(1600)
// 腾出空间后应该恢复正常保存
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('恢复')
await page.waitForTimeout(2200)
record(
  '腾出空间后自动恢复正常保存',
  (await page.locator('.zh-statusbar__draft--warn').count()) === 0,
  '状态栏警告已消失',
)

/* ---------- 4. 超长文档：输入与保存的响应 ---------- */
await freshPage()
const longText = Array.from({ length: 300 }, (_, i) => `第 ${i + 1} 段：这是一段用来测试长文档性能的文字，包含一个公式 $x_{${i}}$。`).join('\n\n')
const t0 = Date.now()
await page.evaluate((t) => window.__EDITOR__.commands.setContent(t), longText)
await page.waitForTimeout(500)
const setCost = Date.now() - t0
const t1 = Date.now()
await page.evaluate(() => window.__MD__())
const readCost = Date.now() - t1
const t2 = Date.now()
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.type('末尾追加')
await page.waitForTimeout(300)
const typeCost = Date.now() - t2
record(
  '320 段长文档不卡（载入 < 2.5s、取值 < 300ms、打字 < 600ms）',
  setCost < 2500 && readCost < 300 && typeCost < 600,
  `载入 ${setCost}ms / 取值 ${readCost}ms / 打字 ${typeCost}ms`,
)

/* ---------- 5. 快速操作不报错 ---------- */
const beforeErrCount = errors.length
for (let i = 0; i < 4; i += 1) {
  await page.locator('.zh-btn[title^="主题"]').click()
  await page.waitForTimeout(120)
  await page.locator('.zh-menu__item', { hasText: i % 2 ? '深色' : '浅色' }).click()
  await page.waitForTimeout(150)
}
await page.locator('.zh-btn[title^="我的文档"]').click()
await page.waitForTimeout(150)
await page.locator('.zh-docmenu__new').click()
await page.waitForTimeout(400)
await page.locator('.zh-btn[title^="我的文档"]').click()
await page.waitForTimeout(150)
await page.locator('.zh-docmenu__open').last().click()
await page.waitForTimeout(500)
record('快速切主题 / 建文档 / 切文档不报错', errors.length === beforeErrCount, `新增错误 ${errors.length - beforeErrCount} 条`)

/* ---------- 6. 窄屏（1024） ---------- */
await freshPage(1024)
const narrow = await page.evaluate(() => {
  const bar = document.querySelector('.zh-toolbar').getBoundingClientRect()
  const groups = [...document.querySelectorAll('.zh-toolbar__group')]
  const last = groups[groups.length - 1].getBoundingClientRect()
  return {
    barHeight: Math.round(bar.height),
    lastRight: Math.round(last.right),
    viewport: window.innerWidth,
    cardWidth: Math.round(document.querySelector('.editor-card').getBoundingClientRect().width),
  }
})
record(
  '窄屏工具栏自动换行且不出屏',
  narrow.lastRight <= narrow.viewport + 1 && narrow.cardWidth <= narrow.viewport,
  `工具栏高 ${narrow.barHeight}px，最右 ${narrow.lastRight} / 视口 ${narrow.viewport}`,
)
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(250)
const menuBox = await page.locator('.zh-menu').first().boundingBox()
record('窄屏下拉菜单仍可见', !!menuBox && menuBox.height > 40 && menuBox.x + menuBox.width <= narrow.viewport + 1, JSON.stringify(menuBox ? { x: Math.round(menuBox.x), w: Math.round(menuBox.width) } : null))
await page.keyboard.press('Escape')
await page.screenshot({ path: resolve(OUT, 'edge-narrow.png') })

/* ---------- 7. 视觉检查：千分号 / 深色面板 ---------- */
await freshPage(1360)
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
await page.locator('.zh-mathcat', { hasText: '常用符号' }).click()
await page.waitForTimeout(500)
const permil = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.zh-mathpanel .zh-symbol')].find((b) =>
    (b.getAttribute('title') || '').includes('千分号'),
  )
  if (!btn) return { found: false }
  const r = btn.getBoundingClientRect()
  return { found: true, text: (btn.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), error: !!btn.querySelector('.katex-error') }
})
record('千分号按钮渲染出的是 ‰（不是 permil 字母）', permil.found && permil.text.includes('‰') && !permil.error, JSON.stringify(permil))
await page.screenshot({ path: resolve(OUT, 'edge-permil.png') })

// 深色下的公式弹窗 + 字体面板 + 文档下拉
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.locator('.zh-btn[title^="主题"]').click()
await page.waitForTimeout(200)
await page.locator('.zh-menu__item', { hasText: '深色' }).click()
await page.waitForTimeout(400)
await page.locator('.zh-btn[title="正文字号 / 字体 / 文字颜色"]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(OUT, 'edge-dark-typomenu.png') })
await page.keyboard.press('Escape')
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 4000 })
await page.locator('.zh-mathcat', { hasText: '希腊字母' }).click()
await page.waitForTimeout(500)
await page.locator('.zh-mathsource').fill('\\alp')
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(OUT, 'edge-dark-mathmodal.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

const darkErr = errors.length
record('全程控制台无（非第三方）错误', darkErr === 0, darkErr ? errors.slice(0, 3).join(' | ').slice(0, 240) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待查：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
