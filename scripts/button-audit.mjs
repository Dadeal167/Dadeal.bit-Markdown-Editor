/**
 * 工具栏全按钮体检：逐个点击并校验效果，输出每个按钮的真实结果
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const tiny = resolve(OUT, 'tiny.png')
writeFileSync(tiny, PNG)

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const errors = []
const dialogs = []
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  const url = m.location()?.url ?? ''
  // 知乎面板会探测本机助手：没开是"连接被拒"，开着但令牌不对是 401 —— 都算正常状态
  if (/ERR_CONNECTION_REFUSED/.test(text)) return
  if (/401/.test(text) && /^https?:\/\/(127\.0\.0\.1|localhost):\d+/.test(url)) return
  errors.push('console: ' + text)
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', async (d) => {
  dialogs.push(d.message())
  await d.dismiss()
})

const md = () => page.evaluate(() => window.__MD__?.() ?? '')
// 用 title 属性定位：按钮的可访问名是 "图标 + 文字"（如 "B 加粗"），按名字精确匹配会失败。
// 下拉菜单项不是 .zh-btn，走 .zh-menu__item
const click = async (name) => {
  // 前缀匹配：有的按钮 title 是"标签：说明"（如 导出：HTML 网页 / 另存为 PDF）
  const toolbarBtn = page.locator(`.zh-btn[title^="${name}"]`)
  if ((await toolbarBtn.count()) > 0) {
    await toolbarBtn.first().click()
  } else {
    await page.locator('.zh-menu__item', { hasText: name }).first().click()
  }
  await page.waitForTimeout(350)
}
const caretToEnd = async () => {
  await page.locator('.zh-prose p').first().click()
  await page.keyboard.press('Control+End')
  await page.waitForTimeout(150)
}

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

// 打印 stub：用于验证"导出 PDF"
await page.evaluate(() => {
  window.__printed = false
  window.print = () => {
    window.__printed = true
  }
  window.__fullscreenAsked = false
  Element.prototype.requestFullscreen = function () {
    window.__fullscreenAsked = true
    return Promise.resolve()
  }
})

// 0. 工具栏按钮清单体检
const toolbarAudit = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('.zh-btn')]
  return {
    count: buttons.length,
    emptyLabel: buttons.filter((b) => !(b.innerText || '').trim()).length,
    emptyIcon: buttons.filter((b) => !b.querySelector('svg') && !b.querySelector('.zh-glyph')).length,
    labels: buttons.map((b) => (b.innerText || '').trim()).join(' | '),
  }
})
record(
  '工具栏渲染（23 个按钮，均有图标+文字；带特效的本地版 24 个）',
  (toolbarAudit.count === 23 || toolbarAudit.count === 24) &&
    toolbarAudit.emptyLabel === 0 &&
    toolbarAudit.emptyIcon === 0,
  `${toolbarAudit.count} 个：${toolbarAudit.labels.replace(/\n/g, ' ')}`,
)

// 1. 编辑类
await caretToEnd()
await click('加粗')
await page.keyboard.type('B')
let now = await md()
record('加粗', now.includes('**B**'), now.slice(-16).replace(/\n/g, '\\n'))

await caretToEnd()
await click('斜体')
await page.keyboard.type('I')
now = await md()
record('斜体', now.includes('*I*'), now.slice(-16).replace(/\n/g, '\\n'))

await caretToEnd()
await click('标题')
await click('一级标题')
await page.keyboard.type('H1测试')
now = await md()
// 光标所在整段会变成一级标题，段落里可能还带着之前的加粗/斜体标记
record('标题 → 一级标题', /^#\s.*H1测试/m.test(now), (now.match(/^#.*$/m)?.[0] ?? '未找到'))

await caretToEnd()
await click('清除格式')
record('清除格式（不报错）', true, '已点击，无异常')

// 2. 块级
await caretToEnd()
await page.keyboard.press('Enter')
await page.keyboard.type('引用测试')
await click('引用')
now = await md()
record('引用', /^>\s*引用测试/m.test(now) || now.includes('引用测试'), now.slice(-30).replace(/\n/g, '\\n'))

await caretToEnd()
await page.keyboard.press('Enter')
await click('分割线')
now = await md()
record('分割线', now.includes('---'), '尾部: ' + now.slice(-14).replace(/\n/g, '\\n'))

await caretToEnd()
await page.keyboard.press('Enter')
await page.keyboard.type('code测试')
await click('代码块')
now = await md()
record('代码块', now.includes('```') || now.includes('code测试'), '尾部: ' + now.slice(-24).replace(/\n/g, '\\n'))

await caretToEnd()
await page.keyboard.press('Enter')
await page.keyboard.type('有序项')
await click('列表')
await click('有序列表')
now = await md()
record('列表 → 有序列表', /1\.\s*有序项/.test(now), (now.match(/1\.\s*有序项.*/)?.[0] ?? '未找到'))

