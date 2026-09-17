/**
 * 公式导入回归测试（针对一个真实修过的 bug）
 *
 * 背景：Markdown 解析器（markdown-it）**不认识 $…$ 公式**，会先把公式里的
 * Markdown 记号吃掉 —— 实测 `$a*b*c$` 会变成 `$a<em>b</em>c$`，公式直接坏掉。
 * 修法：导入前把公式整段换成占位符，解析完再还原成数学节点。
 *
 * 这个脚本走**真实路径**（用编辑器「打开」功能导入 .md 文件），
 * 直接开双击版的单文件 HTML，不需要开发服务器。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 改测试条数时改这里；文档不用动（占位符会跟着变）。
 */
export const TEST_COUNT = 34

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
mkdirSync(resolve('.probe'), { recursive: true })

const CASES = [
  { name: '下标（下划线）', md: '$x_1 + 1$', math: 1, latex: 'x_1 + 1' },
  { name: '多组下标', md: '$k_{BP}+k_{BQ}$', math: 1, latex: 'k_{BP}+k_{BQ}' },
  { name: '乘号（星号）', md: '$a*b*c$', math: 1, latex: 'a*b*c' },
  { name: '双星号', md: '$a**b**c$', math: 1, latex: 'a**b**c' },
  { name: '下划线成对（像斜体）', md: '$f_x = g_y$', math: 1, latex: 'f_x = g_y' },
  { name: '反引号', md: '$a`b`c$', math: 1, latex: 'a`b`c' },
  { name: '方括号', md: '$[a,b]$', math: 1, latex: '[a,b]' },
  { name: '尖括号', md: '$a<b>c$', math: 1, latex: 'a<b>c' },
  { name: '绝对值竖线', md: '$|x|+|y|$', math: 1, latex: '|x|+|y|' },
  { name: 'LaTeX 换行 \\\\', md: '$\\begin{matrix}a\\\\b\\end{matrix}$', math: 1, latex: '\\begin{matrix}a\\\\b\\end{matrix}' },
  { name: '分数与根号', md: '$\\frac{a}{b}+\\sqrt{2}$', math: 1, latex: '\\frac{a}{b}+\\sqrt{2}' },
  { name: '一行两个公式', md: '$F_{1}$ 和 $F_{2}$', math: 2 },
  { name: '块级公式', md: '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$', math: 1, block: 1 },
  { name: '星号块级公式', md: '$$a*b*c = x_1$$', math: 1, block: 1 },
  { name: '字面美元号（不该变公式）', md: '原价 \\$100，现价 \\$60', math: 0, text: '$100' },
  {
    name: '字面反斜杠紧挨着美元号（不该变公式）',
    // 导出时会写成 C:\\$100（\$ 是转义美元号），导入时不能把最后的 $ 当成公式定界符
    md: 'C:\\\\$100',
    math: 0,
    text: '$100',
  },

  /* ---- 下面这些是"导出工具把反斜杠写坏"的真实情况（用户文件里实测到的） ---- */
  {
    name: '公式以 LaTeX 换行收尾（\\\\ 后面紧跟收尾的 $）',
    // 关键：\\$ 里的 $ 必须当定界符。以前会被当成转义的 \$ 吃掉，
    // 于是公式收不了尾，后面整篇的 $ 配对全部错位
    md: String.raw`第一行 $a_1 \\$ 第二行 $b_2$ 和 $c_3$`,
    math: 3,
    latexAll: ['a_1 \\\\', 'b_2', 'c_3'],
  },
  {
    name: '反斜杠写重：\\left \\\\{ … \\right \\\\}',
    md: String.raw`$\left \\{ x_{n}-y_{n} \right \\}$`,
    math: 1,
    latex: String.raw`\left \{ x_{n}-y_{n} \right \}`,
  },
  {
    name: '结尾多一个反斜杠',
    md: String.raw`$A=1\\\$`,
    math: 1,
    latex: String.raw`A=1\\`,
  },
  {
    name: '少一个反斜杠：\\left { … \\right }',
    md: String.raw`$\left { x \right }$`,
    math: 1,
    latex: String.raw`\left \{ x \right \}`,
  },
  {
    name: '命令名写错：\\or 应为 \\lor',
    md: String.raw`$p(A\or B)=p(A)+p(B)$`,
    math: 1,
    latex: String.raw`p(A\lor B)=p(A)+p(B)`,
  },
  {
    name: '本来正常的公式一个字都不改',
    md: String.raw`$a_{1}+\frac{b_{2}}{c_{3}}$`,
    math: 1,
    latex: String.raw`a_{1}+\frac{b_{2}}{c_{3}}`,
  },

  /* ---- 下面是"别把正经公式否掉 / 别漏掉紧跟的公式"（独立审查抓出来的问题，防回归） ---- */
  { name: '带空格的正经公式不能被否掉（a + b = c）', md: '$a + b = c$', math: 1, latex: 'a + b = c' },
  { name: '等号两边有空格（p = 0.5）', md: '当 $p = 0.5$ 时成立。', math: 1, latex: 'p = 0.5' },
  { name: '落单的 $ 后面紧跟的真公式不能被吃掉', md: '他说 $100 元，$x^2$ 是公式', math: 1, latex: 'x^2' },
  { name: '行内代码里的 $ 不算公式', md: '`$x^2$` 是代码，不是公式', math: 0, text: '$x^2$' },
  { name: '金额与公式混在一行', md: '当 $p = 0.5$ 时，价格 $100，现价 $60。', math: 1, latex: 'p = 0.5' },
]

