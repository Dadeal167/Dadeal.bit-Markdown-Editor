/**
 * 「导出知乎 .md」回归测试
 *
 * 背景：知乎的「导入 Markdown」**不认 `$…$` 公式**，必须先把公式换成知乎自己的
 * 公式标记（<img src="https://www.zhihu.com/equation?tex=…" alt="LaTeX" eeimg="1">），
 * 导入后才会变成可编辑的公式节点。
 *
 * 这个脚本走真实路径：开双击版 HTML → 导入一篇带公式/图片的文章 → 点面板里的
 * 「导出知乎 .md」→ 抓下载到的文件 → 检查公式、图片、正文是不是都对。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 改测试条数时改这里；文档不用动（占位符会跟着变）。
 */
export const TEST_COUNT = 36

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')
const DL = resolve('.probe', 'zhihu-export-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* ---------- 造一篇覆盖各种写法的 .md ---------- */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const srcMd = [
  // 开头故意放一份"知乎导出工具"的元数据：导入结果和导出文件里都不该有它
  '---',
  'title: "导出测试"',
  'author: "未知"',
  'date: 1970-01-01',
  'tags: [知乎备份]',
  'url: "https://zhuanlan.zhihu.com/p/123456"',
  '---',
  '',
  '# 导出测试',
  '',
  '行内公式 $x_{1}+y_{2}$，还有 $\\frac{1+k}{1-k}$ 和 $18$。',
  '',
  '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$',
  '',
  '原价 \\$100，现价 \\$60 不该变成公式。',
  '',
  '- 列表项 $a*b*c$',
  '',
  '> 引用里有 $\\left \\{ x_{n}-y_{n} \\right \\}$',
  '',
  '网络图片：![网图](https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg)',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| $p_{1}$ | 内容 |',
  '',
  '```js',
  'const a = "$不是公式$"',
  '```',
  '',
].join('\n')
mkdirSync(resolve('.probe'), { recursive: true })
const srcPath = resolve('.probe', 'zhihu-export-src.md')
writeFileSync(srcPath, srcMd, 'utf-8')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

// 导入源文件
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser.setFiles(srcPath)
await page.waitForTimeout(2500)

const inEditor = await page.evaluate(() => ({
  math: document.querySelectorAll('.math-node').length,
  imgs: [...document.querySelectorAll('.ProseMirror img')].filter(
    (i) => !String(i.className).includes('separator'),
  ).length,
  code: document.querySelector('.ProseMirror pre')?.textContent ?? '',
  text: document.querySelector('.ProseMirror')?.textContent ?? '',
}))
check('导入源文件：公式都认出来了（代码块里的 $ 不算）', inEditor.math === 7, `${inEditor.math} 个公式节点`)
check('导入源文件：网络图片在（这篇故意不放本机图片，本机图的处理另有专门的用例）', inEditor.imgs === 1, `${inEditor.imgs} 张`)
check('导入源文件：代码块原样保留（$ 没被拆成公式）', inEditor.code === 'const a = "$不是公式$"', JSON.stringify(inEditor.code))
check(
  '导入源文件：开头的导出元数据被扔掉（没有 title:/tags: 那一段）',
  !inEditor.text.includes('tags:') && !inEditor.text.includes('url: "https'),
  JSON.stringify(inEditor.text.slice(0, 40)),
)

// 打开「知乎」面板 → 导出
await page.locator('.zh-btn[title="知乎"]').click()
await page.waitForTimeout(600)
check('面板里有「导出知乎 .md」按钮', (await page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).count()) > 0)

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click(),
])
const saved = resolve(DL, 'out.md')
await download.saveAs(saved)
await page.waitForTimeout(400)
const md = readFileSync(saved, 'utf-8')
console.log(`\n导出文件：${download.suggestedFilename()}（${(md.length / 1024).toFixed(1)} KB）`)
const exportNote = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
const exportNoteClass = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.className ?? '')

/* ---------- 检查导出内容 ---------- */
const eeimg = [...md.matchAll(/<img src="https:\/\/www\.zhihu\.com\/equation\?tex=([^"]*)" alt="([^"]*)" class="ee_img tr_noresize" eeimg="(\d)">/g)]
check('公式换成了知乎的公式标记', eeimg.length === 7, `${eeimg.length} 个 img 公式标记`)
const codeStripped = md.replace(/```[\s\S]*?```/g, '')
check(
  '没有残留的 $…$ 公式（代码块和字面美元号除外）',
  !/\$[^$\n]+\$/.test(codeStripped.replace(/\\\$/g, '')),
  codeStripped.match(/\$[^$\n]+\$/g)?.slice(0, 3).join(' '),
)
check('字面美元号保留成 \\$', md.includes('\\$100') && md.includes('\\$60'))

