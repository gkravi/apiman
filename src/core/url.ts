import { newKeyValue } from './factory'
import type { KeyValue } from './types'

// Two-way sync between the URL bar and the params table. Parsing is done by hand rather
// than with `new URL()` so that unresolved {{variables}} and partial URLs survive untouched.

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Encode a query component but leave {{variable}} references readable. */
const encode = (s: string): string =>
  s
    .split(/(\{\{[^{}]*\}\})/)
    .map((part) => (part.startsWith('{{') ? part : encodeURIComponent(part)))
    .join('')

export function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashIdx = url.indexOf('#')
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const qIdx = noHash.indexOf('?')
  return qIdx >= 0
    ? { base: noHash.slice(0, qIdx), query: noHash.slice(qIdx + 1), hash }
    : { base: noHash, query: '', hash }
}

/**
 * Parse the query string of `url` into params. Disabled params from `previous` are kept
 * (they live only in the table, not in the URL) so toggling a checkbox never loses data.
 */
export function paramsFromUrl(url: string, previous: KeyValue[] = []): KeyValue[] {
  const { query } = splitUrl(url)
  const enabledPrev = previous.filter((p) => p.enabled)
  const parsed = query
    ? query.split('&').map((pair, i) => {
        const eq = pair.indexOf('=')
        const key = decode(eq >= 0 ? pair.slice(0, eq) : pair)
        const value = eq >= 0 ? decode(pair.slice(eq + 1)) : ''
        const prev = enabledPrev[i]
        return prev ? { ...prev, key, value } : newKeyValue(key, value)
      })
    : []
  // Re-insert disabled params at their original positions.
  const result: KeyValue[] = []
  let p = 0
  for (const prev of previous) {
    if (!prev.enabled) result.push(prev)
    else if (p < parsed.length) result.push(parsed[p++])
  }
  return result.concat(parsed.slice(p))
}

export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url)
  const query = params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value === '' && !p.key.includes('=') ? encode(p.key) : `${encode(p.key)}=${encode(p.value)}`))
    .join('&')
  return base + (query ? `?${query}` : '') + hash
}

/** Ensure a scheme so `localhost:3000/x` and `api.example.com` work like they do in Postman. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}
