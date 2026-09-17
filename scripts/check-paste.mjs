/**
 * 粘贴公式回归测试（用户真实反馈："导入公式的时候会出现这种情况"）
 *
 * 背景：从网页 / 导出 HTML 里**粘贴**内容时，剪贴板里的公式常常还是纯文本 `$…$`
 * （那些导出工具的 HTML 里，公式本来就是文本），而粘贴这条路不经过"导入 .md"的
 * 公式保护 —— 于是公式原样留在正文里变成一行乱码。
 *
 * 覆盖三条路：
 *   A. 纯文本粘贴（复制 .md 源码）→ 公式应当变成公式节点
 *   B. 富文本粘贴（复制网页，公式是 `$…$` 文本）→ 自动转成公式节点
 *   C. 已经粘错了的文档 → 体检提示条上一键转成公式
 *   D. 误伤检查：正文里的美元金额不能被当成公式
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 *
 * 为什么要导出它而不是让文档手写数字：实测过 7 处「文档写的数量」与实测不符，
 * 其中 6 处都是同一类**数字漂移**（改了测试没改文档）。手写数字一定会漂。
 * 唯一数据源放在这里，文档用 `<!-- TEST_COUNT:<脚本名> -->` 占位。
 *
 * 收尾处还有一条自检：实际跑出来的断言数必须等于这个常量，
 * 否则套件自己失败 —— 免得"测试被删掉几条、常量没跟着改"，把常量变成新的谎话。
 */
export const TEST_COUNT = 26

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(400)
  return { page, errs }
}

const paste = async (page, payload) => {
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    if (data.html) dt.setData('text/html', data.html)
    dt.setData('text/plain', data.text)
    const el = document.querySelector('.ProseMirror')
    el.focus()
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, payload)
  await page.waitForTimeout(2500)
}

const stats = (page) =>
  page.evaluate(() => {
    const prose = document.querySelector('.ProseMirror')
    const t = prose?.textContent || ''
    // 注意：KaTeX 的 MathML 里带 <annotation> 原文，直接取 textContent 会把公式里的
    // \frac 也算进来。所以统计"正文残留"时先把公式节点整棵摘掉。
    const clone = prose.cloneNode(true)
    clone.querySelectorAll('.math-node').forEach((n) => n.remove())
    const plain = clone.textContent || ''
    return {
      math: document.querySelectorAll('.math-node').length,
      dollars: (plain.match(/\$/g) || []).length,
      frac: (plain.match(/\\frac/g) || []).length,
      chars: t.length,
      firstLatex: document.querySelector('.math-node')?.getAttribute('data-latex') ?? '',
      quotes: document.querySelectorAll('.ProseMirror blockquote').length,
    }
  })

