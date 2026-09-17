/**
 * 实测：助手 /upload-images → 图片进图床仓库 → jsDelivr 公开网址能打开
 * 研究用（需要本机能 git push 到 GitHub）
 */
import { spawn } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'

const PORT = 5189
const TOKEN = 'bedtest-' + Date.now().toString(36)
const BASE = `http://127.0.0.1:${PORT}`

function solidPng(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y += 1) {
    const off = y * (w * 3 + 1)
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = fn(x, y)
      raw[off + 1 + x * 3] = r
      raw[off + 2 + x * 3] = g
      raw[off + 3 + x * 3] = b
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
// 两张不一样的图，验证"两张都传上去、顺序对得上、重复上传不重复提交"
const png1 = solidPng(200, 80, (x) => (x < 100 ? [230, 60, 60] : [60, 90, 230]))
const png2 = solidPng(200, 80, () => [60, 200, 120])
const images = [`data:image/png;base64,${png1.toString('base64')}`, `data:image/png;base64,${png2.toString('base64')}`]

console.log(`拉起助手（端口 ${PORT}）…`)
const child = spawn('node', ['scripts/zhihu-assistant.mjs', '--port', String(PORT), '--token', TOKEN], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', (d) => (logs += String(d)))
child.stderr.on('data', (d) => (logs += String(d)))

try {
  let up = false
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${BASE}/status`, { headers: { 'x-dadealbit-token': TOKEN } })
      if (r.ok) {
        up = true
        break
      }
    } catch {
      /* 等启动 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('  助手已就绪：' + up)

  console.log('\n调用 /upload-images（两张图）…')
  const t0 = Date.now()
  const res = await fetch(`${BASE}/upload-images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: JSON.stringify({ images }),
  })
  const json = await res.json()
  console.log(`  HTTP ${res.status}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('  返回：' + JSON.stringify(json).slice(0, 500))

  let allOk = true
  for (const [i, u] of (json.urls ?? []).entries()) {
    if (!u) {
      allOk = false
      console.log(`  第 ${i + 1} 张：没有网址 ✗`)
      continue
    }
    const r = await fetch(u)
    const buf = Buffer.from(await r.arrayBuffer())
    const isPng = buf[0] === 0x89 && buf.toString('ascii', 12, 16) === 'IHDR'
    console.log(`  第 ${i + 1} 张：HTTP ${r.status}，${(buf.length / 1024).toFixed(1)} KB，PNG 头正确：${isPng}`)
    console.log(`     ${u}`)
    if (!r.ok || !isPng) allOk = false
  }

  console.log('\n重复上传同一张（应该不用新提交、网址不变）…')
  const again = await (await fetch(`${BASE}/upload-images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dadealbit-token': TOKEN },
    body: JSON.stringify({ images: [images[0]] }),
  })).json()
  console.log(`  added=${again.added ?? '(未返回)'}，网址一致：${again.urls?.[0] === json.urls?.[0]}`)

  console.log('\n结论：' + (allOk ? '✅ 图片上传 + 公开网址全部可用' : '⚠️ 有问题，看上面'))
} catch (e) {
  console.log('出错：' + String(e).slice(0, 300))
} finally {
  child.kill()
  await new Promise((r) => setTimeout(r, 600))
  console.log('\n助手日志尾部：\n' + logs.split('\n').slice(-10).join('\n'))
}
