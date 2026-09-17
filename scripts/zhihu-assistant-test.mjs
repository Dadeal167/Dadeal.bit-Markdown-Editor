/**
 * 端到端验证「本地知乎助手」：起助手 → 调用 /status 与 /draft → 检查草稿是否真的存住。
 *
 * 用法：node scripts/zhihu-assistant-test.mjs
 * 会往你知乎草稿箱写一篇标题为「Dadealbit 助手自检 …」的草稿（可删）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const OUT = resolve('.probe', 'zhihu-draft')
mkdirSync(OUT, { recursive: true })
const PORT = 5179
const TOKEN = 'testtoken-' + Date.now().toString(36)
const BASE = `http://127.0.0.1:${PORT}`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const api = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

console.log('启动助手（隐藏窗口）…')
const child = spawn('node', ['scripts/zhihu-assistant.mjs', '--port', String(PORT), '--token', TOKEN], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (d) => {
  logs += String(d)
})
child.stderr.on('data', (d) => {
  logs += String(d)
})

const waitUp = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      // 令牌只认请求头（助手已不接受 URL 查询参数里的令牌 —— 那会留在日志/历史里）
      const r = await fetch(`${BASE}/status`, { headers: { 'x-dadealbit-token': TOKEN } })
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

try {
  check('助手能启动并响应 /status', await waitUp(), `端口 ${PORT}`)

  const noToken = await fetch(`${BASE}/status`).then((r) => r.status)
  check('没有令牌会被拒绝（401）', noToken === 401, `HTTP ${noToken}`)

  const st = await api('/status')
  check('/status 返回结构与登录提示', st.json?.ok === true, JSON.stringify(st.json))

  const tokenFile = resolve(homedir(), '.dadealbit', 'token.txt')
  check('令牌落盘（供脚本/编辑器读取）', existsSync(tokenFile), tokenFile)

  // 造一份带公式、表格、颜色、列表的"文档 HTML"（等价于编辑器导出的内容）
  const html = [
    '<h2>自检：这是二级标题</h2>',
    '<p>普通段落，含 <strong>加粗</strong> 与 <span style="color:#d93025">红色文字</span>。</p>',
    '<p>行内公式：<span data-latex="x^2+y^2=1">x^2+y^2=1</span> ，后面继续写。</p>',
    '<ul><li>列表项一</li><li>列表项二</li></ul>',
    '<blockquote><p>引用块</p></blockquote>',
    '<table><tbody><tr><th>列A</th><th>列B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    '<p><a href="https://www.example.com/">一个链接</a></p>',
  ].join('')

  const title = `Dadealbit 助手自检 ${new Date().toISOString().slice(11, 16)}`
  console.log('\n调用 /draft 上传（这一步会真的写进你知乎草稿箱）…')
  const t0 = Date.now()
  const draft = await api('/draft', { title, html })
  const cost = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('  返回：' + JSON.stringify(draft.json).slice(0, 400))

  check('/draft 调用成功', draft.status === 200 && draft.json?.ok === true, `耗时 ${cost}s`)
  check('草稿里的标题与提交一致', draft.json?.title === title, String(draft.json?.title))
  check('公式插入成功', (draft.json?.formulasInserted ?? 0) >= 1, `成功 ${draft.json?.formulasInserted} 个，失败 ${draft.json?.formulasFailed} 个`)
  check('刷新校验：草稿确实存在', draft.json?.saved === true, `草稿里公式节点 ${draft.json?.formulasInDraft} 个`)
  if (draft.json?.warnings?.length) console.log('  警告：' + draft.json.warnings.join(' | '))

  // 第二次上传同一标题：现在助手会**先按标题找回同名草稿**再写（知乎写作页每次打开都是新草稿，
  // 不复用就会在草稿箱里越堆越多）
  console.log('\n再传一次（验证「按标题复用同名草稿」）…')
  const second = await api('/draft', { title, html: html.replace('列表项一', '列表项一（已更新）') })
  check('重复上传仍然成功、标题一致', second.json?.ok === true && second.json?.title === title, String(second.json?.title))
  check(
    '第二次是"更新同名草稿"而不是又新建一篇',
    second.json?.reusedDraft === true,
    `reusedDraft=${second.json?.reusedDraft}（第一次是 ${draft.json?.reusedDraft}）`,
  )

  writeFileSync(resolve(OUT, 'assistant-test.json'), JSON.stringify({ results, logs }, null, 2))
} catch (e) {
  check('测试执行', false, String(e).slice(0, 200))
} finally {
  child.kill()
  await new Promise((r) => setTimeout(r, 800))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} 通过`)
  if (failed) {
    console.log('\n助手日志（尾部）：')
    console.log(logs.split('\n').slice(-12).join('\n'))
  }
  process.exit(failed ? 1 : 0)
}