const byAlt = Object.fromEntries(eeimg.map((m) => [m[2], m[3]]))
check('行内公式的 LaTeX 在 alt 里原样保留', byAlt['x_{1}+y_{2}'] === '1', JSON.stringify(Object.keys(byAlt)))
check('块级公式标成 eeimg=2', byAlt['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'] === '2', String(byAlt['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}']))
check('表格单元格里的公式没丢', byAlt['p_{1}'] === '1', JSON.stringify(Object.keys(byAlt)))
check(
  'tex 参数做了 URL 编码',
  md.includes('tex=x_%7B1%7D%2By_%7B2%7D'),
  eeimg.find((m) => m[2] === 'x_{1}+y_{2}')?.[1],
)
check('代码块原样保留（$ 没被当成公式）', md.includes('const a = "$不是公式$"'), md.slice(md.indexOf('```js')).slice(0, 60).replace(/\n/g, '⏎'))
check('网络图片原样保留', md.includes('https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg'))
check('这篇没有本机图片，导出正常出文件（不弹"先开助手"）', /result--ok/.test(exportNoteClass), exportNoteClass)
check('表格前有空行（否则知乎解析不出表格）', /\n\n\| 列A \| 列B \|/.test(md), JSON.stringify(md.slice(md.indexOf('列A') - 12, md.indexOf('列A') + 12)))
check('表格结构没坏', md.includes('| 列A | 列B |') && md.includes('| --- | --- |'))
check('图片后面的文字没有被粘在同一行', !/\)[^\s\n]/.test(md.match(/!\[[^\]]*\]\([^)]*\)[^\s\n]/)?.[0] ?? ''), md.match(/!\[[^\]]*\]\([^)]*\)[^\s\n]/)?.[0] ?? '(没有粘连)')
check('引用块没坏', /^> /m.test(md))
check('列表没坏', /^- /m.test(md))
check('标题没坏', /^# /m.test(md))

/* ---------- 导出后编辑器内容没被改动 ---------- */
const after = await page.evaluate(() => window.__MD__?.() ?? '')
check(
  '导出是只读操作，正文没被改',
  after.includes('$x_{1}+y_{2}$') && after.includes('\\sum_{i=1}^{n} i'),
  after.slice(0, 60).replace(/\n/g, '⏎'),
)

check('无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

/* ---------- 追加：正文里"粘坏的公式原文"（当普通文字）也要认出来 ----------
   用户真实情况：以前那次坏粘贴把公式留成了正文，存盘时字面 $ 被转义成 \$、反斜杠被转义成 \\，
   导出时必须照样换成知乎的公式标记，否则用户在知乎里看到的是一堆反斜杠乱码。 */
const RAW_FORMULA =
  '粘坏的公式原文：$\\frac{1+k}{1-k}\\times \\frac{x_{n}-y_{n}}{x_{n+1}-y_{n+1}}=\\frac{(x^{2}*{n}-y^{2}*{n})}{(x^{2}*{n+1}-y^{2}*{n+1})}=1$'
await page.evaluate((text) => {
  const ed = window.__EDITOR__
  ed.chain().focus().insertContent({ type: 'paragraph' }).run()
  ed.chain().focus().insertContent({ type: 'text', text }).run()
}, RAW_FORMULA)
await page.waitForTimeout(700)
const editorMd = await page.evaluate(() => window.__MD__?.() ?? '')
const rawPos = editorMd.indexOf('粘坏的')
check(
  '存下来的正文里，公式原文被转义成了 \\$…\\$（这就是用户文件的状态）',
  rawPos >= 0 && editorMd.slice(rawPos, rawPos + 80).includes('\\$'),
  editorMd.slice(rawPos, rawPos + 70).replace(/\n/g, '⏎'),
)

const [download2] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click(),
])
const saved2 = resolve(DL, 'out2.md')
await download2.saveAs(saved2)
const md2 = readFileSync(saved2, 'utf-8')
const tags2 = [...md2.matchAll(/alt="([^"]*)"/g)].map((m) => m[1])
check(
  '导出时把"公式原文"也换成了知乎公式标记',
  tags2.some((t) => t.startsWith('\\frac{1+k}{1-k}')),
  JSON.stringify(tags2.filter((t) => t.includes('frac')).slice(0, 2)).slice(0, 120),
)
check('导出的 .md 里不再有 \\$\\frac 这种乱码', !/\\\$\\+frac/.test(md2), md2.match(/\\\$\\+frac[^\n]{0,40}/)?.[0] ?? '(没有)')
check('这一次导出里其它公式也没受影响', (md2.match(/equation\?tex=/g) || []).length >= 8, `${(md2.match(/equation\?tex=/g) || []).length} 个公式标记`)

