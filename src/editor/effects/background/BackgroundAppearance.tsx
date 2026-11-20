import { useEffect, useState } from 'react'
import { DEFAULT_LOBBY_LAYOUT, MIN_LOBBY_OPACITY, type LobbyLayout, type LobbyOptions } from './lobbySettings'

function positionLabel(value: number, negative: string, positive: string) {
  if (!value) return '默认'
  return `${value < 0 ? negative : positive} ${Math.abs(value)}%`
}

function LayoutSlider({ label, min, max, step, value, display, onChange }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange(value: number): void
}) {
  return (
    <label>
      <span className="zh-fx__head"><span>{label}</span><span aria-hidden="true">{display}</span></span>
      <input className="zh-fx__range" type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={display} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

interface Props {
  busy: boolean
  showing: boolean
  spine: boolean
  layout: LobbyLayout
  options: LobbyOptions
  update(patch: Partial<LobbyOptions>): void
  updateLayout(layout: LobbyLayout): void
}

export default function BackgroundAppearance({ busy, showing, spine, layout, options, update, updateLayout }: Props) {
  const [wideLayout, setWideLayout] = useState(() => matchMedia('(min-width: 1100px)').matches)
  useEffect(() => {
    const media = matchMedia('(min-width: 1100px)')
    const measure = () => setWideLayout(media.matches)
    measure()
    media.addEventListener('change', measure)
    return () => media.removeEventListener('change', measure)
  }, [])

  return (
    <>
    <fieldset className="zh-fx__lobby-layout" disabled={busy}>
      <legend>正文面板材质</legend>
      <label className="zh-fx__lobby-toggle">
        <span>材质</span>
        <select value={options.material} onChange={(event) => update({ material: event.target.value as LobbyOptions['material'] })}>
          <option value="glass">毛玻璃</option>
          <option value="frosted">磨砂</option>
          <option value="solid">实色</option>
        </select>
      </label>
    {options.material !== 'solid' && <><label>
      <span className="zh-fx__head"><span>面板不透明度</span><span>{options.opacity}%</span></span>
      <input className="zh-fx__range" aria-label="面板不透明度" type="range" min={MIN_LOBBY_OPACITY} max="100" value={options.opacity} disabled={busy}
        onChange={(event) => update({ opacity: Number(event.target.value) })} />
    </label>
      <LayoutSlider label="背景模糊" min={0} max={32} step={1} value={options.blur}
        display={options.blur + ' px'} onChange={(blur) => update({ blur })} />
    </>}
    </fieldset>
    {showing && (
      <fieldset className="zh-fx__lobby-layout" disabled={busy}>
        <legend>构图</legend>
        <LayoutSlider label="正文框左右位置" min={0} max={100} step={1}
          value={layout.editorX ?? (wideLayout ? 2 : 50)}
          display={layout.editorX === null ? '默认' : `${layout.editorX}%`}
          onChange={(editorX) => updateLayout({ ...layout, editorX })} />
        <LayoutSlider label="正文框距顶部" min={0} max={180} step={1}
          value={layout.editorTop} display={`${layout.editorTop} px`}
          onChange={(editorTop) => updateLayout({ ...layout, editorTop })} />
        {!spine && <label className="zh-fx__lobby-toggle">
          <span>背景缩放</span>
          <select value={layout.mediaFit} onChange={(event) => updateLayout({ ...layout, mediaFit: event.target.value === 'contain' ? 'contain' : 'cover' })}>
            <option value="cover">填满窗口</option>
            <option value="contain">完整显示</option>
          </select>
        </label>}
        {spine && <><LayoutSlider label="Spine 缩放" min={40} max={220} step={1}
          value={layout.zoom} display={`${layout.zoom}%`}
          onChange={(zoom) => updateLayout({ ...layout, zoom })} />
        <LayoutSlider label="Spine 左右位置" min={-50} max={50} step={1}
          value={layout.spineX} display={positionLabel(layout.spineX, '左', '右')}
          onChange={(spineX) => updateLayout({ ...layout, spineX })} />
        <LayoutSlider label="Spine 上下位置" min={-50} max={50} step={1}
          value={layout.spineY} display={positionLabel(layout.spineY, '上', '下')}
          onChange={(spineY) => updateLayout({ ...layout, spineY })} />
        </>}
        <div className="zh-fx__lobby-actions">
          <button className="zh-fx__pick" type="button" onClick={() => updateLayout(DEFAULT_LOBBY_LAYOUT)}>
            恢复默认构图
          </button>
        </div>
      </fieldset>
    )}
    </>
  )
}
