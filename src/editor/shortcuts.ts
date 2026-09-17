/**
 * 自定义快捷键：动作清单、按键规范化、绑定存储、运行时注册表。
 *
 * 设计要点：
 * - 绑定存在 localStorage（md-editor-shortcuts-v1），只存与默认值不同的项
 * - 编辑器里挂一个「读注册表」的 keymap 插件（见 tiptap/Shortcuts.ts），
 *   按键时实时查表 → 改键立刻生效，不用重建编辑器
 * - 受管动作的「旧默认键」会被吞掉，否则改了键旧键还会触发一次（TipTap 内置键位还在）
 */

export type ShortcutGroup = '编辑' | '插入' | '文件' | '视图'

export interface ShortcutAction {
  id: string
  group: ShortcutGroup
  label: string
  /** 默认键位；null 表示默认不绑定 */
  def: string | null
}

/**
 * 注意：这里的键位串必须与 normalizeEvent 的输出格式完全一致
 * （字母大写、Shift 符号映射回基准键），否则 match 永远匹配不上。
 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'undo', group: '编辑', label: '撤销', def: 'Mod-Z' },
  { id: 'redo', group: '编辑', label: '重做', def: 'Mod-Shift-Z' },
  { id: 'bold', group: '编辑', label: '加粗', def: 'Mod-B' },
  { id: 'italic', group: '编辑', label: '斜体', def: 'Mod-I' },
  { id: 'clearFormat', group: '编辑', label: '清除格式', def: 'Mod-\\' },
  { id: 'h1', group: '编辑', label: '一级标题', def: 'Mod-Alt-1' },
  { id: 'h2', group: '编辑', label: '二级标题', def: 'Mod-Alt-2' },
  { id: 'h3', group: '编辑', label: '三级标题', def: 'Mod-Alt-3' },
  { id: 'paragraph', group: '编辑', label: '正文', def: 'Mod-Alt-0' },
  { id: 'bulletList', group: '编辑', label: '无序列表', def: 'Mod-Shift-8' },
  { id: 'orderedList', group: '编辑', label: '有序列表', def: 'Mod-Shift-7' },
  { id: 'quote', group: '编辑', label: '引用', def: 'Mod-Shift-9' },
  { id: 'codeBlock', group: '编辑', label: '代码块', def: 'Mod-Alt-C' },
  { id: 'hr', group: '编辑', label: '分割线', def: null },

  { id: 'formula', group: '插入', label: '插入公式', def: 'Mod-Shift-M' },
  { id: 'table', group: '插入', label: '插入表格', def: 'Mod-Shift-T' },
  { id: 'link', group: '插入', label: '插入链接', def: 'Mod-K' },
  // 原本是 Mod-Shift-I，但那是 Chrome/Edge 打开开发者工具的保留键，网页拦不住
  { id: 'image', group: '插入', label: '插入图片', def: 'Mod-Shift-P' },
  { id: 'video', group: '插入', label: '插入视频', def: null },

  { id: 'save', group: '文件', label: '保存 .md', def: 'Mod-S' },
  { id: 'open', group: '文件', label: '打开 .md', def: 'Mod-O' },
  { id: 'exportPdf', group: '文件', label: '存为 PDF', def: 'Mod-P' },
  { id: 'exportHtml', group: '文件', label: '导出 HTML', def: null },
  { id: 'newDoc', group: '文件', label: '新建文档', def: 'Mod-Alt-N' },
  { id: 'docs', group: '文件', label: '我的文档', def: 'Mod-Alt-D' },

  { id: 'markdownInput', group: '视图', label: '切换 Markdown 输入', def: 'Mod-Shift-K' },
  { id: 'outline', group: '视图', label: '大纲', def: 'Mod-Alt-O' },
  { id: 'fullscreen', group: '视图', label: '全屏', def: 'Mod-Shift-F' },
  { id: 'shortcuts', group: '视图', label: '快捷键设置', def: 'Mod-/' },
]

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['编辑', '插入', '文件', '视图']

export const SHORTCUTS_KEY = 'md-editor-shortcuts-v1'

export type Bindings = Record<string, string | null>

export function defaultBindings(): Bindings {
  const out: Bindings = {}
  for (const a of SHORTCUT_ACTIONS) out[a.id] = a.def
  return out
}

export function loadBindings(): Bindings {
  const base = defaultBindings()
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Bindings
    for (const a of SHORTCUT_ACTIONS) {
      if (Object.prototype.hasOwnProperty.call(saved, a.id)) {
        const v = saved[a.id]
        base[a.id] = typeof v === 'string' && v ? v : null
      }
    }
  } catch {
    /* 损坏就用默认 */
  }
  return base
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(bindings))
  } catch {
    /* 存储不可用时忽略：本次会话仍然生效 */
  }
}

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

