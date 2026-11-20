import type { ReactNode } from 'react'
import type { LobbyOptions } from './lobbySettings'
import type { LobbyScene } from './spine/lobbyAssets'

interface Props {
  busy: boolean
  animated: boolean
  options: LobbyOptions
  autoPaused: boolean
  playing: boolean
  scene: LobbyScene | null
  children?: ReactNode
  onPlay(playing: boolean): void
  update(patch: Partial<LobbyOptions>): void
}

export default function BackgroundPlayback({ busy, animated, options, autoPaused, playing, scene, children, onPlay, update }: Props) {
  if (!animated) return null
  return (
    <fieldset className="zh-fx__lobby-layout" disabled={busy}>
      <legend>播放与互动</legend>
      <label className="zh-fx__lobby-toggle">
        <span>播放动画</span>
        <input type="checkbox" checked={options.playing} onChange={(event) => onPlay(event.target.checked)} />
      </label>
      <label className="zh-fx__lobby-toggle">
        <span>编辑时暂停</span>
        <input type="checkbox" checked={options.pauseWhileEditing}
          aria-describedby="lobby-editing-pause-hint"
          onChange={(event) => update({ pauseWhileEditing: event.target.checked })} />
      </label>
      <div className="zh-fx__hint" id="lobby-editing-pause-hint">标题或正文获得焦点时暂停，失去焦点后恢复播放。</div>
      {scene?.meteorImage && (
        <label className="zh-fx__lobby-toggle">
          <span>流星</span>
          <input type="checkbox" checked={options.meteors}
            onChange={(event) => update({ meteors: event.target.checked })} />
        </label>
      )}
      {scene && (
        <fieldset className="zh-fx__lobby-layout" disabled={busy || !playing}>
          <legend>互动</legend>
          <label className="zh-fx__lobby-toggle">
            <span>摸头</span>
            <input type="checkbox" checked={options.headPat && Boolean(scene.interaction.pat)}
              disabled={!scene.interaction.pat} onChange={(event) => update({ headPat: event.target.checked })} />
          </label>
          <label className="zh-fx__lobby-toggle">
            <span>视线追踪</span>
            <input type="checkbox" checked={options.gaze && Boolean(scene.interaction.gazeBone)}
              disabled={!scene.interaction.gazeBone} onChange={(event) => update({ gaze: event.target.checked })} />
          </label>
          <div className="zh-fx__hint">
            {!options.playing ? '开启「播放动画」后即可互动。'
              : autoPaused ? '编辑时已暂停。'
                : !scene.interaction.pat && !scene.interaction.gazeBone ? '当前素材不支持互动。'
                  : scene.interaction.pat ? '可点击或拖动人物头部区域。' : '移动指针以控制人物视线。'}
          </div>
        </fieldset>
      )}
      {children}
    </fieldset>
  )
}
