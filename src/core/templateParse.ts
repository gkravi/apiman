import type { ApiRequest } from './types'

// Template functions inside {{ }}: `{{ $name(arg, …) }}`. This file only *parses* (pure, safe in the
// renderer — used to find $prompt calls before sending); templates.ts evaluates them in Node.
//
// Arguments are 'single' or "double" quoted strings (which may contain {{variables}}), numbers,
// true/false, or nested calls: {{ $hmac('sha256', '{{secret}}', $now('unix')) }}.

export type TemplateArg = { kind: 'string'; value: string } | { kind: 'number'; value: number } | { kind: 'bool'; value: boolean } | { kind: 'call'; call: TemplateCall }

export interface TemplateCall {
  name: string
  args: TemplateArg[]
}

export interface TemplateMatch {
  /** Index of the opening `{{` and of the character after the closing `}}`. */
  start: number
  end: number
  call: TemplateCall
}

export class TemplateSyntaxError extends Error {}

/** Parse a call expression starting at `i` (pointing at `$`). Returns the call and the index after `)`. */
function parseCall(src: string, i: number): { call: TemplateCall; next: number } {
  const m = /^\$([A-Za-z][\w]*)\s*\(/.exec(src.slice(i))
  if (!m) throw new TemplateSyntaxError(`Expected a function like $name( at "${src.slice(i, i + 20)}"`)
  const name = m[1]
  let j = i + m[0].length
  const args: TemplateArg[] = []
  const skip = (): void => {
    while (j < src.length && /\s/.test(src[j])) j++
  }
  skip()
  if (src[j] === ')') return { call: { name, args }, next: j + 1 }
  for (;;) {
    skip()
    const c = src[j]
    if (c === "'" || c === '"') {
      let value = ''
      j++
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          value += src[j + 1]
          j += 2
        } else value += src[j++]
      }
      if (src[j] !== c) throw new TemplateSyntaxError(`Unclosed string in $${name}(…)`)
      j++
      args.push({ kind: 'string', value })
    } else if (c === '$') {
      const inner = parseCall(src, j)
      args.push({ kind: 'call', call: inner.call })
      j = inner.next
    } else {
      const lit = /^(-?\d+(?:\.\d+)?|true|false)/.exec(src.slice(j))
      if (!lit) throw new TemplateSyntaxError(`Unexpected "${src.slice(j, j + 12)}" in $${name}(…) — quote text arguments`)
      args.push(lit[1] === 'true' || lit[1] === 'false' ? { kind: 'bool', value: lit[1] === 'true' } : { kind: 'number', value: Number(lit[1]) })
      j += lit[1].length
    }
    skip()
    if (src[j] === ',') {
      j++
      continue
    }
    if (src[j] === ')') return { call: { name, args }, next: j + 1 }
    throw new TemplateSyntaxError(`Expected , or ) in $${name}(…)`)
  }
}

/**
 * Find every `{{ $fn(...) }}` in a string. Plain `{{variables}}` and `{{$guid}}`-style dynamic
 * variables (no parentheses) are left alone for the normal variable resolver.
 */
export function findTemplates(text: string): TemplateMatch[] {
  const out: TemplateMatch[] = []
  let i = 0
  while ((i = text.indexOf('{{', i)) >= 0) {
    let j = i + 2
    while (j < text.length && /\s/.test(text[j])) j++
    if (!/^\$[A-Za-z]\w*\s*\(/.test(text.slice(j))) {
      i += 2
      continue
    }
    const { call, next } = parseCall(text, j)
    let k = next
    while (k < text.length && /\s/.test(text[k])) k++
    if (!text.startsWith('}}', k)) throw new TemplateSyntaxError(`Missing }} after $${call.name}(…)`)
    out.push({ start: i, end: k + 2, call })
    i = k + 2
  }
  return out
}

/** Every $prompt('Label', 'default') in a set of strings, including inside nested calls. */
export function collectPrompts(texts: string[]): { label: string; defaultValue: string }[] {
  const found = new Map<string, string>()
  const visit = (call: TemplateCall): void => {
    if (call.name === 'prompt') {
      const label = call.args[0]?.kind === 'string' ? call.args[0].value : 'Value'
      const def = call.args[1]?.kind === 'string' ? call.args[1].value : ''
      if (!found.has(label)) found.set(label, def)
    }
    for (const a of call.args) {
      if (a.kind === 'call') visit(a.call)
      if (a.kind === 'string') for (const m of safeFind(a.value)) visit(m.call)
    }
  }
  for (const t of texts) for (const m of safeFind(t)) visit(m.call)
  return [...found].map(([label, defaultValue]) => ({ label, defaultValue }))
}

function safeFind(text: string): TemplateMatch[] {
  try {
    return findTemplates(text)
  } catch {
    return [] // syntax errors are reported when the request is sent
  }
}

/** A reference to another request's response, ready to paste into any field. */
export function responseReference(requestName: string, path?: string): string {
  const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return path && path.trim() ? `{{ $response(${q(requestName)}, ${q(path.trim())}) }}` : `{{ $response(${q(requestName)}) }}`
}

/** Every text field of a request that templates are rendered in (matches run.ts renderRequestTemplates). */
export function requestTexts(req: ApiRequest): string[] {
  const out = [req.url, ...req.params.flatMap((p) => [p.key, p.value]), ...req.headers.flatMap((h) => [h.key, h.value])]
  const b = req.body
  if (b.mode === 'raw') out.push(b.raw)
  else if (b.mode === 'urlencoded') out.push(...b.urlencoded.flatMap((p) => [p.key, p.value]))
  else if (b.mode === 'formdata') out.push(...b.formdata.flatMap((p) => [p.key, p.value]))
  else if (b.mode === 'graphql') out.push(b.query, b.variables)
  for (const [k, v] of Object.entries(req.auth)) if (typeof v === 'string' && k !== 'type') out.push(v)
  if (req.message !== undefined) out.push(req.message)
  return out
}
