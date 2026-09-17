/**
 * 动图（GIF）在插入时**不许被压成静态图**
 *
 * 用户报："用知乎小助手上传到知乎草稿箱的时候，动图没法正常显示"。
 * 查出来是两处，第一处就在这里（编辑器插入图片的那一步）：
 * `prepareImageDataUrl` 把**大于 400KB** 的图片一律丢进 canvas 再 `toDataURL`，
 * 而 canvas 只能画出**第一帧** —— 动图在插进文档的那一刻就变成静态 JPEG 了。
 * 实测（`.probe/probe-gif-insert.mjs`）：
 *   93B 的两帧 GIF   → 还是 image/gif、2 帧（走"小图原样返回"侥幸保住）
 *   450KB 的两帧 GIF → 变成 image/jpeg、**只剩 1 帧** ❌
 *
 * 修法：GIF 先数帧（纯字节解析，不依赖浏览器 API）；
 * **只确实只有 1 帧的 GIF** 才允许压缩，其余（动图 / 解析不出来）一律原样保留。
 * 静态 GIF 照旧压缩，免得把文档体积搞大。
 *
 * ⚠️ 别用 ImageDecoder 判动画：实测它对本机的单帧 GIF 也报 `animated: true`（frames: 0），
 * 判定不可靠；字节解析是可离线验证的（见 .probe/gif-frames.mjs）。
 */
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { gifInfo, makeAnimatedGif, makeStaticGif } from './make-test-gif.mjs'

/**
 * **本套件的断言总数** —— 文档里的数量占位符读的就是这个常量（见 check:docs-counts）。
 * 收尾处有自检：实际跑出来的断言数必须等于它。
 */
export const TEST_COUNT = 6

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const OUT = resolve('.probe', 'out')
const small = makeAnimatedGif(0)
const big = makeAnimatedGif(450 * 1024)
const bigStatic = makeStaticGif(450 * 1024)
const smallPath = resolve(OUT, 'gif-small.gif')
const bigPath = resolve(OUT, 'gif-big.gif')
const staticPath = resolve(OUT, 'gif-static-big.gif')
writeFileSync(smallPath, small)
writeFileSync(bigPath, big)
writeFileSync(staticPath, bigStatic)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 60000 })
await page.waitForSelector('.ProseMirror', { timeout: 30000 })
await page.waitForTimeout(1500)

/** 从 Markdown 里取出那张图的 mime 和字节。
    ⚠️ 正则要认 `data:image/gif;base64,` 里的 **`;base64`** —— 第一版写成
    `data:([^;,]*),` 直接匹配不上，于是"插入成功"也被判成 mime=null（自己踩的坑）。 */
const pickImage = () =>
  page.evaluate(() => {
    const md = window.__MD__()
    const m = md.match(/!\[[^\]]*\]\(data:([^;,]*)(;base64)?,([^)]*)\)/)
    return m ? { mime: m[1], b64: m[3] } : { mime: null, b64: '' }
  })

/** 走真实 UI 插入一张图，返回文档里那张图的 data URL 信息 */
const insert = async (path) => {
  await page.evaluate(() => window.__EDITOR__.commands.clearContent())
  await page.waitForTimeout(250)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.locator('.zh-btn[title="图片"]').click(),
  ])
  await chooser.setFiles(path)
  await page.waitForTimeout(1200)
  return pickImage()
}

/* 1. 小动图（走"小图原样"这条路）——本来就是好的，钉住别退化 */
const s = await insert(smallPath)
const sInfo = s.b64 ? gifInfo(Buffer.from(s.b64, 'base64')) : { frames: 0 }
check(
  '小动图（<400KB）插入后仍是 GIF，帧数不变',
  s.mime === 'image/gif' && sInfo.frames === 2,
  `mime=${s.mime} 帧=${sInfo.frames}`,
)

/* 2. 大动图 —— 这条就是用户踩到的那条（修之前是 image/jpeg、1 帧） */
const b = await insert(bigPath)
const bInfo = b.b64 ? gifInfo(Buffer.from(b.b64, 'base64')) : { frames: 0 }
check(
  '大动图（>400KB）插入后**仍是 GIF 且 2 帧**（不许被 canvas 压成静态图）',
  b.mime === 'image/gif' && bInfo.frames === 2,
  `mime=${b.mime} 帧=${bInfo.frames}（修之前是 image/jpeg、1 帧）`,
)
check(
  '大动图的字节与源文件一致（没有被重编码过）',
  Buffer.from(b.b64, 'base64').equals(big),
  `文档里 ${Buffer.from(b.b64, 'base64').length}B / 源文件 ${big.length}B`,
)

/* 3. 静态大 GIF 仍然要被压缩（别为了动图把文档体积放开） */
const st = await insert(staticPath)
const stBytes = st.b64 ? Buffer.from(st.b64, 'base64').length : 0
check(
  '静态 GIF（只有 1 帧）照旧压缩（体积明显变小）',
  st.mime !== 'image/gif' && stBytes > 0 && stBytes < bigStatic.length / 5,
  `mime=${st.mime} ${Math.round(stBytes / 1024)}KB（原 ${Math.round(bigStatic.length / 1024)}KB）`,
)

/* 4. 存盘往返：动画不能"开一次坏一点"（先重新插入那张**动图**，别拿上一张静态图去测） */
await insert(bigPath)
const md = await page.evaluate(() => window.__MD__())
await page.evaluate((m) => window.__SET_MARKDOWN__(window.__EDITOR__, m), md)
await page.waitForTimeout(900)
const after = await pickImage()
check(
  '存盘再打开：还是 GIF、还是 2 帧',
  after.mime === 'image/gif' && gifInfo(Buffer.from(after.b64, 'base64')).frames === 2,
  `mime=${after.mime} 帧=${gifInfo(Buffer.from(after.b64, 'base64')).frames}`,
)
check('全程没有页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条断言通过`)
if (results.length !== TEST_COUNT) {
  console.log(`❌ 断言条数与 TEST_COUNT(${TEST_COUNT}) 不一致：实际 ${results.length} 条`)
  process.exit(1)
}
process.exit(failed.length ? 1 : 0)
