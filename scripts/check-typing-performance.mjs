/**
 * 打字流畅度：**不许每个键都把整篇正文序列化一遍**
 *
 * 为什么要有这一套（用户实测报告）："输入的字多了之后就会出现输入打字卡顿不流畅"，
 * 他那篇只有 1050 字。用 CDP CPU Profiler 打在真产物上逐键剖析
 * （`.probe/profile-typing.mjs`），发现卡不卡和"多少字"关系不大，和"序列化一次有多贵"关系极大：
 *
 *   1050 字（65 个行内公式）      每键 3.4ms    长任务 0 次
 *   1050 字 + 200 公式            每键 24ms     长任务 103 次（最长 152ms）
 *   20000 字（1209 公式）         每键 55ms     长任务 82 次（最长 200ms）
 *   1050 字 + 一张作业照片        每键 336ms    长任务 60 次（最长 636ms），GC 独占 11.1 秒
 *
 * 真凶有两个，都在我们自己这边：
 *   1. `useMarkdownEditor.onUpdate` 每敲一个键就 `getMarkdown()` 整篇序列化一次 ——
 *      可界面真正需要这份字符串的时刻只有三处（自动保存 / 手动保存导出 / 切文档），
 *      而且那三处都是现取，打字过程中的每个中间态纯属白干
 *   2. `mathMarkdown` 的收尾函数逐字符循环 + `new Array(n).fill(false)` 的整篇遮罩表：
 *      2MB 正文每次要建两张 200 万项的 boolean 数组（一张 17MB），每键约 35MB 垃圾
 *
 * 这一套把"改回去就会重新卡"这件事钉住：
 *   A. 函数层：`finalizeMarkdown` 喂一段 2MB 级的大正文，必须在 25ms 内跑完（旧实现要 ≈80ms）
 *   B. 端到端：真产物里载入"1050 字 + 一张照片"，敲 30 个字的墙钟时间与长任务次数
 *   C. 机制层：连敲 20 个字，`__MD_SERIALIZE_COUNT__` 最多只许涨 2（旧实现涨 20）
 *   D. 兜住"攒着不交"带来的新风险：打完字 2 秒后，存储里必须有刚敲进去的内容
 *
 * 反例证明（`mutation:math-markdown` 里两条对应的变异）：
 *   · `onUpdate` 改回"每键都序列化" → C 组变红
 *   · `finalizeMarkdown` 改回逐字符循环 + 整篇遮罩表 → A 组变红
 * 注意 B 组**单独**证明不了机制层：只把序列化改快、却仍然每键交一次，墙钟时间
 * 也可能落在阈值内（实测：单改 onUpdate 时 B 组依然全绿）—— 所以 C 组是必需的。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 收尾处有自检：实际跑出来的断言数必须等于它，免得"测试被删掉几条、常量没跟着改"。
 */
export const TEST_COUNT = 20

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

/** 一段合法 base64 假图片数据（尺寸可控）—— 和 check:indexeddb 用同一招 */
const PNG_UNIT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const bigBase64 = (bytes) => PNG_UNIT.repeat(Math.ceil(bytes / PNG_UNIT.length)).slice(0, bytes)

const readIdb = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('md-editor-docs', 1)
        r.onerror = () => res([])
        r.onsuccess = () => {
          const db = r.result
          const q = db.transaction('docs', 'readonly').objectStore('docs').getAll()
          q.onsuccess = () => {
            const out = (q.result ?? []).map((d) => ({ title: d.title, md: d.md ?? '' }))
            db.close()
            res(out)
          }
          q.onerror = () => {
            db.close()
            res([])
          }
        }
      }),
  )

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/* ============ A. 序列化收尾本体（函数层） ============ */
const hooks = await page.evaluate(() => ({
  finalize: typeof window.__FINALIZE_MARKDOWN__,
  codeMask: typeof window.__CODE_MASK__,
}))
check('调试口在（__FINALIZE_MARKDOWN__ / __CODE_MASK__）', hooks.finalize === 'function' && hooks.codeMask === 'function', JSON.stringify(hooks))

const I = '\u0002' // 行内公式标记
const B = '\u0003' // 块级公式标记
const fin = (md) => page.evaluate((s) => window.__FINALIZE_MARKDOWN__(s), md)

