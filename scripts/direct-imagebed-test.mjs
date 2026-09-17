/**
 * 研究用：验证"编辑器直接上传到图床"这条路能不能走通（不用助手）
 * 关键问题：本地 file:// 页面能不能带令牌调 GitHub 接口（CORS + 预检）
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
const OWNER = 'Dadeal167'
const REPO = 'Dadeal.bit-ImageBed'

const token = await new Promise((ok) => {
  const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => (out += String(d)))
  child.on('close', () => {
    const line = out.split('\n').find((l) => l.startsWith('password='))
    ok(line ? line.slice('password='.length).trim() : '')
  })
  child.stdin.write('protocol=https\nhost=github.com\n\n')
  child.stdin.end()
})
console.log('拿到令牌：' + (token ? '是（长度 ' + token.length + '）' : '否'))

function solidPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y += 1) {
    const off = y * (w * 3 + 1)
    for (let x = 0; x < w; x += 1) {
      raw[off + 1 + x * 3] = 30
      raw[off + 2 + x * 3] = 160
      raw[off + 3 + x * 3] = 240
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
const png = solidPng(120, 60)
const name = `probe-${createHash('sha1').update(png).digest('hex').slice(0, 8)}.png`

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  页面 console 错误: ' + m.text().slice(0, 160))
})
await page.goto('file:///' + APP.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
console.log('编辑器页面已打开（file:// 协议，Origin 是 null）')

const result = await page.evaluate(
  async ({ token, owner, repo, name, b64 }) => {
    const path = `images/${name}`
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
    const out = {}
    // 1) 先读一下仓库信息（顺带验证 CORS 与令牌）
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      })
      out.repo = r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`
    } catch (e) {
      out.repo = 'fetch 出错：' + String(e).slice(0, 120)
    }
    // 2) 上传文件（PUT contents）
    try {
      const r = await fetch(api, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: `probe upload ${name}`, content: b64, branch: 'main' }),
      })
      const text = await r.text()
      out.put = `HTTP ${r.status}` + (r.ok ? '' : ' ' + text.slice(0, 200))
      if (r.ok) {
        const j = JSON.parse(text)
        out.url = `https://gcore.jsdelivr.net/gh/${owner}/${repo}@main/${j.content.path}`
        out.sha = j.content.sha
      }
    } catch (e) {
      out.put = 'fetch 出错：' + String(e).slice(0, 160)
    }
    return out
  },
  { token, owner: OWNER, repo: REPO, name, b64: png.toString('base64') },
)
console.log('\n结果：' + JSON.stringify(result, null, 2).slice(0, 600))

if (result.url) {
  console.log('\n检查公开地址（等几秒分发）…')
  let ok = false
  for (let i = 0; i < 8; i += 1) {
    const r = await fetch(result.url).catch(() => null)
    if (r?.ok) {
      const b = Buffer.from(await r.arrayBuffer())
      console.log(`  HTTP ${r.status}，${b.length} 字节，PNG 头正确：${b[0] === 0x89}`)
      ok = true
      break
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  if (!ok) console.log('  公开地址还没生效（可能还要等）')
  // 顺手删掉探测文件，保持图床干净
  const del = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/images/${name}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({ message: `remove probe ${name}`, sha: result.sha, branch: 'main' }),
  })
  console.log('  清理探测文件 → HTTP ' + del.status)
}
await browser.close()
