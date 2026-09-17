/**
 * 换行写法回归测试（真实修过的 bug）
 *
 * 背景：编辑器里 Shift+Enter 的硬换行，默认序列化成"反斜杠 + 换行"。
 * CommonMark 认这种写法，但**很多软件不认** —— Typedown 就直接把那个反斜杠
 * 当普通字符显示出来，于是引用末尾会冒出一个莫名其妙的 `\`（用户截图反馈）。
 * 现在改成"两个空格 + 换行"，各家都认。
 *
 * 要保证的事：
 *   1. 存盘后**没有**"行尾单个反斜杠"（用户看到的那种）
 *   2. 换行本身还在（两个空格 + 换行），导入回编辑器还是换行，不是被吃掉
 *   3. 代码块里的反斜杠一个都不能动
 *   4. 内容里真的要显示一个反斜杠（`\\`）时也不能被改坏
 *   5. 公式/引用/表格照常
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
const DL = resolve('.probe', 'hardbreak-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/* 源文件：把三种写法都放进去 */
const srcMd = [
  '# 换行测试',
  '',
  '> 引用第一行\\',
  '> 引用第二行（上一行末尾是反斜杠写法）',
  '',
  '普通段落第一行\\',
  '普通段落第二行',
  '',
  '两个空格写法：这行末尾是两个空格  ',
  '这是下一行',
  '',
  '```text',
  'code with trailing backslash\\',
  'code backslash \\\\ and more',
  '```',
  '',
  '正文里的反斜杠：路径 C:\\\\Users\\\\test 和公式 $x_1$ 收尾。',
  '',
  '![插图1](https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg)',
  '> 图片后面紧跟的引用（以前会被粘成 `![](图)> 引用…`）',
  '',
  '![插图2](https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg)',
  '- 图片后面紧跟的列表项',
  '',
  '![插图3](https://pic1.zhimg.com/v2-85acce83f563af8f1e7d838d10e5d294.jpg)',
  '## 图片后面紧跟的标题',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 一格\\ | 两格 |',
  '',
].join('\n')
const srcPath = resolve('.probe', 'hardbreak-src.md')
writeFileSync(srcPath, srcMd, 'utf-8')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
await page.goto(app, { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1200)

async function openFile(path) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="打开"]').click(),
  ])
  await chooser.setFiles(path)
  await page.waitForTimeout(2200)
}

async function saveMd(name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
  ])
  const saved = resolve(DL, name)
  await dl.saveAs(saved)
  await page.waitForTimeout(300)
  return readFileSync(saved, 'utf-8')
}

await openFile(srcPath)
const before = await page.evaluate(() => {
  const doc = window.__EDITOR__.getJSON()
  let br = 0
  const walk = (n) => {
    if (n.type === 'hardBreak') br += 1
    ;(n.content ?? []).forEach(walk)
  }
  walk(doc)
  return { br }
})
check('导入：识别出 3 处硬换行（引用 1 + 段落 1 + 两空格 1）', before.br === 3, `${before.br} 个换行节点`)

const md = await saveMd('saved.md')
// 代码块里的反斜杠是代码本身，不算（下面单独检查它有没有被动过）
const mdNoCode = md.replace(/```[\s\S]*?```/g, '')
const trailingSingle = [...mdNoCode.matchAll(/(?<!\\)\\\n/g)].length
const twoSpaceBreaks = [...mdNoCode.matchAll(/ {2,}\n/g)].length
check('存盘：正文里没有任何"行尾单个反斜杠"', trailingSingle === 0, `${trailingSingle} 处`)
check('存盘：换行改成了"两个空格 + 换行"', twoSpaceBreaks >= 3, `${twoSpaceBreaks} 处`)
check(
  '存盘：引用里那行文字没丢',
  md.includes('> 引用第一行') && md.includes('引用第二行'),
  md.split('\n').slice(2, 5).join(' ⏎ ').slice(0, 90),
)
check('存盘：代码块里的反斜杠原样保留', md.includes('code with trailing backslash\\\n') && md.includes('code backslash \\\\'))
check('存盘：正文里真正的两个反斜杠没被改', md.includes('C:\\\\Users\\\\test'), md.match(/C:\\\\[^\s]*/)?.[0] ?? '(没找到)')
check('存盘：公式还在', md.includes('$x_1$'))
check('存盘：表格没坏', md.includes('| 列A | 列B |'))
/* 块级图片后面必须空一行，否则会粘住后面的引用/列表/标题（用户文件里实测到过） */
const gluedLines = mdNoCode.split('\n').filter((l) => /^\s*!\[[^\]]*\]\([^)]*\)\s*[>#\-]/.test(l))
check(
  '存盘：没有"图片开头、后面直接粘着引用/列表/标题"的行',
  gluedLines.length === 0,
  gluedLines[0]?.slice(0, 80) ?? '(没有)',
)
check(
  '存盘：图片与后面的引用之间有空行',
  /!\[插图1\][^\n]*\n\s*\n\s*>/.test(md),
  JSON.stringify(md.split('\n').slice(md.split('\n').findIndex((l) => l.includes('插图1')), +2).join(' ⏎ ').slice(0, 90)),
)
check(
  '存盘：图片与后面的列表之间有空行',
  /!\[插图2\][^\n]*\n\s*\n\s*-/.test(md),
  JSON.stringify(md.split('\n').slice(md.split('\n').findIndex((l) => l.includes('插图2')), +2).join(' ⏎ ').slice(0, 90)),
)
check(
  '存盘：图片与后面的标题之间有空行',
  /!\[插图3\][^\n]*\n\s*\n\s*##/.test(md),
  JSON.stringify(md.split('\n').slice(md.split('\n').findIndex((l) => l.includes('插图3')), +2).join(' ⏎ ').slice(0, 90)),
)

/* 再导入一遍：换行还在（两个空格写法能被认回来） */
await openFile(resolve(DL, 'saved.md'))
const again = await page.evaluate(() => {
  const doc = window.__EDITOR__.getJSON()
  let br = 0
  const walk = (n) => {
    if (n.type === 'hardBreak') br += 1
    ;(n.content ?? []).forEach(walk)
  }
  walk(doc)
  return { br, text: document.querySelector('.ProseMirror')?.textContent ?? '' }
})
check('往返：换行没有丢（还是 3 处）', again.br === 3, `${again.br} 个`)
check('往返：正文里不出现多余的反斜杠字符', !again.text.includes('引用第一行\\'), JSON.stringify(again.text.slice(0, 60)))

check('无页面错误', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
for (const r of results) if (!r.ok) console.log(`\n待修：${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