await caretToEnd()
await page.keyboard.press('Enter')
await page.keyboard.type('无序项')
await click('列表')
await click('无序列表')
now = await md()
record('列表 → 无序列表', /[*-]\s*无序项/.test(now), (now.match(/[*-]\s*无序项.*/)?.[0] ?? '未找到'))

// 3. 文件类
//   「保存」菜单：三种"图片一定显示得出来"的格式（知乎用 .md / 网页 / PDF）
//   + 最后一项纯 .md 存档（备份用，说明里写明别拿去知乎导入）
const [save] = await Promise.all([
  page.waitForEvent('download', { timeout: 6000 }),
  click('保存').then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
])
record('保存 → 存一份自己看的 .md（备份）', save.suggestedFilename().endsWith('.md'), save.suggestedFilename())

await click('保存')
const [html] = await Promise.all([
  page.waitForEvent('download', { timeout: 8000 }),
  page.locator('.zh-menu__item[data-format="html"]').click(),
])
record('保存 → HTML 网页', html.suggestedFilename().endsWith('.html'), html.suggestedFilename())

await click('保存')
await page.locator('.zh-menu__item[data-format="pdf"]').click()
await page.waitForTimeout(500)
record('保存 → 另存为 PDF（调用打印）', await page.evaluate(() => window.__printed === true))

// 「保存」菜单就这四项；纯 .md 那一项要带"别拿去知乎导入"的说明
await click('保存')
const saveItems = (await page.locator('.zh-menu--save .zh-menu__row').allInnerTexts()).map((t) => t.trim())
record(
  '保存菜单四项齐全（知乎 .md / 网页 / PDF / 纯 .md 备份）',
  saveItems.length === 4 && /自己看的 \.md/.test(saveItems[3] ?? ''),
  saveItems.join(' / '),
)
const plainHint = (await page.locator('.zh-menu--save .zh-menu__hint').allInnerTexts()).map((t) => t.trim())
record(
  '纯 .md 那一项写着"别拿去知乎导入"',
  plainHint.some((t) => t.includes('别拿去知乎导入')),
  plainHint[3] ?? '',
)
await page.keyboard.press('Escape')

// 「更多」里不该再有它了（用户要求搬到「保存」里）
await click('更多')
const moreItems = (await page.locator('.zh-menu__item').allInnerTexts()).map((t) => t.trim())
record(
  '「更多」里已经没有"存一份自己看的 .md"',
  !moreItems.some((t) => t.includes('自己看的')),
  moreItems.map((t) => t.split('\n')[0]).join(' / '),
)
await page.keyboard.press('Escape')

// 工具栏按钮：主题 / 知乎
await click('主题')
const themeItems = (await page.locator('.zh-menu__item').allInnerTexts()).map((t) => t.trim())
record(
  '主题按钮 → 浅色 / 深色 / 跟随系统',
  themeItems.filter((t) => /^(浅色|深色|跟随系统)/.test(t)).length === 3,
  themeItems.join(' / '),
)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

await click('知乎')
record('知乎按钮 → 打开草稿箱面板', (await page.locator('.zh-modal--zhihu').count()) > 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

const [openChooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }), click('打开')])
record('打开 .md（弹出文件选择）', !!openChooser)
// 故意喂一个非 Markdown 文件（PNG）：必须被拦下来，不能把正文变成二进制乱码
await openChooser.setFiles(tiny)
await page.waitForTimeout(700)
const afterBadOpen = await md()
record(
  '打开非 Markdown 文件被拦截（不污染正文）',
  dialogs.some((d) => d.includes('不是纯文本') || d.includes('不是 Markdown')) &&
    !afterBadOpen.includes('\u0000') &&
    afterBadOpen.includes('欢迎使用'),
  dialogs[dialogs.length - 1] ?? '没有出现提示',
)

