/**
 * 助手 · 图片链路测试：标题 + 正文 + 公式 + 图片 一起上传，验证草稿里都在。
 * 会往知乎草稿箱写一篇标题以「Dadealbit 图片测试」开头的草稿（可删）。
 * 注意：图片现在**跟着正文一起粘**，助手自己会把它交给知乎托管 —— 不再占用系统剪贴板，
 * 也不会弹出浏览器窗口（无头即可）。这条脚本专门盯"图片到底进没进草稿"。
 * 更全面的链路验证看 `pnpm audit:zhihu`（面板 + 助手 + 真草稿 14 项）和助手的 /selfcheck。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe', 'zhihu-draft')
mkdirSync(OUT, { recursive: true })
const PORT = 5187
const TOKEN = 'imgtest-' + Date.now().toString(36)
const BASE = `http://127.0.0.1:${PORT}`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// 一张 240x140 的 PNG（红蓝双色块），当作"笔记里贴的图"
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAACMCAYAAADwZ2dGAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACPSURBVHhe7cExAQAAAMKg9U9tDB8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA1A0kAAQABAAAAAElFTkSuQmCC'

const html = [
  '<h2>图片链路测试</h2>',
  '<p>先一句话，然后是一张图：</p>',
  `<img src="data:image/png;base64,${PNG_B64}">`,
  '<p>图后面还有公式：<span data-latex="a^2+b^2=c^2">a^2+b^2=c^2</span> 结束。</p>',
].join('')

console.log('拉起助手（端口 ' + PORT + '，因为有图片会开一个有头窗口）…')
const child = spawn('node', ['scripts/zhihu-assistant.mjs', '--port', String(PORT), '--token', TOKEN], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (d) => (logs += String(d)))
child.stderr.on('data', (d) => (logs += String(d)))

try {
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${BASE}/status?token=${TOKEN}`)).ok) break
    } catch {
      /* 等启动 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  check('助手已就绪', true)

  const title = `Dadealbit 图片测试 ${new Date().toISOString().slice(11, 16)}`
  console.log('\n上传中（图片要等知乎托管，可能要一两分钟）…')
  const t0 = Date.now()
  const res = await fetch(`${BASE}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: JSON.stringify({ title, html }),
  })
  const json = await res.json()
  console.log('  返回：' + JSON.stringify(json).slice(0, 520))
  console.log('  耗时：' + ((Date.now() - t0) / 1000).toFixed(1) + 's')

  check('标题写进草稿', json.title === title, String(json.title))
  check('公式插入成功', (json.formulasInserted ?? 0) >= 1, `${json.formulasInserted} 个`)
  check('图片插入成功', (json.imagesInserted ?? 0) >= 1, `${json.imagesInserted} 张`)
  check('刷新后草稿里确实有图片', (json.imagesInDraft ?? 0) >= 1, `${json.imagesInDraft} 张`)
  check('刷新后正文也在', !!json.previewText, String(json.previewText).slice(0, 40))
  if (json.warnings?.length) console.log('  警告：' + json.warnings.join(' | '))

  writeFileSync(resolve(OUT, 'image-test.json'), JSON.stringify({ results, json }, null, 2))
} catch (e) {
  check('测试执行', false, String(e).slice(0, 200))
} finally {
  child.kill()
  await new Promise((r) => setTimeout(r, 800))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} 通过`)
  if (failed) console.log('\n助手日志尾部：\n' + logs.split('\n').slice(-14).join('\n'))
  process.exit(failed ? 1 : 0)
}
