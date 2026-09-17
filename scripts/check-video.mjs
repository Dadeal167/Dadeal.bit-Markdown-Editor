/**
 * 插入视频：认得全、插得进、在**双击版（file://）**里真的能加载。
 *
 * 为什么单独有这一套：用户报"插入视频会失败"。查下来是两个真问题 ——
 *   1. 生成的 B 站地址是**协议相对**的 `//player.bilibili.com/...`：开发服务器（http://）下没事，
 *      但双击打开的单文件 HTML 是 **file:// 协议**，浏览器把它解析成 `file://player.bilibili.com/...`
 *      → 视频永远是一块白框。**所有** B 站视频在双击版里都挂，而以前的测试都在 http 下跑，所以没抓到。
 *   2. 认得出的写法太少：手机分享的短链 b23.tv、YouTube Shorts / 直播、播放器地址（?aid=）全被拒。
 *
 * 所以这套检查**直接在 file:// 下跑**（打开构建出来的单文件 HTML），并且把上面两类都钉住。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const APP = resolve('Dadealbit Markdown 编辑器.html')
if (!existsSync(APP)) {
  console.error('先跑 pnpm build')
  process.exit(1)
}
const app = 'file:///' + APP.replace(/\\/g, '/')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 期望能插入的写法 → 期望的播放地址 */
const OK_CASES = [
  ['完整 B 站链接', 'https://www.bilibili.com/video/BV1xx411c7mD', 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'],
  ['带分 P 与时间参数', 'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=30', 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'],
  ['只粘 BV 号', 'BV1xx411c7mD', 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'],
  ['手机分享文案里夹着链接', '【某视频-哔哩哔哩】 https://www.bilibili.com/video/BV1xx411c7mD 快来看', 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'],
  ['av 号链接', 'https://www.bilibili.com/video/av170001', 'https://player.bilibili.com/player.html?aid=170001&autoplay=0'],
  ['已经是播放器地址（?aid=）', 'https://player.bilibili.com/player.html?aid=170001', 'https://player.bilibili.com/player.html?aid=170001&autoplay=0'],
  ['YouTube 标准链接', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['youtu.be 短链', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['v= 在参数中间', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['Shorts', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['直播回放', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['手机版 youtube', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['前后带空格', '   https://youtu.be/dQw4w9WgXcQ   ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ['结尾多个斜杠', 'https://www.bilibili.com/video/BV1xx411c7mD//  ', 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'],
]

/** 认不出但必须给出"能照做"的提示 */
const HINT_CASES = [
  ['手机分享短链 b23.tv', 'https://b23.tv/abcd1234', 'BV'],
  ['不相干的网址', 'https://example.com/hello', 'BV'],
  ['纯文字', '随便写点什么', 'BV'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })

const openApp = async () => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  await page.goto(app, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForTimeout(900)
  page.__errs = errs
  return page
}

const openVideoModal = async (page) => {
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.zh-toolbar .zh-btn[title="视频"]').click()
  await page.waitForSelector('.zh-modal--video', { timeout: 5000 })
}
const insertButton = (page) =>
  page.locator('.zh-modal--video .zh-btn-solid', { hasText: '插入' })

/* ---------- 1. 能插入的写法：地址必须是 https，且真的插进文档 ---------- */
{
  const page = await openApp()
  const bad = []
  for (const [label, input, want] of OK_CASES) {
    await openVideoModal(page)
    await page.locator('.zh-modal--video input[type="url"]').fill(input)
    await page.waitForTimeout(180)
    const disabled = await insertButton(page).isDisabled()
    if (disabled) {
      bad.push(`${label}：按钮是灰的（认不出）`)
    } else {
      await insertButton(page).click()
      await page.waitForTimeout(350)
      const got = await page.evaluate(() => {
        const all = [...document.querySelectorAll('.video-node')]
        return all.length ? all[all.length - 1].getAttribute('data-video-src') : null
      })
      if (got !== want) bad.push(`${label}：src=${got}`)
      else if (!got.startsWith('https://')) bad.push(`${label}：不是 https（${got}）`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  check('14 种常见写法都能插入、且地址都是 https', bad.length === 0, bad.slice(0, 3).join('；') || `${OK_CASES.length} 种写法`)
  check(
    '插入后 iframe 真的按 https 加载（双击版 file:// 下的关键）',
    await page.evaluate(() => {
      const f = document.querySelector('.video-node iframe')
      return f ? f.src.startsWith('https://player.bilibili.com/') : false
    }),
    await page.evaluate(() => document.querySelector('.video-node iframe')?.src ?? '（没有 iframe）'),
  )
  check('这一轮没有页面错误', page.__errs.length === 0, page.__errs.slice(0, 2).join(' | ') || '无')
  await page.close()
}

/* ---------- 2. 认不出的写法：按钮灰掉 + 给"能照做"的提示 ---------- */
{
  const page = await openApp()
  const bad = []
  for (const [label, input, mustHint] of HINT_CASES) {
    await openVideoModal(page)
    await page.locator('.zh-modal--video input[type="url"]').fill(input)
    await page.waitForTimeout(200)
    const state = await page.evaluate(() => ({
      disabled: [...document.querySelectorAll('.zh-modal--video button')].find((b) => b.textContent.trim() === '插入')?.disabled,
      hint: document.querySelector('.zh-modal--video .zh-link-form__hint')?.textContent?.trim() ?? '',
    }))
    if (!state.disabled) bad.push(`${label}：竟然插进去了`)
    else if (!state.hint.includes(mustHint)) bad.push(`${label}：提示太笼统（${state.hint.slice(0, 20)}）`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  check('认不出的写法：按钮灰掉 + 提示里告诉用户怎么办（提到 BV）', bad.length === 0, bad.join('；') || `${HINT_CASES.length} 种`)
  await page.close()
}

/* ---------- 3. 老文档里的协议相对地址：读回来要自愈成 https ---------- */
{
  const page = await openApp()
  await page.evaluate(() =>
    window.__EDITOR__.commands.setContent(
      '<div data-video-src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0" data-video-kind="bilibili"></div>',
    ),
  )
  await page.waitForTimeout(600)
  const now = await page.evaluate(() => ({
    attr: document.querySelector('.video-node')?.getAttribute('data-video-src') ?? null,
    resolved: document.querySelector('.video-node iframe')?.src ?? null,
  }))
  check(
    '老文档里的 `//player...` 显示时自愈成 https',
    now.attr === 'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0' &&
      (now.resolved ?? '').startsWith('https://player.bilibili.com/'),
    `属性=${now.attr}`,
  )
  // 存成 .md 之后也该是 https（这样下一次打开就不需要再修）
  const md = await page.evaluate(() => window.__MD__())
  check('存下来的 .md 里已经是 https', md.includes('https://player.bilibili.com/'), md.match(/data-video-src="[^"]*"/)?.[0] ?? '(没找到)')
  await page.close()
}

/* ---------- 4. 往返：存成 .md 再打开，视频还在且地址没坏 ---------- */
{
  const page = await openApp()
  await openVideoModal(page)
  await page.locator('.zh-modal--video input[type="url"]').fill('https://www.bilibili.com/video/BV1xx411c7mD')
  await page.waitForTimeout(200)
  await insertButton(page).click()
  await page.waitForTimeout(500)
  const md = await page.evaluate(() => window.__MD__())
  await page.evaluate(
    (text) => window.__EDITOR__.commands.setContent(text, { contentType: 'markdown' }),
    md,
  )
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => {
    const n = document.querySelectorAll('.video-node').length
    const f = document.querySelector('.video-node iframe')
    return { n, src: f?.src ?? null }
  })
  check(
    '存成 .md 再打开：视频节点还在、地址仍是 https',
    after.n === 1 && (after.src ?? '').startsWith('https://player.bilibili.com/'),
    `${after.n} 个节点，src=${after.src}`,
  )
  await page.close()
}

/* ---------- 5. 边角：连插两个、光标在文末分割线之后也能插 ---------- */
{
  const page = await openApp()
  await page.evaluate(() => window.__EDITOR__.commands.setContent('正文\n\n---\n', { contentType: 'markdown' }))
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__EDITOR__.commands.focus('end'))
  await openVideoModal(page)
  await page.locator('.zh-modal--video input[type="url"]').fill('BV1xx411c7mD')
  await page.waitForTimeout(200)
  await insertButton(page).click()
  await page.waitForTimeout(400)
  // 再来一个
  await openVideoModal(page)
  await page.locator('.zh-modal--video input[type="url"]').fill('https://youtu.be/dQw4w9WgXcQ')
  await page.waitForTimeout(200)
  await insertButton(page).click()
  await page.waitForTimeout(500)
  const r = await page.evaluate(() => ({
    videos: document.querySelectorAll('.video-node').length,
    hr: document.querySelectorAll('.ProseMirror hr').length,
    srcs: [...document.querySelectorAll('.video-node')].map((n) => n.getAttribute('data-video-src')),
  }))
  check(
    '连着插两个视频都成功，而且没把文末的分割线弄丢',
    r.videos === 2 && r.hr === 1,
    `${r.videos} 个视频 / ${r.hr} 条分割线`,
  )
  check(
    '两个视频一个是 B 站、一个是 YouTube',
    (r.srcs[0] ?? '').includes('player.bilibili.com') && (r.srcs[1] ?? '').includes('youtube.com/embed'),
    r.srcs.join(' , '),
  )
  check('这一轮没有页面错误', page.__errs.length === 0, page.__errs.slice(0, 2).join(' | ') || '无')
  await page.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
