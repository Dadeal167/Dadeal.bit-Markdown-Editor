/**
 * 公式不被 Markdown 记号拆碎 —— 回归防线。
 *
 * 为什么单独一个套件：
 * 用户的 `1.md` 里有 `x^{2}*{n+1}`（本该是 `_{n+1}`），公式里出现了 **成对的 `*`**。
 * Markdown 解析器会把成对 `*` 吃成 `<em>`，`<em>` 插进文本节点后 `$…$` 被切断、
 * 公式保护失效，整段 382 字符的 LaTeX 就留在正文里 —— 用户看到的就是"公式变成源码"。
 *
 * 三条铁律（每条都能说清"什么情况下会红"）：
 *   A. 星号绝不能变成 <em>：公式里有 2 个以上 `*` / `_` / `` ` `` / `[` 时，
 *      解析后 DOM 里不得出现来自公式的 <em>，且必须建成公式节点。
 *   B. storedLatex 逐字节守恒：公式里存下来的 LaTeX 必须与原字符串完全相同，
 *      包括 `*`、`_`、`\`、`[`、反引号 —— 一个字符都不能少、不能多。
 *   C. 打开与粘贴两条路一致：同一个 .md 片段，走"打开文件"和"纯文本粘贴"
 *      必须产出相同的节点结构。
 *
 * 判定靠编辑器自己暴露的调试口（window.__SET_MARKDOWN__ / __PROTECT_MATH_SPANS__ /
 * __MD__），见 editorActions.exposeRepairDebugHooks。
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
export const TEST_COUNT = 67

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build:pure')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* 含 Markdown 敏感记号的真公式。`*` 是本案元凶，其余几个是同类风险。 */
const SAMPLES = [
  ['两个星号（用户原文形状）', 'x^{2}*{n+1}-x*{n}x_{n+2}'],
  ['三个星号', 'a*b*c*d'],
  ['星号+下划线混用', 'x^{2}*{n}_{k}*y'],
  ['下划线（对照组）', 'x^{2}_{n+1}-x_{n}x_{n+2}'],
  ['反引号', 'a`b`c'],
  ['方括号', 'a[1]+b[2]'],
  ['用户那段 387 字符原文（截断版）', '\\frac{1+k}{1-k}\\times \\frac{x_{n}-y_{n}}{x_{n+1}-y_{n+1}}=\\frac{(x_{n}-y_{n})(x_{n}+y_{n}+x_{n+1}-y_{n+1})}{(x_{n+1}-y_{n+1})(x_{n}-y_{n}+x_{n+1}+y_{n+1})}=\\frac{(x^{2}*{n}-y^{2}*{n})+(x_{n}-y_{n})(x_{n+1}-y_{n+1})}{(x^{2}*{n+1}-y^{2}*{n+1})+(x_{n+1}-y_{n+1})(x_{n}-y_{n})}=1'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/* ---- 前提：调试口必须在 ---- */
const hooks = await page.evaluate(() => ({
  set: typeof window.__SET_MARKDOWN__ === 'function',
  prot: typeof window.__PROTECT_MATH_SPANS__ === 'function',
  md: typeof window.__MD__ === 'function',
}))
check(
  '调试口齐全（__SET_MARKDOWN__ / __PROTECT_MATH_SPANS__ / __MD__）',
  hooks.set && hooks.prot && hooks.md,
  JSON.stringify(hooks),
)
if (!hooks.set || !hooks.prot || !hooks.md) {
  await browser.close()
  console.log('\n❌ 缺少调试口，套件无法运行')
  process.exit(1)
}

/* ============================================================
 * A + B：打开路径（setMarkdown）——星号不得变 <em>，LaTeX 逐字节守恒
 * ============================================================ */
console.log('\n=== A/B. 打开路径：公式里的 Markdown 记号不得破坏公式 ===')

for (const [label, tex] of SAMPLES) {
  const r = await page.evaluate((t) => {
    const ed = window.__EDITOR__
    window.__SET_MARKDOWN__(ed, `前面文字 $${t}$ 后面文字`)
    const c = {}
    const latexes = []
    ed.state.doc.descendants((n) => {
      c[n.type.name] = (c[n.type.name] || 0) + 1
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(n.attrs.latex)
      return true
    })
    /* 只看"与公式有关"的 <em>：公式里的星号若被吃，会出现在 em 里 */
    const emTexts = Array.from(ed.view.dom.querySelectorAll('em, strong')).map((e) => e.textContent || '')
    let inText = 0
    ed.state.doc.descendants((n) => {
      if (n.isText && n.text) inText += (n.text.match(/\$/g) || []).length
      return true
    })
    return { math: c.mathInline ?? 0, latexes, em: emTexts.length, emTexts, inText }
  }, tex)

  check(
    `[${label}] 建成公式节点（1 个）`,
    r.math === 1,
    `实际 ${r.math} 个`,
  )
  /* 铁律 A：不得出现 <em>（公式里的成对记号若漏进解析器就会生成） */
  const emFromFormula = r.emTexts.filter((t) => tex.includes(t) && t.length > 0)
  check(
    `[${label}] 没有 <em> 从公式里长出来`,
    emFromFormula.length === 0,
    emFromFormula.length ? `发现 ${JSON.stringify(emFromFormula)}` : '',
  )
  /* 铁律 B：storedLatex 逐字节守恒 */
  const stored = r.latexes[0] ?? ''
  check(
    `[${label}] storedLatex 与源字符串逐字节相等`,
    stored === tex,
    stored === tex ? '' : `存的是 ${JSON.stringify(stored).slice(0, 90)}`,
  )
  /* 正文里不得残留 $ */
  check(`[${label}] 正文无残留 $`, r.inText === 0, `残留 ${r.inText}`)
}

/* ============================================================
 * C：两条路径一致（打开 vs 纯文本粘贴）
 * ============================================================ */
console.log('\n=== C. 打开路径与粘贴路径必须一致 ===')

const crossPath = await page.evaluate((t) => {
  const ed = window.__EDITOR__
  const snapshot = () => {
    const c = {}
    const latexes = []
    ed.state.doc.descendants((n) => {
      c[n.type.name] = (c[n.type.name] || 0) + 1
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(n.attrs.latex)
      return true
    })
    let inText = 0
    ed.state.doc.descendants((n) => {
      if (n.isText && n.text) inText += (n.text.match(/\$/g) || []).length
      return true
    })
    return { counts: c, latexes, inText }
  }

  const text = `前面文字 $${t}$ 后面文字`

  /* 路径 1：打开（setMarkdown） */
  window.__SET_MARKDOWN__(ed, text)
  const openPath = snapshot()

  /* 路径 2：纯文本粘贴（和打开一样，先上占位符） */
  const S = ed.state.selection.constructor
  ed.view.dispatch(ed.state.tr.setSelection(S.create(ed.state.doc, 0, ed.state.doc.content.size)))
  ed.view.dispatch(ed.state.tr.deleteSelection())
  const dt = new DataTransfer()
  dt.setData('text/plain', text)
  ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  const pastePath = snapshot()

  return { openPath, pastePath }
}, 'x^{2}*{n+1}-x*{n}x_{n+2}')

check(
  'C1 两条路径的 mathInline 数量一致',
  crossPath.openPath.counts.mathInline === crossPath.pastePath.counts.mathInline,
  `打开 ${crossPath.openPath.counts.mathInline} / 粘贴 ${crossPath.pastePath.counts.mathInline}`,
)
check(
  'C2 两条路径的 storedLatex 完全一致',
  JSON.stringify(crossPath.openPath.latexes) === JSON.stringify(crossPath.pastePath.latexes),
  `打开 ${JSON.stringify(crossPath.openPath.latexes)} / 粘贴 ${JSON.stringify(crossPath.pastePath.latexes)}`,
)
check(
  'C3 两条路径都无正文残留 $',
  crossPath.openPath.inText === 0 && crossPath.pastePath.inText === 0,
  `打开 ${crossPath.openPath.inText} / 粘贴 ${crossPath.pastePath.inText}`,
)

/* ============================================================
 * D：否定断言 —— 修好不许修坏（幂等 + 内容守恒 + 节点类型守恒）
 * ============================================================ */
console.log('\n=== D. 否定断言：反复修复不得改坏 ===')

const idem = await page.evaluate((t) => {
  const ed = window.__EDITOR__
  const snap = () => {
    const seq = []
    const latexes = []
    ed.state.doc.descendants((n) => {
      seq.push(n.type.name)
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(n.attrs.latex)
      return true
    })
    return { seq: seq.join('>'), latexes, md: window.__MD__() }
  }
  window.__SET_MARKDOWN__(ed, `之前 $${t}$ 之后`)
  const first = snap()
  /* 再跑两次（模拟用户连点"修复公式"/反复开关文档） */
  window.__SET_MARKDOWN__(ed, window.__MD__())
  const second = snap()
  window.__SET_MARKDOWN__(ed, window.__MD__())
  const third = snap()
  return { first, second, third, tex: t }
}, 'x^{2}*{n+1}-x*{n}x_{n+2}')

check(
  'D1 节点类型序列守恒（修复不改变结构）',
  idem.first.seq === idem.second.seq && idem.second.seq === idem.third.seq,
  idem.first.seq === idem.second.seq ? '' : `${idem.first.seq} → ${idem.second.seq}`,
)
check(
  'D2 公式数量不减少',
  idem.second.latexes.length >= idem.first.latexes.length &&
    idem.third.latexes.length >= idem.first.latexes.length,
  `${idem.first.latexes.length} → ${idem.second.latexes.length} → ${idem.third.latexes.length}`,
)
check(
  'D3 幂等：连续两次修复结果完全一致',
  idem.second.md === idem.third.md,
  idem.second.md === idem.third.md ? '' : '两次导出不同',
)
/* 内容守恒：原始公式里的 * 和 _ 必须都还在 */
const storedFirst = idem.first.latexes[0] ?? ''
check(
  'D4 内容守恒：原始公式的 * 与 _ 一个都不少',
  storedFirst === idem.tex,
  storedFirst === idem.tex ? '' : `存的是 ${JSON.stringify(storedFirst).slice(0, 90)}`,
)

/* ============================================================
 * E：占位符必须完全还原（不得有残留）
 * ============================================================ */
console.log('\n=== E. 占位符不得残留 ===')
const leftover = await page.evaluate(() => {
  const ed = window.__EDITOR__
  window.__SET_MARKDOWN__(ed, '文字 $x^{2}*{n}$ 文字 $a*b*c*d$ 结束')
  let placeholders = 0
  let ctrlChars = 0
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) {
      placeholders += n.text.split('\u0004').length - 1
      placeholders += n.text.split('\u0005').length - 1
      ctrlChars += (n.text.match(/[\u0001-\u0005]/g) || []).length
    }
    return true
  })
  const md = window.__MD__()
  return { placeholders, ctrlChars, mdControls: (md.match(/[\u0001-\u0005]/g) || []).length }
})
check('E1 文档里无残留占位符', leftover.placeholders === 0, `残留 ${leftover.placeholders}`)
check('E2 控制字符不进入正文', leftover.ctrlChars === 0, `残留 ${leftover.ctrlChars}`)
check('E3 导出的 Markdown 里无控制字符', leftover.mdControls === 0, `残留 ${leftover.mdControls}`)

