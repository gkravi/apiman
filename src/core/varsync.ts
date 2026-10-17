import { newKeyValue } from './factory'
import type { Variable, VarMap } from './types'

// Bridges the editable variable tables (rows with ids, enabled flags, secrets) and the plain
// key→value maps scripts work on.

/** Enabled variables as a map; the first enabled row wins, matching resolution order. */
export function toVarMap(rows: Variable[]): VarMap {
  const out: VarMap = {}
  for (const r of rows) if (r.enabled && r.key && !(r.key in out)) out[r.key] = r.value
  return out
}

/**
 * Apply what a script changed (diff of `before` → `after`) to the table, keeping row ids,
 * order, disabled rows and secret flags intact.
 */
export function applyVarChanges(rows: Variable[], before: VarMap, after: VarMap): Variable[] {
  let out = rows
  for (const key of Object.keys(before)) {
    if (!(key in after)) out = out.filter((r) => !(r.enabled && r.key === key))
  }
  for (const [key, value] of Object.entries(after)) {
    if (before[key] === value) continue
    const idx = out.findIndex((r) => r.enabled && r.key === key)
    out = idx >= 0 ? out.map((r, i) => (i === idx ? { ...r, value } : r)) : [...out, newKeyValue(key, value)]
  }
  return out
}

/** Parse a runner data file: a JSON array of objects, or CSV with a header row. */
export function parseDataFile(content: string, fileName: string): VarMap[] {
  const text = content.replace(/^﻿/, '')
  if (/\.json$/i.test(fileName) || /^\s*\[/.test(text)) {
    const json = JSON.parse(text)
    if (!Array.isArray(json)) throw new Error('JSON data file must be an array of objects')
    return json.map((row) => Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])))
  }
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const [header, ...data] = rows
  return data.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
}

/** RFC 4180 CSV: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
