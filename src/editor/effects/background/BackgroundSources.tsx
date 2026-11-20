import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { LobbyMediaSource } from './lobbyDatabase'
import { lobbyMediaKind } from './media/mediaAssets'
import { WALLPAPER_TIME_FILE } from './wallpaper/useWallpaperTime'

interface Props {
  busy: boolean
  native: boolean
  onMedia(source: LobbyMediaSource): void
  onSpine(files: File[]): void
  onProject(files: File[]): void
  onWindow(): void
  onBuiltIn?: () => void
  onLastSpine?: () => void
  onError(message: string): void
}

function takeFiles(event: ChangeEvent<HTMLInputElement>) {
  const files = Array.from(event.currentTarget.files ?? [])
  event.currentTarget.value = ''
  return files
}

export default function BackgroundSources({ busy, native, onMedia, onSpine, onProject, onWindow, onBuiltIn, onLastSpine, onError }: Props) {
  const spineInput = useRef<HTMLInputElement>(null)
  const mediaInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)

  const importMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const files = takeFiles(event)
    if (!files.length) return
    const media = files.filter((file) => file.name.toLowerCase() !== WALLPAPER_TIME_FILE)
    const timeConfig = files.find((file) => file.name.toLowerCase() === WALLPAPER_TIME_FILE)
    if (media.length !== 1 || files.length > 2 || (timeConfig && lobbyMediaKind(media[0]) !== 'video')) {
      onError('请选择一个图片或视频。导入视频时可同时选择 wallpaper-time.json。')
      return
    }
    onMedia({ file: media[0], timeConfig })
  }

  return <fieldset className="zh-fx__lobby-layout" disabled={busy}>
    <legend>背景来源</legend>
    <div className="zh-fx__lobby-actions">
      {native && typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
        <button className="zh-fx__pick" type="button" onClick={onWindow}>选择 Wallpaper Engine 原生壁纸</button>}
      <button className="zh-fx__pick" type="button" onClick={() => mediaInput.current?.click()}>导入图片或视频</button>
      <button className="zh-fx__pick" type="button"
        title="选择 Wallpaper Engine 中包含 project.json 的壁纸目录"
        onClick={() => projectInput.current?.click()}>导入 Wallpaper Engine 项目</button>
      {__SPINE_ENABLED__ && <button className="zh-fx__pick" type="button" title="选择 Spine 4.2 的骨骼文件、图集和全部贴图"
        onClick={() => spineInput.current?.click()}>导入 Spine 文件</button>}
      {!native && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <button className="zh-fx__pick" type="button"
        title="先在 Wallpaper Engine 中播放壁纸，再选择包含壁纸画面的窗口或屏幕"
        onClick={onWindow}>共享 Wallpaper 窗口</button>}
      {onLastSpine && <button className="zh-fx__pick" type="button" onClick={onLastSpine}>切换至 Spine</button>}
      {onBuiltIn && <button className="zh-fx__pick" type="button" onClick={onBuiltIn}>使用内置壁纸</button>}
    </div>
    {__SPINE_ENABLED__ && <input ref={spineInput} type="file" hidden multiple accept=".skel,.json,.atlas,.png,.jpg,.jpeg,.webp" onChange={(event) => {
      const files = takeFiles(event)
      if (files.length) onSpine(files)
    }} />}
    <input ref={mediaInput} type="file" hidden multiple
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,video/*,.mp4,.webm,.mov,.m4v,.ogv,.json"
      onChange={importMedia} />
    <input ref={projectInput} type="file" hidden {...{ webkitdirectory: '' }} onChange={(event) => {
      const files = takeFiles(event)
      if (files.length) onProject(files)
    }} />
  </fieldset>
}
