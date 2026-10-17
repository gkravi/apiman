import type { KeyValue } from './types'

/**
 * Variable scopes in priority order, highest first — mirrors Postman:
 * local → data → environment → collection → global.
 */
export type Scope = Pick<KeyValue, 'key' | 'value' | 'enabled'>[]

const VAR_PATTERN = /\{\{([^{}]+?)\}\}/g
const MAX_PASSES = 10

const rand = (n: number): number => Math.floor(Math.random() * n)
const pick = <T>(xs: T[]): T => xs[rand(xs.length)]
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken']
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson']

const uuid = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = rand(16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

/** Postman-compatible dynamic variables, e.g. {{$guid}}, {{$timestamp}}. */
export const DYNAMIC_VARIABLES: Record<string, () => string> = {
  $guid: uuid,
  $randomUUID: uuid,
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(rand(1001)),
  $randomBoolean: () => String(Math.random() < 0.5),
  $randomWord: () => pick(WORDS),
  $randomFirstName: () => pick(FIRST),
  $randomLastName: () => pick(LAST),
  $randomFullName: () => `${pick(FIRST)} ${pick(LAST)}`,
  $randomEmail: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${rand(100)}@example.com`,
  $randomColor: () => pick(['red', 'green', 'blue', 'yellow', 'purple', 'orange'])
}

export function lookup(name: string, scopes: Scope[]): string | undefined {
  const key = name.trim()
  for (const scope of scopes) {
    const hit = scope.find((v) => v.enabled && v.key === key)
    if (hit) return hit.value
  }
  const dyn = DYNAMIC_VARIABLES[key]
  return dyn ? dyn() : undefined
}

/**
 * Replace {{var}} references. Runs repeatedly so values that themselves contain
 * references (and nested names like {{host_{{env}}}}) resolve; unknown variables are left as-is.
 */
export function resolve(input: string, scopes: Scope[]): string {
  let out = input
  for (let i = 0; i < MAX_PASSES; i++) {
    let changed = false
    out = out.replace(VAR_PATTERN, (match, name: string) => {
      const value = lookup(name, scopes)
      if (value === undefined) return match
      changed = true
      return value
    })
    if (!changed) break
  }
  return out
}

/** Names of all {{variables}} referenced in a string (for highlighting / "unresolved" warnings). */
export function referencedVariables(input: string): string[] {
  return [...input.matchAll(VAR_PATTERN)].map((m) => m[1].trim())
}

export function unresolvedVariables(input: string, scopes: Scope[]): string[] {
  return referencedVariables(resolve(input, scopes)).filter((n) => !n.startsWith('$'))
}