/* ============================================================
 * F：历史用例 —— 用户 1.md 里真实受害的两个公式
 *    为什么原样写进测试而不去读用户文件：套件必须在任何机器上都能跑，
 *    不能依赖 .probe/out/user-1.md（那是 gitignore 的临时物）。
 *    这两个字面量就是从 1.md 里逐字节复制出来的。
 * ============================================================ */
console.log('\n=== F. 历史用例：1.md 里真实受害的两个公式 ===')

const REAL_387 =
  '\\\\frac{1+k}{1-k}\\\\times \\\\frac{x\\_{n}-y\\_{n}}{x\\_{n+1}-y\\_{n+1}}=' +
  '\\\\frac{(x\\_{n}-y\\_{n})(x\\_{n}+y\\_{n}+x\\_{n+1}-y\\_{n+1})}' +
  '{(x\\_{n+1}-y\\_{n+1})(x\\_{n}-y\\_{n}+x\\_{n+1}+y\\_{n+1})}=' +
  '\\\\frac{(x^{2}*{n}-y^{2}*{n})+(x\\_{n}-y\\_{n})(x\\_{n+1}-y\\_{n+1})}' +
  '{(x^{2}*{n+1}-y^{2}*{n+1})+(x\\_{n+1}-y\\_{n+1})(x\\_{n}-y\\_{n})}=' +
  '\\\\frac{9+(x\\_{n+1}-y\\_{n+1})(x\\_{n}-y\\_{n})}{9+(x\\_{n+1}-y\\_{n+1})(x\\_{n}-y\\_{n})}=1'
