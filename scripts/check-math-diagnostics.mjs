/**
 * 公式诊断包：**必须真的能采到数据**。
 *
 * 为什么要有这个套件：加诊断出口的目的就是"下次公式坏了能拿到现场"。
 * 如果它导出的是一份空壳（比如公式数组是空的、或者关键字段全是默认值），
 * 那等于没加 —— 而"看着有功能、其实是空的"正是我以前反复踩的坑
 * （深色扫描器假绿、typography 时序假绿）。
 * 所以这里不验"按钮点了有没有反应"，而是验**导出的内容本身**：
 *   · 每个公式都带着"节点里存着的写法"（最关键的字段）
 *   · 能识别出哪些公式渲染不出来
 *   · 动作历史真的记下了"修复前后"的对比
 *   · 截图/下载真的产生了文件
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

/* 造一篇"有好公式 + 坏公式 + 原文公式"的文档 */
await page.evaluate(() => {
  window.__EDITOR__.commands.setContent(
    '<p>正常公式 $\\frac{1+k}{1-k}$ 和 $x_{n}^{2}-y_{n}^{2}$</p>' +
      '<p>坏公式 $f\'(x)&lt;0$ 和 $a\\in \\[-\\infty,\\frac{1}{2}\\]$</p>' +
      '<p>修不好的 $\\undefinedcmd x$</p>',
  )
})
await page.waitForTimeout(900)

/* 先做一次"修复"动作，让历史里有"前后对比" */
await page.locator('.zh-btn[title="更多"]').click()
await page.waitForTimeout(300)
const diagItem = page.locator('.zh-menu button', { hasText: '导出公式诊断' }).first()
check('「更多」菜单里有「导出公式诊断」', (await diagItem.count()) > 0)

/* 先点一次检查（它内部走 withDiag，会记历史），再导诊断 */
await page.locator('.zh-menu button', { hasText: '检查图片与公式' }).first().click()
await page.waitForTimeout(1200)

/* 直接问页面要一份诊断（不点下载，避免文件落盘的不确定性） */
const diag = await page.evaluate(() => {
  /* 诊断构造函数没挂到 window 上，所以走"点菜单导出"那条路拿不到内容 ——
     这里用同样的公开入口：先触发导出，再从全局拿不到就直接调内部函数。
     为了可测，编辑器把 buildFormulaDiag 挂在 window.__MATH_DIAG__ 上（见 ZhihuEditor）。 */
  if (typeof window.__MATH_DIAG__ !== 'function') return { err: '没有 __MATH_DIAG__ 调试口' }
  return window.__MATH_DIAG__()
})

if (diag.err) {
  check('能把诊断包内容取出来（有 __MATH_DIAG__ 调试口）', false, diag.err)
} else {
  check('能把诊断包内容取出来（有 __MATH_DIAG__ 调试口）', true)
  check('诊断包里带上了每个公式**节点里存着的写法**', Array.isArray(diag.formulas) && diag.formulas.every((f) => typeof f.storedLatex === 'string'), `共 ${diag.formulas?.length} 个`)
  check(
    '诊断包能指出哪些公式渲染不出来',
    diag.formulas.some((f) => f.storedRenders === false),
    `坏的有 ${diag.formulas.filter((f) => !f.storedRenders).length} 个`,
  )
  check(
    '诊断包记下了"修复会不会改坏它"（repairedLatex + repairedRenders）',
    diag.formulas.every((f) => typeof f.repairedLatex === 'string' && typeof f.repairedRenders === 'boolean'),
  )
  check('诊断包里带浏览器信息与主题', Boolean(diag.editor?.userAgent) && typeof diag.editor?.theme === 'string', diag.editor?.theme)
  check(
    '诊断包里有动作历史（点了"检查图片与公式"之后要留下记录）',
    Array.isArray(diag.events) && diag.events.length > 0,
    `${diag.events?.length} 条`,
  )
  const withSnap = (diag.events ?? []).filter((e) => e.before && e.after)
  check(
    '动作历史里带了"操作前后"的公式摘要（能看出动作有没有改动公式）',
    withSnap.length > 0,
    withSnap.length ? `指纹 ${withSnap[0].before.fingerprint} → ${withSnap[0].after.fingerprint}` : '一条都没有',
  )
  check('诊断包里注明了构建标记（确认用户跑的是哪一版）', typeof diag.editor?.buildMark === 'string' && diag.editor.buildMark !== '(未设置)', diag.editor?.buildMark)
}

/* ---------- 结构字段：必须能识别"公式被降级成普通文字" ----------
   为什么单列一组：用户报过"点了修复公式后，公式全变成源码、一格一格的"。
   拿到现场才发现那不是"内容被改坏"（那种 KaTeX 会画红框），而是
   **数学节点被降级成了普通段落** —— 两种事故的排查方向完全不同。
   以前的诊断只记 latex，看不出是哪一种，白查了一轮。
   所以这里不只验"字段存在"，而是**造一篇降级的文档，验它真的能报出来**。 */