check('行内公式标记还原成 $…$', (await fin(`前面${I}x^{2}+1${I}后面`)) === '前面$x^{2}+1$后面')
check('块级公式标记还原成 $$ 包裹', (await fin(`${B}\\sum i${B}`)) === '$$\n\\sum i\n$$')
check('公式外面的字面 $ 被转义（原价 $100）', (await fin('原价 $100，现价 $60')) === '原价 \\$100，现价 \\$60')
check(
  '围栏代码块里的 $ 不转义',
  (await fin('```\nlet a = "$x$"\n```')) === '```\nlet a = "$x$"\n```',
)
check('行内代码里的 $ 不转义', (await fin('用 `"$x$"` 表示')) === '用 `"$x$"` 表示')
check('硬换行（\\ + 换行）写成两个空格 + 换行', (await fin('第一行\\\n第二行')) === '第一行  \n第二行')
check('已经是 \\\\ 的（用户要显示反斜杠）不碰', (await fin('反斜杠\\\\\n下一行')) === '反斜杠\\\\\n下一行')
check('输出里没有控制字符（标记不泄漏）', !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(await fin(`${I}a${I} 和 ${B}b${B} 和裸${I}一个`)))

/* 大正文：2.4MB（照片内嵌的正文就是这个量级）——这条是"打字卡顿"的正主。
 *
 * 怎么取数、阈值怎么定（踩过一次假红，记下来）：
 *   · **取 7 次里最快的那一次**。只取 1~2 次在机器忙的时候会被拉高 ——
 *     实测同一份 2.4MB 正文：闲时 ≈9ms、忙时（旁边在构建）26.8ms，
 *     原来 25ms 的阈值当场假红。最快的一次代表"这段代码本身的代价"，抖动是外部噪声。
 *   · 阈值 30ms：改之前实测 ≈80ms（逐字符循环 + 两张整篇遮罩表），改之后闲时 ≈9ms，
 *     两边都留余量。中位数一并打出来，方便分辨"真慢"还是"机器忙"。 */
const bigTiming = await page.evaluate(() => {
  const I = '\u0002'
  const B = '\u0003'
  const photo = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='.repeat(26000)
  const head = '# 错题整理\n\n原价 $100 的题，现在 $60。\n\n' + `前面${I}x^{2}-2x+3${I}后面\n\n`.repeat(40)
  const tail = `\n\n![作业照片](${photo})\n\n` + `${B}\\sum_{i=1}^{n} i${B}\n`
  const md = head + tail
  const times = []
  let out1 = ''
  let outLast = ''
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now()
    const r = window.__FINALIZE_MARKDOWN__(md)
    times.push(performance.now() - t0)
    if (i === 0) out1 = r
    outLast = r
  }
  const sorted = [...times].sort((a, b) => a - b)
  return {
    len: md.length,
    ms: +sorted[0].toFixed(2),
    med: +sorted[3].toFixed(2),
    out: out1,
    same: out1 === outLast,
    maskType: Object.prototype.toString.call(window.__CODE_MASK__('a `b` c')),
  }
})
check(
  '2MB 级大正文的收尾够快（旧实现 ≈80ms、新实现闲时 ≈9ms；取 7 次最快的一次）',
  bigTiming.ms < 30,
  `${(bigTiming.len / 1048576).toFixed(1)}MB → 最快 ${bigTiming.ms}ms / 中位 ${bigTiming.med}ms（阈值 30ms）`,
)
check(
  '大正文的结果正确（公式变 $…$、正文 $ 转义、图片原样）',
  bigTiming.out.includes('$x^{2}-2x+3$') &&
    bigTiming.out.includes('原价 \\$100') &&
    bigTiming.out.includes('data:image/png;base64,iVBORw0KGgo') &&
    bigTiming.out.includes('$$\n\\sum_{i=1}^{n} i\n$$') &&
    bigTiming.same,
  `${(bigTiming.out.length / 1048576).toFixed(1)}MB 输出`,
)
check('代码区遮罩是 Uint8Array（不再每键建一张 17MB 的 boolean[]）', bigTiming.maskType === '[object Uint8Array]', bigTiming.maskType)

