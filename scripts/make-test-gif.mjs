/**
 * 测试用的 GIF 生成器 + 帧数解析（**不进产物**，只给套件和探针用）。
 *
 * 为什么要有它：验证"动图插入后会不会被压成静态图"必须有一张**真的会动的 GIF** ——
 * 网上随手找的图不能进仓库（来源/体积/许可都麻烦），所以在测试里现场造一张：
 * 两帧 + NETSCAPE 循环块，需要时可以用注释块把它垫到指定体积
 * （这样"超过 400KB 才走 canvas 压缩"那条阈值也能被测到）。
 *
 * `gifFrames` 是纯字节解析（完整走一遍 GIF 结构）—— 别用浏览器的 `ImageDecoder`：
 * 实测它对本机的**单帧** GIF 也报 `animated: true`（且 frames=0），判定不可靠。
 */

/** LSB 优先的位写入器（GIF 的 LZW 数据就是按这个顺序拼的） */
function bitWriter() {
  const out = []
  let cur = 0
  let n = 0
  return {
    write(code, bits) {
      for (let i = 0; i < bits; i += 1) {
        if ((code >> i) & 1) cur |= 1 << n
        n += 1
        if (n === 8) {
          out.push(cur)
          cur = 0
          n = 0
        }
      }
    },
    finish() {
      if (n > 0) out.push(cur)
      return Buffer.from(out)
    },
  }
}

/** 2×2 的一帧（minCodeSize=2，四色表） */
function frame(indices) {
  const bw = bitWriter()
  bw.write(4, 3) // CLEAR
  for (const px of indices) bw.write(px, 3)
  bw.write(5, 3) // END
  const lzw = bw.finish()
  const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]) // 延时 10/100 秒
  const desc = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00])
  return Buffer.concat([gce, desc, Buffer.from([0x02, lzw.length]), lzw, Buffer.from([0x00])])
}

/** 注释扩展块：用来把文件垫到指定大小（不影响动画） */
function padding(bytes) {
  const blocks = []
  let left = bytes
  while (left > 0) {
    const n = Math.min(255, left)
    blocks.push(Buffer.from([n]), Buffer.alloc(n, 0x20))
    left -= n
  }
  return Buffer.concat([Buffer.from([0x21, 0xfe]), ...blocks, Buffer.from([0x00])])
}

/* ⚠️ flags 的 bit0-2 是"色表项数"：0xF1 = 有全局色表 + 4 项（1<<(1+1)）。
   第一版写成 0xF0（= 2 项）却塞了 4 项色表，整个文件错位、浏览器解不出来。 */
const HEAD = () => [
  Buffer.from('GIF89a', 'ascii'),
  Buffer.from([2, 0, 2, 0, 0xf1, 0x00, 0x00]),
  Buffer.from([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0]),
]
const TRAILER = Buffer.from([0x3b])

/** 两帧 + 循环的 GIF（>`padTo` 字节时用注释块垫大） */
export function makeAnimatedGif(padTo = 0) {
  const [h, lsd, gct] = HEAD()
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00])
  const base = Buffer.concat([h, lsd, gct, loop, frame([0, 1, 1, 0]), frame([1, 0, 0, 1]), TRAILER])
  if (padTo <= base.length) return base
  return Buffer.concat([base.slice(0, base.length - 1), padding(padTo - base.length), TRAILER])
}

/** 单帧 GIF（对照用：静态图，应该照旧被压缩） */
export function makeStaticGif(padTo = 0) {
  const [h, lsd, gct] = HEAD()
  const base = Buffer.concat([h, lsd, gct, frame([0, 1, 1, 0]), TRAILER])
  if (padTo <= base.length) return base
  return Buffer.concat([base.slice(0, base.length - 1), padding(padTo - base.length), TRAILER])
}

/** 走一遍 GIF 结构数帧数：{ gif, sig, frames, loop } */
export function gifFrames(buf) {
  if (buf.length < 13) return { gif: false, frames: 0 }
  const sig = buf.slice(0, 6).toString('ascii')
  if (!/^GIF8[79]a$/.test(sig)) return { gif: false, sig, frames: 0 }
  let p = 6
  const flags = buf[p + 4]
  p += 7
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1)) // 全局色表
  let frames = 0
  let loop = false
  while (p < buf.length) {
    const b = buf[p]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = buf[p + 1]
      const sub = buf.slice(p + 3, p + 14).toString('ascii')
      if (label === 0xff && sub.startsWith('NETSCAPE')) loop = true
      p += 2
      while (p < buf.length && buf[p] !== 0) p += 1 + buf[p]
      p += 1
      continue
    }
    if (b === 0x2c) {
      frames += 1
      const lf = buf[p + 9]
      p += 10
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1))
      p += 1
      while (p < buf.length && buf[p] !== 0) p += 1 + buf[p]
      p += 1
      continue
    }
    return { gif: true, sig, frames, loop, broken: true, at: p }
  }
  return { gif: true, sig, frames, loop }
}

/** 老名字，套件里读起来顺一点 */
export const gifInfo = gifFrames
