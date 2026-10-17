// Bulk edit for key/value tables: rows ⇄ text, one `key: value` per line. Disabled rows are
// written as `// key: value`. Parsing keeps row ids and descriptions for keys that survive, so
// toggling between table and text loses nothing. Pure.

import { newKeyValue } from './factory'
import type { KeyValue } from './types'

export function rowsToText(rows: KeyValue[]): string {
  return rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled ? '' : '// '}${r.key}: ${r.value}`)
    .join('\n')
}

export function textToRows(text: string, previous: KeyValue[] = []): KeyValue[] {
  const pool = [...previous]
  const rows: KeyValue[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    let enabled = true
    if (line.startsWith('//') || line.startsWith('#')) {
      enabled = false
      line = line.replace(/^(\/\/|#)\s*/, '')
      if (!line) continue
    }
    // `key: value` (headers style) or `key=value` (query style); the first separator wins.
    const colon = line.indexOf(':')
    const eq = line.indexOf('=')
    const sep = colon >= 0 && (eq < 0 || colon < eq) ? colon : eq
    const key = (sep >= 0 ? line.slice(0, sep) : line).trim()
    const value = sep >= 0 ? line.slice(sep + 1).trim() : ''
    // Reuse the first unused previous row with this key, so ids and descriptions survive.
    const idx = pool.findIndex((p) => p.key === key)
    const base = idx >= 0 ? pool.splice(idx, 1)[0] : newKeyValue()
    rows.push({ ...base, key, value, enabled })
  }
  return rows
}
