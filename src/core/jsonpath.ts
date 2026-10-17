// A compact JSONPath evaluator for filtering responses. Pure.
//
// Supports: $ (root), .name, ['name'], [n] (negative from the end), [*] / .*, ..name / ..* (recursive),
// [a,b] unions, [start:end:step] slices, and filters [?(@.price < 10 && @.tags)] with
// == != < <= > >= =~ /regex/flags, && and ||. jq-style paths (".data[0].name") are accepted too.

type Json = unknown

type Step =
  | { kind: 'child'; names: (string | number)[] }
  | { kind: 'wildcard' }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'filter'; expr: string }
  | { kind: 'recursive'; then: Step }

export class JsonPathError extends Error {}

function parse(path: string): Step[] {
  let p = path.trim()
  if (p === '' || p === '$' || p === '.') return []
  if (p.startsWith('$')) p = p.slice(1)
  else if (!p.startsWith('.') && !p.startsWith('[')) p = `.${p}` // "data.items" → ".data.items"
  const steps: Step[] = []
  let i = 0

  const readName = (): string => {
    const m = /^[^.[\]\s]+/.exec(p.slice(i))
    if (!m) throw new JsonPathError(`Expected a property name at position ${i + 1}`)
    i += m[0].length
    return m[0]
  }

  const readBracket = (): Step => {
    // p[i] === '['
    let depth = 0
    let j = i
    let quote: string | null = null
    for (; j < p.length; j++) {
      const c = p[j]
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = null
      } else if (c === "'" || c === '"') quote = c
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) break
    }
    if (j >= p.length) throw new JsonPathError('Unclosed [')
    const inner = p.slice(i + 1, j).trim()
    i = j + 1
    if (inner === '*') return { kind: 'wildcard' }
    if (inner.startsWith('?')) {
      const expr = inner.slice(1).trim().replace(/^\(/, '').replace(/\)$/, '')
      return { kind: 'filter', expr }
    }
    if (/^-?\d*\s*:\s*-?\d*(\s*:\s*-?\d*)?$/.test(inner)) {
      const [s, e, st] = inner.split(':').map((x) => (x.trim() === '' ? undefined : Number(x)))
      return { kind: 'slice', start: s, end: e, step: st }
    }
    const names = splitTopLevel(inner, ',').map((part): string | number => {
      const t = part.trim()
      const q = /^(['"])(.*)\1$/.exec(t)
      if (q) return q[2].replace(/\\(.)/g, '$1')
      if (/^-?\d+$/.test(t)) return Number(t)
      throw new JsonPathError(`Unexpected "${t}" inside [ ]`)
    })
    return { kind: 'child', names }
  }

  while (i < p.length) {
    const c = p[i]
    if (c === '.' && p[i + 1] === '.') {
      i += 2
      let next: Step
      if (p[i] === '[') next = readBracket()
      else if (p[i] === '*') {
        i++
        next = { kind: 'wildcard' }
      } else next = { kind: 'child', names: [readName()] }
      steps.push({ kind: 'recursive', then: next })
    } else if (c === '.') {
      i++
      if (p[i] === '*') {
        i++
        steps.push({ kind: 'wildcard' })
      } else if (p[i] === '[') steps.push(readBracket())
      else steps.push({ kind: 'child', names: [readName()] })
    } else if (c === '[') steps.push(readBracket())
    else if (/\s/.test(c)) i++
    else throw new JsonPathError(`Unexpected "${c}" at position ${i + 1}`)
  }
  return steps
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

const isObject = (v: Json): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v)
const children = (v: Json): Json[] => (Array.isArray(v) ? v : isObject(v) ? Object.values(v) : [])

function descendants(v: Json): Json[] {
  const out: Json[] = [v]
  for (const c of children(v)) out.push(...descendants(c))
  return out
}

