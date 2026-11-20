import { useEffect, useRef, useState } from 'react'
import LobbyStage from './spine/LobbyStage'
import { hasBuiltInLobby, loadLobby, type LobbyScene } from './spine/lobbyAssets'
import { readLobbyFiles, readLobbyMedia, type LobbyMediaSource } from './lobbyDatabase'
import BackgroundSources from './BackgroundSources'
import BackgroundPlayback from './BackgroundPlayback'
import BackgroundAppearance from './BackgroundAppearance'
import WritingPresetPanel from './WritingPresetPanel'
import { loadWritingPresets, saveWritingPresets, type WritingPreset, type WritingPresets } from './writingPresets'
import LobbyMedia from './media/lobbyMedia'
import { lobbyMediaKind, validateLobbyMedia, type LobbyMediaKind } from './media/mediaAssets'
import { readWallpaperProject, type WallpaperSpine } from './wallpaper/wallpaperProject'
import LobbyWindow from './media/LobbyWindow'
import LobbyHistoryList from './LobbyHistoryList'
import WallpaperSceneView from './wallpaper/WallpaperSceneView'
import type { WallpaperSource } from './wallpaper/wallpaperScene'
import { listLobbyHistory, migrateLobbyHistory, readCurrentLobbyHistoryId, readLobbyHistorySource,
  rememberLobbyBackground, updateLobbyHistoryNote, deleteLobbyHistory, type LobbyHistoryEntry, type LobbyHistorySource } from './lobbyHistory'
import {
  DEFAULT_LOBBY_LAYOUT, LOBBY_OPTIONS_KEY, loadLobbyLayout, loadLobbyOptions, saveLobbyLayout,
  type LobbyLayout, type LobbyOptions,
} from './lobbySettings'

type LoadedBackground = { layout: LobbyLayout; layoutId: string; name: string } & (
  | { kind: 'spine'; scene: LobbyScene; builtIn: boolean }
  | { kind: LobbyMediaKind; file: File; timeConfig?: File }
  | { kind: 'window'; stream: MediaStream; nativeCaptureId?: string }
  | { kind: 'scene' | 'web'; source: WallpaperSource }
)

interface SpineVariants {
  title: string
  files: WallpaperSpine[]
}

interface BackgroundSelection {
  background: LoadedBackground
  source: LobbyHistorySource
  id?: string
  spineVariants?: SpineVariants
}

async function prepareScene(files: File[] | null): Promise<LoadedBackground> {
  const scene = await loadLobby(files)
  return { kind: 'spine', scene, builtIn: !files, name: scene.name, layoutId: scene.layoutId, layout: loadLobbyLayout(scene.layoutId) }
}

async function prepareMedia({ file, name, timeConfig }: LobbyMediaSource): Promise<LoadedBackground> {
  const kind = lobbyMediaKind(file)
  if (!kind) throw new Error('请选择受支持的图片或视频文件。')
  await validateLobbyMedia(file, kind)
  const layoutId = [kind, file.name, file.size, file.lastModified].join(':')
  return { kind, file, timeConfig, name: name ?? file.name, layoutId, layout: loadLobbyLayout(layoutId) }
}

async function chooseMedia(source: LobbyMediaSource) {
  const background = await prepareMedia(source)
  return { background, source: { ...source, kind: 'media' as const, name: background.name } }
}

async function prepareHistoryBackground(source: LobbyHistorySource) {
  if (source.kind === 'window') throw new Error('请重新选择共享窗口。')
  if (source.kind === 'scene' || source.kind === 'web') return {
    kind: source.kind, source, name: source.name, layoutId: source.kind + ':' + source.name,
    layout: DEFAULT_LOBBY_LAYOUT,
  }
  const background = source.kind === 'spine' ? await prepareScene(source.files) : await prepareMedia(source)
  return { ...background, name: source.name || background.name }
}

function withHistoryLayout(background: LoadedBackground, id?: string): LoadedBackground {
  if (!id) return background
  const layoutId = 'history:' + id
  return { ...background, layoutId, layout: loadLobbyLayout(layoutId, background.layout) }
}

