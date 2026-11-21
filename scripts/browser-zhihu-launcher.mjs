import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const base = import.meta.dirname
const state = join(homedir(), '.dadealbit')
const tokenPath = join(state, 'browser-token.txt')
const address = 'http://127.0.0.1:5174'
const scheme = 'dadealbit-zhihu'
const tokenPattern = /^[0-9a-f]{32,64}$/

function readToken(path) {
  try {
    const token = readFileSync(path, 'utf8').trim()
    return tokenPattern.test(token) ? token : ''
  } catch {
    return ''
  }
}

async function probe(token) {
  const response = await fetch(`${address}/status`, {
    headers: { 'x-dadealbit-token': token }, signal: AbortSignal.timeout(1000),
  }).catch(() => null)
  if (!response) return 'offline'
  return response.ok && (await response.json().catch(() => null))?.ok === true ? 'ready' : 'occupied'
}

async function ensureAssistant(token) {
  const status = await probe(token)
  if (status === 'ready') return
  if (status === 'occupied') throw new Error('Port 5174 is occupied. Stop the previous assistant and try again.')
  const child = spawn(process.execPath, [join(base, 'zhihu-assistant.mjs')], {
    cwd: base, windowsHide: true, detached: true, stdio: 'ignore',
  })
  const started = new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  await started
  child.unref()
  for (let i = 0; i < 24; i++) {
    if (await probe(token) === 'ready') return
    await wait(400)
  }
  throw new Error('The Zhihu assistant did not start. Run setup again to check the installation.')
}

function registerLauncher() {
  const vbs = join(base, 'launch-from-browser.vbs')
  const wscript = join(process.env.SystemRoot, 'System32', 'wscript.exe')
  const key = `HKCU\\Software\\Classes\\${scheme}`
  const set = (path, ...args) => execFileSync('reg.exe', ['add', path, ...args, '/f'], { windowsHide: true })
  set(key, '/ve', '/d', 'URL:Dadealbit Zhihu Assistant')
  set(key, '/v', 'URL Protocol', '/d', '')
  set(`${key}\\shell\\open\\command`, '/ve', '/d', `"${wscript}" "${vbs}" "%1"`)
}

async function install() {
  const legacy = readToken(join(state, 'token.txt'))
  let token = readToken(tokenPath)
  if (!token) {
    token = legacy && await probe(legacy) === 'ready' ? legacy : randomBytes(32).toString('hex')
    mkdirSync(state, { recursive: true })
    try {
      writeFileSync(tokenPath, token, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      token = readToken(tokenPath)
      if (!token) throw new Error('The installed assistant token is invalid.')
    }
  }
  registerLauncher()
  await ensureAssistant(token)
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(base, '..', '启动器', '_open-editor.ps1'),
    '-Html', join(base, '..', 'Dadealbit Markdown 编辑器.html'), '-Token', token, '-Port', '5174', '-Quiet',
  ], { windowsHide: true, stdio: 'ignore' })
  console.log('Setup complete. Open the HTML, then use the Zhihu panel to start the assistant.')
}

try {
  if (process.argv[2] === 'install') await install()
  else if (process.argv[2] === 'start') {
    const token = readToken(tokenPath)
    if (token) await ensureAssistant(token)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
