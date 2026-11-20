import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { buildWallpaperSceneRuntime } from './scripts/wallpaperSceneRuntime.mjs'

const EDITOR_NAME = 'Dadealbit Markdown 编辑器.html'

function wallpaperSceneRuntime(): Plugin {
  const moduleId = 'virtual:wallpaper-scene-runtime'
  return {
    name: 'wallpaper-scene-runtime',
    resolveId(id) { if (id === moduleId) return '\0' + moduleId },
    load(id) {
      if (id !== '\0' + moduleId) return
      const require = createRequire(import.meta.url)
      const root = dirname(require.resolve('webwallgl/package.json'))
      const mediaRoot = resolve(dirname(createRequire(resolve(root, 'package.json')).resolve('mediabunny')), '../..')
      const mediaVersion = JSON.parse(readFileSync(resolve(mediaRoot, 'package.json'), 'utf8')).version
      const runtime = buildWallpaperSceneRuntime(root)
      const licenses = [
        readFileSync(resolve(root, 'LICENSE'), 'utf8'),
        `Mediabunny ${mediaVersion}. Source: https://www.npmjs.com/package/mediabunny/v/${mediaVersion}`,
        readFileSync(resolve(mediaRoot, 'LICENSE'), 'utf8'),
      ].join('\n\n')
      return `export const runtime = ${JSON.stringify(runtime)}; export const licenses = ${JSON.stringify(licenses)};`
    },
  }
}

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
function singleFilePlugin(spine: boolean): Plugin {
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
      copyFileSync(built, resolve(root, EDITOR_NAME))
      console.log(`\n  ✓ 已生成可直接双击的文件：${EDITOR_NAME}\n`)
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
          const spineRoot = spine ? dirname(createRequire(import.meta.url).resolve('@esotericsoftware/spine-webgl/package.json')) : ''
          const projectLicense = readFileSync(resolve(import.meta.dirname, 'LICENSE'), 'utf8')
          const spineLicense = spineRoot ? readFileSync(resolve(spineRoot, 'LICENSE'), 'utf8') : ''
          const notice = `<!--\n${[projectLicense, spineLicense].filter(Boolean).join('\n\n')}\n-->\n  `
          out = out.replace('</body>', () => `${notice}<script>${inlineCode}</script>\n  </body>`)
        }
        return out
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // Spine 运行库需在符合其许可时显式启用。
  const singleFile = mode !== 'web'
  const spine = mode === 'spine'
  return {
    plugins: [react(), wallpaperSceneRuntime(), ...(singleFile ? [singleFilePlugin(spine)] : [])],
    resolve: spine ? undefined : {
      alias: [
        { find: /^\.\/spine\/lobbyAssets$/, replacement: resolve(import.meta.dirname, 'src/editor/effects/background/spine/unavailableAssets.ts') },
        { find: /^\.\/spine\/LobbyStage$/, replacement: resolve(import.meta.dirname, 'src/editor/effects/background/spine/UnavailableStage.tsx') },
      ],
    },
    define: {
      __NO_MOUSE_EFFECT__: 'false',
      __SPINE_ENABLED__: JSON.stringify(spine),
      /* 构建标记：诊断包里带上它，才能确认用户跑的是哪一次构建。
         用户报"公式坏了"时第一件事就是确认他手上那份是不是最新版 ——
         以前没这个标记只能靠猜（吃过亏：桌面产物过时，我却当成代码没修好）。 */
      __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
      __BUILD_MODE__: JSON.stringify('effect'),
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
