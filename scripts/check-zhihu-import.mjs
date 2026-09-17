/**
 * 「记住知乎公式标记」导入测试（回归用）
 *
 * 背景：编辑器导出给知乎的 .md 里，公式是知乎的 img 标记：
 *   <img src="https://www.zhihu.com/equation?tex=…" alt="LaTeX" class="ee_img tr_noresize" eeimg="1|2">
 * 用户会把这种文件再打开继续改（也可能导入别人从知乎导出的文件）。实测踩到两个坑：
 *
 *   1) 这些公式标记以前**不会**被认回来 —— 全变成图片：不能编辑、公式节点也没了。
 *      （用户那篇 166 个公式的文章，导入后公式节点是 0 个）
 *   2) 知乎标记里 alt 常常是数字（"第 18 题"就是 alt="18"）。Tiptap 解析 HTML 时
 *      会把长得像数字的属性转成 number，于是 alt 是数字 18；markdown 序列化器对 alt
 *      调 .replace() 直接抛错 —— 整篇文档存不下来、也导不出去。
 *
 * 这个脚本走真实路径：导入 → 检查公式是不是公式节点 → 存盘不报错 →
 * 导出 → 再把导出的文件导入一次（往返一圈，公式数量不能变）。
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
const DL = resolve('.probe', 'zhihu-import-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const eq = (latex, display = false) => {
  const encoded = encodeURIComponent(latex).replace(/%20/g, '+')
  const alt = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<img src="https://www.zhihu.com/equation?tex=${encoded}" alt="${alt}" class="ee_img tr_noresize" eeimg="${display ? 2 : 1}">`
}

/* ---------- 造一篇"知乎导出格式"的 .md ---------- */
const srcMd = [
  '# 公式标记导入测试',
  '',
  `行内公式 ${eq('x_{1}+y_{2}')}、数字公式 ${eq('18')}、纯公式行：`,
  '',
  eq('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', true),
  '',
  `行内 alt 丢了的公式（只能从 tex 参数解）：<img src="https://www.zhihu.com/equation?tex=%5Cfrac%7B1%7D%7B2%7D" class="ee_img tr_noresize" eeimg="1">`,
  '',
  'markdown 图片语法写公式：![18](https://www.zhihu.com/equation?tex=18)',
  '',
  '普通图片（alt 是数字 2024，不能当公式）：![2024](https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg)',
  '',
  // 注意：这里**故意不放本机图片** —— 有本机图片时导出会先去上传换网址（拿不到就不给文件），
  // 这个套件测的是"公式标记能不能认回来"，图片的事在 check-imagebed-export / check-zhihu-export 里测
  '| 列A | 列B |',
  '| --- | --- |',
  `| ${eq('p_{1}')} | 内容 |`,
  '',
  '```js',
  'const a = "$不是公式$"',
  '```',
  '',
].join('\n')
const srcPath = resolve('.probe', 'zhihu-import-src.md')
writeFileSync(srcPath, srcMd, 'utf-8')

const EXPECT_MATH = 6 // x_1+y_2、18、块级求和、1/2、markdown 语法的 18、表格里的 p_1

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

async function openFile(path) {
  await page.keyboard.press('Escape') // 上一次的面板还开着的话先关掉，否则点不到工具栏
  await page.waitForTimeout(300)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(path)
  await page.waitForTimeout(2500)
}

async function exportMd(fileName) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.locator('.zh-btn[title="知乎"]').click()
  await page.waitForTimeout(400)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click(),
  ])
  const saved = resolve(DL, fileName)
  await download.saveAs(saved)
  await page.waitForTimeout(400)
  return readFileSync(saved, 'utf-8')
}

/* ---------- 1. 导入知乎格式的 .md ---------- */
await openFile(srcPath)
const first = await page.evaluate(() => {
  const ed = window.__EDITOR__
  let save = 'OK'
  try {
    window.__MD__()
  } catch (e) {
    save = '抛错: ' + String(e).slice(0, 70)
  }
  return {
    math: document.querySelectorAll('.math-node').length,
    blockMath: document.querySelectorAll('.math-node--block').length,
    imgs: [...document.querySelectorAll('.ProseMirror img')].filter(
      (i) => !String(i.className).includes('separator'),
    ).length,
    broken: document.querySelectorAll('.math-node--error').length,
    save,
    latexes: [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex')),
  }
})
check('公式标记认回来了（不再是图片）', first.math === EXPECT_MATH, `${first.math} 个公式节点（期望 ${EXPECT_MATH}）`)
check('块级公式仍是块级', first.blockMath === 1, `${first.blockMath} 个块级`)
check('只剩下那张网络图片（这篇没有本机图片）', first.imgs === 1, `${first.imgs} 张`)
check('公式都能渲染（没有红字）', first.broken === 0, `${first.broken} 个渲染失败`)
check('数字 alt 不再把存盘搞崩', first.save === 'OK', first.save)
check(
  'alt 是数字的公式，LaTeX 原文没丢',
  first.latexes.filter((l) => l === '18').length === 2,
  JSON.stringify(first.latexes).slice(0, 120),
)
check(
  'alt 丢了就从 tex 参数解出来（\\frac{1}{2}）',
  first.latexes.includes('\\frac{1}{2}'),
  JSON.stringify(first.latexes.filter((l) => l.includes('frac'))),
)
check('alt 是数字的普通图片没被当成公式', first.latexes.every((l) => !String(l).includes('http')))

/* ---------- 2. 导出一份（公式换回知乎标记） ---------- */
const md1 = await exportMd('out1.md')
const ee1 = [...md1.matchAll(/equation\?tex=([^"]*)"/g)].length
check('导出：公式数量没变', ee1 === EXPECT_MATH, `${ee1} 个公式标记`)
check('导出：普通图片的 alt 还是 2024（没被改）', md1.includes('![2024](https://pic1.zhimg.com'), (md1.match(/!\[[^\]]*\]\([^)]{0,40}/g) || [])[0] ?? '(无)')
check(
  '导出：这篇没有本机图片，所以不该出现"手动粘图"提示行',
  (md1.match(/^> 🖼️ .*$/gm) || []).length === 0,
  `${(md1.match(/^> 🖼️ .*$/gm) || []).length} 行`,
)

/* ---------- 3. 把导出的文件再导入一次（往返） ---------- */
const backPath = resolve('.probe', 'zhihu-import-back.md')
writeFileSync(backPath, md1, 'utf-8')
await openFile(backPath)
const second = await page.evaluate(() => {
  let save = 'OK'
  try {
    window.__MD__()
  } catch (e) {
    save = '抛错: ' + String(e).slice(0, 70)
  }
  return {
    math: document.querySelectorAll('.math-node').length,
    imgs: [...document.querySelectorAll('.ProseMirror img')].filter(
      (i) => !String(i.className).includes('separator'),
    ).length,
    broken: document.querySelectorAll('.math-node--error').length,
    save,
  }
})
check('往返：公式数量一致', second.math === EXPECT_MATH, `${second.math} 个`)
check('往返：公式没变成红字', second.broken === 0, `${second.broken} 个`)
/* 导出的文件里图片是网址 / 引用式写法，再导入回来应该还在 */
check('往返：图片没有丢', second.imgs === 1, `${second.imgs} 张`)
check('往返：存盘仍然没问题', second.save === 'OK', second.save)

const md2 = await exportMd('out2.md')
check(
  '往返两次导出内容一致（提示行不会越导越多）',
  md2 === md1,
  md2 === md1 ? '' : `长度 ${md1.length} vs ${md2.length}`,
)

check('全程无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
