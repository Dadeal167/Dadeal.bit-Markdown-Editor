/**
 * 整链路集成测试：编辑器 →「存到知乎草稿箱」→ 本机助手 → 知乎草稿
 *
 * 会真实往你知乎草稿箱写一篇草稿（标题以「Dadealbit 集成测试」开头，可删）。
 * 前提：pnpm dev 在跑（编辑器用 5173），助手由本脚本自己拉起。
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe', 'zhihu-draft')
mkdirSync(OUT, { recursive: true })
const PORT = 5181
const TOKEN = 'integ-' + Date.now().toString(36)
const BASE = `http://127.0.0.1:${PORT}`
const APP = 'http://127.0.0.1:5173/'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

console.log('拉起助手（端口 ' + PORT + '）…')
const child = spawn('node', ['scripts/zhihu-assistant.mjs', '--port', String(PORT), '--token', TOKEN], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (d) => (logs += String(d)))
child.stderr.on('data', (d) => (logs += String(d)))

const waitAssistant = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      // 令牌走请求头（助手已不再接受 URL 里的令牌）
      const r = await fetch(`${BASE}/status`, { headers: { 'x-dadealbit-token': TOKEN } })
      if (r.ok) return true
    } catch {
      /* 等它起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)))

try {
  check('助手已就绪', await waitAssistant(), BASE)

  await page.goto(APP, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(1500)

  /* 准备一篇带公式的内容（用编辑器自己的 API，等价于用户点按钮拼出来） */
  const docTitle = `Dadealbit 集成测试 ${new Date().toISOString().slice(11, 16)}`
  await page.locator('.zh-title').fill(docTitle)
  await page.evaluate(() => {
    const ed = window.__EDITOR__
    ed.commands.setContent('<h2>集成测试标题</h2><p>这一段里有公式：</p>')
    ed.commands.focus('end')
  })
  await page.waitForTimeout(400)
  // 用公式弹窗插一个真公式（走的是应用自己的路径）
  await page.locator('.zh-btn[title="公式"]').click()
  await page.waitForSelector('.zh-modal--math', { timeout: 5000 })
  await page.locator('.zh-mathsource').fill('\\frac{a}{b}=\\sqrt{2}')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.waitForTimeout(600)
  const mdHasFormula = await page.evaluate(() => (window.__MD__?.() ?? '').includes('\\frac{a}{b}'))
  check('编辑器里已有一篇带公式的文档', mdHasFormula, await page.locator('.zh-title').inputValue())

  /* 再插一张图片（走工具栏的插图按钮，跟用户操作一致） */
  const png = resolve(OUT, 'integ-image.png')
  writeFileSync(
    png,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAPAAAACMCAYAAADwZ2dGAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACPSURBVHhe7cExAQAAAMKg9U9tDB8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA1A0kAAQABAAAAAElFTkSuQmCC',
      'base64',
    ),
  )
  const imgBtn = page.locator('.zh-btn[title="图片"]')
  if (await imgBtn.count()) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }),
      imgBtn.click(),
    ])
    await chooser.setFiles(png)
    await page.waitForTimeout(2500)
  }
  const imgInDoc = await page.evaluate(() => ({
    imgs: document.querySelectorAll('.ProseMirror img').length,
    dataUrl: /<img[^>]*src="data:/.test(window.__EDITOR__?.getHTML?.() ?? ''),
  }))
  check('编辑器里插入了 1 张图片', imgInDoc.imgs >= 1 && imgInDoc.dataUrl, JSON.stringify(imgInDoc))

  /* 打开「存到知乎草稿箱」面板 */
  await page.locator('.zh-btn[title^="知乎"]').click()
  await page.waitForSelector('.zh-modal--zhihu', { timeout: 5000 })
  check('面板能打开', true)

  // 先填助手地址（测试用的是非默认端口），再填令牌，然后点「重新检测助手」
  // 令牌用真键盘输入（不用 fill），这样才走真实用户那条 React onChange 路径
  const addrInput = page.locator('.zh-zhihu__field input').first()
  const tokenInput = page.locator('.zh-zhihu__field input').nth(1)
  await addrInput.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(BASE, { delay: 5 })
  await tokenInput.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(TOKEN, { delay: 5 })
  await page.locator('.zh-zhihu__recheck').click()
  await page.waitForTimeout(2000)
  const stateText = await page.locator('.zh-zhihu__state').innerText()
  check('面板显示助手已连接', stateText.includes('已连接'), stateText)
  check('令牌经真实键盘输入后已生效', (await tokenInput.inputValue()) === TOKEN, await tokenInput.inputValue())

  // 令牌不对时应被拒（先验一下安全边界）
  await page.locator('.zh-zhihu__field input').nth(1).fill('wrong-token-123')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '存到草稿箱' }).click()
  await page.waitForTimeout(3500)
  const badResult = await page.locator('.zh-zhihu__result').innerText().catch(() => '')
  check('令牌错误会被拒绝', /令牌不对/.test(badResult), badResult.slice(0, 60))

  // 填正确令牌并上传
  await page.locator('.zh-zhihu__field input').nth(1).fill(TOKEN)
  await page.waitForTimeout(300)
  const payload = await page.evaluate(() => {
    const ed = window.__EDITOR__
    const html = ed?.getHTML?.() ?? ''
    return { len: html.length, head: html.slice(0, 90), hasLatexAttr: /data-latex/.test(html) }
  })
  console.log('  将要发送的 HTML：长度 ' + payload.len + '，含 data-latex=' + payload.hasLatexAttr)
  console.log('  开头：' + payload.head)
  await page.getByRole('button', { name: '存到草稿箱' }).click()
  console.log('  正在上传（正文一次交完；图片一张张真粘贴，每张要多等几秒）…')
  // 留足预算：万一知乎那边慢（图片托管、自动保存防抖），别让测试先超时
  await page.waitForSelector('.zh-zhihu__result', { timeout: 420000 })
  await page.waitForFunction(
    () => !document.querySelector('.zh-zhihu__phase'),
    { timeout: 420000 },
  )
  const resultText = await page.locator('.zh-zhihu__result').innerText()
  console.log('  结果：' + resultText.replace(/\n/g, ' | ').slice(0, 200))
  await page.screenshot({ path: resolve(OUT, 'integ-result.png') })

  check('上传成功并提示已存进草稿箱', /已存进知乎草稿箱/.test(resultText), resultText.split('\n')[0]?.slice(0, 60))
  check('结果里报告了公式数量', /公式 \d+ 个/.test(resultText), resultText.match(/公式 \d+ 个/)?.[0] ?? '')
  check('结果里报告了图片数量', /图片 \d+(\/\d+)? 张/.test(resultText), resultText.match(/图片 \d+(\/\d+)? 张/)?.[0] ?? '')
  check(
    '报告的是草稿实际收到的图片数（1/1）',
    /图片 1\/1 张/.test(resultText),
    resultText.match(/图片 \S+ 张/)?.[0] ?? '',
  )

  // 用助手接口核对一次：草稿里确实有这篇
  // 再传一次：标题仍然对得上（注意：实测每次打开写作页都是新草稿，所以这只能说明"标题写对了"，
  // 不能证明"更新的是同一篇"——之前这条的名字写过头了）
  const verify = await fetch(`${BASE}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: JSON.stringify({ title: docTitle, html: '<p>二次校验：再传一次</p>' }),
  }).then((r) => r.json())
  check('第二次上传照样写成功、标题对得上', verify?.title === docTitle, `第二次上传后草稿标题="${verify?.title}"`)

  // 自检端点：拿一篇临时草稿把 正文/公式/图片/表格 各验一遍（用户面板上那个按钮走的就是它）
  const self = await fetch(`${BASE}/selfcheck`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: '{}',
  }).then((r) => r.json())
  check('助手自检端点跑通（正文/公式/图片/表格四项全过）', self?.ok === true, self?.summary ?? self?.error ?? JSON.stringify(self).slice(0, 120))
  if (!self?.ok) console.log('  自检步骤：' + JSON.stringify(self?.steps ?? []).slice(0, 300))

  writeFileSync(resolve(OUT, 'integ-test.json'), JSON.stringify({ results, logs }, null, 2))
  check('页面无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('测试执行', false, String(e).slice(0, 220))
  await page.screenshot({ path: resolve(OUT, 'integ-error.png') }).catch(() => {})
} finally {
  await browser.close().catch(() => {})
  child.kill()
  await new Promise((r) => setTimeout(r, 800))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} 通过`)
  if (failed) console.log('\n助手日志尾部：\n' + logs.split('\n').slice(-14).join('\n'))
  process.exit(failed ? 1 : 0)
}
