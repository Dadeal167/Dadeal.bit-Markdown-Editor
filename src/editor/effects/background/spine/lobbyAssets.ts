import { AtlasAttachmentLoader, SkeletonBinary, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-webgl'
import { findLobbyInteraction } from './lobbyInteraction'
import { BUILT_IN_WALLPAPER_ID, BUILT_IN_WALLPAPER_NAME } from '../lobbySettings'

const builtIn = import.meta.glob<string>('../../lobby-assets/*.{atlas,skel,png}', { eager: true, query: '?url&inline', import: 'default' })
const prefix = '../../lobby-assets/CH0294_home'
export const hasBuiltInLobby = Boolean(builtIn[`${prefix}.skel`])

function readBundled(url: string) {
  if (!url) throw new Error('内置背景不可用。请导入背景文件。')
  return fetch(url)
}

async function decodeImage(source: File | string) {
  const img = new Image()
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    img.src = url
    await img.decode()
    return img
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

export async function loadLobby(files: File[] | null) {
  const skeletons = files?.filter((file) => /\.(skel|json)$/i.test(file.name)) ?? []
  const skeletonFile = skeletons.find((file) => /_home\./i.test(file.name)) ?? skeletons[0]
  const atlases = files?.filter((file) => /\.atlas$/i.test(file.name)) ?? []
  const atlasName = skeletonFile?.name.replace(/\.[^.]+$/, '.atlas')
  const atlasFile = atlases.find((file) => file.name === atlasName) ?? (atlases.length === 1 ? atlases[0] : undefined)
  if (files && (!skeletonFile || !atlasFile)) throw new Error('请一起选择骨骼文件、图集和全部贴图。')

  const atlas = new TextureAtlas(atlasFile ? await atlasFile.text() : await (await readBundled(builtIn[`${prefix}.atlas`])).text())
  if (!atlas.pages.length) throw new Error('图集未包含贴图。')
  const loader = new AtlasAttachmentLoader(atlas)
  let data
  if (skeletonFile && /\.json$/i.test(skeletonFile.name)) {
    const json = JSON.parse(await skeletonFile.text())
    if (!String(json.skeleton?.spine).startsWith('4.2.')) throw new Error('请选择 Spine 4.2 导出的骨骼文件。')
    data = new SkeletonJson(loader).readSkeletonData(json)
  } else {
    const bytes = skeletonFile ? await skeletonFile.arrayBuffer() : await (await readBundled(builtIn[`${prefix}.skel`])).arrayBuffer()
    const header = new TextDecoder().decode(bytes.slice(9, 15))
    if (!header.startsWith('4.2.')) throw new Error('请选择 Spine 4.2 导出的骨骼文件。')
    data = new SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes))
  }
  const idle = data.animations.find(({ name }) => /^idle(?:_|$)/i.test(name)) ?? data.animations[0]
  if (!idle) throw new Error('当前骨骼文件不包含可播放的动画。')

  const atlasImages = Promise.all(atlas.pages.map(async (page) => {
    const name = page.name.split(/[/\\]/).at(-1)
    const source = files ? files.find((file) => file.name === name) : builtIn[`../../lobby-assets/${name}`]
    if (!source) throw new Error(`缺少贴图 ${page.name}。`)
    return decodeImage(source)
  }))
  const meteor = builtIn['../../lobby-assets/lobby-meteor.png']
  const [images, meteorImage] = await Promise.all([atlasImages, !files && meteor ? decodeImage(meteor) : null])
  const layoutId = skeletonFile
    ? `imported:${data.hash || [skeletonFile.name, skeletonFile.size, skeletonFile.lastModified].join(':')}`
    : BUILT_IN_WALLPAPER_ID
  return { atlas, data, images, meteorImage, layoutId, interaction: findLobbyInteraction(data), animation: idle.name, name: skeletonFile?.name ?? BUILT_IN_WALLPAPER_NAME }
}

export type LobbyScene = Awaited<ReturnType<typeof loadLobby>>
