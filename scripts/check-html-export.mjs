/**
 * 导出 HTML 的公式回归测试（针对用户截图里的红框）
 *
 * 现象：文档里存的公式写法是坏的（`\left { x_{n}-y_{n} \right }`，`\left`/`\right` 中间少了 `\{`），
 * 屏幕上显示时编辑器会先修再渲染，看着是好的；**导出 HTML 这条路径以前没修**，
 * 于是导出的文件里出现 `ParseError: KaTeX parse error: Expected '}', got '\right' …` 的红框。
 *
 * 修法（三层，全部要过）：
 *   1. 打开/导入 .md 时，把节点里**存着的**写法也修好（以前只修了"解析用的占位符"）
 *   2. 导入知乎公式标记（<img src="…/equation?tex=…" alt="坏的写法">）时同样先修
 *   3. 导出 HTML 时再兜一层：渲染前一律按修好的写法渲染（防手输/旧文档里的坏写法）
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')
const DL = resolve('.probe', 'html-export-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const BROKEN = String.raw`\left { x_{n}-y_{n} \right }`
const FIXED = String.raw`\left \{ x_{n}-y_{n} \right \}`
const GOOD = String.raw`a_{1}+\frac{b_{2}}{c_{3}}`

/* 源文件 1：普通 $…$，里面夹一个坏写法 */
const mdPath = resolve('.probe', 'html-export-src.md')
writeFileSync(
  mdPath,
  ['# 公式导出测试', '', `坏的：$${BROKEN}$`, '', `好的：$${GOOD}$`, ''].join('\n'),
  'utf-8',
)

/* 源文件 2：知乎格式的公式标记，alt 里是坏写法 */
const imgPath = resolve('.probe', 'html-export-img.md')
writeFileSync(
  imgPath,
  [
    '# 知乎标记里的坏写法',
    '',
    `前面 <img src="https://www.zhihu.com/equation?tex=%5Cleft%20%7B%20x%20%5Cright%20%7D" alt="${BROKEN.replace(/"/g, '&quot;')}" class="ee_img tr_noresize" eeimg="1"> 后面`,
    '',
  ].join('\n'),
  'utf-8',
)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

const openFile = async (p) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(p)
  await page.waitForTimeout(2200)
}

/** 导出 HTML（走「保存 → 导出网页」，按钮文字没变） */
const exportHtml = async (fileName) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.locator('.zh-btn[title="保存"]').click()
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('.zh-menu__item[data-format="html"]').click(),
  ])
  const saved = resolve(DL, fileName)
  await dl.saveAs(saved)
  await page.waitForTimeout(400)
  return readFileSync(saved, 'utf-8')
}

/** 文档里"存着的"写法（data-latex 直接来自节点属性） */
const storedLatex = () =>
  page.evaluate(() => [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex')))

/* ---------- 1. 打开带坏写法的 $…$ 文件：节点里存的应该是修好的 ---------- */
await openFile(mdPath)
const stored1 = await storedLatex()
check('导入：节点里存着的是**修好的**写法（不是只修显示）', stored1.includes(FIXED), JSON.stringify(stored1))
check('导入：坏写法没有留在文档里', !stored1.some((l) => /\\left\s+\{/.test(l)), JSON.stringify(stored1))
check('导入：本来就正常的公式一个字没改', stored1.includes(GOOD), JSON.stringify(stored1))

const html1 = await exportHtml('out1.html')
const fixbox1 = (html1.match(/katex-error/g) || []).length
check('导出 HTML：没有 KaTeX 报错标记（红框）', fixbox1 === 0, `${fixbox1} 处 katex-error`)
check('导出 HTML：没有 ParseError 文字', !/ParseError/i.test(html1))
check('导出 HTML：公式按修好的写法渲染（能搜到 \\left \\{）', html1.includes(String.raw`\left \{`) || !html1.includes(String.raw`\left {`), '')

/* ---------- 2. 知乎公式标记里 alt 是坏写法：也要修好 ---------- */
await openFile(imgPath)
const stored2 = await storedLatex()
check('知乎标记：坏写法在导入时被修好', stored2.includes(FIXED), JSON.stringify(stored2))
const html2 = await exportHtml('out2.html')
check('知乎标记：导出的 HTML 里没有报错', !/katex-error|ParseError/i.test(html2), `${(html2.match(/katex-error/g) || []).length} 处`)

/* ---------- 3. 兜底：文档里被硬塞一个坏写法（模拟手输/旧文档），导出也不能出红框 ---------- */
await page.evaluate((broken) => {
  const ed = window.__EDITOR__
  ed.chain().focus().clearContent().run()
  ed.chain().insertContent({ type: 'paragraph' }).run()
  ed.chain().insertContent({ type: 'text', text: '硬塞的坏写法：' }).run()
  ed.chain().insertContent({ type: 'mathInline', attrs: { latex: broken } }).run()
}, BROKEN)
await page.waitForTimeout(900)
const rawStored = await storedLatex()
check('兜底场景：节点里确实是坏写法（模拟旧文档）', rawStored.some((l) => l === BROKEN), JSON.stringify(rawStored))
const html3 = await exportHtml('out3.html')
check('兜底场景：导出 HTML 仍然不出现红框（渲染前再修一层）', !/katex-error|ParseError/i.test(html3), `${(html3.match(/katex-error/g) || []).length} 处`)
check('兜底场景：导出的是修好的公式', html3.includes(String.raw`\left \{`) || !html3.includes(String.raw`\left {`), '')

check('全程无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
