const { fork } = require('node:child_process')
const { readFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { join } = require('node:path')

const entry = join(__dirname, '..', 'scripts', 'zhihu-assistant.mjs')
const defaultAddress = 'http://127.0.0.1:5174'
let child
let credentials
let starting
let stopping

async function legacyAssistant() {
  const token = (await readFile(join(homedir(), '.dadealbit', 'token.txt'), 'utf8').catch(() => '')).trim()
  if (!token) return
  const response = await fetch(defaultAddress + '/status', {
    headers: { 'x-dadealbit-token': token }, signal: AbortSignal.timeout(1500),
  }).catch(() => null)
  if (response?.ok && (await response.json().catch(() => null))?.ok === true) {
    return { address: defaultAddress, token, managed: false }
  }
  if (response) throw new Error('默认端口上的助手无法验证。请先关闭外部助手，再从这里启动。')
}

async function launch() {
  const legacy = await legacyAssistant()
  if (legacy) return legacy
  try {
    require.resolve('playwright-core')
  } catch {
    throw new Error('缺少知乎助手依赖。请在项目目录运行 pnpm install。')
  }

  return new Promise((resolve, reject) => {
    const worker = fork(entry, ['--desktop', '--port', '0'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    child = worker
    const timer = setTimeout(() => {
      if (worker.connected) worker.disconnect()
      reject(new Error('启动知乎助手超时。请检查项目依赖后重试。'))
    }, 8000)
    worker.once('error', () => {
      clearTimeout(timer)
      if (child === worker && worker.pid === undefined) child = undefined
      reject(new Error('无法启动知乎助手。请检查项目依赖后重试。'))
    })
    worker.once('exit', () => {
      clearTimeout(timer)
      if (child === worker) {
        child = undefined
        credentials = undefined
      }
      reject(new Error('知乎助手已退出。请确认项目依赖已安装。'))
    })
    worker.on('message', (result) => {
      if (worker !== child || result?.type !== 'ready' || !Number.isInteger(result.port) ||
        result.port < 1 || result.port > 65535 || typeof result.token !== 'string' || !/^[0-9a-f]{32}$/.test(result.token)) return
      clearTimeout(timer)
      credentials = { address: 'http://127.0.0.1:' + result.port, token: result.token, managed: true }
      resolve(credentials)
    })
  })
}

function startAssistant() {
  if (stopping) return stopping.then(startAssistant)
  if (credentials) return Promise.resolve(credentials)
  if (starting) return starting
  if (child) throw new Error('上一次启动正在退出。请稍后重试。')
  starting = launch().finally(() => { starting = undefined })
  return starting
}

async function stopAssistant() {
  if (starting) await starting.catch(() => {})
  if (stopping) return stopping
  const process = child
  if (!process || process.exitCode !== null || !process.connected) return
  stopping = new Promise((resolve) => {
    process.once('exit', resolve)
    process.send('stop', (error) => {
      if (error && process.connected) process.disconnect()
    })
  }).finally(() => { stopping = undefined })
  return stopping
}

module.exports = { startAssistant, stopAssistant }
