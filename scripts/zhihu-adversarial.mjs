/**
 * 对抗性测试：这个功能在异常输入下会不会干坏事
 *  A. 空内容 / 只有空白 → 会不会把知乎草稿清空？
 *  B. 超长标题（>100 字）→ 会怎样？
 *  C. 未登录的助手（全新配置）→ 报错是否可操作？
 *  D. 请求体过大 / 缺字段 → 助手怎么反应？
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('.probe', 'zhihu-draft')
mkdirSync(OUT, { recursive: true })
const PORT = 5189
const TOKEN = 'adversarial-' + Date.now().toString(36)
const BASE = `http://127.0.0.1:${PORT}`

const results = []
const note = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok === true ? '✅' : ok === 'info' ? 'ℹ️ ' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const api = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** 等一下助手的启动（状态探测要走请求头） */
const status = () => fetch(`${BASE}/status`, { headers: { 'x-dadealbit-token': TOKEN } })

console.log('拉起助手…')
const child = spawn('node', ['scripts/zhihu-assistant.mjs', '--port', String(PORT), '--token', TOKEN], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (d) => (logs += String(d)))
child.stderr.on('data', (d) => (logs += String(d)))
for (let i = 0; i < 40; i += 1) {
  try {
    if ((await status()).ok) break
  } catch {
    /* 等 */
  }
  await new Promise((r) => setTimeout(r, 500))
}

try {
  /* ---------- 先把一篇"有内容"的草稿放进去，作为被破坏的基准 ---------- */
  console.log('\n=== 先写入一篇有内容的草稿（基准）===')
  const baselineTitle = `Dadealbit 对抗测试基准 ${new Date().toISOString().slice(11, 16)}`
  const base = await api('/draft', {
    title: baselineTitle,
    html: '<h2>基准内容</h2><p>这段文字如果被清空就说明出问题了。</p>',
  })
  note('基准草稿写入成功', base.json?.saved === true, `标题=${base.json?.title}`)

  /* ---------- A. 空内容（现在应该被拒绝，且不能动草稿）---------- */
  console.log('\n=== A. 发一个空内容（应该被拒绝且不动草稿）===')
  const a = await api('/draft', { title: baselineTitle, html: '<p></p>' })
  console.log('  返回：' + JSON.stringify(a.json).slice(0, 240))
  note('空内容被拒绝（HTTP 400）', a.status === 400, `HTTP ${a.status}`)
  note('拒绝理由说清了"没有动草稿"', /没有动/.test(a.json?.error ?? ''), String(a.json?.error).slice(0, 60))

  // 再确认草稿本身没被动过：写一篇正常内容，看基准内容是否还在（不覆盖的前提下无法直接读，
  // 所以这里用"上传空内容后再传一篇正常内容，检查返回体"来间接确认助手没有清空）
  const a2 = await api('/draft', { title: baselineTitle, html: '<p>第二次正常内容</p>' })
  note('空内容之后再传正常内容仍然成功', a2.json?.saved === true, `标题=${a2.json?.title}`)

  /* ---------- B. 超长标题（应自动截断到 100 字并提示）---------- */
  console.log('\n=== B. 超长标题（156 字）===')
  const longTitle = 'Dadealbit 超长标题测试' + '标题'.repeat(70)
  const b = await api('/draft', { title: longTitle, html: '<p>超长标题测试正文</p>' })
  const zhihuTitle = b.json?.title ?? ''
  note(
    '超长标题被截断到 100 字并且上传成功',
    b.json?.ok === true && [...zhihuTitle].length === 100,
    `发 ${[...longTitle].length} 字 → 草稿 ${[...zhihuTitle].length} 字，ok=${b.json?.ok}`,
  )
  note('并且提示了截断', /截断/.test(JSON.stringify(b.json?.warnings ?? [])), JSON.stringify(b.json?.warnings ?? []).slice(0, 80))

  /* ---------- C. 缺字段（不能再 500）---------- */
  console.log('\n=== C. 缺字段 ===')
  const c1 = await api('/draft', {})
  note('完全空请求被拒绝（400）', c1.status === 400, `HTTP ${c1.status}`)
  const c3 = await api('/draft', { title: '只有标题没有正文' })
  note('只有标题没有正文被拒绝（400，不是 500 崩溃）', c3.status === 400, `HTTP ${c3.status} ${JSON.stringify(c3.json).slice(0, 90)}`)

  /* ---------- D. 鉴权 ---------- */
  console.log('\n=== D. 鉴权边界 ===')
  const bad = await fetch(`${BASE}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': 'wrong' },
    body: JSON.stringify({ title: 'x', html: '<p>x</p>' }),
  })
  note('错误令牌被拒绝', bad.status === 401, `HTTP ${bad.status}`)
  const noTok = await fetch(`${BASE}/status`)
  note('无令牌被拒绝', noTok.status === 401, `HTTP ${noTok.status}`)
  const queryTok = await fetch(`${BASE}/status?token=${TOKEN}`)
  note('令牌放 URL 查询参数已不再被接受（防泄露）', queryTok.status === 401, `HTTP ${queryTok.status}`)
  const headerTok = await fetch(`${BASE}/status`, { headers: { 'x-dadealbit-token': TOKEN } })
  note('令牌走请求头正常', headerTok.status === 200, `HTTP ${headerTok.status}`)

  /* ---------- 并发 ---------- */
  console.log('\n=== E. 并发两个上传请求 ===')
  const p1 = api('/draft', { title: '并发A', html: '<p>A</p>' })
  await new Promise((r) => setTimeout(r, 800))
  const p2 = api('/draft', { title: '并发B', html: '<p>B</p>' })
  const [r1, r2] = await Promise.all([p1, p2])
  note(
    '并发时第二个被挡住（不会两个页面互相打架）',
    r2.status === 429 || r1.status === 429,
    `第一个 HTTP ${r1.status}，第二个 HTTP ${r2.status}`,
  )
} catch (e) {
  note('测试执行', false, String(e).slice(0, 200))
} finally {
  writeFileSync(resolve(OUT, 'adversarial.json'), JSON.stringify({ results, logsTail: logs.split('\n').slice(-20) }, null, 2))
  child.kill()
  await new Promise((r) => setTimeout(r, 800))
  for (const r of results) if (r.ok === false) console.log(`\n⚠️ ${r.name} — ${r.detail}`)
  console.log(`\n完成（详情见 .probe/zhihu-draft/adversarial.json）`)
}