/** Shift 按下时 e.key 会变成上档符号（Ctrl+Shift+8 → '*'），要映射回基准键才能和键位串对上 */
const SHIFTED_BASE: Record<string, string> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
}

/** 键盘事件 → 规范键位串，例如 Mod-Shift-8；不收录会抢正常打字的组合 */
export function normalizeEvent(e: KeyboardEvent): string | null {
  const k0 = e.key
  if (!k0 || k0 === 'Dead' || k0 === 'Unidentified' || k0 === 'Process') return null
  if (k0 === 'Control' || k0 === 'Alt' || k0 === 'Shift' || k0 === 'Meta') return null

  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('Mod')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')

  let k = k0
  if (e.shiftKey && SHIFTED_BASE[k]) k = SHIFTED_BASE[k]
  if (k === ' ') k = 'Space'
  else if (k.length === 1) k = k.toUpperCase()

  const isFunctionKey = /^F\d{1,2}$/.test(k)
  // 没有修饰键时只允许功能键与 Escape，避免把普通字符抢走
  if (mods.length === 0 && !isFunctionKey && k !== 'Escape') return null
  return [...mods, k].join('-')
}

/** 规范键位串 → 给人看的写法 */
export function displayKey(binding: string | null): string {
  if (!binding) return '未绑定'
  return binding
    .split('-')
    .map((p) => {
      if (p === 'Mod') return IS_MAC ? '⌘' : 'Ctrl'
      if (p === 'Alt') return IS_MAC ? '⌥' : 'Alt'
      if (p === 'Shift') return IS_MAC ? '⇧' : 'Shift'
      if (p === 'Space') return '空格'
      if (p === '\\') return '\\'
      return p
    })
    .join(IS_MAC ? '' : ' + ')
}

/* ============ 运行时注册表 ============ */

type Handler = () => void

const handlers = new Map<string, Handler>()
let bindings: Bindings = defaultBindings()

export const shortcuts = {
  bindings(): Bindings {
    return bindings
  },

  applyBindings(next: Bindings): void {
    bindings = next
    saveBindings(next)
  },

  setHandlers(map: Record<string, Handler>): void {
    handlers.clear()
    for (const [id, fn] of Object.entries(map)) handlers.set(id, fn)
  },

  /** 这个键位当前绑给了哪个动作 */
  match(key: string): string | null {
    for (const a of SHORTCUT_ACTIONS) {
      if (bindings[a.id] === key) return a.id
    }
    return null
  },

  run(id: string): boolean {
    const fn = handlers.get(id)
    if (!fn) return false
    fn()
    return true
  },

  /**
   * 是否是某个受管动作的「默认键」但已被改掉——这种键要吞掉，
   * 否则 TipTap 内置的键位（加粗、撤销…）还会照旧触发，改键就白改了。
   */
  isStaleDefault(key: string): boolean {
    for (const a of SHORTCUT_ACTIONS) {
      if (a.def === key && bindings[a.id] !== key) return true
    }
    return false
  },

  reset(): void {
    bindings = defaultBindings()
    saveBindings(bindings)
  },
}
