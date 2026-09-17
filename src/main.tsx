import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './index.css'
// 深色主题放在最后：同权重规则靠后者覆盖
import './dark.css'

createRoot(document.getElementById('root')!).render(<App />)
