/** 根据文件内容识别可动画的格式，适用于扩展名和 MIME 不准确的导出文件。 */
export function sniffImage(bytes) {
  const has = (offset, tag) => [...tag].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0))
  if (has(0, 'GIF87a') || has(0, 'GIF89a')) return { mime: 'image/gif', ext: 'gif' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    for (let pos = 8; pos + 12 <= bytes.length;) {
      if (has(pos + 4, 'acTL')) return { mime: 'image/png', ext: 'png', animated: true }
      if (has(pos + 4, 'IDAT')) break
      pos += 12 + view.getUint32(pos)
    }
    return { mime: 'image/png', ext: 'png' }
  }
  if (has(0, 'RIFF') && has(8, 'WEBP')) {
    const animated = has(12, 'VP8X') && Boolean(bytes[20] & 0x02)
    return { mime: 'image/webp', ext: 'webp', animated }
  }
  return null
}
