import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 单文件产物的文件名：
 *   - 纯净版占用正式名字（这是对外发布的那份，会进仓库）
 *   - 带鼠标特效的版本叫「-特效版」，只在本地用，已被 .gitignore 排除
 */
const PURE_NAME = 'Dadealbit Markdown 编辑器.html'
const EFFECT_NAME = 'Dadealbit Markdown 编辑器-特效版.html'

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
function singleFilePlugin(pure: boolean): Plugin {
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
      const name = pure ? PURE_NAME : EFFECT_NAME
      copyFileSync(built, resolve(root, name))
      console.log(`\n  ✓ 已生成可直接双击的文件：${name}\n`)
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
  // 默认产出单文件（双击即用）；`vite build --mode web` 产出常规多文件版本；
  // `vite build --mode pure` 产出**纯净版**（不含鼠标特效）
  const singleFile = mode !== 'web'
  const pure = mode === 'pure'
  return {
    plugins: [react(), ...(singleFile ? [singleFilePlugin(pure)] : [])],
    // 纯净版：把特效实现整块换成空壳（约 3 万字符的第三方代码不进产物），
    // 同时用构建期常量把特效面板从界面上摘掉
    resolve: pure
      ? {
          alias: [
            // 注意：alias 匹配的是 import 说明符（不是解析后的绝对路径），
            // 必须精确匹配，别把 .pure.ts 也换掉
            {
              find: /^\.\/mouseSpark$/,
              replacement: resolve(import.meta.dirname ?? process.cwd(), 'src/editor/effects/mouseSpark.pure.ts'),
            },
            {
              find: /^\.\/effects\/mouseEffect$/,
              replacement: resolve(import.meta.dirname ?? process.cwd(), 'src/editor/effects/mouseEffect.pure.ts'),
            },
            {
              find: /^\.\/EffectPanel$/,
              replacement: resolve(import.meta.dirname ?? process.cwd(), 'src/editor/EffectPanel.pure.tsx'),
            },
          ],
        }
      : undefined,
    define: {
      __NO_MOUSE_EFFECT__: JSON.stringify(pure),
      /* 构建标记：诊断包里带上它，才能确认用户跑的是哪一次构建。
         用户报"公式坏了"时第一件事就是确认他手上那份是不是最新版 ——
         以前没这个标记只能靠猜（吃过亏：桌面产物过时，我却当成代码没修好）。 */
      __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
      __BUILD_MODE__: JSON.stringify(pure ? 'pure' : 'effect'),
    },
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