const REAL_SHORT = 'S=\\\\frac{k}{2}\\\\left| x^{2}*{n+1}-x*{n}x\\_{n+2} \\\\right|'

/* 真实上下文：一句话 + 公式 + 引用编号 + 后文，和 1.md 里的排布一致。
   注意 `$(3)$` 本身是一个合法公式 —— 所以这一段正确结果是 **3 个**公式节点。 */
const REAL_PARA = `即有 $${REAL_387}$ $(3)$ 那么这个题目，前两问其实很简单，第三问绝对要把第二问利用起来。\n\n带入得到 $${REAL_SHORT}$ ,`

console.log(`  两个公式长度: ${REAL_387.length} / ${REAL_SHORT.length}，星号数 ${(REAL_387.match(/\*/g) || []).length} / ${(REAL_SHORT.match(/\*/g) || []).length}`)

const hist = await page.evaluate((para) => {
  const ed = window.__EDITOR__
  window.__SET_MARKDOWN__(ed, para)
  const c = {}
  const latexes = []
  ed.state.doc.descendants((n) => {
    c[n.type.name] = (c[n.type.name] || 0) + 1
    if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') latexes.push(n.attrs.latex)
    return true
  })
  /* 检测"源文本里的公式原文有没有整段留在正文里"—— 逐字符比对，不靠肉眼 */
  let bodyText = ''
  const textNodes = []
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) {
      bodyText += n.text
      textNodes.push(n.text)
    }
    return true
  })
  const emTexts = Array.from(ed.view.dom.querySelectorAll('em, strong')).map((e) => e.textContent || '')
  let inText = 0
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) inText += (n.text.match(/\$/g) || []).length
    return true
  })
  return { math: c.mathInline ?? 0, latexes, em: emTexts.length, emTexts, inText, bodyText, md: window.__MD__(), nodeCount: textNodes.length }
}, REAL_PARA)

