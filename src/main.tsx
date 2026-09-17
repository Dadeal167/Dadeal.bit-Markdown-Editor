import { createRoot } from 'react-dom/client'
import App from './App'
import { initDocStore, markUiStarted } from './editor/documents'
import 'katex/dist/katex.min.css'
import './index.css'
// 深色主题放在最后：同权重规则靠后者覆盖
import './dark.css'

/**
 * 先把文档库准备好再渲染：文档现在存在 IndexedDB（localStorage 只有 5MB，装了图就不够），
 * 读它是异步的，而界面里到处都同步读 loadStore()，所以在这里等一次（通常几十毫秒）。
 * 加超时是防止某些浏览器上 IndexedDB 卡住导致白屏 —— 超时就退回 localStorage 老路。
 *
 * 超时那条路要额外说一句：这时界面是拿 localStorage 那份（可能偏旧）画出来的，
 * 得告诉存储层"界面已经先起来了" —— 它会在 IndexedDB 迟到时决定是"换成 IndexedDB 的最新数据
 * 并通知界面刷新"还是"以你正在编辑的内存为准、下次整库推一次"（见 documents.ts 的 adopt()）。
 */
const boot = initDocStore().catch(() => undefined)
let timedOut = false
const timeout = new Promise((r) =>
  setTimeout(() => {
    timedOut = true
    r(undefined)
  }, 3000),
)
Promise.race([boot, timeout]).then(() => {
  if (timedOut) markUiStarted()
  createRoot(document.getElementById('root')!).render(<App />)
})
