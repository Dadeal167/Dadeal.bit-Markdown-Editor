/**
 * 深挖体检：把"真人在用"时会踩到的边角case全过一遍，找出真实缺陷。
 * 前提：pnpm dev 已运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173/'

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e.message)))

const md = () => page.evaluate(() => window.__MD__?.() ?? '')
const ready = async () => {
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
}

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await ready()
// 清掉多文档存储，回到"第一次打开"的状态
await page.evaluate(() => {
  localStorage.removeItem('md-editor-docs-v1')
  localStorage.removeItem('md-editor-draft-v1')
})
await page.reload({ waitUntil: 'load' })
await ready()

/* ---------- 1. 草稿：写 → 刷新 → 内容还在 ---------- */
await page.locator('.zh-title').fill('草稿恢复测试')
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.press('Enter')
await page.keyboard.type('这段字刷新后应该还在。')
await page.waitForTimeout(1800)
await page.reload({ waitUntil: 'load' })
await ready()
const restoredTitle = await page.locator('.zh-title').inputValue()
const restoredMd = await md()
record('草稿恢复：标题', restoredTitle === '草稿恢复测试', `标题="${restoredTitle}"`)
record('草稿恢复：正文', restoredMd.includes('这段字刷新后应该还在'), '含正文 ✓')

/* ---------- 2. 文件名安全：标题里有 Windows 非法字符 ---------- */
await page.locator('.zh-title').fill('第1章/函数:图像*与"性质"?')
await page.waitForTimeout(400)
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  // 右下角那个按钮文字没变（「保存 .md」），点开是选格式菜单 → 选 Markdown
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
const fname = dl.suggestedFilename()
record(
  '文件名不含 Windows 非法字符',
  !/[\\/:*?"<>|]/.test(fname),
  `下载名 = ${fname}`,
)

/* ---------- 3. 表格：单元格文字能否存进 .md ---------- */
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.locator('.zh-btn[title="表格"]').click()
await page.waitForSelector('.zh-modal--table', { timeout: 5000 })
await page.locator('.zh-modal--table input[aria-label="输入表格行数"]').fill('2')
await page.locator('.zh-modal--table input[aria-label="输入表格列数"]').fill('2')
await page.getByRole('button', { name: '插入', exact: true }).click()
await page.waitForTimeout(600)
await page.locator('.ProseMirror table td').first().click()
await page.keyboard.type('单元格A1')
await page.waitForTimeout(400)
const mdWithTable = await md()
record('表格单元格文字进 Markdown', mdWithTable.includes('单元格A1'), '在 .md 里找到单元格内容')

/* ---------- 4. 表格操作可撤销 ---------- */
const rowCount = () =>
  page.evaluate(() => document.querySelectorAll('.ProseMirror table tr').length)
const beforeUndo = await rowCount()
await page.locator('.zh-tablemenu__btn', { hasText: '↓ 插行' }).click()
await page.waitForTimeout(300)
const afterInsert = await rowCount()
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
const afterUndo = await rowCount()
record(
  '表格插行可撤销',
  afterInsert === beforeUndo + 1 && afterUndo === beforeUndo,
  `${beforeUndo} → ${afterInsert} → 撤销后 ${afterUndo}`,
)

/* ---------- 5. 表格里插公式（Markdown 表格不支持，不能崩） ---------- */
await page.locator('.ProseMirror table td').first().click()
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.locator('.zh-mathsource').fill('x^2')
await page.waitForTimeout(300)
await page.getByRole('button', { name: '确认', exact: true }).click()
await page.waitForTimeout(600)
const stillAlive = (await page.locator('.ProseMirror').count()) === 1
record('表格单元格里插公式不崩', stillAlive, `编辑器 ${stillAlive ? '正常' : '挂了'}`)

/* ---------- 6. 大纲点击跳转 ---------- */
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.keyboard.press('Enter')
await page.locator('.zh-btn[title="标题"]').click()
await page.getByRole('button', { name: '二级标题' }).click()
await page.keyboard.type('跳转目标标题')
await page.waitForTimeout(400)
await page.locator('.zh-btn[title="大纲"]').click()
await page.waitForSelector('.zh-outline', { timeout: 5000 })
const jumpItem = page.locator('.zh-outline__item', { hasText: '跳转目标标题' })
const hasItem = (await jumpItem.count()) > 0
await jumpItem.first().click()
await page.waitForTimeout(500)
const scrolledToIt = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.ProseMirror h2')]
  const target = heads.find((h) => h.textContent.includes('跳转目标标题'))
  if (!target) return false
  const r = target.getBoundingClientRect()
  return r.top > 0 && r.top < window.innerHeight
})
record('大纲点击跳到对应标题', hasItem && scrolledToIt, `列表有该项=${hasItem}，视口内可见=${scrolledToIt}`)
await page.locator('.zh-outline__close').click()

