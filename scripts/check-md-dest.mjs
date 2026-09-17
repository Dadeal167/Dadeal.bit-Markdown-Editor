/**
 * 链接 / 图片目标里的"坏字符"守卫 —— 回归防线。
 *
 * 为什么单独一个套件（用户实测，2026-09-27）：
 *   用户在**新电脑**上导入自己从知乎导出的 .md，结果"只出来文字、图片一张都没有"，
 *   gif / jpg 都一样。根因不在图片，而在**文件夹名字里的空格**：
 *   `![说明](assets/…——Dadealbit Markdown编辑器/img_020.gif)` 里的裸空格让整段
 *   不再是图片语法，而是普通文字；而且因为没建出图片节点，
 *   "🖼 图片打不开 → 选导出文件夹修复"的提示也不会出现 —— 界面上无路可走。
 *
 * 这一套件守四件事（每件都能说清"什么情况下会红"）：
 *   A. 带空格的路径必须被转义，导入后**真的建出 image 节点**（不是字面文字）
 *   B. 标题（`"…"`）里的空格**不许**被碰 —— 那是语法分隔符，转了就把标题并进路径
 *   C. 代码块 / 行内代码里的 `![a](x y.png)` 一个字符都不许动
 *   D. 已经 `<…>` 包起来的、以及已经 `%20` 的，不许二次编码
 *
 * 判定靠编辑器自己的调试口 `__ESCAPE_MD_DESTS__`（转义本体）与
 * `__SET_MARKDOWN__`（真导入链）；被测代码是 src/editor/tiptap/mdDestinations.ts。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。 */
export const TEST_COUNT = 24

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

/** 用户那篇的文件夹名（**注意里面有空格**，这正是本案元凶） */
const ART = '可能是更简单的Markdown编辑器？——Dadealbit Markdown编辑器'
const ENC = '可能是更简单的Markdown编辑器？——Dadealbit%20Markdown编辑器'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 140)))
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

const hooks = await page.evaluate(() => ({
  esc: typeof window.__ESCAPE_MD_DESTS__ === 'function',
  set: typeof window.__SET_MARKDOWN__ === 'function',
  md: typeof window.__MD__ === 'function',
}))
check('调试口齐全（__ESCAPE_MD_DESTS__ / __SET_MARKDOWN__ / __MD__）', hooks.esc && hooks.set && hooks.md, JSON.stringify(hooks))
if (!hooks.esc || !hooks.set || !hooks.md) {
  await browser.close()
  console.log('\n❌ 缺少调试口，套件无法运行')
  process.exit(1)
}

const esc = (md) => page.evaluate((m) => window.__ESCAPE_MD_DESTS__(m), md)
/** 真导入链（打开 .md / 初始文档都走它），返回建出来的图片数等 */
const importAndInspect = async (md) => {
  await page.evaluate((m) => window.__SET_MARKDOWN__(window.__EDITOR__, m), md)
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.ProseMirror img')].filter(
      (i) => !String(i.className).includes('separator'),
    )
    return {
      imgs: imgs.length,
      srcs: imgs.map((i) => i.getAttribute('src') || ''),
      alt: imgs.map((i) => i.getAttribute('alt') || ''),
      titles: imgs.map((i) => i.getAttribute('title') || ''),
      text: document.querySelector('.ProseMirror')?.textContent ?? '',
      code: [...document.querySelectorAll('.ProseMirror pre, .ProseMirror code')].map((e) => e.textContent),
    }
  })
}

/* ================= A. 本体：带空格的路径 ================= */
const userMd = `开头一段话。\n\n![动图说明](assets/${ART}/img_020.gif)\n`
const escA = await esc(userMd)
check('A1 带空格的路径被转义（出现 %20）', escA.includes(`assets/${ENC}/img_020.gif`), escA.split('\n')[2] ?? '')
check('A2 转义后不再有裸空格路径', !/\]\(assets\/[^)]* [^)]*\)/.test(escA), escA.split('\n')[2] ?? '')
check('A3 说明文字（alt）原样保留', escA.includes('![动图说明]('), escA.split('\n')[2] ?? '')

const afterA = await importAndInspect(userMd)
check('A4 真导入后**建出了图片节点**（用户那次是 0 张）', afterA.imgs === 1, `${afterA.imgs} 张`)
check('A5 正文里不再出现字面 `![`', !afterA.text.includes('!['), afterA.text.replace(/\s+/g, ' ').slice(0, 80))
check('A6 图片 src 指向那个带空格的文件夹（已解码）', /img_020\.gif$/.test(decodeURIComponent(afterA.srcs[0] ?? '')), afterA.srcs[0] ?? '(无)')
check('A7 alt 就是那句说明', afterA.alt[0] === '动图说明', afterA.alt[0] ?? '(无)')