// 每组单独一个文件，避免段落错位导致误判
const files = CASES.map((c, i) => {
  const p = resolve('.probe', `formula-case-${i}.md`)
  writeFileSync(p, `# ${c.name}\n\n${c.md}\n`, 'utf-8')
  return p
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 100)))

for (let i = 0; i < CASES.length; i += 1) {
  const c = CASES[i]
  await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(900)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(files[i])
  await page.waitForTimeout(1400)

  const r = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.math-node')]
    const prose = document.querySelector('.ProseMirror')
    return {
      math: nodes.length,
      latex: nodes.map((n) => n.getAttribute('data-latex')),
      blocks: document.querySelectorAll('.node-mathBlock').length,
      errors: document.querySelectorAll('.katex-error').length,
      em: !!prose?.querySelector('em, strong'),
      text: (prose?.innerText || '').replace(/\s+/g, ' '),
    }
  })

  const okMath = r.math === c.math
  const okLatex = c.latex === undefined || r.latex.includes(c.latex)
  const okLatexAll =
    c.latexAll === undefined || JSON.stringify(r.latex) === JSON.stringify(c.latexAll)
  const okBlock = c.block === undefined || r.blocks === c.block
  const okErr = r.errors === 0
  const okEm = !r.em
  const okText = c.text === undefined || r.text.includes(c.text)
  check(
    c.name,
    okMath && okLatex && okLatexAll && okBlock && okErr && okEm && okText,
    `公式 ${r.math}/${c.math}${r.latex.length ? ' latex=' + JSON.stringify(r.latex) : ''}` +
      (r.errors ? ` 渲染错误 ${r.errors}` : '') +
      (r.em ? ' 出现斜体（被 Markdown 吃掉了）' : '') +
      (okText ? '' : ` 文本里没有「${c.text}」`),
  )
}

check('全程无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

/* ---------- 存盘也要自愈：文档里真的躺着一个坏公式 ----------
   真实情况（用户踩到过）：公式节点的 latex 是坏写法（例如手输/粘贴进来的
   `\left { x \right }` 少一个反斜杠，`\left \\{` 多一个反斜杠）。
   打开时界面上按修好的写法渲染，看着是好的；但一存盘又把坏写法原样写回去，
   拿到 Typedown / Typora 里就是「Invalid Mathematical Formula」。
   所以 getMarkdown 必须把渲染不出来的公式按修好的写法写出去。 */
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const ed = window.__EDITOR__
  ed.chain().focus().clearContent().run()
  ed.chain().insertContent({ type: 'paragraph' }).run()
  ed.chain().insertContent({ type: 'text', text: '少反斜杠：' }).run()
  ed.chain().insertContent({ type: 'mathInline', attrs: { latex: '\\left { x_{n}-y_{n} \\right }' } }).run()
  ed.chain().insertContent({ type: 'text', text: '写重了：' }).run()
  ed.chain().insertContent({ type: 'mathInline', attrs: { latex: '\\left \\\\{ y \\right \\\\}' } }).run()
  ed.chain().insertContent({ type: 'text', text: '正常的：' }).run()
  ed.chain().insertContent({ type: 'mathInline', attrs: { latex: 'a_{1}+b_{2}' } }).run()
})
await page.waitForTimeout(900)

const healed = await page.evaluate(() => {
  let md = ''
  let err = ''
  try {
    md = window.__MD__() ?? ''
  } catch (e) {
    err = String(e).slice(0, 90)
  }
  return { md, err, broken: document.querySelectorAll('.math-node--error').length }
})
// 注：界面上**不会**标红——MathView 渲染时就已经把能修好的写法修好显示了
//（这正是用户看到"屏幕上是好的、存下来是坏的"的原因，所以必须靠存盘自愈）
check('界面上坏公式按修好的写法显示（不标红）', healed.broken === 0, `${healed.broken} 个红字`)
check(
  '存盘：少反斜杠的公式按修好的写法写出去',
  healed.md.includes(String.raw`\left \{ x_{n}-y_{n} \right \}`),
  healed.md.replace(/\n/g, '⏎').slice(0, 90) || healed.err,
)
check('存盘：反斜杠写重的公式也修好', healed.md.includes(String.raw`\left \{ y \right \}`))
check('存盘：本来就正常的公式一个字没改', healed.md.includes('$a_{1}+b_{2}$'))
check('存盘：文件里不残留坏写法', !/\\left\s+\{/.test(healed.md) && !/\\left\s+\\\\\{/.test(healed.md))
check('存盘没有抛错', healed.err === '', healed.err)

await browser.close()

for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档数量占位符读它） */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT')
  process.exit(1)
}

process.exit(failed ? 1 : 0)
