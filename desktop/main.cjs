const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } = require('electron')
const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const { basename, dirname, join, win32 } = require('node:path')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')
const { findInstalledEngine, sendEngineCommand, engineNames, localFile, exists } = require('./wallpaperEngine.cjs')
const { startAssistant, stopAssistant } = require('./zhihuAssistant.cjs')

const editorFile = join(__dirname, '..', 'Dadealbit Markdown 编辑器.html')
const editorUrl = pathToFileURL(editorFile).href
const profile = app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), 'Dadealbit Desktop')
app.setPath('userData', profile)
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcWindowCapturer')

let editor
let closing = false
let armed
let result
let requesting = false
let engineOverride
const projects = new Map()
const captures = new Map()
const catalog = join(profile, 'wallpaper-projects.json')
const projectId = (path) => createHash('sha256').update(path.toLowerCase()).digest('hex')
const message = (error) => error instanceof Error ? error.message : String(error)

async function restoreProjects() {
  try {
    const saved = JSON.parse(await fs.readFile(catalog, 'utf8'))
    for (const path of saved.projects ?? []) {
      if (localFile(path)) projects.set(projectId(path), path)
    }
    if (localFile(saved.engine) && engineNames.includes(basename(saved.engine).toLowerCase())) engineOverride = saved.engine
  } catch { /* 首次启动时没有目录记录。 */ }
}

async function saveProjects() {
  const temporary = catalog + '.tmp'
  await fs.writeFile(temporary, JSON.stringify({ projects: [...projects.values()], engine: engineOverride }), 'utf8')
  await fs.rename(temporary, catalog)
}

async function findEngine(project) {
  const installed = await findInstalledEngine(project, engineOverride)
  if (installed) return installed
  const choice = await dialog.showOpenDialog(editor, {
    title: '选择 Wallpaper Engine 的 wallpaper64.exe',
    properties: ['openFile'],
    filters: [{ name: 'Wallpaper Engine 程序', extensions: ['exe'] }],
  })
  if (choice.canceled) return
  const [path] = choice.filePaths
  if (!localFile(path) || !engineNames.includes(basename(path).toLowerCase()) || !await exists(path)) {
    throw new Error('请选择已安装的 wallpaper64.exe 或 wallpaper32.exe。')
  }
  engineOverride = path
  return path
}

async function closeCapture(id) {
  const capture = captures.get(id)
  if (!capture) return
  captures.delete(id)
  await sendEngineCommand(capture.engine, ['closeWallpaper', '-location', capture.title]).catch(() => {})
}

async function selectProject(id) {
  if (id) {
    const previous = projects.get(id)
    if (previous && await exists(previous)) return previous
    throw new Error('该记录的本地项目已移动或删除。请重新选择壁纸文件。')
  }
  const previous = [...projects.values()].at(-1)
  const choice = await dialog.showOpenDialog(editor, {
    title: '选择 Wallpaper Engine 项目的 project.json 或视频文件',
    defaultPath: previous ? dirname(previous) : undefined,
    properties: ['openFile'],
    filters: [{ name: 'Wallpaper Engine 项目或视频', extensions: ['json', 'mp4', 'webm', 'm4v'] }],
  })
  if (choice.canceled) return
  const path = win32.normalize(choice.filePaths[0])
  if (!localFile(path) || !await exists(path)) throw new Error('无法读取所选的本地壁纸文件。')
  if (basename(path).toLowerCase() !== 'project.json' && !/\.(mp4|webm|m4v)$/i.test(path)) {
    throw new Error('请选择壁纸目录中的 project.json 或本地视频文件。')
  }
  return path
}

async function projectName(path) {
  if (basename(path).toLowerCase() !== 'project.json') return basename(path)
  const manifest = JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  return typeof manifest?.title === 'string' && manifest.title.trim() ? manifest.title.trim() : basename(dirname(path))
}

async function nativeSource(id, request) {
  const path = await selectProject(id)
  if (!path || closing) return
  const name = await projectName(path)
  const engine = await findEngine(path)
  if (!engine || closing) return
  const captureId = randomUUID()
  const title = 'Dadealbit-Wallpaper-' + captureId
  const { x, y, width, height } = editor.getBounds()
  captures.set(captureId, { engine, title })
  try {
    await sendEngineCommand(engine, [
      'openWallpaper', '-file', path, '-playInWindow', title,
      '-width', String(width), '-height', String(height), '-x', String(x), '-y', String(y), '-borderless', 'true',
    ])
    for (const until = Date.now() + 25000; !closing && request.frame && !request.frame.detached && Date.now() < until;) {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const source = sources.find((window) => window.id.startsWith('window:') && window.name === title)
      if (source && !closing) {
        const nativeProjectId = projectId(path)
        projects.set(nativeProjectId, path)
        await saveProjects()
        if (closing) break
        result = { captureId, nativeProjectId, name }
        editor.focus()
        return source
      }
      await delay(250)
    }
    throw new Error('Wallpaper Engine 未提供可捕获的播放窗口。请确认项目能在 Wallpaper Engine 中播放。')
  } finally {
    if (result?.captureId !== captureId) await closeCapture(captureId)
  }
}

function fromEditor(frame) {
  return editor && !editor.isDestroyed() && frame === editor.webContents.mainFrame && frame.url === editorUrl
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromEditor(event.senderFrame) || closing) throw new Error('此操作仅在编辑器主窗口中可用。')
    return fn(...args)
  })
}

async function start() {
  if (!await exists(editorFile)) throw new Error('请先在项目根目录运行 pnpm build，生成编辑器 HTML。')
  await restoreProjects()
  editor = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 650,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  editor.webContents.on('will-navigate', (event) => event.preventDefault())
  editor.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  handle('wallpaper:arm', (id) => {
    if (requesting) throw new Error('原生壁纸正在加载。')
    if (id !== undefined && (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id))) throw new Error('壁纸记录无效。')
    result = undefined
    armed = { id, expires: Date.now() + 5000 }
  })
  handle('wallpaper:result', () => result)
  handle('wallpaper:release', (id) => typeof id === 'string' ? closeCapture(id) : undefined)
  handle('assistant:start', startAssistant)
  handle('assistant:stop', stopAssistant)
  editor.webContents.session.setDisplayMediaRequestHandler((request, respond) => {
    if (!fromEditor(request.frame) || !request.videoRequested || request.audioRequested || !request.userGesture ||
      requesting || !armed || Date.now() > armed.expires) {
      respond(null)
      return
    }
    const { id } = armed
    armed = undefined
    requesting = true
    void nativeSource(id, request).catch((error) => { result = { error: message(error) } }).then((source) => {
      respond(source ? { video: source } : null)
    }).catch(() => {
      if (result?.captureId) return closeCapture(result.captureId)
    }).finally(() => { requesting = false })
  })
  await editor.loadFile(editorFile)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (editor && !editor.isDestroyed()) { editor.restore(); editor.focus() }
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (closing) return
    event.preventDefault()
    closing = true
    void Promise.allSettled([stopAssistant(), ...[...captures.keys()].map(closeCapture)]).then(() => app.quit())
  })
  void app.whenReady().then(start).catch((error) => { dialog.showErrorBox('Dadealbit 桌面编辑器', message(error)); app.quit() })
}
