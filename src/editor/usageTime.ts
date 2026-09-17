/**
 * 使用时长统计（状态栏左下角显示的那行，也是"使用反馈"邮件里的内容）
 *
 * 两个数：
 *   · 本次使用时长 —— 从打开这个网页算起（刷新页面 = 新的一次）
 *   · 累计使用时长 —— 每次打开都往上加（存 localStorage，只在这台电脑的浏览器里）
 *
 * 为什么单独一个模块：状态栏要一直显示（得能定时刷新），反馈邮件要引用同一份数据，
 * 而且跨会话累计的逻辑（把上一次会话的时长结算掉）需要一个明确的地方做，免得散在组件里。
 */

const USAGE_KEY = 'md-editor-usage-v1'
const SESSION_KEY = 'md-editor-session-v1'

/** 单次会话最多计多久（防止忘了关标签页，第二天开机被算成"用了 14 小时"） */
const MAX_SESSION_MS = 8 * 60 * 60 * 1000

export interface UsageStats {
  /** 第一次使用的时间戳 */
  firstAt: number
  /** 累计使用了多久（毫秒） */
  totalMs: number
  /** 打开过多少次 */
  sessions: number
}

const EMPTY: UsageStats = { firstAt: 0, totalMs: 0, sessions: 0 }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存不下就算了：功能照用，只是不留记录 */
  }
}

export function loadUsage(): UsageStats {
  const raw = read(USAGE_KEY)
  if (!raw) return { ...EMPTY }
  try {
    const j = JSON.parse(raw) as Partial<UsageStats>
    return {
      firstAt: typeof j.firstAt === 'number' ? j.firstAt : 0,
      totalMs: typeof j.totalMs === 'number' ? j.totalMs : 0,
      sessions: typeof j.sessions === 'number' ? j.sessions : 0,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveUsage(s: UsageStats): void {
  write(USAGE_KEY, JSON.stringify(s))
}

/** 开始一次会话：把**上一次**会话的时长结算进累计值，返回本次会话的开始时间 */
export function beginSession(now = Date.now()): number {
  const stats = loadUsage()
  let prevStart = 0
  try {
    const j = JSON.parse(read(SESSION_KEY) ?? '{}') as { at?: number }
    if (typeof j.at === 'number') prevStart = j.at
  } catch {
    /* 记录坏了就当没有 */
  }
  if (prevStart > 0 && now > prevStart) {
    stats.totalMs += Math.min(now - prevStart, MAX_SESSION_MS)
    stats.sessions += 1
  }
  if (!stats.firstAt) stats.firstAt = now
  saveUsage(stats)
  write(SESSION_KEY, JSON.stringify({ at: now }))
  return now
}

/** 现在总共用了多久（= 之前结算过的累计 + 本次会话到此刻的时长） */
export function totalUsageMs(sessionStart: number, now = Date.now()): number {
  const stats = loadUsage()
  const current = sessionStart > 0 ? Math.min(Math.max(0, now - sessionStart), MAX_SESSION_MS) : 0
  return stats.totalMs + current
}

/** 本次会话开始时间（整个页面共用一个）。第一次问的时候开一次会话。 */
let sessionStart = 0
export function sessionStartedAt(): number {
  if (!sessionStart) sessionStart = beginSession()
  return sessionStart
}

/** 本次会话到此刻用了多久 */
export function sessionMs(now = Date.now()): number {
  return Math.max(0, now - sessionStartedAt())
}

/** 时长写成中文：不到 1 分钟 / N 分钟 / N 小时 M 分 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return '不到 1 分钟'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

/**
 * 「使用反馈」邮件里的正文（只带统计信息，**不带文档内容**）。
 *
 * 只放正文本身：收件人和标题**不写进来** ——
 * 用户明确要求"只用复制内容，不用复制收件人和标题"。
 * 邮箱地址和标题在弹窗界面上摆着（地址还能点一下单独复制），不用塞进这段文字。
 */
export function feedbackBody(opts: { wordCount: number; sessionMs: number; totalMs: number }): string {
  return [
    '你好，我想反馈一个使用问题或建议：',
    '',
    '',
    '——————————————',
    '（下面这几行是自动带上的，方便定位问题；不想发也可以删掉）',
    `当前文档字数：${opts.wordCount}`,
    `本次使用时长：${formatDuration(opts.sessionMs)}`,
    `累计使用时长：${formatDuration(opts.totalMs)}`,
    '',
    '（如果方便，请把出问题的步骤、或者截图一起发过来，谢谢！）',
  ].join('\n')
}

export const FEEDBACK_MAIL = 'dadealbit@gmail.com'
export const FEEDBACK_SUBJECT = 'Dadealbit Markdown 编辑器 · 使用反馈'

/** 反馈邮件的 mailto 链接 */
export function feedbackMailto(opts: { wordCount: number; sessionMs: number; totalMs: number }): string {
  return `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody(opts))}`
}

/** 常用邮箱的网页版写信地址（mailto 拉不起来时，直接点这个去网页里写） */
export const WEBMAIL_LINKS: { label: string; url: string }[] = [
  { label: 'QQ 邮箱', url: 'https://mail.qq.com/' },
  { label: '163 邮箱', url: 'https://mail.163.com/' },
  { label: 'Gmail', url: 'https://mail.google.com/mail/u/0/#compose' },
  { label: 'Outlook', url: 'https://outlook.live.com/mail/0/deeplink/compose' },
]
