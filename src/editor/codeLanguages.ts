/**
 * 代码块可以选的"语言"清单。
 *
 * 依据：运行时装在 lowlight 里的语法（highlight.js 的 common 包，共 37 种）。
 * 这里只挑**主流、日常真会用**的，按字母顺序排（用户要求：按字母顺序依次排列）；
 * 名字用大家熟悉的写法（C++、C#、TypeScript…），值就是 highlight.js 的语法名。
 *
 * `plaintext` 是"不高亮"（纯文本）；不选语言则是"自动识别"（高亮器自己猜语法）。
 */
import { createLowlight, common } from 'lowlight'

/** 运行时可用的语法名（拿它过滤清单，避免列出一个没装的语法点不动） */
export const AVAILABLE = (() => {
  try {
    return new Set(createLowlight(common).listLanguages())
  } catch {
    return new Set<string>()
  }
})()

export interface CodeLanguage {
  /** 显示名（也用于排序） */
  label: string
  /** highlight.js 的语法名；空字符串表示"不指定" */
  value: string
}

/** 菜单第一项：不指定语言 = 让高亮器自己猜（这就是以前的默认行为） */
export const AUTO_LABEL = '自动识别（默认）'

const ALL: CodeLanguage[] = [
  { label: 'Arduino', value: 'arduino' },
  { label: 'Bash', value: 'bash' },
  { label: 'C', value: 'c' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'cpp' },
  { label: 'CSS', value: 'css' },
  { label: 'Diff', value: 'diff' },
  { label: 'Go', value: 'go' },
  { label: 'GraphQL', value: 'graphql' },
  { label: 'INI / 配置', value: 'ini' },
  { label: 'Java', value: 'java' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'JSON', value: 'json' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Less', value: 'less' },
  { label: 'Lua', value: 'lua' },
  { label: 'Makefile', value: 'makefile' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'Objective-C', value: 'objectivec' },
  { label: 'Perl', value: 'perl' },
  { label: 'PHP', value: 'php' },
  { label: 'Plain text（不高亮）', value: 'plaintext' },
  { label: 'Python', value: 'python' },
  { label: 'R', value: 'r' },
  { label: 'Ruby', value: 'ruby' },
  { label: 'Rust', value: 'rust' },
  { label: 'SCSS', value: 'scss' },
  { label: 'SQL', value: 'sql' },
  { label: 'Swift', value: 'swift' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'VB.NET', value: 'vbnet' },
  { label: 'XML / HTML', value: 'xml' },
  { label: 'YAML', value: 'yaml' },
]

/** 常见别名 → 清单里的名字。别人的 .md 里 ```js / ```py / ```yml 太常见了，
 *  不认出来的话按钮会显示"自动识别"（其实上色是对的），看着像坏了。 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  cs: 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  html: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  rb: 'ruby',
  pl: 'perl',
  objc: 'objectivec',
  'obj-c': 'objectivec',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
}

/** 按字母顺序（不区分大小写）排好的清单；运行时缺哪个语法就自动去掉哪个 */
export const CODE_LANGUAGES: CodeLanguage[] = ALL.filter((l) => l.value === '' || AVAILABLE.has(l.value)).sort((a, b) =>
  a.label.toLowerCase().localeCompare(b.label.toLowerCase()),
)

const LABEL_BY_VALUE = new Map(CODE_LANGUAGES.map((l) => [l.value, l.label]))

/** 把文档里写的语言（可能是别名）对到清单里的那一个；对不上就是 null（= 由高亮器自己猜） */
export function resolveLanguage(value: string | null | undefined): string | null {
  if (!value) return null
  if (LABEL_BY_VALUE.has(value)) return value
  const canon = ALIASES[value.toLowerCase()]
  return canon && LABEL_BY_VALUE.has(canon) ? canon : null
}

/** 按钮上的显示名 */
export function languageLabel(value: string | null | undefined): string {
  if (!value) return '自动识别'
  const canon = resolveLanguage(value)
  if (canon) return LABEL_BY_VALUE.get(canon) as string
  // 没内置的语法（```vue / ```dockerfile 这类）：别假装认出来了，但也要说明语言标记还留着
  return `${value} · 未内置`
}
