/**
 * 推知乎前的图片体检
 *
 * 为什么要有它：知乎编辑器只认得两种图片来源 ——
 *   1. 内嵌 `data:`（粘贴过去后知乎会自己接手重新托管，草稿里变成 picx.zhimg.com 的地址）
 *   2. 公开网址 `http(s)://`（知乎服务端自己去抓）
 * 而 `assets/文章名/img_001.jpg` 这种**本地相对路径**，知乎那边读不到你电脑上的文件，
 * 结果草稿里只留下一个「图片导入失败，请重新上传」的空位。
 *
 * 麻烦的地方在于：这条路以前**没有任何提示**——编辑器只数 `data:` 图片（相对路径一张都不数），
 * 助手也只数 `data:`，所以两边都报"成功"，用户得自己去草稿箱里才发现图没了。
 * 现在推送前先分类：只要还有本地图片，就当场拦下来，让用户先把它们嵌进文档。
 */

export interface ZhihuImageStats {
  /** 正文里真正的图片张数（不含知乎公式那种 <img eeimg>） */
  total: number
  /** 内嵌 data:（知乎会接手托管） */
  embedded: number
  /** 公开网址 http(s)（知乎自己去抓） */
  remote: number
  /** 本地路径 / file: / blob:（知乎拿不到，推过去就是"图片导入失败"） */
  local: number
  /** 本地图片的文件名（最多前 3 个，用来提示用户） */
  localNames: string[]
}

/** 从 src 里取文件名（和编辑器里的修复流程保持一致的取法） */
function nameOf(src: string): string {
  let s = src.split(/[?#]/)[0]
  try {
    s = decodeURIComponent(s)
  } catch {
    /* 编码坏了就按原样比 */
  }
  const parts = s.split(/[\\/]/)
  return parts[parts.length - 1] || s
}

/** 正文里的图片按"知乎收不收得到"分类 */
export function zhihuImageStats(html: string): ZhihuImageStats {
  const stats: ZhihuImageStats = { total: 0, embedded: 0, remote: 0, local: 0, localNames: [] }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    // 公式在知乎编辑器里也是 <img>（eeimg / equation?tex=），别把它们当图片数
    if (/\beeimg\b/i.test(tag) || /equation\?tex=/i.test(tag)) continue
    const m = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i)
    const src = (m?.[2] ?? m?.[3] ?? '').trim()
    if (!src) continue
    stats.total += 1
    if (/^data:/i.test(src)) {
      stats.embedded += 1
    } else if (/^https?:/i.test(src)) {
      stats.remote += 1
    } else {
      stats.local += 1
      if (stats.localNames.length < 3) stats.localNames.push(nameOf(src))
    }
  }
  return stats
}

/** 拦下来的那句人话（面板里显示、助手也会回同一句） */
export function localImageBlockText(stats: ZhihuImageStats): string {
  const names = stats.localNames.length ? `（${stats.localNames.join('、')}${stats.local > stats.localNames.length ? ' 等' : ''}）` : ''
  return (
    `这篇里有 ${stats.local} 张图片还是本地路径${names}，知乎读不到你电脑上的文件 —— ` +
    `直接传过去，草稿里只会出现「图片导入失败，请重新上传」。` +
    `先点下面的「选图片文件夹修复」把它们嵌进文档（选那个装着 assets 的文件夹），修好再传。`
  )
}
