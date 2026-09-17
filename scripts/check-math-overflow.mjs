/**
 * 长公式不许超出正文范围
 *
 * 用户报的："遇见长的公式，会超出范围"。实测（`.probe/probe-math-overflow.mjs`）：
 * 正文列 654px 时，一个把 \sum/\frac 连写六遍的行间公式自然宽度 ≈835px，
 * KaTeX 的内容被**裁在公式盒子里**（盒内可滚 196px）——右边一截根本看不见。
 *
 * 做法（只动**显示**，不动 LaTeX、不动 Markdown）：
 *   · 量出公式的自然宽度，比正文列宽就等比缩小（`zoom`），最多缩到 0.5
 *   · 缩到下限还放不下 → 打上 `data-wide`，在公式框内部横向滚动（绝不撑破正文列）
 *   · 本来放得下就什么都不做（短公式与老文档一模一样，不留任何 style）
 *   · 导出 HTML / PDF 里量不了宽度，用 CSS 兜底：`math[display=block]{overflow-x:auto}`
 *
 * 三个测量坑（都踩过，注释里也记了，别改回去）：
 *   1. 盒子 rect 永远等于列宽 —— 内容被裁在盒子里，rect 看不出溢出
 *   2. zoom 子树里元素的 scrollWidth 不随 zoom 变 —— 用它判断"缩够了没"会一路缩到下限
 *   3. 按"刚好等于列宽"算会剩十几个像素被裁 —— 要给公式盒子自己的内边距留余量
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 收尾处有自检：实际跑出来的断言数必须等于它。
 */
export const TEST_COUNT = 9

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const LONG_BLOCK =
  ('\\sum_{i=1}^{n}\\frac{x_{i}^{2}-\\bar{x}^{2}}{\\sigma\\sqrt{2\\pi}}' + '+').repeat(6) +
  '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}'
/* 极端档：连写 24 遍，缩到下限（0.5）也放不下 → 应该走"框内横向滚动"那条兜底 */
const HUGE_BLOCK = ('\\sum_{i=1}^{n}\\frac{x_{i}^{2}-\\bar{x}^{2}}{\\sigma\\sqrt{2\\pi}}' + '+').repeat(24) + 'x'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/** 量：公式本体有没有越出正文列、盒子里有没有被裁掉的内容、有没有被缩放 */
const measure = () =>
  page.evaluate(() => {
    const prose = document.querySelector('.ProseMirror')
    const pr = prose.getBoundingClientRect()
    const n = document.querySelector('.math-node')
    if (!n) return null
    const inner = n.querySelector('.katex-html') ?? n.querySelector('.katex')
    const ir = inner ? inner.getBoundingClientRect() : null
    return {
      colW: Math.round(pr.width),
      zoom: n.style.zoom || '',
      wide: n.dataset.wide === '1',
      contentW: ir ? Math.round(ir.width) : null,
      spillRight: ir ? Math.round(ir.right - pr.right) : null,
      clipped: n.scrollWidth - n.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      md: window.__MD__(),
    }
  })

const setMd = async (md) => {
  await page.evaluate((m) => window.__SET_MARKDOWN__(window.__EDITOR__, m), md)
  await page.waitForTimeout(900)
}

/* ---------- 1. 超长行间公式：缩到放得下 ---------- */
await setMd(`$$${LONG_BLOCK}$$\n`)
const a = await measure()
check('超长行间公式：公式本体不再越出正文列', a.spillRight !== null && a.spillRight <= 1, `越出 ${a.spillRight}px（列宽 ${a.colW}）`)
check('超长行间公式：盒子里没有被裁掉的内容（不是"裁掉"而是"缩小"）', a.clipped <= 1, `盒内可滚 ${a.clipped}px，内容宽 ${a.contentW}`)
check('超长行间公式：确实做了等比缩放（zoom < 1）', Number.parseFloat(a.zoom || '1') < 1, `zoom=${a.zoom || '(无)'}`)

/* ---------- 2. 缩到下限也放不下时：框内滚动，页面照样不越界 ---------- */
await setMd(`$$${HUGE_BLOCK}$$\n`)
const b = await measure()
check('极端超长：打上 data-wide（在公式框内横向滚动）', b.wide, `data-wide=${b.wide}，zoom=${b.zoom}`)
check('极端超长：页面本身不出现横向滚动', b.pageOverflow <= 0, `页面超出 ${b.pageOverflow}px`)

/* ---------- 3. 短公式与老文档零影响 ---------- */
await setMd('短公式 $x^2+y^2=1$\n')
const c = await measure()
check('短公式：不加缩放、不加 data-wide（老文档显示一模一样）', c.zoom === '' && !c.wide, `zoom=${c.zoom || '(无)'} data-wide=${c.wide}`)
check(
  '缩放只动显示：Markdown / LaTeX 一个字都没变',
  c.md.trim() === '短公式 $x^2+y^2=1$',
  JSON.stringify(c.md),
)

/* ---------- 4. 窗口变窄（正文列真的变窄）→ 重新适应、缩得更多 ----------
   注意要缩到 600px 以下正文列才会跟着变（实测：1280/1000/900/760 都是 654px 的列宽，
   600px 时变成 524px）—— 所以别用"窄一点"来测，测不到东西。 */
await setMd(`$$${LONG_BLOCK}$$\n`)
const before = await measure()
await page.setViewportSize({ width: 600, height: 900 })
await page.waitForTimeout(800)
const narrow = await measure()
check(
  '正文列变窄后公式重新适应（缩得更多、且仍然不越界）',
  narrow.colW < before.colW &&
    narrow.spillRight <= 1 &&
    Number.parseFloat(narrow.zoom || '1') < Number.parseFloat(before.zoom || '1'),
  `列宽 ${before.colW}→${narrow.colW}px，zoom ${before.zoom}→${narrow.zoom}，越出 ${narrow.spillRight}px`,
)
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(500)

/* ---------- 5. 导出的 HTML 自带兜底 ----------
   走真实路径（保存 → 导出网页），读下载到的文件 —— 不看内部函数，免得"函数对了、导出没接上" */
await setMd(`$$${LONG_BLOCK}$$\n`)
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="html"]').click()),
])
const dlPath = await dl.path()
const exported = dlPath ? readFileSync(dlPath, 'utf-8') : ''
check(
  '导出的 HTML / PDF 带"长公式不撑破页面"的 CSS 兜底',
  exported.includes('math[display="block"]') && /overflow-x:\s*auto/.test(exported),
  `导出 ${(exported.length / 1024).toFixed(0)}KB，含兜底样式=${exported.includes('math[display="block"]')}`,
)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条断言通过`)
if (errors.length) console.log(`（页面错误 ${errors.length} 条：${errors.slice(0, 2).join(' | ')}）`)
if (results.length !== TEST_COUNT) {
  console.log(`❌ 断言条数与 TEST_COUNT(${TEST_COUNT}) 不一致：实际 ${results.length} 条`)
  process.exit(1)
}
process.exit(failed.length ? 1 : 0)
