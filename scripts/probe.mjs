/**
 * 验证探针（TipTap 内核版）：用系统 Edge 无头跑一遍核心交互
 * 前提：pnpm dev 已在 127.0.0.1:5173 运行
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = 'http://127.0.0.1:5173/'
const OUT = resolve('.probe')
mkdirSync(OUT, { recursive: true })

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const tinyPng = resolve(OUT, 'tiny.png')
writeFileSync(tinyPng, PNG)

const openMd = resolve(OUT, 'open-test.md')
writeFileSync(
  openMd,
  '# 打开测试\n\n从文件读进来的内容：$a^2+b^2=c^2$。\n\n- 文件里的列表\n\n$$\n\\int_0^1 x\\,dx=\\frac{1}{2}\n$$\n',
  'utf-8',
)

const results = []
const record = (step, ok, detail = '') => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
const errors = []
// 嵌入的 B 站播放器会往控制台写自己的报错，那不是我们的问题
const IGNORE_CONSOLE = [
  /bili-user-fingerprint/,
  /report is not found/,
  /bilibili/i,
  // 代理/运营商往页面里插的第三方脚本（实测在 127.0.0.1 上也见到过 B 站的 reporter-pb，
  // 它请求失败会记进控制台）——本地应用不该被这种环境噪音牵连
  /hdslb\.com/,
  /reporter-pb/,
  /jinkela/,
]
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (IGNORE_CONSOLE.some((re) => re.test(text))) return
  errors.push('console: ' + text)
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const getMd = () =>
  page.evaluate(() => {
    // 用应用真正会保存的那份（含转义）；底层 storage.markdown.getMarkdown() 拿到的是内部标记
    if (typeof window.__MD__ === 'function') return window.__MD__()
    return window.__EDITOR__ ? '(no __MD__)' : '(no editor)'
  })

// 公式输入框是普通 textarea（可视化填空模式已按用户要求移除）
const fieldValue = () =>
  page.evaluate(() => {
    const ta = document.querySelector('.zh-mathsource')
    return ta ? ta.value : ''
  })

try {
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve(OUT, '01-initial.png'), fullPage: true })
  record('编辑器初始化（TipTap）', true)

  let md = await getMd()
  record('示例内容已载入', md.includes('欢迎使用'), md.slice(0, 40).replace(/\n/g, '\\n'))
  const demoNodes = await page.locator('.math-node').count()
  record('示例里的公式已解析为公式节点', demoNodes >= 2, `公式节点数: ${demoNodes}`)

  const body = page.locator('.ProseMirror')
  // 注意：不要点编辑器正中央——示例里有居中的块级公式，点上去会（按设计）打开公式弹窗
  const firstPara = page.locator('.zh-prose p').first()
  await firstPara.click()
  await page.keyboard.press('Control+End')

  // 1. 加粗：空选区点按钮再打字（TipTap 的 stored marks）
  await page.getByRole('button', { name: '加粗' }).click()
  await page.keyboard.type('加粗测试')
  await page.waitForTimeout(300)
  md = await getMd()
  record('加粗（点按钮后直接输入）', md.includes('**加粗测试**'), '尾部: ' + md.slice(-30).replace(/\n/g, '\\n'))

  // 2. 撤销 / 重做
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
  md = await getMd()
  record('撤销', !md.includes('**加粗测试**'))
  await page.keyboard.press('Control+y')
  await page.waitForTimeout(250)
  md = await getMd()
  record('重做', md.includes('**加粗测试**'))

  // 3. 标题下拉 → 二级标题
  await firstPara.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '标题' }).click()
  await page.getByRole('button', { name: '二级标题' }).click()
  await page.keyboard.type('二级标题测试')
  await page.waitForTimeout(300)
  md = await getMd()
  record('标题下拉 → 二级标题', md.includes('## 二级标题测试'), '尾部: ' + md.slice(-30).replace(/\n/g, '\\n'))

  // 4. 列表
  await firstPara.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('列表测试')
  await page.getByRole('button', { name: '列表' }).click()
  await page.getByRole('button', { name: '无序列表' }).click()
  await page.waitForTimeout(300)
  md = await getMd()
  record('列表下拉 → 无序列表', /[*-]\s*列表测试/.test(md), '相关: ' + (md.match(/[*-]\s*列表测试.*/)?.[0] ?? '未找到'))

  // 5. 公式弹窗（知乎骨架 + latexLive 分类面板 + 功能行）
  await page.getByRole('button', { name: '公式', exact: true }).click()
  await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
  const modalBox = await page.locator('.zh-modal--math').boundingBox()
  record(
    '公式弹窗尺寸 880×660',
    !!modalBox && Math.round(modalBox.width) === 880 && Math.round(modalBox.height) === 660,
    modalBox ? `${Math.round(modalBox.width)}×${Math.round(modalBox.height)}` : '未找到',
  )
  const catCount = await page.locator('.zh-mathcat').count()
  record('分类 10 个', catCount === 10, `实际 ${catCount} 个`)
  record('快捷碎片行已移除', (await page.locator('.zh-mathchip').count()) === 0)
  record('可视化模式已移除（只剩输入框）', (await page.locator('.zh-mathsource').count()) === 1)

  // 分类面板：点开 → 分组标题 → 符号按钮
  await page.locator('.zh-mathcat', { hasText: '分数微分' }).click()
  await page.waitForSelector('.zh-mathpanel', { timeout: 3000 })
  const secTitles = await page.locator('.zh-mathsec__title').allInnerTexts()
  record('分类面板带分组标题', secTitles.length >= 3, secTitles.join(' / '))
  const symbolCount = await page.locator('.zh-mathpanel .zh-symbol').count()
  record('面板符号数量合理（≥15）', symbolCount >= 15, `${symbolCount} 个符号`)
  const faceBox = await page.locator('.zh-mathpanel .zh-symbol .katex').first().boundingBox()
  record(
    '符号按钮图形可见',
    !!faceBox && faceBox.width >= 10 && faceBox.height >= 16,
    faceBox ? `${Math.round(faceBox.width)}×${Math.round(faceBox.height)}px` : '未找到',
  )

  await page.locator('.zh-mathpanel .zh-symbol').first().click()
  await page.waitForTimeout(300)
  let tex = await fieldValue()
  record('点符号插入代码', tex.includes('\\frac'), '输入区: ' + tex)
  record('插入后面板自动收起', (await page.locator('.zh-mathpanel').count()) === 0)

  // 清空
  await page.locator('.zh-opt', { hasText: '清空' }).click()
  await page.waitForTimeout(200)
  record('清空', (await fieldValue()).trim() === '')

  // 直接在输入框里敲代码（源码输入）
  await page.locator('.zh-mathsource').fill('\\sqrt{x}')
  await page.waitForTimeout(250)
  tex = await fieldValue()
  record('直接输入 TeX', tex.includes('\\sqrt{x}'), '输入区: ' + tex)

  // 功能行：颜色（没选中时应包住整条公式）
  await page.locator('.zh-opt', { hasText: '颜色' }).click()
  await page.locator('.zh-optmenu__item', { hasText: '红色 Red' }).click()
  await page.waitForTimeout(300)
  tex = await fieldValue()
  record('颜色（红色）→ 包住整条公式', tex === '\\color{red}{\\sqrt{x}}', '输入区: ' + tex)

  // 功能行：字号步进
  const beforeSize = await page.locator('.zh-opt__num').innerText()
  await page.locator('.zh-opt--stepper').last().click()
  await page.waitForTimeout(200)
  const afterSize = await page.locator('.zh-opt__num').innerText()
  record('字号步进（16 → 18）', beforeSize === '16' && afterSize === '18', `${beforeSize} → ${afterSize}`)

  // 功能行：环境（套壳 / 去壳）
  await page.locator('.zh-opt', { hasText: '环境' }).click()
  await page.locator('.zh-optmenu__item', { hasText: '对齐 aligned' }).click()
  await page.waitForTimeout(300)
  tex = await fieldValue()
  const wrapped = tex.includes('\\begin{aligned}')
  await page.locator('.zh-opt', { hasText: '环境' }).click()
  await page.locator('.zh-optmenu__item', { hasText: '无环境 none' }).click()
  await page.waitForTimeout(300)
  tex = await fieldValue()
  record('环境：套壳并去壳', wrapped && !tex.includes('\\begin{aligned}'), '当前: ' + tex.slice(0, 40))

  // 源码 / 可视化 切换已移除，这里确认输入框还在
  record('输入框可见', (await page.locator('.zh-mathsource').count()) === 1)
  await page.screenshot({ path: resolve(OUT, '02-math-modal.png') })

  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.waitForTimeout(600)
  md = await getMd()
  const insertedLatex = '\\color{red}{\\sqrt{x}}'
  record('公式插入正文（行内节点）', md.includes(`$${insertedLatex}$`), '尾部: ' + md.slice(-50).replace(/\n/g, '\\n'))

  // 6. 点正文里的公式 → 再次打开编辑
  // 注意：不能用 [data-latex*="\color{red}"] 这种属性选择器——CSS 会把反斜杠当转义符，
  // 改成先读出所有公式节点的 latex，再按序号定位
  const nodeCountBefore = await page.locator('.math-node').count()
  const nodeLatex = await page.evaluate(() =>
    [...document.querySelectorAll('.math-node')].map((n) => n.getAttribute('data-latex') ?? ''),
  )
  const targetIndex = nodeLatex.findIndex((t) => t.includes('color{red}'))
  record('插入的公式节点在正文中', targetIndex >= 0, `共 ${nodeLatex.length} 个公式节点`)
  const insertedNode = page.locator('.math-node').nth(targetIndex < 0 ? nodeLatex.length - 1 : targetIndex)
  // 滚到视口中央后用鼠标坐标点击：节点位于 li 内部时 Playwright 的可操作性检查会误判被遮挡，
  // 而真实鼠标点击（下面这种方式）和真人操作完全一致
  await insertedNode.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(250)
  const nodeBox = await insertedNode.boundingBox()
  if (!nodeBox) throw new Error('找不到公式节点的位置')
  await page.mouse.click(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
  await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
  const reopened = await fieldValue()
  record('点公式节点可再编辑', reopened.includes('\\sqrt{x}'), '回填: ' + reopened.slice(0, 40))
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(300)
  record('取消不产生新节点', (await page.locator('.math-node').count()) === nodeCountBefore)

  // 7. 表格
  await page.getByRole('button', { name: '表格' }).click()
  await page.waitForSelector('.zh-modal--table', { timeout: 5000 })
  await page.locator('.zh-modal--table input[aria-label="输入表格行数"]').fill('2')
  await page.locator('.zh-modal--table input[aria-label="输入表格列数"]').fill('2')
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await page.waitForTimeout(500)
  const tableCount = await page.locator('.ProseMirror table').count()
  record('表格插入', tableCount > 0, `表格数: ${tableCount}`)

  // 7.5 表格结构编辑（光标进表格 → 浮动操作条）
  const tableStats = () =>
    page.evaluate(() => {
      const t = document.querySelector('.ProseMirror table')
      if (!t) return { rows: 0, cols: 0 }
      return { rows: t.querySelectorAll('tr').length, cols: t.querySelector('tr')?.children.length ?? 0 }
    })

  const cell = page.locator('.ProseMirror table td, .ProseMirror table th').first()
  await cell.click()
  await page.waitForTimeout(300)
  record('光标进表格后浮出操作条', (await page.locator('.zh-tablemenu').count()) === 1)
  const sizeLabel = await page.locator('.zh-tablemenu__size').innerText()
  const before7 = await tableStats()
  record(
    '操作条显示表格规模',
    sizeLabel.includes(`${before7.rows} 行`) && sizeLabel.includes(`${before7.cols} 列`),
    `${sizeLabel}（实际 ${before7.rows}×${before7.cols}）`,
  )

  await page.locator('.zh-tablemenu__btn', { hasText: '↓ 插行' }).click()
  await page.waitForTimeout(300)
  const afterRow = await tableStats()
  record('下方插行', afterRow.rows === before7.rows + 1, `${before7.rows} → ${afterRow.rows} 行`)

  await page.locator('.zh-tablemenu__btn', { hasText: '→ 插列' }).click()
  await page.waitForTimeout(300)
  const afterCol = await tableStats()
  record('右侧插列', afterCol.cols === before7.cols + 1, `${before7.cols} → ${afterCol.cols} 列`)

  await page.locator('.zh-tablemenu__btn', { hasText: '删本列' }).click()
  await page.waitForTimeout(300)
  const afterDelCol = await tableStats()
  record('删除本列', afterDelCol.cols === afterCol.cols - 1, `${afterCol.cols} → ${afterDelCol.cols} 列`)

  await page.locator('.zh-tablemenu__btn', { hasText: '删本行' }).click()
  await page.waitForTimeout(300)
  const afterDelRow = await tableStats()
  record('删除本行', afterDelRow.rows === afterRow.rows - 1, `${afterRow.rows} → ${afterDelRow.rows} 行`)

  await page.screenshot({ path: resolve(OUT, '02b-table-menu.png') })

  // 光标移出表格 → 操作条消失
  await firstPara.click()
  await page.waitForTimeout(400)
  record('光标移出表格后操作条消失', (await page.locator('.zh-tablemenu').count()) === 0)

  // 删除整个表格（插一个新的 3×3 来验证）
  await page.getByRole('button', { name: '表格' }).click()
  await page.waitForSelector('.zh-modal--table', { timeout: 5000 })
  await page.locator('.zh-modal--table input[aria-label="输入表格行数"]').fill('3')
  await page.locator('.zh-modal--table input[aria-label="输入表格列数"]').fill('3')
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await page.waitForTimeout(500)
  const tablesBefore = await page.locator('.ProseMirror table').count()
  await page.locator('.ProseMirror table td, .ProseMirror table th').last().click()
  await page.waitForTimeout(300)
  await page.locator('.zh-tablemenu__btn', { hasText: '删除表格' }).click()
  await page.waitForTimeout(400)
  const tablesAfter = await page.locator('.ProseMirror table').count()
  record('删除整个表格', tablesAfter === tablesBefore - 1, `${tablesBefore} → ${tablesAfter} 个表格`)

  // 8. 图片（选择本地文件 → 内嵌）
  // 注意：光标先落到普通段落——表格单元格里的内容无法用 Markdown 表格语法表示
  await firstPara.click()
  await page.waitForTimeout(200)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '图片' }).click(),
  ])
  await chooser.setFiles(tinyPng)
  await page.waitForTimeout(1600)
  md = await getMd()
  record('图片插入（内嵌）', md.includes('data:image/png'), `img 数: ${await page.locator('.ProseMirror img').count()}`)

  // 8.5 大图自动压缩（生成一张 2000×1400 的噪声图，体积必然很大）
  const bigPngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1400
    const ctx = canvas.getContext('2d')
    const data = ctx.createImageData(canvas.width, canvas.height)
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = Math.random() * 255
      data.data[i + 1] = Math.random() * 255
      data.data[i + 2] = Math.random() * 255
      data.data[i + 3] = 255
    }
    ctx.putImageData(data, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const bigBuffer = Buffer.from(bigPngBase64, 'base64')
  await firstPara.click()
  await page.waitForTimeout(200)
  const [bigChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '图片' }).click(),
  ])
  await bigChooser.setFiles({ name: 'big-noise.png', mimeType: 'image/png', buffer: bigBuffer })
  await page.waitForTimeout(3000)
  const afterBig = await getMd()
  const embedded = [...afterBig.matchAll(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1].length)
  const biggest = embedded.length ? Math.max(...embedded) : 0
  record(
    '大图自动压缩后内嵌',
    bigBuffer.length > 1500000 && biggest > 0 && biggest < bigBuffer.length * 0.5,
    `原图 ${Math.round(bigBuffer.length / 1024)}KB → 内嵌约 ${Math.round((biggest * 0.75) / 1024)}KB`,
  )

  // 9. 视频（B 站链接 → iframe）
  await page.getByRole('button', { name: '视频' }).click()
  await page.waitForSelector('.zh-modal--video', { timeout: 5000 })
  await page.locator('.zh-modal--video input').fill('https://www.bilibili.com/video/BV1xx411c7mD')
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await page.waitForTimeout(600)
  const iframeCount = await page.locator('.video-node iframe').count()
  record('视频嵌入（B 站 iframe）', iframeCount > 0, `iframe 数: ${iframeCount}`)

  // 10. Markdown 输入开关（替代了原来的整篇源码模式）
  const switchState = () => page.locator('.zh-switch__state').innerText()
  record('Markdown 输入默认开启', (await switchState()) === '开', await switchState())

  /* 切开关会**把编辑器实例整个换掉**（TipTap 的输入规则只能在建实例时设定）。
     所以每次切换后要等"新实例真的在位"，不能只等固定毫秒数 —— 否则后面 focus('end')
     打在已经销毁的旧实例上，字打进了虚空（在自用分支上实测偶发失败，就是这一步没等对）。 */
  const editorId = () =>
    page.evaluate(() => {
      window.__PROBE_ED__ = (window.__PROBE_ED__ ?? 0) + 1
      window.__PROBE_ED_OBJ__ = window.__EDITOR__
      return { seq: window.__PROBE_ED__, destroyed: window.__EDITOR__?.isDestroyed ?? true }
    })
  const waitEditorRebuilt = async () => {
    const before = await page.evaluate(() => window.__EDITOR__)
    await page.waitForFunction(
      (old) => {
        const ed = window.__EDITOR__
        return Boolean(ed) && ed !== old && !ed.isDestroyed
      },
      before,
      { timeout: 8000 },
    )
    await page.waitForTimeout(300)
  }
  void editorId

  /** 把光标放到文末再打字（点一下正文，确保键盘事件落进编辑器而不是别处） */
  const typeAtEnd = async (text) => {
    await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
    await page.locator('.ProseMirror').click({ position: { x: 40, y: 20 } }).catch(() => {})
    await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
    await page.keyboard.press('Enter')
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(350)
  }

  // 开启时：输入 "# " 应自动变成一级标题
  await typeAtEnd('# 语法转换测试')
  const h1WithRule = await page.locator('.ProseMirror h1', { hasText: '语法转换测试' }).count()
  record('开启时输入 "# " 自动变标题', h1WithRule === 1, `找到 ${h1WithRule} 个 h1`)

  // 关掉开关：同样的输入应保持原样
  await page.locator('.zh-switch').click()
  await waitEditorRebuilt()
  record('开关已关闭', (await switchState()) === '关', await switchState())
  const keptContent = await getMd()
  record('重建编辑器后内容不丢', keptContent.includes('语法转换测试') && keptContent.includes('二级标题测试'))

  await typeAtEnd('# 关闭后测试')
  const h1WithoutRule = await page.locator('.ProseMirror h1', { hasText: '关闭后测试' }).count()
  const literalText = await page.locator('.ProseMirror').innerText()
  const mdAfterOff = await getMd()
  record(
    '关闭时输入 "# " 保持原样',
    h1WithoutRule === 0 && (literalText.includes('# 关闭后测试') || mdAfterOff.includes('# 关闭后测试')),
    `h1 数 ${h1WithoutRule}；DOM 尾="${literalText.slice(-24).replace(/\n/g, '⏎')}"；md 尾="${mdAfterOff.slice(-24).replace(/\n/g, '⏎')}"`,
  )
  await page.screenshot({ path: resolve(OUT, '03-markdown-input-off.png'), fullPage: true })

  // 再开回来
  await page.locator('.zh-switch').click()
  await waitEditorRebuilt()
  record('可以再开回来', (await switchState()) === '开', await switchState())

  // 11. 大纲导航
  await page.getByRole('button', { name: '大纲' }).click()
  await page.waitForSelector('.zh-outline', { timeout: 5000 })
  const outlineText = await page.locator('.zh-outline').innerText()
  record('大纲面板列出标题', outlineText.includes('二级标题测试'), '大纲: ' + outlineText.replace(/\n/g, ' / ').slice(0, 60))
  await page.screenshot({ path: resolve(OUT, '04-outline.png'), fullPage: true })
  await page.locator('.zh-outline__close').click()

  // 11.5 白卡撑满视口高度（像知乎那样，下方不留大片灰底）
  const cardGeom = await page.evaluate(() => {
    const card = document.querySelector('.editor-card')?.getBoundingClientRect()
    const bar = document.querySelector('.zh-statusbar')?.getBoundingClientRect()
    return {
      cardBottom: card ? Math.round(card.bottom) : 0,
      cardHeight: card ? Math.round(card.height) : 0,
      barTop: bar ? Math.round(bar.top) : 0,
      viewport: window.innerHeight,
    }
  })
  const expectMin = cardGeom.viewport - 98
  record(
    '白卡撑满视口高度',
    cardGeom.cardHeight >= expectMin - 2,
    `卡高 ${cardGeom.cardHeight}px，视口 ${cardGeom.viewport}px（期望 ≥ ${expectMin}）`,
  )
  record(
    '白卡下方不留灰底空隙',
    cardGeom.cardBottom >= cardGeom.barTop - 2,
    `卡底 ${cardGeom.cardBottom} vs 状态栏顶 ${cardGeom.barTop}（内容长时卡会继续往下长）`,
  )

  // 11.6 另存为 PDF
  await page.evaluate(() => {
    window.__printCalled = false
    window.print = () => {
      window.__printCalled = true
    }
  })
  await page.locator('.zh-btn[title="保存"]').click()
  await page.waitForTimeout(300)
  await page.locator('.zh-menu__item[data-format="pdf"]').click()
  await page.waitForTimeout(400)
  record('保存 → 另存为 PDF 可点', await page.evaluate(() => window.__printCalled === true))

  // 打印样式：工具栏/状态栏/表格操作条都不该印出来，白卡也不再撑满高度
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  const printState = await page.evaluate(() => {
    const display = (sel) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).display : null
    }
    const card = document.querySelector('.editor-card')
    return {
      toolbar: display('.zh-toolbar'),
      statusbar: display('.zh-statusbar'),
      tablemenu: display('.zh-tablemenu'),
      cardMinHeight: card ? getComputedStyle(card).minHeight : null,
    }
  })
  record(
    '打印时隐藏工具栏 / 状态栏',
    printState.toolbar === 'none' && printState.statusbar === 'none',
    `toolbar=${printState.toolbar} statusbar=${printState.statusbar}`,
  )
  record('打印时白卡不再固定高度', printState.cardMinHeight === '0px', `min-height=${printState.cardMinHeight}`)

  // 真的导出一份 PDF，确认内容不是空白
  const pdfPath = resolve(OUT, 'export-test.pdf')
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  const pdfSize = readFileSync(pdfPath).length
  record('能生成 PDF（非空白）', pdfSize > 20000, `${Math.round(pdfSize / 1024)} KB → .probe/export-test.pdf`)

  // 按钮多了以后最容易踩的坑：工具栏容器加了 overflow 会把下拉面板裁掉（人眼看不到，但测试仍点得到）
  await page.locator('.zh-btn[title="更多"]').click()
  await page.waitForTimeout(300)
  const menuBox = await page.locator('.zh-menu').first().boundingBox()
  record(
    '工具栏下拉菜单可见（没被容器裁剪）',
    !!menuBox && menuBox.height > 40 && menuBox.y > 0,
    menuBox ? `菜单位置 y=${Math.round(menuBox.y)}，高 ${Math.round(menuBox.height)}px` : '未找到菜单',
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 12. 打开 .md（含公式，验证 Markdown 回读）
  const [openChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '打开' }).click(),
  ])
  await openChooser.setFiles(openMd)
  await page.waitForTimeout(900)
  md = await getMd()
  record(
    '打开 .md（含公式回读）',
    md.includes('打开测试') && md.includes('$a^2+b^2=c^2$') && md.includes('\\int_0^1'),
    '读入: ' + md.slice(0, 46).replace(/\n/g, '\\n'),
  )
  record('文件里的公式渲染为节点', (await page.locator('.math-node').count()) >= 2)

  // 13. 保存 .md（点「保存」→ 菜单里选 Markdown；「导出」已经并进这个菜单）
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page
      .locator('.zh-btn[title="保存"]')
      .click()
      .then(() => page.locator('.zh-menu__item[data-format="plain"]').click()),
  ])
  const savedPath = await download.path()
  const savedText = savedPath ? readFileSync(savedPath, 'utf-8') : ''
  record(
    '保存 .md 文件',
    download.suggestedFilename().endsWith('.md') && savedText.includes('打开测试'),
    `${download.suggestedFilename()}，${savedText.length} 字节`,
  )

  // 14. 导出 HTML（下载）：从「保存」菜单里选
  await page.locator('.zh-btn[title="保存"]').click()
  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('.zh-menu__item[data-format="html"]').click(),
  ])
  const htmlPath = await htmlDownload.path()
  const htmlText = htmlPath ? readFileSync(htmlPath, 'utf-8') : ''
  record(
    '导出 HTML 离线可用（MathML，无 CDN）',
    htmlDownload.suggestedFilename().endsWith('.html') &&
      htmlText.includes('<math') &&
      !htmlText.includes('unpkg.com'),
    `${htmlDownload.suggestedFilename()}，${htmlText.length} 字节`,
  )

  // 15. 文档落盘（多文档存储）
  await page.waitForTimeout(1600)
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('md-editor-docs-v1')
    return raw ? JSON.parse(raw) : null
  })
  const currentDoc = stored?.docs?.find((d) => d.id === stored.currentId)
  record(
    '当前文档写入 localStorage',
    !!currentDoc && currentDoc.md.includes('打开测试'),
    stored ? `${stored.docs.length} 篇文档，当前 ${currentDoc?.md?.length ?? 0} 字节` : '未写入',
  )

  // 16. 视觉计量（规格尺寸）
  const metrics = await page.evaluate(() => {
    const css = (sel, prop) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el)[prop] : null
    }
    const card = document.querySelector('.editor-card')?.getBoundingClientRect()
    const toolbar = document.querySelector('.zh-toolbar')?.getBoundingClientRect()
    const icon = document.querySelector('.zh-btn svg')?.getBoundingClientRect()
    const titleEl = document.querySelector('.zh-title')
    return {
      bodyBg: css('body', 'backgroundColor'),
      cardWidth: card ? Math.round(card.width) : 0,
      cardLeft: card ? Math.round(card.left) : 0,
      viewport: window.innerWidth,
      toolbarHeight: toolbar ? Math.round(toolbar.height) : 0,
      toolbarBg: css('.zh-toolbar', 'backgroundColor'),
      toolbarBorder: css('.zh-toolbar', 'borderBottomWidth'),
      iconSize: icon ? Math.round(icon.width) : 0,
      btnLabelSize: css('.zh-btn__label', 'fontSize'),
      btnHeight: css('.zh-btn', 'height'),
      btnRadius: css('.zh-btn', 'borderRadius'),
      titleSize: css('.zh-title', 'fontSize'),
      titlePlaceholder: titleEl ? getComputedStyle(titleEl, '::placeholder').color : null,
      primaryBg: css('.zh-pill--primary', 'backgroundColor'),
    }
  })
  // 工具栏按钮越来越多，必须保证 1280 宽下全部可见（曾经挤出过屏幕、也换行过）
  const barFit = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.zh-toolbar__group')]
    const last = groups[groups.length - 1]?.getBoundingClientRect()
    return {
      lastRight: last ? Math.round(last.right) : 0,
      viewport: window.innerWidth,
      buttons: document.querySelectorAll('.zh-btn').length,
    }
  })
  const checks = [
    ['页面底色 #f8f8fa', metrics.bodyBg === 'rgb(248, 248, 250)', metrics.bodyBg],
    ['白卡宽 694', metrics.cardWidth === 694, String(metrics.cardWidth)],
    ['白卡居中', Math.abs(metrics.cardLeft - (metrics.viewport - metrics.cardWidth) / 2) <= 1, `left=${metrics.cardLeft}`],
    ['工具栏高 46px（取中规格）', metrics.toolbarHeight === 46, `${metrics.toolbarHeight}px`],
    [
      `工具栏 ${barFit.buttons} 个按钮在 1280 宽下不出屏`,
      barFit.lastRight <= barFit.viewport - 8,
      `最右 ${barFit.lastRight} / 视口 ${barFit.viewport}`,
    ],
    ['工具栏白底 + 下边框', metrics.toolbarBg === 'rgb(255, 255, 255)' && metrics.toolbarBorder === '1px', `${metrics.toolbarBg} / ${metrics.toolbarBorder}`],
    ['图标 18px', metrics.iconSize === 18, `${metrics.iconSize}px`],
    ['按钮文字 12px', metrics.btnLabelSize === '12px', metrics.btnLabelSize],
    ['按钮高 40px', metrics.btnHeight === '40px', metrics.btnHeight],
    ['按钮圆角 4px', metrics.btnRadius === '4px', metrics.btnRadius],
    ['标题 24px', metrics.titleSize === '24px', metrics.titleSize],
    ['标题 placeholder #9196a1', metrics.titlePlaceholder === 'rgb(145, 150, 161)', metrics.titlePlaceholder],
    ['主色 #1772f6', metrics.primaryBg === 'rgb(23, 114, 246)', metrics.primaryBg],
  ]
  for (const [name, ok, detail] of checks) record(name, ok, detail)

  // 17. 空白文档时白卡应"正好"填满到状态栏上沿（内容少也不留灰底）
  await page.evaluate(() => window.__EDITOR__.commands.clearContent())
  await page.waitForTimeout(400)
  const emptyGeom = await page.evaluate(() => {
    const card = document.querySelector('.editor-card')?.getBoundingClientRect()
    const bar = document.querySelector('.zh-statusbar')?.getBoundingClientRect()
    return {
      cardBottom: card ? Math.round(card.bottom) : 0,
      cardHeight: card ? Math.round(card.height) : 0,
      barTop: bar ? Math.round(bar.top) : 0,
      viewport: window.innerHeight,
    }
  })
  record(
    '空文档时正文长于一屏（往下滑还有白纸）',
    emptyGeom.cardHeight > emptyGeom.viewport + 200,
    `卡高 ${emptyGeom.cardHeight}，视口 ${emptyGeom.viewport}`,
  )

  // 滚到底部：白卡仍应铺满视口（不留灰底）
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(400)
  const bottomGeom = await page.evaluate(() => {
    const card = document.querySelector('.editor-card')?.getBoundingClientRect()
    const bar = document.querySelector('.zh-statusbar')?.getBoundingClientRect()
    return {
      cardTop: card ? Math.round(card.top) : 0,
      cardBottom: card ? Math.round(card.bottom) : 0,
      barTop: bar ? Math.round(bar.top) : 0,
    }
  })
  record(
    '滚到底部白卡仍铺满视口',
    bottomGeom.cardBottom >= bottomGeom.barTop - 2 && bottomGeom.cardTop <= 1,
    `卡顶 ${bottomGeom.cardTop}，卡底 ${bottomGeom.cardBottom}，状态栏顶 ${bottomGeom.barTop}`,
  )

  // 点文末空白处 → 光标落到文末，能接着写
  await page.mouse.click(430, 500)
  await page.waitForTimeout(300)
  await page.keyboard.type('探针：空白处接着写')
  await page.waitForTimeout(400)
  record('点文末空白处能接着写', (await getMd()).includes('探针：空白处接着写'))
  await page.screenshot({ path: resolve(OUT, '09-empty-layout.png') })

  await page.screenshot({ path: resolve(OUT, '08-final.png'), fullPage: true })
} catch (e) {
  record('探针执行异常', false, String(e).slice(0, 300))
  await page.screenshot({ path: resolve(OUT, '99-error.png'), fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

record('控制台错误数', errors.length === 0, errors.length === 0 ? '无' : errors.slice(0, 5).join(' | '))
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过；截图与报告在 .probe/`)
process.exit(failed > 0 ? 1 : 0)
