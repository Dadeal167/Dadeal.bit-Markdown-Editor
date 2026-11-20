/**
 * 「公式检查键必须真能修」—— 这条链以前是断的，用这个套件守住。
 *
 * 用户原话："我怀疑你的公式检查是个摆设，在刚才那种情况都显示正常。"
 * 查实后是一条三处断裂的链：
 *   1. `countBrokenMath` 数的是"repairLatex 修过之后还坏不坏"。
 *      像 `f'(x)&lt;0` 这种"存着是坏的、但一修就好"的公式会被数成 **0**。
 *   2. 提示条只在 `issues.math > 0` 时出现 → 数成 0 就不出现，
 *      挂在提示条上的「一键修复公式」按钮**跟着一起不出现**。
 *   3. 菜单里那个「检查图片与公式（**打不开就修**）」只 count、**从不 repair** ——
 *      名字里写着"就修"，实际点十次也不改一个字。
 * 于是：屏幕上明明有红字，却找不到任何能修的入口。
 *
 * 这个套件按**真实路径**验（造一个 .md 文件 → 「打开 .md」），盯四件事：
 *   a) 载入时自动修（提示条要说明修了几个）
 *   b) 存进节点里的是**好写法**（不是修在渲染层、存的还是坏的）
 *   c) 手动塞坏写法后，菜单那一项**真的能修好**
 *   d) 修不了的公式要明说"得手动改"，不能假装没事
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve(process.env.DADEALBIT_TEST_HTML ?? 'Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const OUT = resolve('.probe', 'out')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* 三种坏写法，都是知乎导出常见的，repairLatex 都能修 */
const MD = [
  '# 公式修复链验证',
  '',
  '在 $x\\in (-\\infty,0)$ 时，$f\'(x)&lt;0,f(x)$ 单调递减。',
  '',
  '答案是 $a\\in \\[-\\infty,\\frac{1}{2}\\]$，且 $\\varphi\'\'(0)=2a-1&lt;0$。',
  '',
  '不正常的不等式 $a&nbsp;b$ 也顺带试一下。',
  '',
  '对照（本来就正常）：$\\frac{1+k}{1-k}$。',
].join('\n')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
await page.addInitScript(() => { window.showOpenFilePicker = undefined })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1000)

const mdPath = resolve(OUT, 'math-fix-chain-check.md')
writeFileSync(mdPath, MD, 'utf8')
const chooser = page.waitForEvent('filechooser', { timeout: 15000 })
await page.locator('.zh-btn[title^="打开"]').click()
;(await chooser).setFiles(mdPath)
await page.waitForTimeout(2500)

const probe = () =>
  page.evaluate(() => {
    const prose = document.querySelector('.zh-prose')
    const nodes = [...prose.querySelectorAll('.math-node')]
    const bar = document.querySelector('.zh-fixbar')
    return {
      stored: nodes.map((n) => n.getAttribute('data-latex')),
      err: prose.querySelectorAll('.katex-error').length,
      barVisible: bar ? getComputedStyle(bar).display !== 'none' : false,
      barText: (bar?.textContent || '').replace(/\s+/g, ' ').slice(0, 120),
    }
  })

const afterImport = await probe()

/* ---------- a. 载入时自动修 ---------- */
check('打开带坏写法的 .md 后，屏幕上没有渲染失败的公式', afterImport.err === 0, `katex-error ${afterImport.err} 个`)
check(
  '导入后提示已修复的公式数量',
  afterImport.barVisible && /(?:已修复|导入时自动修好了)\s*\d+\s*(?:处公式语法|个公式)/.test(afterImport.barText),
  JSON.stringify(afterImport.barText),
)

/* ---------- b. 存进节点里的是好写法 ---------- */
const storedText = JSON.stringify(afterImport.stored)
check('节点里**存着**的写法里没有 HTML 实体（不是只修渲染层）', !/&lt;|&gt;|&nbsp;/.test(storedText), storedText.slice(0, 130))
check('节点里没有被 `\\[` `\\]` 包住的定界符残留', !/\\\\\[|\\\\\]/.test(storedText), storedText.slice(0, 130))
check(
  '对照公式（本来正常的）一个字都没被改',
  afterImport.stored.includes('\\frac{1+k}{1-k}'),
  storedText.slice(0, 130),
)

/* ---------- c. 手动塞坏写法后，菜单那一项真的能修 ---------- */
const forced = await page.evaluate(() => {
  const ed = window.__EDITOR__
  let pos = null
  ed.state.doc.descendants((n, p) => {
    if (pos === null && n.type.name === 'mathInline') pos = p
  })
  if (pos === null) return false
  const node = ed.state.doc.nodeAt(pos)
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: "f'(x)&lt;0,f(x)" }))
  return true
})
check('（前置）成功把第一个公式改回坏写法', forced)