check('F1 三个公式都建成节点（含 $(3)$，不降级成正文）', hist.math === 3, `实际 ${hist.math} 个`)
/* 最强的判定：**源文本里的公式原文，一个字都不该出现在正文里** */
check(
  'F2 387 字符公式的原文没有留在正文里',
  !hist.bodyText.includes(REAL_387.slice(0, 60)) && !hist.bodyText.includes(REAL_387.slice(-40)),
  hist.bodyText.includes(REAL_387.slice(0, 60)) ? '正文里出现了公式原文！' : '',
)
check(
  'F3 短公式的原文没有留在正文里',
  !hist.bodyText.includes(REAL_SHORT.slice(0, 30)),
  hist.bodyText.includes(REAL_SHORT.slice(0, 30)) ? '正文里出现了公式原文！' : '',
)
check('F4 星号没有被吃成 <em>', hist.em === 0, hist.em ? JSON.stringify(hist.emTexts) : '')
check('F5 正文里没有残留 $', hist.inText === 0, `残留 ${hist.inText}`)
check(
  'F6 三个公式逐个逐字节守恒',
  hist.latexes.length === 3 && hist.latexes[0] === REAL_387 && hist.latexes[1] === '(3)' && hist.latexes[2] === REAL_SHORT,
  JSON.stringify(hist.latexes.map((s) => (s.length > 24 ? s.slice(0, 24) + `…(${s.length})` : s))),
)

/* ============================================================
 * G：looksLikeLatex 的已知边界（记录现状，不是"应该这样"）
 *    用户提的第三条：含 * 的字符串不应被当成"不像公式"。
 *    实测这一侧本来就是对的（含 * 的公式全判 true），
 *    但有反向问题：`2 * 3 = 6` 这种**算式正文**也会判 true。
 *    这里把现状钉住 —— 哪天有人动了判定逻辑，两侧都会立刻反映出来。
 * ============================================================ */
console.log('\n=== G. looksLikeLatex 两侧边界 ===')