/* ---------- 追加：只有网络图片时，不该出现"要手动拖图"的警告 ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const netPath = resolve('.probe', 'zhihu-export-net.md')
writeFileSync(
  netPath,
  [
    '# 只有网图',
    '',
    '![网图2](https://picx.zhimg.com/v2-3f0a1c0e5a0a0a0a0a0a0a0a0a0a0a0a.jpg)',
    '',
    '公式 $a+b=c$。',
    '',
  ].join('\n'),
  'utf-8',
)
const [chooser2] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser2.setFiles(netPath)
await page.waitForTimeout(2200)
await page.locator('.zh-btn[title="知乎"]').click()
await page.waitForTimeout(500)
const [download3] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click(),
])
const saved3 = resolve(DL, 'out3.md')
await download3.saveAs(saved3)
const md3 = readFileSync(saved3, 'utf-8')
const note3 = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
const note3Class = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.className ?? '')
check('只有网络图片时：不出现"手动拖图"的警告', !/本机图片/.test(note3), note3.slice(0, 70))
check('只有网络图片时：提示是成功样式', /result--ok/.test(note3Class), note3Class)
check(
  '只有网络图片时：网址原样带过去、公式也换好了',
  md3.includes('https://picx.zhimg.com/v2-3f0a1c0e5a0a0a0a0a0a0a0a0a0a0a0a.jpg') && md3.includes('equation?tex=a%2Bb%3Dc'),
  md3.slice(0, 60).replace(/\n/g, '⏎'),
)

/* ---------- 追加：有本机图片、又拿不到公开网址时：照样出文件 + 每张图上面一行提示 ----------
   用户 2026-09 的决定：硬拦住"先不导出"太不近人情，改成给文件但把缺图说清楚。
   这一段的断言随之改：**要下载到文件**、文件里图片上面有提示行、反馈是警告样式并推荐草稿箱。 */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const localPath = resolve('.probe', 'zhihu-export-local.md')
writeFileSync(
  localPath,
  ['# 只有本机图片', '', `![本机图](data:image/png;base64,${PNG})`, '', '公式 $a+b=c$。', ''].join('\n'),
  'utf-8',
)
const [chooser3] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 10000 }),
  page.locator('.zh-btn[title="打开"]').click(),
])
await chooser3.setFiles(localPath)
await page.waitForTimeout(2200)
await page.locator('.zh-btn[title="知乎"]').click()
await page.waitForTimeout(500)
const [dl4] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
  page.locator('.zh-zhihu__export button', { hasText: '导出知乎 .md' }).click(),
])
const saved4 = resolve(DL, 'local-only.md')
if (dl4) await dl4.saveAs(saved4)
const md4 = dl4 ? readFileSync(saved4, 'utf-8') : ''
const note4 = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.textContent ?? '')
const note4Class = await page.evaluate(() => document.querySelector('.zh-zhihu__result')?.className ?? '')
check('有本机图片、又没上传条件时：**照样给文件**（不再硬拦住）', dl4 !== null, `下载了 ${dl4?.suggestedFilename() ?? '(没下载)'}`)
check('文件里那张图上面有一行提示（🖼️）', /^> 🖼️ /m.test(md4), (md4.split('\n').find((l) => l.startsWith('> 🖼️')) ?? '(没有提示行)').slice(0, 70))
check('图片本身还留在文件里（没有把图删掉）', /\]\(data:image\/png;base64,/.test(md4))
check('公式照常转换（缺图不影响公式）', md4.includes('equation?tex=a%2Bb%3Dc'))
check('并且提示按"警告"样式显示', /result--bad/.test(note4Class), note4Class)
check(
  '提示里说清"会丢图 + 两条出路 + 推荐草稿箱"',
  /没换成公开网址/.test(note4) && /开始使用\.bat/.test(note4) && /图床设置/.test(note4) && /存到草稿箱/.test(note4),
  note4.slice(0, 140).replace(/\n/g, ' '),
)

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
