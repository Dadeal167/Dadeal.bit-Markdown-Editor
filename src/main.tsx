import { createRoot } from 'react-dom/client'
import App from './App'
import { initDocStore } from './editor/documents'
import 'katex/dist/katex.min.css'
import './index.css'
// 深色主题放在最后：同权重规则靠后者覆盖
import './dark.css'

/**
 * 先把文档库准备好再渲染：文档现在存在 IndexedDB（localStorage 只有 5MB，装了图就不够），
 * 读它是异步的，而界面里到处都同步读 loadStore()，所以在这里等一次（通常几十毫秒）。
 * 加超时是防止某些浏览器上 IndexedDB 卡住导致白屏 —— 超时就退回 localStorage 老路。
 *
 * 超时时先显示 localStorage 备份，数据库就绪后再合并等待期间的改动。
 */
const boot = initDocStore().catch(() => undefined)
let timer: ReturnType<typeof setTimeout>
const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000) })
Promise.race([boot, timeout]).then(() => {
  clearTimeout(timer)
  createRoot(document.getElementById('root')!).render(<App />)
})
