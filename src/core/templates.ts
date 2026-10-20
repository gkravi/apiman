// Node-only: evaluate template functions (see templateParse.ts for the syntax).
//
// Functions deliberately can't read files or environment variables: templates come with imported
// collections, and must not be able to send local secrets to whoever wrote them.

import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto'
import { filterJson } from './jsonpath'
import { findTemplates, TemplateSyntaxError, type TemplateArg, type TemplateCall } from './templateParse'
import { resolve, type Scope } from './variables'
import type { ApiResponse } from './types'

/** When `$response` may (re)send the referenced request. */
export type SendPolicy = { kind: 'if-missing' } | { kind: 'always' } | { kind: 'never' } | { kind: 'max-age'; seconds: number }

export interface TemplateEnv {
  /** Variable scopes for {{variables}} inside string arguments. */
  scopes: Scope[]
  /** Answers to $prompt(label), collected before sending. */
  prompts: Record<string, string>
  /** Latest response of the named request in the same collection, sending it per the policy. */
  response(ref: string, policy: SendPolicy): Promise<ApiResponse>
}

export class TemplateError extends Error {}

const MAX_DEPTH = 10

export const TEMPLATE_FUNCTIONS = ['response', 'base64', 'base64Decode', 'urlEncode', 'urlDecode', 'hash', 'hmac', 'uuid', 'now', 'random', 'prompt', 'jsonPath', 'lower', 'upper', 'trim'] as const

/** Replace every {{ $fn(...) }} in `text`; plain {{variables}} are left for the variable resolver. */
export async function renderTemplates(text: string, env: TemplateEnv, depth = 0): Promise<string> {
  if (!text.includes('{{')) return text
  if (depth > MAX_DEPTH) throw new TemplateError('Templates are nested too deeply')
  let matches
  try {
    matches = findTemplates(text)
  } catch (e) {
    throw new TemplateError((e as TemplateSyntaxError).message)
  }
  if (!matches.length) return text
  let out = ''
  let last = 0
  for (const m of matches) {
    out += text.slice(last, m.start) + (await evalCall(m.call, env, depth))
    last = m.end
  }
  return out + text.slice(last)
}

async function argValue(a: TemplateArg | undefined, env: TemplateEnv, depth: number): Promise<string | number | boolean | undefined> {
  if (!a) return undefined
  switch (a.kind) {
    case 'string':
      // Strings may contain nested templates and {{variables}}.
      return resolve(await renderTemplates(a.value, env, depth + 1), env.scopes)
    case 'call':
      return evalCall(a.call, env, depth + 1)
    default:
      return a.value
  }
}

const str = (v: unknown, what: string, fn: string): string => {
  if (v === undefined) throw new TemplateError(`$${fn}() needs ${what}`)
  return String(v)
}

const HASHES = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])
const algo = (v: unknown, fn: string): string => {
  const a = str(v, 'an algorithm (md5, sha1, sha256, sha384, sha512)', fn).toLowerCase().replace('-', '')
  if (!HASHES.has(a)) throw new TemplateError(`$${fn}(): unknown algorithm "${v}" — use md5, sha1, sha256, sha384 or sha512`)
  return a
}
const encoding = (v: unknown): 'hex' | 'base64' => (v === 'base64' ? 'base64' : 'hex')

function parsePolicy(v: unknown): SendPolicy {
  if (v === undefined || v === 'if-missing') return { kind: 'if-missing' }
  if (v === 'always' || v === 'never') return { kind: v }
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return { kind: 'max-age', seconds: n }
  throw new TemplateError(`$response(): the 3rd argument must be 'if-missing', 'always', 'never' or a max age in seconds`)
}

