/* 从 cursor.png 量出"箭头尖"的像素位置，写进源码常量。
   为什么：原来是写死的 (87,67)，一旦换指针素材、或素材被重新导出，就会悄悄偏
   （本文件就是为此而生：旧默认偏了 22px，根因就是"尖端在哪"靠人记）。
   做法：最右不透明列 = 尖端列，取那一列不透明像素的中点作为 y。
   用法：node scripts/measure-cursor-tip.mjs [--write]
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const SRC = resolve('src/editor/effects/customCursor.ts')
const PNG = resolve('src/editor/effects/cursor.png')
const WRITE = process.argv.includes('--write')

if (!existsSync(PNG)) {
  console.error(`❌ 找不到素材: ${PNG}`)
  process.exit(1)
}

/* 用浏览器解 PNG（Node 里没有现成的 PNG 解码；浏览器本来就在依赖里） */
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
await page.goto('about:blank')
const dataUrl = `data:image/png;base64,${readFileSync(PNG).toString('base64')}`
const tip = await page.evaluate(async (url) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = img.naturalWidth
  cv.height = img.naturalHeight
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data
  const A = (x, y) => d[(y * cv.width + x) * 4 + 3]

  /* 不透明范围 */
  let minX = cv.width
  let maxX = -1
  let minY = cv.height
  let maxY = -1
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      if (A(x, y) > 30) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  /* 最右不透明列 = 尖端列；取该列不透明像素的中点 */
  const colYs = []
  for (let y = 0; y < cv.height; y++) if (A(maxX, y) > 30) colYs.push(y)
  const tipY = colYs.length ? Math.round((colYs[0] + colYs[colYs.length - 1]) / 2) : 0
  /* 该列有多少像素 → 尖端模糊度（±N/2） */
  return {
    w: cv.width,
    h: cv.height,
    opaque: { minX, maxX, minY, maxY },
    tipX: maxX,
    tipY,
    tipColumnPixels: colYs.length,
    blurPx: Math.round(colYs.length / 2),
  }
}, dataUrl)
await browser.close()

console.log('=== 素材量测结果 ===')
console.log(`  图片尺寸     : ${tip.w} × ${tip.h}`)
console.log(`  不透明范围   : x ${tip.opaque.minX}..${tip.opaque.maxX}  y ${tip.opaque.minY}..${tip.opaque.maxY}`)
console.log(`  左留白 / 上留白: ${tip.opaque.minX} / ${tip.opaque.minY}`)
console.log(`  尖端像素     : (${tip.tipX}, ${tip.tipY})`)
console.log(`  尖端列像素数 : ${tip.tipColumnPixels}  → ±${tip.blurPx}px 模糊（斜切面）`)

/* 自检：源码里的常量必须等于量出来的值。
   不加这一条的话，换了素材而忘了更新常量，就会悄悄偏 ——
   这次事故（默认热点偏 22px、圆和点击点错位）根因就是"尖端在哪"靠人记。 */
const srcText = readFileSync(SRC, 'utf8')
const num = (name) => {
  const m = new RegExp(`export const ${name} = (\\d+)`).exec(srcText)
  return m ? Number(m[1]) : null
}
const declared = {
  CURSOR_SPRITE_PAD_LEFT: num('CURSOR_SPRITE_PAD_LEFT'),
  CURSOR_SPRITE_PAD_TOP: num('CURSOR_SPRITE_PAD_TOP'),
  TIP_PIXEL_X: num('TIP_PIXEL_X'),
  TIP_PIXEL_Y: num('TIP_PIXEL_Y'),
}
const expected = {
  CURSOR_SPRITE_PAD_LEFT: tip.opaque.minX,
  CURSOR_SPRITE_PAD_TOP: tip.opaque.minY,
  TIP_PIXEL_X: tip.tipX,
  TIP_PIXEL_Y: tip.tipY,
}
console.log('\n=== 源码常量 vs 素材实测 ===')
let bad = 0
for (const k of Object.keys(expected)) {
  const ok = declared[k] === expected[k]
  if (!ok) bad += 1
  console.log(`  ${ok ? '✅' : '❌'} ${k.padEnd(24)} 源码 ${declared[k]}   素材 ${expected[k]}`)
}
if (bad) {
  console.log(`\n❌ ${bad} 个常量与素材对不上 —— 跑 \`node scripts/measure-cursor-tip.mjs --write\` 写回`)
} else {
  console.log('\n✅ 源码常量与素材一致')
}

if (!WRITE) {
  console.log('\n（加 --write 才会写进源码）')
  process.exit(bad ? 1 : 0)
}

/* 把量到的值写进源码：改 CURSOR_SPRITE_PAD_LEFT/TOP 与 TIP_PIXEL_X/Y */
let src = readFileSync(SRC, 'utf8')
const before = src
src = src.replace(/export const CURSOR_SPRITE_PAD_LEFT = \d+/, `export const CURSOR_SPRITE_PAD_LEFT = ${tip.opaque.minX}`)
src = src.replace(/export const CURSOR_SPRITE_PAD_TOP = \d+/, `export const CURSOR_SPRITE_PAD_TOP = ${tip.opaque.minY}`)
src = src.replace(/export const TIP_PIXEL_X = \d+/, `export const TIP_PIXEL_X = ${tip.tipX}`)
src = src.replace(/export const TIP_PIXEL_Y = \d+/, `export const TIP_PIXEL_Y = ${tip.tipY}`)
if (src === before) {
  console.log('\n⚠️ 源码里的常量名不是预期的（CURSOR_SPRITE_PAD_LEFT/TOP、TIP_PIXEL_X/Y），没有改动')
  process.exit(1)
}
writeFileSync(SRC, src, 'utf8')
console.log('\n✅ 已写进', SRC.replace(process.cwd() + '\\', ''))
