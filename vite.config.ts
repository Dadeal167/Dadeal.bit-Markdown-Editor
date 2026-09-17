import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** 单文件产物的文件名：同时放在项目根目录，双击即可用，不必进 dist */
const FRIENDLY_NAME = 'Dadealbit Markdown 编辑器.html'

/**
 * 把 JS / CSS 内联进 index.html，产出**单文件**交付物。
 *
 * 为什么必须这样：file:// 下 Chrome 会拦截
 *   - `type="module"` 脚本（CORS: origin 'null'）
 *   - 带 crossorigin 的样式表
 * 所以"双击就能用"只有一个办法：产物里不留任何外部引用。
 * 配合 assetsInlineLimit（字体转 data URL）+ iife 打包格式（不能是 ESM），
 * 最终 dist 里只有一个 index.html。
 */
function singleFilePlugin(): Plugin {
  return {
    name: 'zhihu-md-single-file',
    apply: 'build',
    enforce: 'post',
    // 构建完顺手在项目根目录放一份好认的副本：双击它就打开，
    // 不用进 dist、也不会弹出命令行窗口
    closeBundle() {
      const root = import.meta.dirname ?? process.cwd()
      const built = resolve(root, 'dist', 'index.html')
      if (!existsSync(built)) return
      copyFileSync(built, resolve(root, FRIENDLY_NAME))
      console.log(`\n  ✓ 已生成可直接双击的文件：${FRIENDLY_NAME}\n`)
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        let out = html
        let inlineCode = ''
        for (const [fileName, item] of Object.entries(bundle)) {
          if (item.type === 'chunk') {
            // 注意 1：必须用函数形式替换——bundle 里 React 自己就带 `$&` 这类字符串，
            //         用字符串替换会被当成"插入匹配到的原文"，直接把 HTML 标签塞进代码里
            inlineCode += item.code.replace(/<\/script/gi, '<\\/script')
            out = out.replace(new RegExp(`<script[^>]*src="[^"]*${esc(fileName)}"[^>]*></script>`), '')
            delete bundle[fileName]
          } else if (fileName.endsWith('.css')) {
            const css = String(item.source).replace(/<\/style/gi, '<\\/style')
            out = out.replace(new RegExp(`<link[^>]*href="[^"]*${esc(fileName)}"[^>]*>`), () => `<style>${css}</style>`)
            delete bundle[fileName]
          }
        }
        // 注意 2：Vite 会把脚本提升到 <head>，而内联的普通脚本会立即执行，
        //         那时 <div id="root"> 还没解析到（React 会报 #299）。所以放到 </body> 之前。
        if (inlineCode) {
          out = out.replace('</body>', () => `<script>${inlineCode}</script>\n  </body>`)
        }
        return out
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // 默认产出单文件（双击即用）；`vite build --mode web` 产出常规多文件版本
  const singleFile = mode !== 'web'
  return {
    plugins: [react(), ...(singleFile ? [singleFilePlugin()] : [])],
    base: './',
    server: { port: 5173, strictPort: true, host: '127.0.0.1' },
    build: singleFile
      ? {
          // 字体等资源全部转成 data URL，产物里不留外部文件
          assetsInlineLimit: 100 * 1024 * 1024,
          cssCodeSplit: false,
          rollupOptions: {
            output: {
              format: 'iife',
              inlineDynamicImports: true,
              entryFileNames: 'assets/[name].js',
              assetFileNames: 'assets/[name][extname]',
            },
          },
        }
      : {},
  }
})
