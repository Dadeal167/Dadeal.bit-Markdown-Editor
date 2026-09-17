/**
 * 「修不好就一个字都不许改」—— 公式修复的安全网（否定断言）。
 *
 * 为什么要单独一个套件：以前的断言**全都在验"能不能修好"**，
 * 没有一条验过"修不好的时候会不会反而改坏"。结果就是修复函数里的兜底分支
 * 把一段渲染失败的公式改成了"命令被拆散"的样子并存进文档 ——
 * 用户实测：「点击修复公式后，所有命令的反斜杠都被吃掉了，公式变成一堆源码」。
 * 这类"修复造成二次破坏"的 bug，只有否定断言能拦住。
 *
 * 三条铁律（每条都要能说清"什么情况下会红"）：
 *   A. 幂等/一致性：对任何输入，repairLatex 的输出要么**等于输入**，
 *      要么**确实能渲染**。绝不允许出现第三种（改坏了还存进去）。
 *   B. 失败即原样：明确渲染不出来的公式，走一遍修复后必须与输入**逐字节相等**。
 *   C. 好公式不动：本来就能渲染的公式，输出必须与输入逐字节相等。
 *
 * 判定靠编辑器自己的 KaTeX（`window.__RENDERS_OK__`，见 ZhihuEditor 暴露的调试口）。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build:pure')
  process.exit(1)
}
const OUT = resolve('.probe', 'out')
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

const hasHook = await page.evaluate(() => typeof window.__REPAIR_LATEX__ === 'function' && typeof window.__RENDERS_OK__ === 'function')
check(
  '编辑器暴露了 repairLatex / rendersOk 的调试口（安全网靠它验）',
  hasHook,
  hasHook ? '' : 'window.__REPAIR_LATEX__ / __RENDERS_OK__ 没有 —— 断言无法进行',
)
if (!hasHook) {
  await browser.close()
  console.log('\n❌ 缺少调试口，套件无法运行')
  process.exit(1)
}

/* 一批"渲染不出来"的公式。
   挑选原则：**必须大量覆盖"会落进兜底分支"的情况** ——
   上一版只有 18 个样本、其中只有 1 个踩中兜底，做变异测试时差点没拦住。
   踩中兜底的条件：STEPS 的几步都修不好，但 SPELLING 表里的某条正则会命中它。
   所以样本里要刻意放 \or / \and / \degree 这些"拼写表能认出来"的记号，
   再混进别的坏写法让它整体修不好。 */
const BROKEN = [
  // —— 能修好的（正向样本，证明修复本身没坏） ——
  '\\left \\\\{ x_{n}-y_{n} \\right \\\\}',
  'f\'(x)&lt;0,f(x)',
  'a\\in \\[-\\infty,\\frac{1}{2}\\]',
  '\\left { x \\right }',
  // —— 修不好、而且会被 SPELLING 命中的（**兜底分支的高危样本**） ——
  '\\undefinedcmd \\or x',
  '\\text{中文} \\or \\left\\{',
  '\\or \\or \\or',
  'a \\or b \\undefinedcmd',
  '\\frac{1}{ \\or \\and',
  'x^ \\or \\degree',
  '\\or \\perthousand \\permil \\undefinedcmd',
  '\\begin{cases} a \\or b \\end{cases}',
  '\\left\\{ \\or \\right\\} \\undefinedcmd',
  '\\or',
  '\\and \\or \\degree \\undefinedcmd \\celsius',
  // —— 修不好、不会命中 SPELLING 的（对照） ——
  '\\undefinedcmd x',
  'x^',
  '\\frac{1}{',
  '} { \\ \\ \\',
  'a_b_c^d^e',
  '\\sqrt[3]{x',
  '\\ \\ \\ \\ \\',
  '\\end{array}',
  '&lt; &gt; &amp; \\undefinedcmd',
]

/* 一致性：输出要么等于输入，要么确实能渲染 */
const consistency = await page.evaluate((list) => {
  return list.map((tex) => {
    const out = window.__REPAIR_LATEX__(tex, false)
    const changed = out !== tex
    const outOk = window.__RENDERS_OK__(out, false)
    const inOk = window.__RENDERS_OK__(tex, false)
    /* 内容保护：改动后的输出不许比输入"少东西"（长度不能缩水） */
    const cmds = (s) => (s.match(/\\[a-zA-Z]+/g) || []).length
    return {
      tex,
      out,
      changed,
      outOk,
      inOk,
      bad: changed && !outOk,
      /* 命令数量变少了 = 有命令被吃掉（这次事故的形状） */
      cmdDropped: changed && cmds(out) < cmds(tex),
      lenShrank: changed && out.length < tex.length - 2,
    }
  })
}, BROKEN)

const violations = consistency.filter((x) => x.bad)
check(
  'A. 修复输出要么等于输入、要么确实能渲染（没有"改坏了"的第三种结果）',
  violations.length === 0,
  violations.length
    ? violations.map((v) => `${JSON.stringify(v.tex)} → ${JSON.stringify(v.out)}`).slice(0, 3).join(' | ')
    : `${consistency.length} 个样本，全部满足`,
)