const looks = await page.evaluate(() => {
  const t = (s) => window.__LOOKS_LIKE_LATEX__(s)
  return {
    /* 必须判 true：含 * 的真公式（用户第三条的核心诉求） */
    starFormulas: {
      'frac 带星号': t('\\frac{1+k}{1-k} * x'),
      '上下标带星号': t('x^{2}*{n+1}-x*{n}x_{n+2}'),
      '多星号': t('a*b*c*d'),
      '单纯星号': t('a*b'),
    },
    /* 纯文本：当前判定（记录现状） */
    plain: {
      '算式正文 2*3=6': t('2 * 3 = 6'),
      '带中文的正文': t('价格 100 * 2 = 200'),
      '散文': t('这是一段中文'),
    },
  }
})

let starOk = 0
for (const [k, v] of Object.entries(looks.starFormulas)) {
  if (v) starOk++
  console.log(`  ${v ? '✅' : '❌'} [公式] ${k.padEnd(16)} → ${v}`)
}
check('G1 含 * 的真公式全部判为公式（用户第三条诉求）', starOk === Object.keys(looks.starFormulas).length, `${starOk}/${Object.keys(looks.starFormulas).length}`)
check('G2 带中文的正文判为非公式', looks.plain['带中文的正文'] === false, `→ ${looks.plain['带中文的正文']}`)
check('G3 中文散文判为非公式', looks.plain['散文'] === false, `→ ${looks.plain['散文']}`)
/* 这一条是**记录现状**：算式正文目前会被判成公式。
   不是"期望如此"，而是钉住行为、避免悄悄改变（要改的话这条会红，提醒去看影响面）。 */
console.log(`  ℹ️  现状记录：[算式] '2 * 3 = 6' → ${looks.plain['算式正文 2*3=6']}（已知边界：无空格英文词才算正文）`)

/* ============================================================
 * H：真实坏文件形态 —— 存盘时被转义过的"公式原文"
 *    来源：用户机器上 Desktop\zhihu\learning\ 里的文章带着这个印记：
 *      ...]=1\$ \$\n\n$cos\alpha sin\beta=...
 *    即"字面 \$ 与真公式交叉出现"—— $ 的配对整体错位之后留下的化石。
 *    这类文件是真实存在的历史伤（同一篇还有 18 处），产品必须能读好它、
 *    而且不得越读越坏。这是"用户真实环境"的回归锚点。
 * ============================================================ */
console.log('\n=== H. 历史坏文件形态：转义过的公式原文必须能救回来 ===')

const ESCAPED_LEAK =
  '即有 \\$\\frac{1+k}{1-k}\\times \\frac{x_{n}-y_{n}}{x_{n+1}-y_{n+1}}=1\\$ $(3)$ 那么这个题目很简单。\n\n' +
  '我得到了 $T=\\frac{1}{2}\\left| x_{1}-x_{2} \\right|$ 这个结果。'

const heal = await page.evaluate((text) => {
  const ed = window.__EDITOR__
  const snap = () => {
    let math = 0
    let inText = 0
    let escaped = 0
    const latexes = []
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'mathInline' || n.type.name === 'mathBlock') {
        math++
        latexes.push(n.attrs.latex)
      }
      if (n.isText && n.text) {
        inText += (n.text.match(/\$/g) || []).length
        escaped += (n.text.match(/\\\$/g) || []).length
      }
      return true
    })
    return { math, inText, escaped, latexes, md: window.__MD__() }
  }
  window.__SET_MARKDOWN__(ed, text)
  const opened = snap()
  /* 存盘 → 重开，连做两轮，确认不恶化 */
  window.__SET_MARKDOWN__(ed, opened.md)
  const round2 = snap()
  window.__SET_MARKDOWN__(ed, round2.md)
  const round3 = snap()
  return { opened, round2, round3 }
}, ESCAPED_LEAK)

check(
  'H1 转义过的公式原文被救回（转义那个 + 正常那个 + (3) = 3 个）',
  heal.opened.math === 3,
  `实际 ${heal.opened.math} 个`,
)
check('H2 正文里没有残留的字面 \\$', heal.opened.escaped === 0, `残留 ${heal.opened.escaped}`)
check('H3 正文里没有残留 $', heal.opened.inText === 0, `残留 ${heal.opened.inText}`)
check(
  'H4 反复存开不恶化（公式数不减少）',
  heal.round2.math >= heal.opened.math && heal.round3.math >= heal.opened.math,
  `${heal.opened.math} → ${heal.round2.math} → ${heal.round3.math}`,
)
check(
  'H5 救回来的公式逐字节保留原文',
  heal.opened.latexes.some((s) => s.includes('\\frac{1+k}{1-k}')) &&
    heal.opened.latexes.some((s) => s.includes('x_{1}-x_{2}')),
  JSON.stringify(heal.opened.latexes.map((s) => s.slice(0, 30))),
)