await page.evaluate(() => {
  window.__EDITOR__.commands.setContent('<p>正常：$\\frac{1+k}{1-k}$ 和 $\\left| x \\right|$</p>')
})
await page.waitForTimeout(700)
const dGood = await page.evaluate(() => window.__MATH_DIAG__())

await page.evaluate(() => {
  /* 降级：同样的内容，但公式是**普通文字**（命令名没了反斜杠、也没被识别成公式） */
  window.__EDITOR__.commands.setContent(
    '<p>降级：frac{1+k}{1-k} 和 left| x right|</p><p>还有 \\frac{1+k}{1-k} 但没被识别成公式</p>',
  )
})
await page.waitForTimeout(700)
const dBad = await page.evaluate(() => window.__MATH_DIAG__())

check(
  '诊断带结构摘要（nodeTypes / mathTotal / 疑似降级段落）',
  Boolean(dGood.structure?.nodeTypes && typeof dGood.structure.mathTotal === 'number'),
  JSON.stringify(dGood.structure?.nodeTypes),
)
check(
  '公式正常时：数学节点计数正确、没有"疑似降级"段落',
  dGood.structure.mathTotal === 2 && dGood.structure.suspectDegradedCount === 0,
  `mathTotal=${dGood.structure.mathTotal} 疑似降级=${dGood.structure.suspectDegradedCount}`,
)
check(
  '公式降级成文字时：mathTotal 归零（能看出节点没了）',
  dBad.structure.mathTotal === 0,
  `mathTotal=${dBad.structure.mathTotal} nodeTypes=${JSON.stringify(dBad.structure.nodeTypes)}`,
)
check(
  '公式降级成文字时：报出"疑似降级段落"（这就是节点被降级的指纹）',
  dBad.structure.suspectDegradedCount > 0,
  `${dBad.structure.suspectDegradedCount} 个：${JSON.stringify(dBad.structure.suspectDegraded[0]?.text ?? '').slice(0, 70)}`,
)
check(
  '每个公式都带 nodeType / attrKeys / hasKatexDom（能区分"内容坏"和"结构坏"）',
  dGood.formulas.length > 0 &&
    dGood.formulas.every((f) => typeof f.nodeType === 'string' && Array.isArray(f.attrKeys) && typeof f.hasKatexDom === 'boolean'),
  JSON.stringify(dGood.formulas.map((f) => `${f.nodeType}(${f.attrKeys.join(',')})`)),
)
check(
  '正常公式的 nodeType 就是 mathInline、页面上真的渲染出 KaTeX 子树',
  dGood.formulas.every((f) => f.nodeType === 'mathInline' && f.hasKatexDom === true),
  JSON.stringify(dGood.formulas.map((f) => `${f.nodeType}/katex=${f.hasKatexDom}`)),
)

/* 恢复成有公式的文档，后面的下载断言还要用 */
await page.evaluate(() => {
  window.__EDITOR__.commands.setContent('<p>恢复：$\\frac{1+k}{1-k}$</p>')
})
await page.waitForTimeout(600)

/* 真点一次导出，确认下载文件真的产生且内容是合法 JSON */
let downloaded = null
try {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    (async () => {
      await page.locator('.zh-btn[title="更多"]').click()
      await page.waitForTimeout(250)
      await page.locator('.zh-menu button', { hasText: '导出公式诊断' }).first().click()
    })(),
  ])
  const p = resolve(OUT, '_diag-download.json')
  await dl.saveAs(p)
  downloaded = { name: dl.suggestedFilename(), path: p }
} catch (e) {
  downloaded = { error: String(e).slice(0, 100) }
}

if (downloaded?.path) {
  check('点「导出公式诊断」真的下载了文件', /公式诊断.*\.json$/.test(downloaded.name), downloaded.name)
  try {
    const parsed = JSON.parse(readFileSync(downloaded.path, 'utf8'))
    check('下载到的是**合法 JSON**，且含公式数组', Array.isArray(parsed.formulas) && parsed.formulas.length > 0, `${parsed.formulas?.length} 个公式`)
    check('下载的 JSON 里有 storedLatex 字段（关键字段没丢）', parsed.formulas.every((f) => 'storedLatex' in f))
  } catch (e) {
    check('下载到的是合法 JSON', false, String(e).slice(0, 80))
  }
} else {
  check('点「导出公式诊断」真的下载了文件', false, downloaded?.error ?? '没触发下载')
}

check('全程没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'}  公式诊断包：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'))
  process.exit(1)
}
