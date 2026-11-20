import { EMPTY_MACROS, type MathMacros } from './documentMacros'

const tokensOf = (tex: string) => tex.match(/\\[A-Za-z]+|\\[\s\S]|%[^\n]*(?:\n|$)|[\s\S]/gu)?.filter((token) => !token.startsWith('%')) ?? []
const command = /^\\[A-Za-z]+$/

interface MacroExpansion { tokens: { text: string }[]; numArgs: number; delimiters?: unknown[][]; unexpandable?: boolean }

function macroExpansion(macro: object): MacroExpansion | null {
  const value = macro as Partial<MacroExpansion>
  return Array.isArray(value.tokens) && typeof value.numArgs === 'number' && !value.unexpandable &&
    !value.delimiters?.some((parts) => parts.length) ? value as MacroExpansion : null
}

function argument(tokens: string[], start: number) {
  let end = start
  while (/^\s+$/.test(tokens[end] ?? '')) end++
  if (end >= tokens.length || tokens[end] === '}') throw new Error('missing argument')
  if (tokens[end] !== '{') return { content: [tokens[end]], end: end + 1 }
  const from = ++end
  let depth = 1
  for (; end < tokens.length; end++) {
    if (tokens[end] === '{') depth++
    if (tokens[end] === '}' && --depth === 0) return { content: tokens.slice(from, end), end: end + 1 }
  }
  throw new Error('unclosed argument')
}

export function expandDocumentMacros(latex: string, macros: MathMacros): { latex: string; unresolved: boolean; changed: boolean } {
  if (macros === EMPTY_MACROS) return { latex, unresolved: false, changed: false }
  const tokens = tokensOf(latex)
  if (!tokens.some((token) => Object.hasOwn(macros, token))) return { latex, unresolved: false, changed: false }
  if (/\\(?:newcommand|renewcommand|providecommand|g?def|let|verb|string|noexpand|csname)\b/.test(latex)) {
    return { latex, unresolved: true, changed: false }
  }
  let steps = 0
  const expand = (tokens: string[], depth: number): string[] => {
    if (depth > 40 || steps > 50000) throw new Error('expansion limit')
    steps += tokens.length
    const out: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const name = tokens[i]
      if (!Object.hasOwn(macros, name)) { out.push(name); continue }
      const macro = macros[name]
      const parsed = macro && typeof macro === 'object' ? macroExpansion(macro) : null
      const replacement = typeof macro === 'string' ? tokensOf(macro)
        : parsed ? [...parsed.tokens].reverse().map((token) => token.text) : null
      if (!replacement) throw new Error('unsupported macro')
      const argc = parsed?.numArgs ?? Math.max(0, ...[...String(macro).matchAll(/#([1-9])/g)].map((m) => Number(m[1])))
      const args: string[][] = []
      // TeX discards the whitespace immediately following a control word.
      while (command.test(name) && /^\s+$/.test(tokens[i + 1] ?? '')) i++
      for (let n = 0; n < argc; n++) {
        const arg = argument(tokens, i + 1)
        args.push(arg.content)
        i = arg.end - 1
      }
      const substituted: string[] = []
      for (let n = 0; n < replacement.length; n++) {
        const token = replacement[n]
        const next = replacement[n + 1]
        if (token === '#' && next === '#') { substituted.push('#'); n++; continue }
        if (token === '#' && /^[1-9]$/.test(next ?? '')) { substituted.push(...(args[Number(next) - 1] ?? [])); n++; continue }
        substituted.push(token)
      }
      out.push(...expand(substituted, depth + 1))
    }
    return out
  }
  try {
    const expanded = expand(tokens, 0)
    const value = expanded.map((token, i) => command.test(token) && /^[A-Za-z]/.test(expanded[i + 1] ?? '') ? token + ' ' : token).join('')
    return { latex: value, unresolved: false, changed: value !== latex }
  } catch {
    return { latex, unresolved: true, changed: false }
  }
}