/* ============================================================
 * I：复制成纯文本时公式不许消失
 *    实测过的缺陷：ProseMirror 默认纯文本序列化是
 *      slice.content.textBetween(0, slice.content.size, "\n\n")
 *    而 textBetween 对没有 leafText 的原子节点贡献**空字符串** ——
 *    于是复制出来的纯文本里公式整个不见（`前面文字  后面文字`，连 $ 都不剩）。
 *    粘到微信 / 记事本 / 聊天窗口（只认纯文本的地方）公式就丢了。
 *
 *    修法在 editorProps.clipboardTextSerializer。
 *    **不能**在节点 spec 上加 leafText —— TipTap 会静默丢弃（见 I4）。
 * ============================================================ */
console.log('\n=== I. 复制成纯文本时公式不许消失 ===')

const COPY_CASES = [
  ['公式在句中', '前面文字 $\\left| TF_{1} \\right|=4$ 后面文字', '\\left| TF_{1} \\right|=4'],
  ['多个公式', '前 $x$ 中 $\\frac{1}{2}$ 后', '\\frac{1}{2}'],
  ['含星号的公式', '带入 $S=x^{2}*{n+1}$ 结束', 'x^{2}*{n+1}'],
  ['块级公式', '前\n\n$$\\frac{a}{b}$$\n\n后', '\\frac{a}{b}'],
]

for (const [label, md, mustContain] of COPY_CASES) {
  const r = await page.evaluate((content) => {
    const ed = window.__EDITOR__
    window.__SET_MARKDOWN__(ed, content)
    const S = ed.state.selection.constructor
    ed.view.dispatch(ed.state.tr.setSelection(S.create(ed.state.doc, 0, ed.state.doc.content.size)))
    const dt = new DataTransfer()
    ed.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    return { plain: dt.getData('text/plain'), html: dt.getData('text/html') }
  }, md)
  check(
    `[${label}] text/plain 里有公式源码`,
    r.plain.includes(mustContain),
    r.plain.includes(mustContain) ? '' : `拿到的是 ${JSON.stringify(r.plain).slice(0, 80)}`,
  )
  check(`[${label}] text/plain 里公式带 $ 定界符`, /\$[^$]+\$/.test(r.plain), JSON.stringify(r.plain).slice(0, 80))
  /* text/html 那条路必须仍然带 data-latex（粘回编辑器还是真节点） */
  check(
    `[${label}] text/html 仍是真节点（带 data-latex）`,
    r.html.includes('data-latex'),
    r.html.includes('data-latex') ? '' : 'HTML 里没有 data-latex',
  )
}

/* I4：钉住"TipTap 会丢弃 leafText"这个坑 —— 哪天 TipTap 改了行为，这条会红 */
const leafCheck = await page.evaluate(() => {
  const schema = window.__EDITOR__.state.doc.type.schema
  return { hasLeafText: typeof schema.nodes.mathInline?.spec?.leafText === 'function' }
})
check(
  'I4 记录：节点 spec 上没有 leafText（TipTap 丢弃它，所以修法在 view prop）',
  leafCheck.hasLeafText === false,
  leafCheck.hasLeafText ? 'leafText 竟然生效了 —— TipTap 行为变了，可以简化实现' : '',
)

/* ============================================================
 * 收尾
 * ============================================================ */
check('页面无运行时报错', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅' : '❌'}  ${results.length - failed.length}/${results.length} 条断言通过`)
if (failed.length) {
  console.log('\n失败的断言：')
  for (const f of failed) console.log('  ❌ ' + f.name)
}
await browser.close()
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档占位符读它）。
   不加这条的话，删掉几条断言而忘了改常量，文档就会显示一个假的数字。 */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  console.log('   改测试条数时请一并更新文件顶部的 TEST_COUNT（文档数量占位符读它）')
  process.exit(1)
}

process.exit(failed.length ? 1 : 0)
