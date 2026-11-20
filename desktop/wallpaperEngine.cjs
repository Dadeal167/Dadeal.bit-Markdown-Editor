const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const { basename, dirname, join } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)
const engineNames = ['wallpaper64.exe', 'wallpaper32.exe']
const localFile = (path) => typeof path === 'string' && /^[a-z]:[\\/]/i.test(path)
const exists = (path) => fs.stat(path).then((entry) => entry.isFile(), () => false)

async function findInstalledEngine(project, engineOverride) {
  const libraries = new Set()
  for (let folder = dirname(project); dirname(folder) !== folder; folder = dirname(folder)) {
    if (basename(folder).toLowerCase() === 'steamapps') {
      libraries.add(dirname(folder))
      break
    }
  }
  const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles
  if (programFiles) libraries.add(join(programFiles, 'Steam'))
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
    const { stdout } = await run(reg, ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true })
    const steam = stdout.match(/SteamPath\s+REG_SZ\s+(.+?)\s*$/mi)?.[1]
    if (localFile(steam)) {
      libraries.add(steam)
      const file = await fs.readFile(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const match of file.matchAll(/"path"\s+"([^"\r\n]+)"/g)) {
        const library = match[1].replaceAll('\\\\', '\\')
        if (localFile(library)) libraries.add(library)
      }
    }
  } catch { /* 仍可按当前库和默认安装目录定位。 */ }

  const candidates = [...libraries].flatMap((library) => engineNames
    .map((name) => join(library, 'steamapps', 'common', 'wallpaper_engine', name)))
  for (const candidate of engineOverride ? [engineOverride, ...candidates] : candidates) {
    if (await exists(candidate)) return candidate
  }
}

function sendEngineCommand(engine, args) {
  return new Promise((resolve, reject) => {
    // 冷启动时此进程会继续渲染。只等待进程创建。
    const child = spawn(engine, ['-control', ...args], {
      cwd: dirname(engine), windowsHide: true, stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

module.exports = { findInstalledEngine, sendEngineCommand, engineNames, localFile, exists }