await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(250)
const checkItem = page.locator('.zh-menu button', { hasText: '检查图片与公式' }).first()
check('菜单明确说明会自动修复公式', (await checkItem.innerText()).includes('自动修复公式'))
await checkItem.click()
await page.waitForTimeout(900)

const afterMenu = await probe()
check(
  '点菜单那一项**真的把节点里的坏写法修好了**（名字里的"就修"不是摆设）',
  afterMenu.stored[0] === "f'(x)<0,f(x)",
  `${JSON.stringify(afterImport.stored[0])} → ${JSON.stringify(afterMenu.stored[0])}`,
)
check(
  '修完会告诉用户修了几个',
  /(?:已修复|修好了)\s*\d+\s*个公式/.test(afterMenu.barText),
  JSON.stringify(afterMenu.barText),
)

/* ---------- d. 修不了的公式必须明说 ---------- */
const hardCase = await page.evaluate(() => {
  const ed = window.__EDITOR__
  let pos = null
  ed.state.doc.descendants((n, p) => {
    if (pos === null && n.type.name === 'mathInline') pos = p
  })
  if (pos === null) return false
  const node = ed.state.doc.nodeAt(pos)
  /* \undefinedcmd 是 KaTeX 不认识的命令，repairLatex 也修不了 */
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: 'a \\undefinedcmd b' }))
  return true
})
if (hardCase) {
  await page.locator('.zh-btn[title="更多"]').click()
  await page.waitForTimeout(250)
  await page.locator('.zh-menu button', { hasText: '检查图片与公式' }).first().click()
  await page.waitForTimeout(900)
  const hard = await probe()
  check(
    '自动修不了的公式会**明说**要手动改（不假装没事）',
    /手动编辑|手动改/.test(hard.barText) || /手动编辑|手动改/.test(await page.locator('.zh-fixbar').textContent()),
    JSON.stringify(hard.barText),
  )
  check('只有手动修复项时不展示一键修复按钮', await page.getByTitle('一键修复公式', { exact: true }).count() === 0)
}

/* ---------- e. 弹窗里的修复预览、确认写回与中文找符号 ---------- */
const dialog = page.getByRole('dialog', { name: '公式编辑器' })
const input = dialog.locator('.zh-mathsource')
await page.locator('.zh-btn[title="公式"]').click()
const originalTex = '\\[\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}\\]'
await input.fill(originalTex)
await dialog.getByRole('button', { name: '应用修复' }).waitFor()
check('预览先用修复后的多行公式，输入框保留原文',
  (await input.inputValue()) === originalTex && await dialog.locator('.zh-formula__preview .katex').count() === 1)
await dialog.getByRole('button', { name: '确认', exact: true }).click()
check('确认把修好的 TeX 写进文档节点', (await probe()).stored.some(tex => tex?.startsWith('\\begin{aligned}') && tex.includes('c &= d')))

await page.locator('.zh-btn[title="公式"]').click()
await dialog.getByRole('button', { name: '找符号', exact: true }).click()
await dialog.getByRole('searchbox', { name: '搜索公式符号' }).fill('分数')
await dialog.getByRole('button', { name: '分数', exact: true }).click()
await page.waitForFunction(() => {
  const input = document.querySelector('.zh-mathsource')
  return input === document.activeElement && input.value.includes('\\frac{}{}')
    && input.selectionStart === input.value.indexOf('{}') + 1
}, null, { timeout: 4000 })
check('中文找到分数模板，光标落在第一个空位', await input.evaluate(element =>
  element.value.includes('\\frac{}{}') && element.selectionStart === element.value.indexOf('{}') + 1))
await dialog.getByRole('button', { name: '找符号', exact: true }).click()
check('最近使用可以再次插入已选过的符号', await dialog.getByRole('button', { name: '分数', exact: true }).isVisible())
await dialog.getByRole('searchbox', { name: '搜索公式符号' }).fill('\\sum')
check('TeX 命令也能找到符号', await dialog.locator('.zh-mathpanel .zh-symbol[data-latex^="\\\\sum"]').count() > 0)
await dialog.getByRole('button', { name: '取消', exact: true }).click()

check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

writeFileSync(
  resolve(OUT, 'math-fix-chain-check.json'),
  JSON.stringify({ afterImport, afterMenu, errors }, null, 2),
  'utf-8',
)
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  公式检查键真能修：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
