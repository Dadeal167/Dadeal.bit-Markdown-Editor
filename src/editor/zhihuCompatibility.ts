import type { Node as PMNode } from '@tiptap/pm/model'
import { BIB_LANGUAGE, refLabel, scholarIndex } from './scholarIndex'
import { MACRO_LANGUAGE } from './math/documentMacros'
import { diagramPng } from './mermaidDiagrams'
import { codeMask } from './tiptap/mathMarkdown'

async function projectFences(md: string): Promise<string> {
  const lines = md.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const output: Array<string | Promise<string>> = []
  for (let start = 0; start < lines.length;) {
    const open = /^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)/.exec(lines[start])
    if (!open || (open[2][0] === '`' && open[3].includes('`'))) { output.push(lines[start++]); continue }
    const [, prefix, fence, info] = open
    let end = start + 1
    let closed = false
    for (; end < lines.length; end++) {
      const close = /^([ \t>]*)(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/.exec(lines[end])
      if (close && close[2][0] === fence[0] && close[2].length >= fence.length) { closed = true; break }
    }
    const stop = closed ? end + 1 : end
    const raw = lines.slice(start, stop).join('')
    const language = info.trim().split(/\s+/)[0]
    if (language === 'mermaid') {
      const source = lines.slice(start + 1, end).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('').trimEnd()
      output.push(diagramPng(source).then((png) => png ? `${prefix}![Mermaid 图表](${png})\n` : raw))
    } else if (language !== MACRO_LANGUAGE && language !== BIB_LANGUAGE) output.push(raw)
    start = stop
  }
  return (await Promise.all(output)).join('')
}

export async function projectZhihuMarkdown(md: string, doc: PMNode): Promise<string> {
  if (!md.includes('mermaid') && !md.includes(MACRO_LANGUAGE) && !md.includes(BIB_LANGUAGE) && !/\[(?:\^|@|!)/.test(md)) return md
  const index = scholarIndex(doc)
  const refs = new Map([...index.links.values()].map((link) => [`${link.kind}:${link.key}`, link]))
  const mask = codeMask(md)
  const mapped = md.replace(/(?<!\\)\[\^([^\]\s]+)\](:)?|(?<!\\)\[@(stmt:)?([^\]\s]+)\]|(?<!\\)\[!(?:THEOREM|LEMMA|DEFINITION|EXAMPLE|PROOF)\]\{([^{}\s]+)\}/g,
    (whole, note: string | undefined, colon: string | undefined, statement: string | undefined,
      key: string | undefined, header: string | undefined, offset: number) => {
      if (mask[offset]) return whole
      if (note) {
        const entry = index.footnotes.get(note)
        if (colon) return entry ? `**${entry.label === '脚注' ? '未引用的脚注' : `〔注${entry.label}〕`}**` : whole
        return refs.has(`footnote:${note}`) ? `〔注${refLabel(refs.get(`footnote:${note}`))}〕` : whole
      }
      if (key) {
        const link = refs.get(`${statement ? 'statement' : 'citation'}:${key}`)
        return link ? refLabel(link).replace(/\[/g, '\\[') : whole
      }
      const entry = header ? index.statements.get(header) : undefined
      return entry ? `**${entry.label}**` : whole
    })
  const bibliography = [...index.bibliography.values()].map((entry) =>
    `${entry.label.replace('[', '\\[')} ${String(entry.text).replace(/[&<>`*_$~[\]\\|]/g, (char) => `&#${char.codePointAt(0)};`)}`)
  const projected = await projectFences(mapped)
  return bibliography.length ? `${projected.trimEnd()}\n\n## 参考文献\n\n${bibliography.join('\n\n')}\n` : projected
}