/* ---------- A. 纯文本粘贴（复制 Markdown 源码） ---------- */
{
  const { page, errs } = await freshPage()
  await paste(page, {
    text: [
      '# 粘贴测试',
      '',
      '下标公式：$x_1 + y_2$，星号公式：$a*b*c$，分数：$\\frac{1+k}{1-k}$',
      '',
      '> 引用里也有公式 $F_{1}(-1,0)$ 和 $\\left \\{ x_{n}-y_{n} \\right \\}$',
      '',
    ].join('\n'),
  })
  const r = await stats(page)
  check('A 纯文本粘贴：公式变成公式节点', r.math === 5 && r.dollars === 0, `公式 ${r.math} 个，残留 $ ${r.dollars}`)
  check('A 纯文本粘贴：下划线没被吃成斜体', r.firstLatex === 'x_1 + y_2', r.firstLatex)
  check('A 纯文本粘贴：引用块正常', r.quotes === 1, `${r.quotes} 个引用块`)
  check('A 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- B. 富文本粘贴（复制网页，公式是 $…$ 文本） ---------- */
{
  const { page, errs } = await freshPage()
  const html =
    '<p>即有 $\\frac{1+k}{1-k}\\times \\frac{x_{n}-y_{n}}{x_{n+1}-y_{n+1}}=1$ 公式（3）</p>' +
    '<p>简单一点的 $x_1$、$18$、$(3)$ 也要认出来。</p>' +
    '<blockquote>引用里的 $\\left \\{ x_{n}-y_{n} \\right \\}$</blockquote>'
  await paste(page, { html, text: '即有 $\\frac{1+k}{1-k}=1$ 公式（3）' })
  const r = await stats(page)
  check('B 富文本粘贴：原文公式被转成公式节点', r.math === 5 && r.dollars === 0, `公式 ${r.math} 个，残留 $ ${r.dollars}`)
  check('B 富文本粘贴：\\frac 不再留在正文里', r.frac === 0, `残留 \\frac ${r.frac}`)
  check('B 富文本粘贴：引用块还在', r.quotes === 1, `${r.quotes} 个引用块`)
  const latex = await page.evaluate(() =>
    [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex')),
  )
  check('B 简单公式（$18$、$(3)$）也认出来了', latex.includes('18') && latex.includes('(3)'), JSON.stringify(latex))
  check('B 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- C. 正文里还留着原文公式：体检条一键转 ---------- */
{
  const { page, errs } = await freshPage()
  // 直接在正文里敲出"原文公式"（打字不经过粘贴那条自动修复）
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('粘坏的公式 $\\frac{a}{b}$ 和 $x_{1}+y_{1}$，还有 $\\left \\{ z \\right \\}$')
  await page.waitForTimeout(600)
  const before = await stats(page)
  check('C 敲进去的公式确实还是原文（没被自动改）', before.math === 0 && before.dollars === 6, `公式 ${before.math} 个，$ ${before.dollars}`)

  // 「更多 → 检查图片与公式」→ 这个入口名字里有"就修"，所以它会**直接修**：
  // 把"还是原文的 $…$"转成真公式，并报出做了几处。
  // （以前它只 count 不修，用户点了没反应；那是用户点名批评过的"摆设"行为。）
  await page.locator('.zh-btn[title^="更多"]').click()
  await page.waitForTimeout(300)
  await page.locator('.zh-menu__item', { hasText: '检查图片与公式' }).first().click()
  await page.waitForTimeout(2000)
  const afterFix = await stats(page)
  check(
    'C「检查图片与公式」直接把原文公式修成了真公式',
    afterFix.math === 3 && afterFix.dollars === 0,
    `公式 ${afterFix.math} 个，残留 $ ${afterFix.dollars}`,
  )
  const barText = await page.evaluate(() => document.querySelector('.zh-fixbar')?.textContent?.trim() ?? '')
  check('C 修完会报出"把几处原文公式变成了真公式"', /原文公式/.test(barText), barText.replace(/\s+/g, ' ').slice(0, 70))
  const latex = await page.evaluate(() =>
    [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex')),
  )
  check('C 转换后的公式内容正确', latex.includes('\\frac{a}{b}') && latex.includes('x_{1}+y_{1}'), JSON.stringify(latex))
  check('C 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- C2. 已经粘坏、存在浏览器里的旧文档：重开就自己好了 ---------- */
{
  const { page, errs } = await freshPage()
  // 敲出原文公式 → 等自动保存（存进去的就是 `$…$` 原文，和用户那篇粘坏的文档一样）
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('旧文档：$\\frac{a}{b}$ 和 $x_{1}$')
  await page.waitForTimeout(2400)
  const saved = await page.evaluate(() => localStorage.getItem('md-editor-docs-v1') || '')
  // 正文里的反斜杠存成 Markdown 时会被转义（\frac → \\frac），这里只确认"公式还是 $…$ 原文"
  check(
    'C2 存进去的确实是 $…$ 原文（模拟旧文档）',
    saved.includes('frac{a}{b}') && /\$/.test(saved),
    saved.slice(0, 70).replace(/\s+/g, ' '),
  )

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const r = await stats(page)
  check('C2 旧文档一打开，原文公式就自己变成公式了', r.math === 2 && r.dollars === 0, `公式 ${r.math} 个，残留 $ ${r.dollars}`)
  check('C2 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- D. 误伤检查：美元金额不能被当成公式 ---------- */
{
  const { page, errs } = await freshPage()
  await paste(page, { text: '原价 $100，现价 $60，很划算。价格区间 $100 and $200 也算正文。' })
  const r = await stats(page)
  check('D 正文里的美元金额没被误认成公式', r.math === 0, `${r.math} 个公式节点`)
  const text = await page.evaluate(() => document.querySelector('.ProseMirror').textContent)
  check('D 金额文字原样保留', text.includes('100') && text.includes('60'), text.slice(0, 60))
  check('D 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- E. 旧文档里"粘坏的公式原文"：重开时自动修好 ----------
   用户真实情况：坏粘贴留下的公式原文是普通文字，**存盘时字面 $ 被转义成 \$**，
   于是重开时它只是正文、永远变不回公式。现在打开文档时会自动转回真公式。 */
{
  const { page, errs } = await freshPage()
  await page.evaluate(() => {
    const ed = window.__EDITOR__
    ed.chain()
      .focus()
      .insertContent({
        type: 'text',
        // 故意带上 `*` 和 `_`：Markdown 会把它们解析成斜体/加粗标记，把 $…$ 切成好几个节点
        //（用户那两段公式就是这么卡住的）
        text: '粘坏的：$\\frac{1+k}{1-k}\\times \\frac{x_{n}-y_{n}}{x_{n+1}-y_{n+1}}=\\frac{(x^{2}*{n}-y^{2}*{n})}{(x^{2}*{n+1}-y^{2}*{n+1})}=1$ 和 $S=\\frac{k}{2}\\left| x^{2}*{n+1} \\right|$',
      })
      .run()
  })
  await page.waitForTimeout(500)
  // 触发一次"关闭前保存"：这条路径会把字面 $ 转义成 \$ 写进存储（用户文件就是这么坏的）
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')))
  await page.waitForTimeout(700)
  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('md-editor-docs-v1') || '{}')
    return s.docs?.find((d) => d.id === s.currentId)?.md ?? ''
  })
  const at = stored.indexOf('粘坏的')
  check('存储里现在是转义过的公式原文（\\$…\\$）', at >= 0 && stored.slice(at, at + 60).includes('\\$'), stored.slice(at, at + 50))

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(3000)
  const r = await stats(page)
  const note = await page.evaluate(() => document.querySelector('.zh-fixbar')?.textContent?.trim() ?? '')
  check('重开文档时自动把公式原文转回了真公式', r.math === 2 && r.dollars === 0, `公式 ${r.math} 个，残留 $ ${r.dollars}`)
  // 提示不是必须的：加载时 Markdown 解析这一步可能已经修好了，那就不需要再补一次
  console.log(`  （提示条：${note ? note.slice(0, 36) : '无（说明加载时就修好了）'}）`)
  check('E 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

/* ---------- F. 带空格的公式，存盘重开后不能降级成文字 ----------
   独立审查抓到的回归风险：如果"像不像公式"的判据太紧（例如要求含 \ ^ _），
   `$a + b$`、`$p = 0.5$` 这种正经公式会在重开时变成一行字面 `$a + b$`，随后被转义、
   永远回不去。这里用编辑器自己的公式节点（不是粘贴的原文）来盯住它。 */
{
  const { page, errs } = await freshPage()
  await page.evaluate(() => {
    const ed = window.__EDITOR__
    ed.chain()
      .focus()
      .insertContent({ type: 'text', text: '带空格的公式：' })
      .insertMathInline('a + b = c')
      .insertContent({ type: 'text', text: ' 和 ' })
      .insertMathInline('p = 0.5')
      .run()
  })
  await page.waitForTimeout(700)
  const before = await stats(page)
  check('插入两个带空格的公式', before.math === 2, `${before.math} 个`)

  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')))
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const after = await stats(page)
  const latex = await page.evaluate(() =>
    [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex')),
  )
  check(
    '关掉重开：带空格的公式还是公式（没降级成文字）',
    after.math === 2 && after.dollars === 0 && latex.includes('a + b = c') && latex.includes('p = 0.5'),
    `公式 ${after.math} 个，残留 $ ${after.dollars}，latex=${JSON.stringify(latex)}`,
  )
  check('F 无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档占位符读它）。
   不加这条的话，删掉几条断言而忘了改常量，文档就会显示一个假的数字。 */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT（文档数量占位符读它）')
  process.exit(1)
}

process.exit(failed ? 1 : 0)
