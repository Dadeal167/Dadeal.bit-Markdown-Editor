import { useEffect, useState } from 'react'
import { useEscapeClose } from '../useEscapeClose'
import { resolveProjectAsset, type AssetScope } from './documentAssets'

export default function LocalVideoModal({ path, scope, onClose }: {
  path: string; scope?: AssetScope; onClose(): void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEscapeClose(true, onClose)
  useEffect(() => {
    if (!scope) return
    let active = true
    let objectUrl = ''
    void resolveProjectAsset(scope, path).then((file) => {
      if (!active) return
      if (file) {
        objectUrl = URL.createObjectURL(file)
        setUrl(objectUrl)
      } else setError('无法读取视频。请检查链接，或在「素材管理与断链修复」中重新定位文件。')
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, scope])
  return <div className="zh-modal-mask" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="zh-modal zh-modal--source" role="dialog" aria-modal="true" aria-label="本地视频">
      <div className="zh-modal__head">本地视频
        <button type="button" className="zh-modal__close" autoFocus aria-label="关闭本地视频" onClick={onClose}>✕</button>
      </div>
      <div className="zh-modal__body">
        {!scope || error ? <p role="alert">{error || '请先打开文档文件夹或连接本地工作区，再播放此视频。'}</p>
          : url ? <video src={url} controls playsInline preload="metadata" style={{ display: 'block', maxWidth: '100%', maxHeight: '65vh', margin: 'auto' }}
            onError={() => setError('浏览器无法播放此视频。请检查编码，或使用 MP4、WebM 格式。')} />
          : <p role="status">正在读取视频…</p>}
      </div>
    </section>
  </div>
}