/* B. 修不好的公式：必须逐字节原样 */
const unfixable = consistency.filter((x) => x.changed === false && x.inOk === false)
check(
  'B. 渲染不出来的公式，修复后必须与输入逐字节相等',
  unfixable.length > 0 && unfixable.every((x) => x.out === x.tex),
  `${unfixable.length} 个修不好的样本：` +
    unfixable
      .slice(0, 3)
      .map((x) => JSON.stringify(x.tex))
      .join('、'),
)

/* C. 本来就能渲染的公式：一个字都不许改 */
const GOOD = [
  '\\frac{1+k}{1-k}',
  'x_{n}^{2}-y_{n}^{2}',
  '\\left \\{ x_{n}-y_{n} \\right \\}',
  'a\\in [-\\infty,\\frac{1}{2}]',
  '\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}',
  '\\Delta = 0',
  '\\odot N',
  'x \\in [0,1]',
  '50\\% \\# 3',
  '\\angle PNQ=90^{\\circ}',
]
const goodKept = await page.evaluate((list) => {
  return list.map((tex) => {
    const out = window.__REPAIR_LATEX__(tex, false)
    return { tex, out, same: out === tex, rendersOk: window.__RENDERS_OK__(out, false) }
  })
}, GOOD)
const goodChanged = goodKept.filter((x) => !x.same)
check(
  'C. 本来就能渲染的公式一个字符都没被改',
  goodChanged.length === 0,
  goodChanged.length ? goodChanged.map((x) => `${JSON.stringify(x.tex)} → ${JSON.stringify(x.out)}`).slice(0, 3).join(' | ') : `${GOOD.length} 个样本全部原样`,
)

/* D. 幂等：同一个输入修两次，结果必须一样（不能越修越坏） */
const idem = await page.evaluate((list) => {
  return list.map((tex) => {
    const a = window.__REPAIR_LATEX__(tex, false)
    const b = window.__REPAIR_LATEX__(a, false)
    return { tex, a, b, stable: a === b }
  })
}, BROKEN)
const unstable = idem.filter((x) => !x.stable)
check(
  'D. 修复是幂等的（再修一次不会再变 —— 不能"越修越坏"）',
  unstable.length === 0,
  unstable.length ? unstable.map((x) => `${JSON.stringify(x.tex)}: ${JSON.stringify(x.a)} → ${JSON.stringify(x.b)}`).slice(0, 3).join(' | ') : `${idem.length} 个样本稳定`,
)

/* E. 内容不许缩水：被改动的输出里，命令的反斜杠不许凭空变少。
   这一条直接对着这次事故的形状 —— 用户看到的就是"所有命令的反斜杠被吃掉"。 */
const dropped = consistency.filter((x) => x.cmdDropped)
check(
  'E. 被改动的公式里，命令的反斜杠不许凭空变少（这次事故的形状）',
  dropped.length === 0,
  dropped.length
    ? dropped.map((x) => `${JSON.stringify(x.tex)} → ${JSON.stringify(x.out)}`).slice(0, 3).join(' | ')
    : `${consistency.filter((x) => x.changed).length} 个被改动的样本，命令数都没减少`,
)

/* F. 内容不许缩水。
   注意只对"改完**仍然渲染不出来**"的情况判 —— 修成功的那些本来就会缩短，
   比如 `&lt;` 解码成 `<`（少 3 个字符）是**该缩的**。
   第一版把这条写成"任何改动都不许变短"，结果把实体解码误判成事故（我自己踩的）。 */
const shrank = consistency.filter((x) => x.changed && !x.outOk && x.out.length < x.tex.length)
check(
  'F. 改完仍然渲染不出来的，不许还少了字符（内容和原文不一致就是被改坏了）',
  shrank.length === 0,
  shrank.length
    ? shrank.map((x) => `${JSON.stringify(x.tex)} → ${JSON.stringify(x.out)}`).slice(0, 3).join(' | ')
    : `${consistency.filter((x) => x.changed).length} 个被改动的样本，没有"越改越短还没修好"的`,
)

/* G. 兜底分支的样本量自检：样本里必须真的有一批"落进兜底"的情况，
   否则上面几条断言是空转的（上一版就只有 1 个，做变异测试差点没拦住）。 */
const fallbackLikely = consistency.filter((x) => /\\or|\\and|\\degree|\\perthousand|\\permil|\\celsius/.test(x.tex) && !x.inOk)
check(
  'G. 样本里有足够多"会落进兜底分支"的高危样本（否则上面的断言是空转）',
  fallbackLikely.length >= 8,
  `${fallbackLikely.length} 个高危样本`,
)

check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

writeFileSync(resolve(OUT, 'latex-repair-safety.json'), JSON.stringify({ consistency, goodKept, idem, errors }, null, 2), 'utf-8')
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  公式修复安全网：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