/* ================= B. 标题里的空格不许被碰 ================= */
const titleMd = '![图](img.png "我的 标题")\n'
const escB = await esc(titleMd)
check('B1 标题里的空格不许被转义', escB === titleMd, escB.trim())

const spacedTitle = `![图](assets/文章 名/img.png "我的 标题")\n`
const escB2 = await esc(spacedTitle)
check(
  'B2 路径要转义、标题要保留（同时出现时）',
  escB2 === `![图](assets/文章%20名/img.png "我的 标题")\n`,
  escB2.trim(),
)
const afterB = await importAndInspect(spacedTitle)
/* 标题（markdown 的 `"…"`）**不是** alt —— alt 是方括号里那句，标题进的是 title 属性。
   这条断言以前写错过一次（写了"标题进了 alt"），实测 alt=图 / title=我的 标题 才对。 */
check(
  'B3 真导入：图片建成、alt 是方括号那句、标题进 title 属性（没被并进路径）',
  afterB.imgs === 1 && afterB.alt[0] === '图' && afterB.titles[0] === '我的 标题',
  `${afterB.imgs} 张 / alt=${afterB.alt[0] ?? '(无)'} / title=${afterB.titles[0] ?? '(无)'}`,
)

/* ================= C. 代码区一个字符都不许动 ================= */
const fenceMd = '```\n![a](assets/我的 文章/img.png)\n```\n'
check('C1 围栏代码块里的原样不动', (await esc(fenceMd)) === fenceMd, '不动')
const tickMd = '行内的 `![a](assets/我的 文章/img.png)` 也要原样\n'
check('C2 行内代码里的原样不动', (await esc(tickMd)) === tickMd, '不动')
const afterC = await importAndInspect(fenceMd)
check('C3 真导入：代码块里的那段仍然是代码，没变成图片', afterC.imgs === 0 && (afterC.code.join('') || '').includes('assets/我的 文章/img.png'), `${afterC.imgs} 张 / 代码里 ${afterC.code.length ? '有原文' : '没有原文'}`)

/* ================= D. 不二次编码 / 不动已经合法的 ================= */
const encMd = `![图](assets/${ENC}/img.png)\n`
check('D1 已经是 %20 的不再动', (await esc(encMd)) === encMd, '不动')
check('D2 不会出现 %2520（二次编码）', !(await esc(encMd)).includes('%2520'), '无二次编码')
const angleMd = '![图](<assets/我的 文章/img.png>)\n'
check('D3 `<…>` 形式不动', (await esc(angleMd)) === angleMd, '不动')
const plainMd = '普通一段话，里面有括号（中文的）和 [链接](https://x.com/a)。\n'
check('D4 正常的链接与中文括号不受影响', (await esc(plainMd)) === plainMd, '不动')
const afterD = await importAndInspect(angleMd)
check('D5 真导入：`<…>` 写法本来就能建出图片', afterD.imgs === 1, `${afterD.imgs} 张`)

/* ================= E. 括号 / 尖括号：同类坏字符 ================= */
const parenMd = '![图](assets/我的 文章/图 (1).png)\n'
const escE = await esc(parenMd)
check('E1 路径里的空格和括号都被转义', escE === '![图](assets/我的%20文章/图%20%281%29.png)\n', escE.trim())
const afterE = await importAndInspect(parenMd)
check('E2 真导入：括号路径也能建出图片', afterE.imgs === 1, `${afterE.imgs} 张`)

/* ================= F. 幂等 + 无副作用 ================= */
const once = await esc(userMd)
const twice = await esc(once)
check('F1 转义是幂等的（跑两遍结果一样）', once === twice, once === twice ? '一致' : '不一致')
const noLink = '# 标题\n\n一段普通文字，没有任何链接。\n'
check('F2 没有链接的文档原样返回', (await esc(noLink)) === noLink, '原样')

check('全程无页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
/* 自检：实际断言数必须等于对外声明的 TEST_COUNT（文档数量占位符读它） */
if (results.length !== TEST_COUNT) {
  console.log(`\n❌ 断言总数与 TEST_COUNT 不符：实际 ${results.length}，声明 ${TEST_COUNT}`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