/* ---------- 7. 长度：正文留白（往下滑还有白纸可写） ---------- */
await page.evaluate(() => {
  window.__EDITOR__.commands.clearContent()
  window.scrollTo(0, 0)
})
await page.waitForTimeout(500)
const layout = await page.evaluate(() => {
  const card = document.querySelector('.editor-card').getBoundingClientRect()
  const bar = document.querySelector('.zh-statusbar').getBoundingClientRect()
  return { cardHeight: Math.round(card.height), barTop: Math.round(bar.top), viewport: window.innerHeight }
})
record(
  '空文档时正文已长于一屏（能往下滑）',
  layout.cardHeight > layout.viewport,
  `卡高 ${layout.cardHeight}px vs 视口 ${layout.viewport}px`,
)

// 滚到底部：白卡仍应铺满到状态栏
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(400)
const bottomState = await page.evaluate(() => {
  const card = document.querySelector('.editor-card').getBoundingClientRect()
  const bar = document.querySelector('.zh-statusbar').getBoundingClientRect()
  return { cardBottom: Math.round(card.bottom), cardTop: Math.round(card.top), barTop: Math.round(bar.top) }
})
record(
  '滚到底部白卡仍铺满视口',
  bottomState.cardBottom >= bottomState.barTop - 2 && bottomState.cardTop <= 1,
  `卡顶 ${bottomState.cardTop}，卡底 ${bottomState.cardBottom}，状态栏顶 ${bottomState.barTop}`,
)

// 点击文末空白处 → 光标落到文末，能接着写
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(300)
await page.mouse.click(430, 500)
await page.waitForTimeout(300)
await page.keyboard.type('在空白处点一下就能接着写')
await page.waitForTimeout(400)
record('点文末空白处能接着写', (await md()).includes('在空白处点一下就能接着写'))

/* ---------- 8. 长文档：滚动时表格操作条跟随 ---------- */
await page.evaluate(() => {
  const ed = window.__EDITOR__
  ed.commands.focus('end')
})
await page.locator('.zh-btn[title="表格"]').click()
await page.waitForSelector('.zh-modal--table', { timeout: 5000 })
await page.getByRole('button', { name: '插入', exact: true }).click()
await page.waitForTimeout(500)
await page.locator('.ProseMirror table td').last().click()
await page.waitForTimeout(300)
const posBefore = await page.locator('.zh-tablemenu').boundingBox()
await page.evaluate(() => window.scrollBy(0, 120))
await page.waitForTimeout(400)
const posAfter = await page.locator('.zh-tablemenu').boundingBox()
record(
  '滚动时表格操作条跟随表格',
  !!posBefore && !!posAfter && Math.abs(posAfter.y - (posBefore.y - 120)) <= 4,
  `y ${Math.round(posBefore?.y ?? 0)} → ${Math.round(posAfter?.y ?? 0)}（滚了 120）`,
)

