const labelPattern = '[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,95}'
const labels = new RegExp(String.raw`(?<!\\)\\label\s*\{(${labelPattern})\}`, 'g')
const references = new RegExp(String.raw`(?<!\\)\\(eqref|ref)\s*\{(${labelPattern})\}`, 'g')
const standalone = new RegExp(String.raw`^\\(eqref|ref)\s*\{(${labelPattern})\}$`)
const suppress = /(?<!\\)\\(?:notag|nonumber)(?![a-zA-Z])/g

export function equationLabels(latex: string): string[] {
  return [...latex.matchAll(labels)].map((match) => match[1])
}

export function equationReferences(latex: string): string[] {
  return [...latex.matchAll(references)].map((match) => match[2])
}

export function standaloneEquationReference(latex: string) {
  const match = standalone.exec(latex.trim())
  return match ? { label: match[2], parentheses: match[1] === 'eqref' } : null
}

export function equationMarkup(latex: string) {
  const withoutSuppression = latex.replace(suppress, '')
  return { core: withoutSuppression.replace(labels, ''), suppressed: withoutSuppression !== latex }
}

export function substituteEquationReferences(latex: string, getNumber?: (label: string) => string | undefined): string {
  return latex.replace(references, (_match, command: string, label: string) => {
    const number = getNumber?.(label) ?? '\\text{??}'
    return command === 'eqref' ? `(${number})` : number
  })
}

/** 单独保留手写的编号，以便在 Word 和知乎中使用相同的编号。 */
export function manualEquationTag(latex: string) {
  const start = /(?<!\\)\\tag(\*)?\s*\{/.exec(latex)
  if (!start) return null
  const valueFrom = start.index + start[0].length
  let depth = 1
  for (let index = valueFrom; index < latex.length; index++) {
    if (latex[index] === '\\') { index++; continue }
    if (latex[index] === '{') depth++
    if (latex[index] === '}' && --depth === 0) {
      return {
        value: latex.slice(valueFrom, index),
        parentheses: start[1] !== '*',
        from: start.index,
        to: index + 1,
      }
    }
  }
  return null
}