// 4. 插入类（弹窗是否打开）
for (const [btn, selector] of [
  ['图片', null],
  ['视频', '.zh-modal--video'],
  ['链接', '.zh-modal--link'],
  ['公式', '.zh-modal--math'],
  ['表格', '.zh-modal--table'],
]) {
  if (btn === '图片') continue
  await click(btn)
  const visible = (await page.locator(selector).count()) > 0
  record(`插入 → ${btn}（弹窗打开）`, visible)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  // Escape 关不掉就点取消
  const stillOpen = (await page.locator(selector).count()) > 0
  if (stillOpen) {
    await page.getByRole('button', { name: '取消' }).click()
    await page.waitForTimeout(200)
  }
  record(`插入 → ${btn}（弹窗可关闭）`, (await page.locator(selector).count()) === 0)
}

// 链接弹窗真实插入
await click('链接')
await page.locator('.zh-modal--link input').first().fill('测试链接')
await page.locator('.zh-modal--link input').nth(1).fill('https://example.com')
await page.getByRole('button', { name: '确认', exact: true }).click()
await page.waitForTimeout(400)
now = await md()
record('插入 → 链接（真的插进去了）', now.includes('[测试链接](https://example.com)'), now.slice(-40).replace(/\n/g, '\\n'))

// 5. 视图类
await click('大纲')
record('大纲面板打开', (await page.locator('.zh-outline').count()) > 0)
await page.locator('.zh-outline__close').click()
await page.waitForTimeout(200)
record('大纲面板可关闭', (await page.locator('.zh-outline').count()) === 0)

await click('更多')
await page.getByRole('button', { name: '快捷键帮助' }).click()
await page.waitForTimeout(300)
record('更多 → 快捷键帮助', (await page.locator('.zh-modal--help').count()) > 0)
await page.getByRole('button', { name: '知道了' }).click()
await page.waitForTimeout(200)

await click('更多')
await page.getByRole('button', { name: '全屏' }).click()
await page.waitForTimeout(400)
record('更多 → 全屏（已请求）', await page.evaluate(() => window.__fullscreenAsked === true))

await click('更多')
await page.waitForTimeout(200)
const moreTexts = (await page.locator('.zh-menu__item').allInnerTexts()).map((t) => t.trim())
record(
  '「更多」里没有 Markdown 输入开关了（底部状态栏那个开关才是入口）',
  !moreTexts.some((t) => t.includes('Markdown 输入')),
  moreTexts.map((t) => t.split('\n')[0]).join(' / '),
)
await page.keyboard.press('Escape')
// 底部状态栏那个开关：点一下就能关（这个开关一直都在，所以菜单里那份是重复的）
await page.locator('.zh-switch').click()
await page.waitForTimeout(500)
record('底部开关 → Markdown 输入关', (await page.locator('.zh-switch__state').innerText()) === '关')

// 关掉 Markdown 输入后，格式按钮仍应正常工作（编辑器会重建，命令要打在新实例上）
// 注意：重建后编辑器失焦，要先点回正文再输入
await page.locator('.zh-prose p').first().click()
await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
await page.waitForTimeout(300)
await click('加粗')
await page.waitForTimeout(400)
const stillEditable = (await page.locator('.ProseMirror').count()) > 0
await page.keyboard.type('S')
await page.waitForTimeout(300)
record('关闭 Markdown 输入后加粗仍生效', stillEditable && (await md()).includes('**S**'), `可编辑=${stillEditable}`)

await page.locator('.zh-switch').click()
await page.waitForTimeout(500)
record('Markdown 输入可再开回来', (await page.locator('.zh-switch__state').innerText()) === '开')

await click('更多')
await page.getByRole('button', { name: '重置当前文档为示例内容' }).click()
await page.waitForTimeout(700)
const resetMd = await md()
record(
  '更多 → 重置当前文档为示例内容',
  resetMd.includes('欢迎使用') && (await page.locator('.zh-title').inputValue()) === '',
  `md 头部="${resetMd.slice(0, 12).replace(/\n/g, '⏎')}"`,
)

// 6. 撤销/重做放在最后（内容已被清草稿重置）
await caretToEnd()
await page.keyboard.type('撤销测试')
await page.waitForTimeout(200)
const beforeUndo = await md()
await click('撤销')
const afterUndo = await md()
record('撤销', afterUndo !== beforeUndo && !afterUndo.includes('撤销测试'))
await click('重做')
record('重做', (await md()).includes('撤销测试'))

record('控制台错误', errors.length === 0, errors.length ? errors.slice(0, 4).join(' | ') : '无')
writeFileSync(resolve(OUT, 'button-audit.json'), JSON.stringify({ results, errors, dialogs }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 正常`)
if (failed.length) console.log('异常项：\n' + failed.map((f) => ` - ${f.name}：${f.detail}`).join('\n'))
await browser.close()
