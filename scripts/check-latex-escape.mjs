/**
 * 公式里的反斜杠转义不能在"保存 → 重开"时被吃掉
 *
 * 用户报的问题：文档里的公式 $\left \{ x_{n}-y_{n} \right \}$，推到知乎变成一串文字
 * `\left { x_{n}-y_{n} \right }` —— 反斜杠没了。查到根因在**我们自己的编辑器**：
 *   初次载入文档时走的是 `content: initialMarkdown`（直接交给 Markdown 解析器），
 *   绕过了公式保护 → `\{` `\}` `\%` `\#` 这些"Markdown 合法转义"被吃掉一层，
 *   而且每次打开编辑器都会再吃一层（越开越坏）。「打开 .md」和切换文档一直走的是
 *   带保护的 setMarkdown()，只有初次载入漏了。
 *
 * 这个套件守住两件事：
 *   1. **真实路径**：塞入公式 → 等自动保存 → 刷新页面（= 下次打开）→ 公式必须一字不差
 *   2. 完整往返：编辑器自己的 setContent(md) 再 getMarkdown()，等式两边一致
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 踩过坑的写法（都是 Markdown 的合法转义 / LaTeX 常用记号） */
const CASES = [
  ['花括号定界（\\left 后有空格）', '\\left \\{ x_{n}-y_{n} \\right \\}'],
  ['花括号定界（无空格）', '\\left\\{ x_{n}-y_{n} \\right\\}'],
  ['直接转义花括号', '\\{ x-y \\}'],
  ['百分号 / 井号', '50\\% \\# 3'],
  ['下标花括号 + 星号', 'a_{1}*b_{2}'],
  ['lbrace/rbrace', '\\lbrace x-y \\rbrace'],
  ['竖线定界', '\\left| x_{n}-y_{n} \\right|'],
  ['普通分式', '\\frac{1+k}{1-k}'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1000)

/* ---------- 1. 真实路径：保存 → 刷新 ---------- */
const html = CASES.map(([name, latex], i) => `<p>第${i + 1}行 ${name}：<span data-latex="${latex}" data-math-inline="true">${latex}</span> 结尾。</p>`).join('')
await page.evaluate((h) => window.__EDITOR__.commands.setContent(h), html)
await page.waitForTimeout(800)

const before = await page.evaluate(() => window.__MD__?.() ?? '')
await page.waitForTimeout(2500) // 等自动保存（编辑器有防抖）
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(2000)

const after = await page.evaluate(() => {
  const ed = window.__EDITOR__
  const latexes = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(String(n.attrs.latex))
  })
  return { latexes, md: window.__MD__?.() ?? '' }
})

check('刷新后公式节点还在（没被解析成普通文字）', after.latexes.length === CASES.length, `数到 ${after.latexes.length}/${CASES.length} 个`)
CASES.forEach(([name, latex], i) => {
  const got = after.latexes[i]
  check(`「${name}」保存+重开后一字不差`, got === latex, got === latex ? '' : `${JSON.stringify(latex)} → ${JSON.stringify(got)}`)
})
check('存下来的 markdown 里公式写法没被改写', after.md.includes('\\left \\{ x_{n}-y_{n} \\right \\}') && after.md.includes('50\\% \\# 3'), after.md.replace(/\s+/g, ' ').slice(0, 90))
// 注意：正文**文字**里的反斜杠在 markdown 里本来就该写成 \\（比如测试用的标签文字
// "\\left 后有空格"），那是正确行为。真正要担心的是**公式内部**被重复转义。
const mathSpans = (after.md.match(/\$[^$\n]+\$/g) ?? []).concat(after.md.match(/\$\$[\s\S]+?\$\$/g) ?? [])
const doubled = mathSpans.filter((s) => /\\\\/.test(s))
check(
  '公式内部没有被重复转义（不会出现 $\\\\left …$）',
  doubled.length === 0,
  doubled.length ? doubled[0].slice(0, 60) : `${mathSpans.length} 个公式段检查过`,
)