export default function LobbyControls({ open, documentId }: { open: boolean; documentId?: string }) {
  const [options, setOptions] = useState(loadLobbyOptions)
  const [active, setActive] = useState<LoadedBackground | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [wallpaperPreview, setWallpaperPreview] = useState<LobbyMediaSource | null>(null)
  const [spineVariants, setSpineVariants] = useState<SpineVariants>()
  const [history, setHistory] = useState<LobbyHistoryEntry[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [writingPresets, setWritingPresets] = useState(loadWritingPresets)
  const [presetMessage, setPresetMessage] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [sceneControlsHost, setSceneControlsHost] = useState<HTMLDivElement | null>(null)
  const [activeHistoryId, setActiveHistoryId] = useState<string>()
  const changing = useRef(false)
  const historyGeneration = useRef(0)
  const documentRef = useRef(documentId)
  documentRef.current = documentId
  const attemptedPreset = useRef<string>(undefined)
  const [editing, setEditing] = useState(false)
  const desktop = window.dadealbitDesktop
  const layout = active?.layout ?? DEFAULT_LOBBY_LAYOUT
  const binding = documentId ? writingPresets.bindings[documentId] : undefined
  const boundPreset = writingPresets.presets.find((preset) => preset.id === binding)
  const bindingKey = boundPreset ? documentId + ':' + boundPreset.id : undefined
  const bindingPending = Boolean(bindingKey && attemptedPreset.current !== bindingKey)

  const update = (patch: Partial<LobbyOptions>) => {
    setOptions((current) => {
      const next = { ...current, ...patch }
      try { localStorage.setItem(LOBBY_OPTIONS_KEY, JSON.stringify(next)) }
      catch { /* 存储不可用时，本次打开仍可调整外观。 */ }
      return next
    })
  }

  const refreshHistory = async () => {
    const token = ++historyGeneration.current
    const entries = await listLobbyHistory()
    if (token === historyGeneration.current) { setHistory(entries); setHistoryError(''); setHistoryLoaded(true) }
  }

  useEffect(() => {
    let alive = true
    void migrateLobbyHistory().then(() => listLobbyHistory()).then((entries) => {
      if (alive && historyGeneration.current === 0) setHistory(entries)
    }).catch(() => { if (alive) setHistoryError('无法读取使用记录。背景仍可在当前会话中使用。') })
      .finally(() => { if (alive) setHistoryLoaded(true) })
    return () => { alive = false }
  }, [])

  const updateLayout = (next: LobbyLayout) => {
    if (!active) return
    setActive({ ...active, layout: next })
    saveLobbyLayout(active.layoutId, next)
  }

  useEffect(() => {
    if (!options.enabled || active || busy || bindingPending) return
    let alive = true
    const load = async () => {
      await migrateLobbyHistory().catch(() => {})
      let id = await readCurrentLobbyHistoryId().catch(() => undefined)
      let source = id ? await readLobbyHistorySource(id).catch(() => null) : null
      if (!source) id = undefined
      const media = await readLobbyMedia().catch(() => null)
      if (!source) {
        if (media) source = { kind: 'media', file: media.file, name: media.name ?? media.file.name }
        else {
          const files = await readLobbyFiles().catch(() => null)
          if (!files && !hasBuiltInLobby) return null
          source = { kind: 'spine', files, name: '' }
        }
      }
      const background = await prepareHistoryBackground(source)
      source = { ...source, name: source.name || background.name || '内置壁纸' }
      if (!background.name) background.name = source.name
      let entry: LobbyHistoryEntry | undefined
      try {
        entry = await rememberLobbyBackground(source, false, id)
        if (alive) await refreshHistory()
      } catch { if (alive) setHistoryError('背景已加载，使用记录未能保存。') }
      return { background: withHistoryLayout(background, entry?.id), entry }
    }
    void load().then(
      (next) => { if (alive && next) { setActive(next.background); setActiveHistoryId(next.entry?.id) } },
      (reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : '动态壁纸加载失败。') },
    )
    return () => { alive = false }
  }, [options.enabled, active, busy, bindingPending])

  const showing = options.enabled && active !== null && !renderError
  const autoPaused = options.playing && options.pauseWhileEditing && editing
  const playing = options.playing && !autoPaused
  const scene = active?.kind === 'spine' ? active.scene : null

  useEffect(() => {
    if (!options.enabled && active?.kind === 'window') {
      active.stream.getTracks().forEach((track) => track.stop())
      setActive(null)
    }
  }, [active, options.enabled])

  const nativeCaptureId = active?.kind === 'window' ? active.nativeCaptureId : undefined
  useEffect(() => {
    if (nativeCaptureId && desktop) return () => { void desktop.releaseWallpaper(nativeCaptureId).catch(() => {}) }
  }, [desktop, nativeCaptureId])

  useEffect(() => {
    if (!showing || !options.pauseWhileEditing) return
    const isEditor = (node: EventTarget | null) =>
      node instanceof Element && node.closest('.editor-card') !== null
    const onFocusIn = (event: FocusEvent) => setEditing(isEditor(event.target))
    const onFocusOut = (event: FocusEvent) => setEditing(isEditor(event.relatedTarget))
    setEditing(isEditor(document.activeElement))
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [showing, options.pauseWhileEditing])

  useEffect(() => {
    if (!showing) return
    const root = document.documentElement
    root.dataset.memoryLobby = 'on'
    return () => {
      delete root.dataset.memoryLobby
    }
  }, [showing])

  useEffect(() => {
    if (!showing) return
    const root = document.documentElement
    root.dataset.lobbyMaterial = options.material
    root.style.setProperty('--lobby-blur', options.blur + 'px')
    return () => {
      delete root.dataset.lobbyMaterial
      root.style.removeProperty('--lobby-blur')
    }
  }, [showing, options.material, options.blur])

  useEffect(() => {
    if (!showing) return
    const style = document.documentElement.style
    style.setProperty('--lobby-glass-opacity', `${options.opacity}%`)
    style.setProperty('--lobby-editor-top', `${layout.editorTop}px`)
    if (layout.editorX !== null) style.setProperty('--lobby-editor-x', `${layout.editorX / 100}`)
    return () => {
      style.removeProperty('--lobby-glass-opacity')
      style.removeProperty('--lobby-editor-top')
      style.removeProperty('--lobby-editor-x')
    }
  }, [showing, options.opacity, layout.editorTop, layout.editorX])

  const changeBackground = async (choose: () => Promise<BackgroundSelection | null>, preset?: WritingPreset, autoFor?: string) => {
    if (changing.current) return
    changing.current = true
    setBusy(true)
    setError('')
    setWallpaperPreview(null)
    try {
      const next = await choose()
      if (!next || (autoFor && documentRef.current !== autoFor)) return
      let nextHistoryId: string | undefined
      try {
        const entry = await rememberLobbyBackground(next.source, true, next.id)
        nextHistoryId = entry.id
        await refreshHistory()
      } catch {
        setHistoryError(nextHistoryId ? '背景已保存，使用记录列表刷新失败。'
          : '背景可在本次会话中使用，使用记录未能保存。请检查浏览器存储空间。')
      }
      if (autoFor && documentRef.current !== autoFor) return
      update(preset?.options ?? { enabled: true })
      setRenderError('')
      setSpineVariants(next.spineVariants)
      const selected = withHistoryLayout(next.background, nextHistoryId)
      setActive(preset ? { ...selected, layout: preset.layout } : selected)
      setActiveHistoryId(nextHistoryId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '背景导入失败。')
    } finally {
      changing.current = false
      setBusy(false)
    }
  }

  const replaceSpine = (files: File[] | null, variant?: { group: SpineVariants; label: string }) => changeBackground(async () => {
    const background = await prepareScene(files)
    if (variant) background.name = variant.group.title + ' · Spine ' + variant.label
    return { background, source: { kind: 'spine' as const, files, name: background.name }, spineVariants: variant?.group }
  })

  const importWallpaper = (files: File[]) => changeBackground(async () => {
    const project = await readWallpaperProject(files)
    let reason = project.reason
    if (project.scene) {
      const background = await prepareHistoryBackground(project.scene)
      setWallpaperPreview(project.preview)
      return { background, source: project.scene }
    }
    if (__SPINE_ENABLED__ && project.spines.length) {
      const selected = project.spines[0]
      const background = await prepareScene(selected.files)
      const name = project.title + ' · Spine ' + selected.label
      return { background: { ...background, name }, source: { kind: 'spine' as const, files: selected.files, name },
        spineVariants: { title: project.title, files: project.spines } }
    }
    if (project.web) {
      const background = await prepareHistoryBackground(project.web)
      setWallpaperPreview(project.preview)
      return { background, source: project.web }
    }
    if (project.main) {
      try { return await chooseMedia(project.main) }
      catch (error) { reason = error instanceof Error ? error.message : '无法读取项目背景。' }
    }
    if (!__SPINE_ENABLED__ && project.spines.length) reason = '此项目需要启用 Spine 播放。'
    if (!project.preview) throw new Error(`${reason} 项目内没有可用的预览图。`)
    setWallpaperPreview(project.preview)
    setError(`${reason} 可将项目预览图用作背景。`)
    return null
  })

  const shareWindow = (native?: { projectId?: string }, preset?: WritingPreset) => changeBackground(async () => {
    if (native && !desktop) throw new Error('请在特效版 Windows 桌面模式中打开这条记录。')
    if (native) await desktop?.armWallpaper(native.projectId)
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: false }) }
    catch (error) {
      if (native) {
        const result = await desktop?.wallpaperResult()
        if (result && 'error' in result) throw new Error(result.error)
        if (result) {
          await desktop?.releaseWallpaper(result.captureId)
          throw new Error('无法读取 Wallpaper Engine 的播放画面。')
        }
      }
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return null
      throw new Error('无法共享此窗口。请确认窗口仍在播放，再重新选择。')
    }
    const result = native ? await desktop?.wallpaperResult() : undefined
    const capture = result && 'captureId' in result ? result : undefined
    const track = stream.getVideoTracks().find((entry) => entry.readyState === 'live')
    if (!track || (native && !capture)) {
      stream.getTracks().forEach((track) => track.stop())
      if (capture) await desktop?.releaseWallpaper(capture.captureId)
      throw new Error('所选窗口没有可用的视频画面。')
    }
    const name = capture ? capture.name + ' · 原生壁纸' : (track.label || '共享窗口') + ' · 实时窗口'
    const layoutId = 'wallpaper-window'
    if (!preset) update({ playing: true })
    return {
      background: { kind: 'window' as const, stream, layoutId, layout: loadLobbyLayout(layoutId), name, nativeCaptureId: capture?.captureId },
      source: { kind: 'window' as const, name, nativeProjectId: capture?.nativeProjectId },
    }
  }, preset)

  const useHistory = (entry: LobbyHistoryEntry, preset?: WritingPreset, autoFor?: string) => {
    if (entry.kind === 'window') {
      void shareWindow(entry.nativeProjectId ? { projectId: entry.nativeProjectId } : undefined, preset)
      return
    }
    void changeBackground(async () => {
      const source = { ...await readLobbyHistorySource(entry.id), name: entry.name }
      const background = await prepareHistoryBackground(source)
      return { background, source, id: entry.id }
    }, preset, autoFor)
  }

  const canSavePreset = !options.enabled || Boolean(active && activeHistoryId &&
    (active.kind !== 'window' || history.some((entry) => entry.id === activeHistoryId && entry.nativeProjectId)))
  const persistPresets = (next: WritingPresets) => {
    setWritingPresets(next)
    try { saveWritingPresets(next); setPresetMessage('') }
    catch { setPresetMessage('存储不可用，预设仅保留在本次会话中。') }
  }
  const savePreset = (name: string) => {
    if (!canSavePreset) return
    persistPresets({ ...writingPresets, presets: [...writingPresets.presets, {
      id: crypto.randomUUID(), name, historyId: options.enabled ? activeHistoryId : undefined, options, layout,
    }] })
  }
  const bindPreset = (id: string) => {
    if (!documentId) return
    const bindings = { ...writingPresets.bindings }
    if (binding === id) delete bindings[documentId]
    else bindings[documentId] = id
    persistPresets({ ...writingPresets, bindings })
  }
  const deletePreset = (id: string) => persistPresets({
    presets: writingPresets.presets.filter((preset) => preset.id !== id),
    bindings: Object.fromEntries(Object.entries(writingPresets.bindings).filter(([, bound]) => bound !== id)),
  })
  const applyPreset = (preset: WritingPreset, autoFor?: string) => {
    if (!preset.historyId || (active && preset.historyId === activeHistoryId)) {
      update(preset.options)
      setActive((current) => current && { ...current, layout: preset.layout })
      setPresetMessage('')
      return
    }
    const entry = history.find((item) => item.id === preset.historyId)
    if (!entry) { setPresetMessage('此预设的壁纸记录已不可用。'); return }
    if (autoFor && entry.kind === 'window') { setPresetMessage('原生壁纸需要手动点击「应用」。'); return }
    setPresetMessage('')
    useHistory(entry, preset, autoFor)
  }

  useEffect(() => {
    if (!boundPreset || !bindingKey) { attemptedPreset.current = undefined; return }
    if (!historyLoaded || busy || attemptedPreset.current === bindingKey) return
    attemptedPreset.current = bindingKey
    applyPreset(boundPreset, documentId)
  }, [boundPreset, bindingKey, busy, documentId, historyLoaded, applyPreset])

  const saveNote = async (id: string, note: string) => {
    if (!await updateLobbyHistoryNote(id, note)) throw new Error('记录已不可用。')
    await refreshHistory()
  }

  const deleteHistory = async (id: string) => {
    if (changing.current) throw new Error('背景正在切换，请稍后重试。')
    changing.current = true
    setBusy(true)
    try {
      await deleteLobbyHistory(id, activeHistoryId)
      ++historyGeneration.current
      setHistory((entries) => entries.filter((entry) => entry.id !== id))
      setActiveHistoryId((current) => current === id ? undefined : current)
      setHistoryError('')
    } finally {
      changing.current = false
      setBusy(false)
    }
  }

  const lastSpine = history.find((entry) => entry.kind === 'spine' && !entry.id.startsWith('built-in:'))
  const previewScene = active?.kind === 'image' && active.name.endsWith(' · 壁纸预览图')
    ? history.find((entry) => entry.kind === 'scene' && entry.name === active.name.replace(/ · 壁纸预览图$/, ' · 场景'))
    : undefined

  return (
    <>
      {showing && active?.kind === 'spine' && (
        <LobbyStage scene={active.scene} builtIn={active.builtIn} playing={playing} layout={layout}
          meteors={options.meteors} interaction={options} onError={setRenderError} />
      )}
      {showing && active && (active.kind === 'image' || active.kind === 'video') && (
        <LobbyMedia key={active.layoutId} file={active.file} kind={active.kind} playing={playing} fit={layout.mediaFit}
          layoutId={active.layoutId} timeConfig={active.timeConfig} controlsTarget={sceneControlsHost} onError={setRenderError} onPlaybackBlocked={setError} />
      )}
      {showing && active?.kind === 'window' && <LobbyWindow stream={active.stream} playing={playing} fit={layout.mediaFit}
        onError={setError} onEnded={() => {
          setActive(null)
          setError(active.nativeCaptureId ? 'Wallpaper Engine 播放窗口已关闭。可从使用记录重新打开。'
            : '窗口共享已结束。已恢复上次保存的背景。')
        }} />}
      {showing && (active?.kind === 'scene' || active?.kind === 'web') && <WallpaperSceneView key={active.layoutId} source={active.source}
        layoutId={active.layoutId} playing={playing} fit={layout.mediaFit} controlsTarget={sceneControlsHost} onError={setRenderError} />}
      {open && (
        <section className="zh-fx__lobby" aria-label="动态壁纸">
          <label className="zh-fx__lobby-toggle">
            <span>动态壁纸</span>
            <input type="checkbox" role="switch" checked={options.enabled} disabled={busy} onChange={(event) => {
              setError('')
              setRenderError('')
              setWallpaperPreview(null)
              update({ enabled: event.target.checked })
            }} />
          </label>
          {options.enabled && (
            <div className="zh-fx__lobby-settings">
              <div className="zh-fx__hint" role="status">
                {error || renderError || (busy ? '正在读取背景文件…' : active?.name ??
                  (hasBuiltInLobby ? '正在加载背景…' : '请选择背景来源。'))}
              </div>
              <BackgroundSources busy={busy} native={Boolean(desktop)} onError={setError}
                onMedia={(source) => void changeBackground(() => chooseMedia(source))}
                onSpine={(files) => void replaceSpine(files)} onProject={(files) => void importWallpaper(files)}
                onWindow={() => void shareWindow(desktop ? {} : undefined)}
                onLastSpine={lastSpine && active && active.kind !== 'spine' ? () => useHistory(lastSpine) : undefined}
                onBuiltIn={hasBuiltInLobby && !(active?.kind === 'spine' && active.builtIn) ? () => void replaceSpine(null) : undefined} />
              {previewScene && <div className="zh-fx__lobby-actions">
                <span className="zh-fx__hint">当前使用项目预览图。可切换到场景并使用分时播放。</span>
                <button className="zh-fx__pick" type="button" disabled={busy} onClick={() => void useHistory(previewScene)}>
                  切换到同名场景
                </button>
              </div>}
              {wallpaperPreview && <div className="zh-fx__lobby-actions">
                <button className="zh-fx__pick" type="button" disabled={busy}
                  title={/\.gif$/i.test(wallpaperPreview.file.name) ? '项目预览动图按原文件循环' : undefined}
                  onClick={() => void changeBackground(() => chooseMedia(wallpaperPreview))}>
                  使用项目预览图
                </button>
                <button className="zh-fx__pick" type="button" onClick={() => { setWallpaperPreview(null); setError('') }}>取消</button>
              </div>}
              {spineVariants && spineVariants.files.length > 1 && <div className="zh-fx__lobby-actions" role="group" aria-label="壁纸资源分辨率">
                {spineVariants.files.map((variant) => <button key={variant.path} type="button" className="zh-fx__pick" disabled={busy}
                  onClick={() => void replaceSpine(variant.files, { group: spineVariants, label: variant.label })}>使用 {variant.label}</button>)}
              </div>}
              {active?.kind === 'window' && <div className="zh-fx__hint">{active.nativeCaptureId
                ? 'Wallpaper Engine 正在原生播放。可从使用记录重新打开。'
                : '窗口共享仅在本次会话中使用。重新打开编辑器后需再次选择窗口。'}</div>}
              <BackgroundPlayback busy={busy} animated={active?.kind !== 'image'} options={options} autoPaused={autoPaused}
                scene={scene} playing={playing} onPlay={(next) => { setError(''); update({ playing: next }) }} update={update}>
                {(active?.kind === 'scene' || active?.kind === 'web' || active?.kind === 'video') && <div ref={setSceneControlsHost} />}
              </BackgroundPlayback>
              <BackgroundAppearance busy={busy} showing={showing} spine={active?.kind === 'spine'} options={options}
                layout={layout} update={update} updateLayout={updateLayout} />
            </div>
          )}
          <LobbyHistoryList entries={history} activeId={activeHistoryId} busy={busy} error={historyError}
            onUse={useHistory} onNote={saveNote} onDelete={deleteHistory} />
          <WritingPresetPanel presets={writingPresets.presets} bound={binding} canBind={Boolean(documentId)}
            canSave={canSavePreset} busy={busy} message={presetMessage}
            onSave={savePreset} onApply={applyPreset} onBind={bindPreset} onDelete={deletePreset} />
        </section>
      )}
    </>
  )
}