function extract(res: ApiResponse, ref: string, path: string | undefined): string {
  if (path === undefined || path === '' || path === 'body') return res.bodyEncoding === 'utf8' ? res.body : ''
  if (path === 'status') return String(res.status)
  if (path.toLowerCase().startsWith('header:')) {
    const name = path.slice(7).trim().toLowerCase()
    const h = res.headers.find(([k]) => k.toLowerCase() === name)
    if (!h) throw new TemplateError(`"${ref}" response has no ${path.slice(7).trim()} header`)
    return h[1]
  }
  let filtered
  try {
    filtered = filterJson(res.body, path)
  } catch (e) {
    throw new TemplateError(e instanceof SyntaxError ? `"${ref}" response isn't JSON, so the path ${path} can't be used` : `Bad path ${path}: ${(e as Error).message}`)
  }
  if (filtered.count === 0) throw new TemplateError(`${path} matched nothing in the "${ref}" response`)
  return typeof filtered.result === 'string' ? filtered.result : JSON.stringify(filtered.result)
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** $now(format, offset): 'iso' (default), 'unix', 'unixms', or tokens YYYY MM DD HH mm ss SSS (UTC). */
function formatNow(format: string, offset: string | undefined): string {
  let t = Date.now()
  if (offset) {
    const m = /^([+-]\d+)\s*([smhdw])$/.exec(offset.trim())
    if (!m) throw new TemplateError(`$now(): offset must look like +1h, -30m or +7d`)
    const unit = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[m[2] as 's']
    t += Number(m[1]) * unit
  }
  const d = new Date(t)
  if (format === 'iso') return d.toISOString()
  if (format === 'unix') return String(Math.floor(t / 1000))
  if (format === 'unixms') return String(t)
  return format
    .replace(/YYYY/g, String(d.getUTCFullYear()))
    .replace(/MM/g, pad(d.getUTCMonth() + 1))
    .replace(/DD/g, pad(d.getUTCDate()))
    .replace(/HH/g, pad(d.getUTCHours()))
    .replace(/mm/g, pad(d.getUTCMinutes()))
    .replace(/ss/g, pad(d.getUTCSeconds()))
    .replace(/SSS/g, pad(d.getUTCMilliseconds(), 3))
}

async function evalCall(call: TemplateCall, env: TemplateEnv, depth: number): Promise<string> {
  if (depth > MAX_DEPTH) throw new TemplateError('Templates are nested too deeply')
  const a = (i: number): Promise<string | number | boolean | undefined> => argValue(call.args[i], env, depth)
  const fn = call.name
  switch (fn) {
    case 'response': {
      const ref = str(await a(0), 'a request name', fn)
      const path = call.args[1] === undefined ? undefined : String(await a(1))
      const res = await env.response(ref, parsePolicy(await a(2)))
      return extract(res, ref, path)
    }
    case 'base64':
      return Buffer.from(str(await a(0), 'text', fn), 'utf8').toString('base64')
    case 'base64Decode':
      return Buffer.from(str(await a(0), 'text', fn), 'base64').toString('utf8')
    case 'urlEncode':
      return encodeURIComponent(str(await a(0), 'text', fn))
    case 'urlDecode':
      return decodeURIComponent(str(await a(0), 'text', fn))
    case 'hash':
      return createHash(algo(await a(0), fn)).update(str(await a(1), 'text', fn)).digest(encoding(await a(2)))
    case 'hmac':
      return createHmac(algo(await a(0), fn), str(await a(1), 'a key', fn))
        .update(str(await a(2), 'text', fn))
        .digest(encoding(await a(3)))
    case 'uuid':
      return randomUUID()
    case 'now':
      return formatNow(String((await a(0)) ?? 'iso'), call.args[1] === undefined ? undefined : String(await a(1)))
    case 'random': {
      const min = Number((await a(0)) ?? 0)
      const max = Number((await a(1)) ?? 100)
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new TemplateError('$random(min, max) needs whole numbers with min ≤ max')
      return String(randomInt(min, max + 1))
    }
    case 'prompt': {
      const label = String((await a(0)) ?? 'Value')
      return env.prompts[label] ?? String((await a(1)) ?? '')
    }
    case 'jsonPath': {
      const { result, count } = filterJson(str(await a(0), 'JSON text', fn), str(await a(1), 'a path', fn))
      if (count === 0) return ''
      return typeof result === 'string' ? result : JSON.stringify(result)
    }
    case 'lower':
      return str(await a(0), 'text', fn).toLowerCase()
    case 'upper':
      return str(await a(0), 'text', fn).toUpperCase()
    case 'trim':
      return str(await a(0), 'text', fn).trim()
    default:
      throw new TemplateError(`Unknown template function $${fn}() — available: ${TEMPLATE_FUNCTIONS.map((f) => `$${f}`).join(', ')}`)
  }
}