/* ---------- 9. 粘贴 Markdown：跟随「Markdown 输入」开关 ---------- */
const pasteMd = async (text) => {
  await page.evaluate((t) => {
    window.__EDITOR__.commands.focus('end')
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.ProseMirror').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, text)
  await page.waitForTimeout(600)
}

const mdInputState = () => page.locator('.zh-switch__state').innerText()

// 开关开着：粘贴的 Markdown 应该被转成排版好的正文
// 判据不能用"md 里有没有 ##"——标题序列化回 Markdown 本来就是 `## 标题`，要看 DOM
await pasteMd('## 粘贴测试标题\n\n这是**加粗**文字')
const pasteConverted = await page.evaluate(() => {
  const h2 = [...document.querySelectorAll('.ProseMirror h2')].find((h) =>
    h.textContent.includes('粘贴测试标题'),
  )
  if (!h2) return { h2: false, paraText: null, bold: false }
  const para = h2.nextElementSibling
  return {
    h2: true,
    paraText: para?.textContent ?? null,
    bold: (para?.querySelectorAll('strong') ?? []).length > 0,
  }
})
record(
  'Markdown 输入开着时：粘贴的 Markdown 会转换',
  pasteConverted.h2 && pasteConverted.paraText === '这是加粗文字' && pasteConverted.bold,
  `h2=${pasteConverted.h2}，段落文字="${pasteConverted.paraText}"，有加粗=${pasteConverted.bold}`,
)

// 关掉开关：同样内容应原样进来
await page.locator('.zh-switch').click()
await page.waitForTimeout(800)
record('开关已切到关闭', (await mdInputState()) === '关', await mdInputState())
await pasteMd('## 不该转换的标题')
const h2AfterOff = await page.locator('.ProseMirror h2', { hasText: '不该转换的标题' }).count()
const literalAfterOff = (await md()).includes('## 不该转换的标题')
record(
  'Markdown 输入关闭时：粘贴内容原样保留',
  h2AfterOff === 0 && literalAfterOff,
  `h2 数=${h2AfterOff}，原样保留=${literalAfterOff}`,
)
await page.locator('.zh-switch').click()
await page.waitForTimeout(800)

/* ---------- 10. 打印 / PDF 输出 ---------- */
await page.emulateMedia({ media: 'print' })
await page.waitForTimeout(300)
await page.screenshot({ path: resolve(OUT, 'audit-print-view.png') })
const printLayout = await page.evaluate(() => {
  const card = document.querySelector('.editor-card')
  const title = document.querySelector('.zh-title')
  const prose = document.querySelector('.zh-prose')
  return {
    cardMinHeight: card ? getComputedStyle(card).minHeight : null,
    prosePaddingBottom: prose ? getComputedStyle(prose).paddingBottom : null,
    titleBorder: title ? getComputedStyle(title).borderTopWidth : null,
    titleValue: title ? title.value : '',
    toolbarDisplay: document.querySelector('.zh-toolbar')
      ? getComputedStyle(document.querySelector('.zh-toolbar')).display
      : null,
  }
})
record(
  '打印视图：去掉留白与固定高度',
  printLayout.cardMinHeight === '0px' && printLayout.prosePaddingBottom === '0px',
  `card.min-height=${printLayout.cardMinHeight}，prose.padding-bottom=${printLayout.prosePaddingBottom}`,
)
record('打印时工具栏隐藏', printLayout.toolbarDisplay === 'none', `display=${printLayout.toolbarDisplay}`)

const pdfBuf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm' } })
await page.emulateMedia({ media: 'screen' })
const pageCount = (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
record(
  'PDF 页数与内容相称（短文档不出空白页）',
  pageCount >= 1 && pageCount <= 2,
  `${pageCount} 页，${Math.round(pdfBuf.length / 1024)} KB`,
)

await page.screenshot({ path: resolve(OUT, 'audit-features.png'), fullPage: false })
record('全程控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 240) : '无')

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name} — ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
