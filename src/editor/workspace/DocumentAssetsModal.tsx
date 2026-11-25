import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEscapeClose } from '../useEscapeClose'
import { localFilePickers } from '../localMarkdownFile'
import { remoteImages, saveRemoteImages } from '../remoteImages'
import { applyAssetRepairs, assetFileList, classifyAssets, documentAssets, planAssetRepairs, readAssetDirectory,
  type AssetScope, type AssetStatus } from './documentAssets'

interface Props {
  editor: Editor
  scope?: AssetScope
  canApply(): boolean
  onApplied(count: number): void
  onRemoteSaved(): void
  onClose(): void
}

function showPath(path: string) {
  try { return decodeURI(path) }
  catch { return path }
}

export default function DocumentAssetsModal({ editor, scope, canApply, onApplied, onRemoteSaved, onClose }: Props) {
  const [snapshot, setSnapshot] = useState(() => editor.state.doc)
  const assets = useMemo(() => documentAssets(snapshot), [snapshot])
  const remote = useMemo(() => remoteImages(snapshot), [snapshot])
  const [statuses, setStatuses] = useState<AssetStatus[]>()
  const [plan, setPlan] = useState<ReturnType<typeof planAssetRepairs>>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [remoteStatus, setRemoteStatus] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const remoteJob = useRef<AbortController>(null)
  const alive = useRef(true)
  const close = () => {
    if (busy && !remoteJob.current) return
    remoteJob.current?.abort()
    onClose()
  }
  useEscapeClose(true, close)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      remoteJob.current?.abort()
    }
  }, [])
  useEffect(() => {
    let active = true
    void classifyAssets(assets, scope).then((result) => { if (active) setStatuses(result) })
    return () => { active = false }
  }, [assets, scope])

  const buildPlan = (choose: () => Promise<{ candidates: ReturnType<typeof assetFileList>; folder?: string[] | null }>) => {
    if (!statuses || busy) return
    setBusy(true)
    setError('')
    void choose().then(({ candidates, folder }) => {
      if (alive.current) setPlan(planAssetRepairs(assets, statuses, candidates, scope, folder))
    }).catch((cause: unknown) => {
      if (alive.current && !(cause instanceof DOMException && cause.name === 'AbortError')) setError('无法读取所选素材文件夹。')
    }).finally(() => { if (alive.current) setBusy(false) })
  }
  const chooseFolder = () => {
    const picker = localFilePickers()
    if (!picker.showDirectoryPicker) { input.current?.click(); return }
    buildPlan(async () => {
      const directory = await picker.showDirectoryPicker!({ mode: 'read' })
      const [candidates, folder] = await Promise.all([readAssetDirectory(directory), scope?.root.resolve(directory)])
      return { candidates, folder }
    })
  }
  const apply = () => {
    if (!plan?.repairs.length || busy) return
    setBusy(true)
    setError('')
    void applyAssetRepairs(editor, snapshot, plan.repairs, scope, () => alive.current && canApply()).then(() => {
      onApplied(plan.repairs.length)
    }).catch((cause: unknown) => {
      if (alive.current) setError(cause instanceof Error ? cause.message : '无法应用素材修复。')
    }).finally(() => { if (alive.current) setBusy(false) })
  }

  const saveRemote = () => {
    if (busy || !remote.length || remoteJob.current) return
    const controller = new AbortController()
    remoteJob.current = controller
    setBusy(true)
    setError('')
    setRemoteStatus('正在读取远程图片…')
    void saveRemoteImages(editor, snapshot, remote, () => alive.current && canApply(), controller.signal,
      (done) => setRemoteStatus('正在处理远程图片（' + done + '/' + remote.length + '）…')).then((result) => {
      if (!alive.current || controller.signal.aborted) return
      if (result.saved) {
        setSnapshot(editor.state.doc)
        setStatuses(undefined)
        setPlan(undefined)
        onRemoteSaved()
      }
      setRemoteStatus('已保存 ' + result.saved + ' 张图片。' +
        (result.remaining ? result.remaining + ' 张未能下载，列表中的网络地址已保留。' : '这些图片可离线查看。'))
    }).catch((cause: unknown) => {
      if (alive.current && !controller.signal.aborted) {
        setRemoteStatus('')
        setError(cause instanceof Error ? cause.message : '无法保存远程素材。')
      }
    }).finally(() => {
      remoteJob.current = null
      if (alive.current && !controller.signal.aborted) setBusy(false)
    })
  }

  return <div className="zh-modal-mask" onClick={close}>
    <section className="zh-modal zh-modal--source" role="dialog" aria-modal="true" aria-labelledby="zh-assets-heading"
      onClick={(event) => event.stopPropagation()}>
      <header className="zh-modal__head">
        <span id="zh-assets-heading">素材管理</span>
        <button className="zh-btn-plain" type="button" aria-label="关闭素材管理" disabled={busy && !remoteJob.current} onClick={close}>✕</button>
      </header>
      <div className="zh-modal__body zh-assets">
        <p>当前文档引用了 {assets.length} 处图片或视频。可选择新素材文件夹预览修复。</p>
        <ul className="zh-assets__list" aria-label="文档素材">
          {assets.map((asset, index) => <li key={asset.position + ':' + index}>
            <strong>{asset.kind === 'image' ? '图片' : '视频'} · {asset.name}</strong>
            <small>{statuses?.[index] ?? '正在检查'}{!/^data:/i.test(asset.path) && ' · ' + showPath(asset.path)}</small>
          </li>)}
        </ul>
        <input type="file" ref={input} hidden multiple {...{ webkitdirectory: '' }} onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length) buildPlan(async () => ({ candidates: assetFileList(files) }))
        }} />
        <button className="zh-btn-plain" type="button" disabled={busy || !statuses || !assets.length} onClick={chooseFolder}>
          选择新素材文件夹
        </button>
        {remote.length > 0 && <button className="zh-btn-plain" type="button" disabled={busy} onClick={saveRemote}>
          保存远程素材（{remote.length}）
        </button>}
        {remoteStatus && <p role="status">{remoteStatus}</p>}
        {plan && <section aria-label="修复预览">
          <h3>修复预览</h3>
          <p>{plan.repairs.length} 处可修复，{plan.unresolved.length} 处待处理。</p>
          <ul className="zh-assets__list">
            {plan.repairs.map(({ reference, path, file }) => <li key={reference.position}>
              <span>{showPath(reference.path)}</span><strong>→ {path ? showPath(path) : `将「${file.name}」嵌入文档`}</strong>
            </li>)}
            {plan.unresolved.map(({ reference, reason }) => <li key={reference.position}>
              <span>{showPath(reference.path)}</span><small>{reason}</small>
            </li>)}
          </ul>
        </section>}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer className="zh-modal__footer">
        <button className="zh-btn-plain" type="button" disabled={busy && !remoteJob.current} onClick={close}>
          {remoteJob.current ? '取消下载' : '取消'}
        </button>
        <button className="zh-btn-solid" type="button" disabled={busy || !plan?.repairs.length} onClick={apply}>应用修复到正文</button>
      </footer>
    </section>
  </div>
}
