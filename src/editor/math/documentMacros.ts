import type { Node as PMNode } from '@tiptap/pm/model'
import katex, { type KatexOptions } from 'katex'

export const MACRO_LANGUAGE = 'latex-macros'
export type MathMacros = NonNullable<KatexOptions['macros']>
export const EMPTY_MACROS: MathMacros = Object.freeze({})
const empty = { macros: EMPTY_MACROS, problems: [] as (string | null)[] }

const compiled = new Map<string, typeof empty>()

function compile(sources: string[]) {
  if (!sources.length) return empty
  const key = JSON.stringify(sources)
  const cached = compiled.get(key)
  if (cached) return cached
  let macros: MathMacros = {}
  const problems = sources.map((source) => {
    if (source.length > 32000) return '宏定义块过长。'
    const next = { ...macros }
    try {
      katex.renderToString(source, { macros: next, globalGroup: true, throwOnError: true, trust: false, strict: false })
      macros = next
      return null
    } catch (error) {
      return error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/i, '').slice(0, 220) : '无法解析宏定义。'
    }
  })
  const result = { macros: Object.keys(macros).length ? Object.freeze(macros) : EMPTY_MACROS, problems }
  if (compiled.size >= 32) compiled.delete(compiled.keys().next().value!)
  compiled.set(key, result)
  return result
}

const docs = new WeakMap<PMNode, typeof empty & { positions: number[] }>()

export function documentMacros(doc: PMNode) {
  const cached = docs.get(doc)
  if (cached) return cached
  const positions: number[] = []
  const sources: string[] = []
  if (__BUILD_MODE__ === 'effect') doc.forEach((node, pos) => {
    if (node.type.name === 'codeBlock' && node.attrs.language === MACRO_LANGUAGE) {
      positions.push(pos)
      sources.push(node.textContent)
    }
  })
  const result = { ...compile(sources), positions }
  docs.set(doc, result)
  return result
}

export function markdownMacros(md: string): MathMacros {
  if (__BUILD_MODE__ !== 'effect' || !md.includes(MACRO_LANGUAGE)) return EMPTY_MACROS
  const sources: string[] = []
  let fence: string | undefined
  let source: string[] | undefined
  for (const line of md.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
        if (source) sources.push(source.join('\n'))
        fence = undefined
        source = undefined
      } else source?.push(line)
    } else if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
      fence = match[1]
      if (match[2].trim().split(/\s+/)[0] === MACRO_LANGUAGE) source = []
    }
  }
  if (source) sources.push(source.join('\n'))
  return compile(sources).macros
}

export function katexMacroOptions(macros: MathMacros): KatexOptions {
  // KaTeX writes \\gdef back into the map. Each formula receives its own copy.
  return macros === EMPTY_MACROS ? {} : { macros: { ...macros } }
}