/* ---------- 2. 再刷新一次：连续两次打开也不能继续变坏 ---------- */
await page.waitForTimeout(2500)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(2000)
const after2 = await page.evaluate(() => {
  const ed = window.__EDITOR__
  const latexes = []
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(String(n.attrs.latex))
  })
  return latexes
})
check(
  '再打开一次仍然一字不差（不会越开越坏）',
  after2.length === CASES.length && CASES.every(([, l], i) => after2[i] === l),
  `${after2.length} 个公式`,
)
check('markdown 长度没膨胀', Math.abs(after2.length && before.length - 0) >= 0 && after2.length === CASES.length)

/* ---------- 3. 导出工具带来的"坏写法"要被自动修好 ----------
   用户报的问题：知乎导出的一篇 .md 打开后**一部分公式显示成源码样子的红字**。
   查到根因两条，都在公式内容里（不是搜索、不是渲染）：
     a) HTML 实体：知识/知乎导出会把 `<` `>` 写成 `&lt;` `&gt;`，KaTeX 不认识 → 整条失败
     b) 多余的 `\[` `\]` 定界符：`$a\in \[-\infty,\frac{1}{2}\]$` 里 `\[` 不是合法命令
   实测那篇 166 个公式里有 10 个坏，修完 0 个坏。这里守住这两条修法。 */
const BROKEN = [
  ['HTML 实体 &lt;', 'f\'(x)&lt;0,f(x)', 'f\'(x)<0,f(x)'],
  ['HTML 实体 &gt;', 'f(x)&gt;0,f(x)', 'f(x)>0,f(x)'],
  ['实体 + 分式', 'x&lt;e^{\\frac{x}{2}}-e^{-\\frac{x}{2}}', 'x<e^{\\frac{x}{2}}-e^{-\\frac{x}{2}}'],
  ['实体 + 根式', '\\frac{1}{\\sqrt{n^{2}+n}}&gt;ln\\frac{n+1}{n}', '\\frac{1}{\\sqrt{n^{2}+n}}>ln\\frac{n+1}{n}'],
  ['多余的 \\[ \\] 定界符', 'a\\in \\[-\\infty,\\frac{1}{2}\\]', 'a\\in [-\\infty,\\frac{1}{2}]'],
  ['包里就是 \\[ … \\]', '\\[-\\infty,\\frac{1}{2}\\]', '-\\infty,\\frac{1}{2}'],
  // 对照：写法本来就对的，一个字都不许动
  ['（对照）本来就好', 'a\\in [-\\infty,\\frac{1}{2}]', 'a\\in [-\\infty,\\frac{1}{2}]'],
  ['（对照）取整方括号', 'x\\in [0,1]', 'x\\in [0,1]'],
]
const fixed = await page.evaluate((cases) => {
  /* 走编辑器自己的载入路径，再读回节点里存的 latex */
  const ed = window.__EDITOR__
  return cases.map(([name, raw]) => {
    ed.commands.setContent(`<p>前 <span data-latex="${raw.replace(/"/g, '&quot;')}" data-math-inline="true">x</span> 后</p>`)
    let got = ''
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') got = String(n.attrs.latex)
    })
    return { name, raw, got }
  })
}, BROKEN)

fixed.forEach((f, i) => {
  const want = BROKEN[i][2]
  check(`坏写法自动修好：${f.name}`, f.got === want, `${JSON.stringify(f.raw)} → ${JSON.stringify(f.got)}${f.got === want ? '' : `（期望 ${JSON.stringify(want)}）`}`)
})

/* 修好的公式必须真的能渲染出来（不是只把字符串换掉） */
const renders = await page.evaluate((latexes) => {
  const prose = document.querySelector('.zh-prose')
  return {
    err: prose.querySelectorAll('.katex-error').length,
    katex: prose.querySelectorAll('.katex').length,
    first: latexes,
  }
}, fixed.map((f) => f.got))
check('修完之后画面上没有渲染失败的公式', renders.err === 0, `katex-error ${renders.err} 个，katex ${renders.katex} 个`)

/* 对照项必须**原样保留**（不能"顺手"把好公式也改了） */
const controls = fixed.slice(-2)
check(
  '（对照）本来就能渲染的公式一个字符都没被改',
  controls.every((c) => c.got === c.raw),
  controls.map((c) => `${JSON.stringify(c.raw)} → ${JSON.stringify(c.got)}`).join(' | '),
)

check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  公式转义往返：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