/* ============ B. 端到端：1050 字 + 一张照片，敲 30 个字 ============ */
const TEXT = '设函数 f(x)=x^2-2x+3，求它在区间上的最小值。因为配方之后顶点横坐标正好落在区间里面，所以最小值就在顶点取到，端点值再比较一次即可。'.repeat(15)
const PHOTO_BYTES = 2 * 1024 * 1024
await page.evaluate(
  ([text, photo]) => {
    const md = `# 二次函数错题整理\n\n${text}\n\n![作业照片](${photo})\n`
    window.__SET_MARKDOWN__(window.__EDITOR__, md)
  },
  [TEXT, 'data:image/png;base64,' + bigBase64(PHOTO_BYTES)],
)
await page.waitForTimeout(1200)
const docInfo = await page.evaluate(() => {
  let chars = 0
  window.__EDITOR__.state.doc.descendants((n) => {
    if (n.isText && n.text) chars += n.text.length
    return true
  })
  return { chars, mdKB: Math.round(window.__MD__().length / 1024) }
})
check('端到端这一档的正文 ≈1050 字 + 一张照片（Markdown 2MB 级）', docInfo.chars >= 900 && docInfo.mdKB > 1500, `${docInfo.chars} 字 / Markdown ${docInfo.mdKB}KB`)

await page.evaluate(() => {
  window.__PERF__ = { longtasks: [] }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__PERF__.longtasks.push(+e.duration.toFixed(1))
    }).observe({ type: 'longtask', buffered: false })
  } catch {
    /* 不支持就算了 */
  }
})
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.waitForTimeout(300)

const MARK = '持久化标记一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'
const t0 = Date.now()
await page.keyboard.type(MARK, { delay: 0 })
const typeMs = Date.now() - t0
const perf = await page.evaluate(() => window.__PERF__)
const longOnes = perf.longtasks.filter((d) => d > 200)

check(
  '带照片的正文里敲 30 个字（delay 0）在 4 秒内完成 —— 旧实现每键 ≈400ms、要十几秒',
  typeMs < 4000,
  `${MARK.length} 个字用了 ${typeMs}ms（每键 ${(typeMs / MARK.length).toFixed(0)}ms）`,
)
check(
  '打字期间没有"卡住"的长任务（>200ms 的最多 2 次）—— 旧实现是 30 次上下',
  longOnes.length <= 2,
  `长任务共 ${perf.longtasks.length} 次，其中 >200ms 的 ${longOnes.length} 次${longOnes.length ? `（最长 ${Math.max(...longOnes)}ms）` : ''}`,
)

/* ============ C. 机制层：打字过程中"交出去"了几次 ============
   这一条是**直接盯住"攒着交"这个机制本身**的，不靠时间阈值 ——
   因为只把序列化改快、却仍然每键交一次，墙钟时间也可能落在阈值内（实测过：
   把 onUpdate 单独改回"每键都序列化"，端到端那两条依然全绿，因为序列化本身
   已经被 A 组改快了）。所以这里数次数：连敲 20 个字只该交 1~2 次。 */
await page.waitForTimeout(600) // 先让上一轮"攒着的那一次"落地，免得算进来
await page.evaluate(() => {
  window.__MD_SERIALIZE_COUNT__ = 0
})
await page.keyboard.type('再敲二十个字看看序列化了几次哼哼哈哈嘿嘿', { delay: 0 })
await page.waitForTimeout(150)
const midCount = await page.evaluate(() => window.__MD_SERIALIZE_COUNT__ ?? -1)
check(
  '连敲 20 个字的过程中最多只交 2 次序列化（旧实现：每键一次 = 20 次）',
  midCount >= 0 && midCount <= 2,
  `交了 ${midCount} 次`,
)
await page.waitForTimeout(1300)
const settled = await page.evaluate(() => window.__MD_SERIALIZE_COUNT__ ?? -1)
check(
  '停下之后一定补交一次（"攒着"不等于"不交"）',
  settled >= midCount + 1 && settled <= midCount + 2,
  `${midCount} 次 → 停下后 ${settled} 次`,
)

/* ============ D. 攒着不交也不能丢内容 ============ */
await page.waitForTimeout(2400)
const saved = await readIdb(page)
const current = saved.find((d) => d.md.includes(MARK)) ?? saved[0] ?? { md: '' }
check('打完字等下自动保存：存储里的正文含刚敲进去的字（不许丢）', current.md.includes(MARK), `存储里 ${saved.length} 篇，命中「${MARK}」=${current.md.includes(MARK)}`)
check(
  '存进去的正文里没有控制字符（序列化收尾没被"攒着交"绕过）',
  !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(current.md),
)
check('整轮没有页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条断言通过`)
if (results.length !== TEST_COUNT) {
  console.log(`❌ 断言条数与 TEST_COUNT(${TEST_COUNT}) 不一致：实际 ${results.length} 条（改了测试就同步改常量与文档）`)
  process.exit(1)
}
process.exit(failed.length ? 1 : 0)
