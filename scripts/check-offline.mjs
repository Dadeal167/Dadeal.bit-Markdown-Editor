/**
 * 交付形态验证：双击那个 HTML（file://）能不能正常用，不用任何服务器
 * 验证对象是项目根目录的「Dadealbit Markdown 编辑器.html」——也就是用户真正双击的文件
 * 前提：先跑过 pnpm build
 */
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const friendly = resolve('Dadealbit Markdown 编辑器.html')
const distIndex = resolve('dist', 'index.html')
const fileUrl = 'file:///' + friendly.replace(/\\/g, '/')

if (!existsSync(friendly)) {
  console.error('根目录没有「Dadealbit Markdown 编辑器.html」，先跑 pnpm build:pure')
  process.exit(1)
}

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// 根目录那份应该和 dist 里的一致
record(
  '根目录的「Dadealbit Markdown 编辑器.html」与 dist 产物一致',
  existsSync(distIndex) && readFileSync(friendly).equals(readFileSync(distIndex)),
  `${Math.round(readFileSync(friendly).length / 1024)} KB`,
)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e.message)))

const md = () => page.evaluate(() => window.__MD__?.() ?? '')

await page.goto(fileUrl, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(2500)

record('file:// 打开后页面有内容', (await page.locator('.editor-card').count()) > 0)
if (errors.length) {
  console.log('\n控制台/加载错误：')
  errors.slice(0, 5).forEach((e) => console.log('  • ' + e.slice(0, 220)))
  console.log('')
}
record('编辑器初始化成功', (await page.locator('.ProseMirror').count()) === 1)
const demoMath = await page.locator('.math-node').count()
record('示例公式渲染成节点（KaTeX 资源加载正常）', demoMath >= 2, `${demoMath} 个公式节点`)
const titleFont = await page.evaluate(() => {
  const el = document.querySelector('.zh-title')
  return el ? getComputedStyle(el).fontSize : null
})
record('样式表加载正常', titleFont === '24px', `标题字号 ${titleFont}`)

// 打字与加粗
await page.locator('.zh-prose p').first().click()
await page.keyboard.press('Control+End')
await page.locator('.zh-btn[title="加粗"]').click()
await page.keyboard.type('离线可用')
await page.waitForTimeout(300)
record('能打字 + 能加粗', (await md()).includes('**离线可用**'))

// 文档落盘：file:// 下 localStorage 是否可用（多文档存储）
await page.waitForTimeout(1600)
const draft = await page.evaluate(() => localStorage.getItem('md-editor-docs-v1'))
record(
  '文档写入 localStorage',
  !!draft && draft.includes('离线可用'),
  draft ? `${draft.length} 字节` : '写入失败',
)

// 公式弹窗（符号表是本地数据，不依赖网络）
await page.locator('.zh-btn[title="公式"]').click()
await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
await page.locator('.zh-mathcat', { hasText: '分数微分' }).click()
await page.waitForTimeout(400)
const symbolCount = await page.locator('.zh-mathpanel .zh-symbol').count()
await page.locator('.zh-mathpanel .zh-symbol').first().click()
await page.waitForTimeout(300)
const tex = await page.evaluate(() => document.querySelector('.zh-mathsource')?.value ?? '')
record('公式符号面板可用', symbolCount > 15 && tex.includes('\\frac'), `${symbolCount} 个符号，输入区 ${tex}`)
await page.getByRole('button', { name: '确认', exact: true }).click()
await page.waitForTimeout(500)

// 导出（下载）在 file:// 下是否正常
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page
    .locator('.zh-btn[title="保存"]')
    .click()
    .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
const savedPath = await download.path()
const savedText = savedPath ? readFileSync(savedPath, 'utf-8') : ''
record('保存 .md 可下载', download.suggestedFilename().endsWith('.md') && savedText.includes('离线可用'), `${download.suggestedFilename()}，${savedText.length} 字节`)

// 界面文案里不该出现问号（曾是 .bat 控制台代码页问题，顺便守一下页面本身）
const pageText = await page.locator('body').innerText()
const questionRuns = (pageText.match(/\?{2,}/g) ?? []).length
record('界面没有乱码问号', questionRuns === 0 && !pageText.includes('\uFFFD'), `连续问号 ${questionRuns} 处`)

await page.screenshot({ path: resolve(OUT, 'file-protocol.png'), fullPage: true })
record('控制台无错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ').slice(0, 200) : '无')

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