function literal(s: string, current: Json, root: Json): Json {
  const t = s.trim()
  if (t.startsWith('@') || t.startsWith('$')) {
    const base = t.startsWith('@') ? current : root
    const rest = t.slice(1)
    const res = evaluate(base, rest === '' ? '$' : `$${rest}`)
    return res.length ? res[0] : undefined
  }
  const q = /^(['"])(.*)\1$/.exec(t)
  if (q) return q[2]
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t)
  throw new JsonPathError(`Can't understand "${t}" in a filter`)
}

function test(expr: string, current: Json, root: Json): boolean {
  const ors = splitTopLevel(expr, '||')
  if (ors.length > 1) return ors.some((e) => test(e, current, root))
  const ands = splitTopLevel(expr, '&&')
  if (ands.length > 1) return ands.every((e) => test(e, current, root))
  let e = expr.trim()
  if (e.startsWith('(') && e.endsWith(')')) return test(e.slice(1, -1), current, root)
  let negate = false
  if (e.startsWith('!')) {
    negate = true
    e = e.slice(1)
  }
  const re = /^(.*?)\s*=~\s*\/(.*)\/([a-z]*)$/.exec(e)
  if (re) {
    const v = literal(re[1], current, root)
    return negate !== (typeof v === 'string' && new RegExp(re[2], re[3]).test(v))
  }
  const m = /^(.*?)\s*(==|!=|<=|>=|<|>)\s*(.*)$/.exec(e)
  if (!m) {
    const v = literal(e, current, root) // existence check
    return negate !== (v !== undefined && v !== null && v !== false)
  }
  const a = literal(m[1], current, root)
  const b = literal(m[3], current, root)
  let r: boolean
  switch (m[2]) {
    case '==':
      r = a === b
      break
    case '!=':
      r = a !== b
      break
    case '<':
      r = (a as number) < (b as number)
      break
    case '<=':
      r = (a as number) <= (b as number)
      break
    case '>':
      r = (a as number) > (b as number)
      break
    default:
      r = (a as number) >= (b as number)
  }
  return negate !== r
}

function apply(step: Step, nodes: Json[], root: Json): Json[] {
  const out: Json[] = []
  for (const n of nodes) {
    switch (step.kind) {
      case 'child':
        for (const name of step.names) {
          if (typeof name === 'number' && Array.isArray(n)) {
            const idx = name < 0 ? n.length + name : name
            if (idx >= 0 && idx < n.length) out.push(n[idx])
          } else if (isObject(n) && Object.prototype.hasOwnProperty.call(n, String(name))) out.push(n[String(name)])
          else if (Array.isArray(n) && String(name) === 'length') out.push(n.length)
        }
        break
      case 'wildcard':
        out.push(...children(n))
        break
      case 'slice': {
        if (!Array.isArray(n)) break
        const len = n.length
        const stepN = step.step ?? 1
        if (stepN === 0) throw new JsonPathError('Slice step cannot be 0')
        const norm = (v: number | undefined, d: number): number => (v === undefined ? d : v < 0 ? Math.max(0, len + v) : Math.min(len, v))
        if (stepN > 0) for (let k = norm(step.start, 0); k < norm(step.end, len); k += stepN) out.push(n[k])
        else for (let k = step.start === undefined ? len - 1 : norm(step.start, len - 1); k > (step.end === undefined ? -1 : norm(step.end, -1)); k += stepN) out.push(n[k])
        break
      }
      case 'filter':
        for (const c of children(n)) if (test(step.expr, c, root)) out.push(c)
        break
      case 'recursive':
        out.push(...apply(step.then, descendants(n), root))
        break
    }
  }
  return out
}

/** Evaluate a JSONPath (or jq-style path) against parsed JSON; returns every match. */
export function evaluate(data: Json, path: string): Json[] {
  let nodes: Json[] = [data]
  for (const step of parse(path)) nodes = apply(step, nodes, data)
  return nodes
}

/**
 * Filter a JSON response body for display: a single match is shown as-is, several as an array.
 * Throws JsonPathError (or SyntaxError for invalid JSON) with a readable message.
 */
export function filterJson(body: string, path: string): { result: Json; count: number } {
  const data = JSON.parse(body)
  const matches = evaluate(data, path)
  return { result: matches.length === 1 ? matches[0] : matches, count: matches.length }
}
