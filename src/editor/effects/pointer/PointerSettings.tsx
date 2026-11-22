import { useEffect, useRef, useState } from 'react'
import ColorField, { hexToHsl, hslToRgbString } from '../../ColorField'
import {
  MOUSE_EFFECTS,
  MOUSE_EFFECT_COLORS,
  CLICK_OFFSET_RANGE,
  DEFAULT_CLICK_OFFSET_X,
  DEFAULT_CLICK_OFFSET_Y,
  colorHex,
  rememberColor,
  type MouseEffectSettings,
} from '../mouseEffect'
import {
  CURSOR_SPRITE_PAD_LEFT,
  DEFAULT_CURSOR_HOTSPOT,
  TIP_ALIGNED_X,
  TIP_ALIGNED_Y,
  dropToHotspot,
  hotspotToDrop,
  hotspotToShiftX,
  shiftXToHotspot,
} from '../customCursor'

/** 一行滑块：标签 + 可输入的数字 + 单位 + 滑杆（照原版设置面板的做法） */
function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  digits = 2,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  digits?: number
  onChange(v: number): void
}) {
  const [text, setText] = useState(value.toFixed(digits))
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setText(value.toFixed(digits))
  }, [value, digits])

  const commit = () => {
    editing.current = false
    const n = Number(text)
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
    else setText(value.toFixed(digits))
  }

  return (
    <div className="zh-fx__row">
      <div className="zh-fx__head">
        <span className="zh-fx__label">{label}</span>
        <span className="zh-fx__value">
          <input
            type="text"
            value={text}
            onFocus={() => {
              editing.current = true
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <em>{unit}</em>
        </span>
      </div>
      <input
        className="zh-fx__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="zh-fx__hint">{hint}</div>}
    </div>
  )
}

export default function PointerSettings({ visible, settings, onChange, onReset }: {
  visible: boolean
  settings: MouseEffectSettings
  onChange(next: MouseEffectSettings): void
  onReset(): void
}) {
  const set = (patch: Partial<MouseEffectSettings>) => onChange({ ...settings, ...patch })
  /** 指针热点（可微调）：面板里的 X/Y 加减就是改它 */
  const hotspot = settings.cursorHotspot ?? DEFAULT_CURSOR_HOTSPOT
  /** 校准区里最后一次点的位置（相对校准区左上角） */
  const [calibPoint, setCalibPoint] = useState<{ x: number; y: number } | null>(null)
  if (!visible) return null

  return (
    <div className="zh-fx__page">
        <div className="zh-fx__head-bar">
          <span className="zh-fx__title">鼠标效果</span>
          <button type="button" className="zh-fx__reset" onClick={onReset} title="恢复鼠标效果的默认设置">
            恢复默认设置
          </button>
        </div>
        <div className="zh-fx__tip">编辑数值后按 Enter 应用。</div>

      <div className="zh-fx__modes">
        {MOUSE_EFFECTS.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`zh-fx__mode${settings.mode === m.value ? ' zh-fx__mode--on' : ''}`}
            onClick={() => set({ mode: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>

      <SliderRow
        label="缩放比例"
        value={settings.scale}
        min={0.5}
        max={3}
        step={0.05}
        unit="x"
        onChange={(scale) => set({ scale })}
      />
      <SliderRow
        label="全局不透明度"
        value={Math.round(settings.opacity * 100)}
        min={10}
        max={100}
        step={5}
        unit="%"
        digits={0}
        onChange={(p) => set({ opacity: p / 100 })}
      />

      <div className="zh-fx__toggle">
        <label className="zh-fx__switch">
          <input
            type="checkbox"
            checked={settings.sameSpeed}
            onChange={(e) => set({ sameSpeed: e.target.checked })}
          />
          <span className="zh-fx__slider" />
        </label>
        <div>
          <div className="zh-fx__label">拖尾与点击使用同一动画速度</div>
          <div className="zh-fx__hint">
            关闭后可单独加快或减慢拖尾衰减与移动粒子，而不影响点击波纹与爆发粒子。
          </div>
        </div>
      </div>

      {settings.sameSpeed ? (
        <SliderRow
          label="动画播放速度"
          value={settings.speed}
          min={0.2}
          max={3}
          step={0.05}
          unit="x"
          onChange={(speed) => set({ speed })}
        />
      ) : (
        <>
          <SliderRow
            label="拖尾衰减速度"
            value={settings.trailSpeed}
            min={0.2}
            max={3}
            step={0.05}
            unit="x"
            onChange={(trailSpeed) => set({ trailSpeed })}
          />
          <SliderRow
            label="点击爆发速度"
            value={settings.clickSpeed}
            min={0.2}
            max={3}
            step={0.05}
            unit="x"
            onChange={(clickSpeed) => set({ clickSpeed })}
          />
        </>
      )}

      <SliderRow
        label="拖尾刷新率"
        hint="越低越省性能，拖尾也会更『跳』；60 相当于每帧都采样。"
        value={settings.trailHz}
        min={10}
        max={240}
        step={5}
        unit="Hz"
        digits={0}
        onChange={(trailHz) => set({ trailHz })}
      />

      <div className="zh-fx__color">
        <div className="zh-fx__label">
          特效主题颜色
          <span className="zh-fx__label-hint">拖条或直接填色值都行；选过的颜色会留在下面「我的颜色」里</span>
        </div>
        <ColorField
          value={hexToHsl(colorHex(settings.color)) ?? { h: 205, s: 82, l: 59 }}
          onChange={(hsl) => set({ color: hslToRgbString(hsl) })}
          onCommit={(hsl) => {
            const rgb = hslToRgbString(hsl)
            set({ color: rgb, customColors: rememberColor(settings.customColors, rgb) })
          }}
        />

        <div className="zh-fx__presets">
          {MOUSE_EFFECT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`zh-fx__preset${settings.color === c.value ? ' zh-fx__preset--on' : ''}`}
              style={{ background: colorHex(c.value) }}
              title={c.label}
              onClick={() => set({ color: c.value })}
            />
          ))}
        </div>

        {settings.customColors.length > 0 && (
          <div className="zh-fx__mine">
            <div className="zh-fx__mine-head">
              <span>我的颜色</span>
              <span className="zh-fx__label-hint">左键使用 · 右键删掉</span>
            </div>
            <div className="zh-fx__presets">
              {settings.customColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`zh-fx__preset${settings.color === c ? ' zh-fx__preset--on' : ''}`}
                  style={{ background: colorHex(c) }}
                  title={`${colorHex(c)}（左键使用，右键删除）`}
                  onClick={() => set({ color: c })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    set({ customColors: settings.customColors.filter((x) => x !== c) })
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="zh-fx__toggle">
          <label className="zh-fx__switch">
            <input
              type="checkbox"
              checked={settings.cursor}
              onChange={(e) => set({ cursor: e.target.checked })}
            />
            <span className="zh-fx__slider" />
          </label>
          <div>
            <div className="zh-fx__label">自定义鼠标指针</div>
            <div className="zh-fx__hint">
              正文、标题和输入框使用《蔚蓝档案》的箭头指针。按钮使用手型指针。
            </div>
          </div>
        </div>

        {/* 指针偏移可微调，也可对准实际点击点。 */}
        {settings.cursor && (
          <div className="zh-fx__row">
            <div className="zh-fx__label">
              指针位置
              <span className="zh-fx__label-hint">
                默认右移 21 px、下移 20 px。滑块以实际点击点为基准。
              </span>
            </div>
            <div className="zh-fx__cursor-row">
              <button
                type="button"
                className="zh-fx__pick"
                title="恢复当前默认的指针偏移"
                onClick={() => set({ cursorHotspot: { ...DEFAULT_CURSOR_HOTSPOT } })}
              >
                复位
              </button>
              <button
                type="button"
                className="zh-fx__pick"
                title="将箭头尖端与实际点击点对齐"
                onClick={() => set({ cursorHotspot: { x: TIP_ALIGNED_X, y: TIP_ALIGNED_Y } })}
              >
                尖端对准
              </button>
            </div>
            <div className="zh-fx__cursor-row">
              <span className="zh-fx__label" style={{ minWidth: 64 }}>
                整体右移
              </span>
              <input
                type="range"
                className="zh-fx__range"
                min={TIP_ALIGNED_X - (CURSOR_SPRITE_PAD_LEFT + 31)}
                max={TIP_ALIGNED_X}
                step={1}
                value={hotspotToShiftX(hotspot.x)}
                onChange={(e) =>
                  set({ cursorHotspot: { ...hotspot, x: shiftXToHotspot(Number(e.target.value)) } })
                }
              />
              <span className="zh-fx__value">
                <em>{hotspotToShiftX(hotspot.x)}</em> px
              </span>
            </div>
            <div className="zh-fx__cursor-row">
              <span className="zh-fx__label" style={{ minWidth: 64 }}>
                整体下移
              </span>
              <input
                type="range"
                className="zh-fx__range"
                min={-(CURSOR_SPRITE_PAD_LEFT + 31 - TIP_ALIGNED_Y)}
                max={TIP_ALIGNED_Y}
                step={1}
                value={hotspotToDrop(hotspot.y)}
                onChange={(e) =>
                  set({ cursorHotspot: { ...hotspot, y: dropToHotspot(Number(e.target.value)) } })
                }
              />
              <span className="zh-fx__value">
                <em>{hotspotToDrop(hotspot.y)}</em> px
              </span>
            </div>
            <div
              className="zh-fx__calib"
              title="在这里点一下，红叉就是浏览器认为的点击点"
              onMouseDown={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                setCalibPoint({ x: Math.round(e.clientX - box.left), y: Math.round(e.clientY - box.top) })
              }}
            >
              <span className="zh-fx__calib-hint">
                {calibPoint ? '红叉 = 实际点到的位置' : '在这块区域里点一下，看箭头尖端有没有落在红叉上'}
              </span>
              {calibPoint && (
                <i className="zh-fx__calib-dot" style={{ left: calibPoint.x, top: calibPoint.y }} />
              )}
            </div>
          </div>
        )}

        {/* 点击特效（圆圈）的位置：和"指针位置"是两件事，互不影响 */}
        <div className="zh-fx__row">
          <div className="zh-fx__label">
            点击特效位置
            <span className="zh-fx__label-hint">
              圆画在哪儿（<b>指针本身一点不动</b>）。默认往右一点点；觉得没对准就直接拖这两条 ——
              拖完在下面那块区域点一下，看圆是不是正好套住你点的位置
            </span>
          </div>
          <div className="zh-fx__cursor-row">
            <button
              type="button"
              className="zh-fx__pick"
              title="回到默认：往右一点点（指针和圆都不动）"
              onClick={() =>
                set({ clickOffsetX: DEFAULT_CLICK_OFFSET_X, clickOffsetY: DEFAULT_CLICK_OFFSET_Y })
              }
            >
              复位
            </button>
            <button
              type="button"
              className="zh-fx__pick"
              title="圆画在真实点击点上（不加任何偏移）"
              onClick={() => set({ clickOffsetX: 0, clickOffsetY: 0 })}
            >
              对准点击点
            </button>
          </div>
          <div className="zh-fx__cursor-row">
            <span className="zh-fx__label" style={{ minWidth: 64 }}>
              特效右移
            </span>
            <input
              type="range"
              className="zh-fx__range"
              min={-CLICK_OFFSET_RANGE}
              max={CLICK_OFFSET_RANGE}
              step={1}
              value={settings.clickOffsetX ?? DEFAULT_CLICK_OFFSET_X}
              onChange={(e) => set({ clickOffsetX: Number(e.target.value) })}
            />
            <span className="zh-fx__value">
              <em>{settings.clickOffsetX ?? DEFAULT_CLICK_OFFSET_X}</em> px
            </span>
          </div>
          <div className="zh-fx__cursor-row">
            <span className="zh-fx__label" style={{ minWidth: 64 }}>
              特效下移
            </span>
            <input
              type="range"
              className="zh-fx__range"
              min={-CLICK_OFFSET_RANGE}
              max={CLICK_OFFSET_RANGE}
              step={1}
              value={settings.clickOffsetY ?? DEFAULT_CLICK_OFFSET_Y}
              onChange={(e) => set({ clickOffsetY: Number(e.target.value) })}
            />
            <span className="zh-fx__value">
              <em>{settings.clickOffsetY ?? DEFAULT_CLICK_OFFSET_Y}</em> px
            </span>
          </div>
        </div>

        {/* 彩虹：颜色自己流动，想要"炫"一点就打开 */}
        <div className="zh-fx__toggle">
          <label className="zh-fx__switch">
            <input
              type="checkbox"
              checked={settings.rainbow}
              onChange={(e) => set({ rainbow: e.target.checked })}
            />
            <span className="zh-fx__slider" />
          </label>
          <div>
            <div className="zh-fx__label">彩虹（颜色自己变）</div>
            <div className="zh-fx__hint">
              打开后拖尾和波纹的色相会顺着轨迹铺开、并缓慢转圈，主色只当起点色。
            </div>
          </div>
        </div>

        {/* 渐变：第二个颜色是可选的，留空就是单色 */}
        <div className="zh-fx__color-row zh-fx__color-row--second">
          <span
            className={`zh-fx__swatch${settings.color2 ? '' : ' zh-fx__swatch--empty'}`}
            style={settings.color2 ? { background: colorHex(settings.color2) } : undefined}
            title={settings.color2 ? colorHex(settings.color2) : '未设置'}
          />
          {settings.color2 ? (
            <button type="button" className="zh-fx__pick" onClick={() => set({ color2: '' })}>
              取消渐变
            </button>
          ) : (
            <button type="button" className="zh-fx__pick" onClick={() => set({ color2: settings.color })}>
              加第二个颜色
            </button>
          )}
        </div>
        {settings.color2 && (
          <ColorField
            label="第二个颜色（拖尾/波纹的收尾色）"
            value={hexToHsl(colorHex(settings.color2)) ?? { h: 280, s: 76, l: 72 }}
            onChange={(hsl) => set({ color2: hslToRgbString(hsl) })}
          />
        )}
        <div className="zh-fx__hint">
          设了第二个颜色后：拖尾和波纹会从主色过渡到第二个颜色（粒子仍是白色光点）。
        </div>
      </div>
    </div>
  )
}
