// Administrator-managed policies: a read-only file an IT team deploys (or an MDM profile on macOS)
// that locks settings for everyone on the machine. This file is pure — parsing, host matching and
// the effective settings — so the app, the CLI and the renderer (which only shows what is locked)
// share it. The main process and the CLI load the file and call setActivePolicy(); the executor,
// realtime/gRPC, the sandbox and the mock server read activePolicy() at the point of use, so a
// renderer can't opt out by sending different settings.

import type { HistoryEntry, NetworkSettings } from './types'

export interface ManagedPolicy {
  /** Pre-request and post-response scripts don't run. */
  disableScripts?: boolean
  /** Only these destination hosts may be contacted (glob: `*.example.com`, `api-*.corp`, optional `:port`). */
  allowedHosts?: string[]
  /** These destination hosts may never be contacted; checked before allowedHosts. */
  blockedHosts?: string[]
  /** TLS certificates are always verified; "Verify SSL" and `--insecure` are ignored. */
  forbidInsecureTls?: boolean
  /** Every request goes through this proxy; the user's proxy settings are ignored. */
  enforcedProxy?: { url: string; bypass: string }
  /** This CA bundle (PEM) is trusted in addition to the system roots; the user's choice is ignored. */
  enforcedCaPath?: string
  disableMockServers?: boolean
  /** pm.sendRequest() fails inside scripts. */
  disableSendRequest?: boolean
  /** History entries older than this many days are deleted; 0 keeps no history. */
  historyRetentionDays?: number
}

/** What the renderer is told: the policy in force and where it came from. */
export interface PolicyInfo {
  policy: ManagedPolicy
  /** Files or profiles the policy was read from; empty when no policy is set. */
  sources: string[]
}

export class PolicyError extends Error {}

export const NO_POLICY: ManagedPolicy = {}

const BOOLEAN_KEYS = ['disableScripts', 'forbidInsecureTls', 'disableMockServers', 'disableSendRequest'] as const
const LIST_KEYS = ['allowedHosts', 'blockedHosts'] as const
const KNOWN_KEYS = new Set<string>([...BOOLEAN_KEYS, ...LIST_KEYS, 'enforcedProxy', 'enforcedCaPath', 'historyRetentionDays'])

/**
 * Validate a parsed policy document. A value of the wrong type is an error, not something to
 * skip: a typo must not quietly turn a restriction off. Unknown keys are reported as warnings
 * (they may belong to a newer ApiMan) and ignored.
 */
export function parsePolicy(doc: unknown, source = 'policy'): { policy: ManagedPolicy; warnings: string[] } {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new PolicyError(`${source}: expected a JSON object`)
  const raw = doc as Record<string, unknown>
  const policy: ManagedPolicy = {}
  const warnings: string[] = []
  const bad = (key: string, expected: string): never => {
    throw new PolicyError(`${source}: "${key}" must be ${expected}`)
  }

  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.has(key)) warnings.push(`${source}: unknown key "${key}" ignored`)

  for (const key of BOOLEAN_KEYS) {
    const v = raw[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean') bad(key, 'true or false')
    policy[key] = v as boolean
  }
  for (const key of LIST_KEYS) {
    const v = raw[key]
    if (v === undefined) continue
    if (!Array.isArray(v) || v.some((p) => typeof p !== 'string')) bad(key, 'a list of host patterns')
    const list = (v as string[]).map((p) => p.trim().toLowerCase()).filter(Boolean)
    for (const p of list) if (!parsePattern(p)) bad(key, `a list of host patterns ("${p}" isn't one)`)
    policy[key] = list
  }

  const proxy = raw.enforcedProxy
  if (proxy !== undefined) {
    const spec = typeof proxy === 'string' ? { url: proxy } : proxy
    if (!spec || typeof spec !== 'object') bad('enforcedProxy', 'a proxy URL or { "url": ..., "bypass": ... }')
    const { url, bypass } = spec as { url?: unknown; bypass?: unknown }
    if (typeof url !== 'string' || !url.trim()) bad('enforcedProxy', 'a proxy URL or { "url": ..., "bypass": ... }')
    if (bypass !== undefined && typeof bypass !== 'string' && !(Array.isArray(bypass) && bypass.every((b) => typeof b === 'string')))
      bad('enforcedProxy.bypass', 'a comma-separated string or a list of hosts')
    const full = /^[a-z]+:\/\//i.test(url as string) ? (url as string).trim() : `http://${(url as string).trim()}`
    try {
      new URL(full)
    } catch {
      bad('enforcedProxy', `a valid URL ("${url as string}" isn't one)`)
    }
    policy.enforcedProxy = { url: full, bypass: Array.isArray(bypass) ? bypass.join(',') : ((bypass as string | undefined) ?? '') }
  }

  const ca = raw.enforcedCaPath
  if (ca !== undefined) {
    if (typeof ca !== 'string' || !ca.trim()) bad('enforcedCaPath', 'the path of a PEM file')
    policy.enforcedCaPath = (ca as string).trim()
  }

  const days = raw.historyRetentionDays
  if (days !== undefined) {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) bad('historyRetentionDays', 'a number of days (0 or more)')
    policy.historyRetentionDays = days as number
  }
  return { policy, warnings }
}

/**
 * Combine policies from several sources (e.g. the policy file and a macOS configuration profile).
 * Switches are on if any source turns them on, block lists add up and the shortest history
 * retention wins. Allow lists, the proxy and the CA can't be combined safely, so the later source
 * (the configuration profile) replaces the earlier one.
 */
export function mergePolicies(...policies: ManagedPolicy[]): ManagedPolicy {
  const out: ManagedPolicy = {}
  for (const p of policies) {
    for (const key of BOOLEAN_KEYS) if (p[key]) out[key] = true
    if (p.blockedHosts) out.blockedHosts = [...new Set([...(out.blockedHosts ?? []), ...p.blockedHosts])]
    if (p.allowedHosts) out.allowedHosts = [...p.allowedHosts]
    if (p.enforcedProxy) out.enforcedProxy = p.enforcedProxy
    if (p.enforcedCaPath) out.enforcedCaPath = p.enforcedCaPath
    if (p.historyRetentionDays !== undefined) out.historyRetentionDays = Math.min(out.historyRetentionDays ?? Infinity, p.historyRetentionDays)
  }
  return out
}

export const isPolicyEmpty = (p: ManagedPolicy): boolean => Object.keys(p).length === 0

// ---------- host patterns ----------

interface Pattern {
  host: RegExp
  port?: string
}

const defaultPort = (protocol: string): string => (/^(https|wss|grpcs):$/.test(protocol) ? '443' : '80')

/** `*` matches any run of characters (dots included); `*.example.com` also matches example.com. */
function parsePattern(p: string): Pattern | null {
  let host = p
  let port: string | undefined
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+|\*))?$/.exec(p)
  if (!m) return null
  host = m[1]
  if (m[2] && m[2] !== '*') port = m[2]
  host = host.replace(/\.$/, '')
  if (!host || /[\s/?#@]/.test(host)) return null
  const glob = (s: string): string => s.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  const source = host.startsWith('*.') ? `(?:.*\\.)?${glob(host.slice(2))}` : glob(host)
  return { host: new RegExp(`^${source}$`, 'i'), port }
}

const patternCache = new Map<string, Pattern | null>()

export function hostMatchesPattern(pattern: string, url: URL): boolean {
  let p = patternCache.get(pattern)
  if (p === undefined) patternCache.set(pattern, (p = parsePattern(pattern.trim().toLowerCase())))
  if (!p) return false
  if (p.port && p.port !== (url.port || defaultPort(url.protocol))) return false
  return p.host.test(url.hostname.toLowerCase().replace(/\.$/, ''))
}

/**
 * Why a destination is refused, or null when it's allowed. Matching uses the URL's normalised
 * host name (so `http://2130706433/` is checked as 127.0.0.1); names are not resolved to IPs.
 */
export function hostBlockedReason(target: string | URL, policy: ManagedPolicy = activePolicy()): string | null {
  if (!policy.allowedHosts && !policy.blockedHosts) return null
  let url: URL
  try {
    url = typeof target === 'string' ? new URL(target) : target
  } catch {
    return `Your organisation's policy only allows requests to known hosts, and "${String(target)}" isn't a valid URL`
  }
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname
  if (policy.blockedHosts?.some((p) => hostMatchesPattern(p, url))) return `Requests to ${host} are blocked by your organisation's policy`
  if (policy.allowedHosts && !policy.allowedHosts.some((p) => hostMatchesPattern(p, url))) return `Requests to ${host} aren't allowed by your organisation's policy`
  return null
}

/** Throw when the policy refuses the destination. */
export function assertHostAllowed(target: string | URL, policy: ManagedPolicy = activePolicy()): void {
  const reason = hostBlockedReason(target, policy)
  if (reason) throw new PolicyError(reason)
}

// ---------- effective settings ----------

export const effectiveVerifySsl = (verifySsl: boolean, policy: ManagedPolicy = activePolicy()): boolean => verifySsl || !!policy.forbidInsecureTls

/** The user's network settings with the enforced proxy and CA bundle swapped in. */
export function effectiveNetwork(network: NetworkSettings | undefined, policy: ManagedPolicy = activePolicy()): NetworkSettings | undefined {
  if (!policy.enforcedProxy && !policy.enforcedCaPath) return network
  const base: NetworkSettings = network ?? { proxy: { enabled: false, url: '', bypass: '' }, certificates: [] }
  return {
    ...base,
    ...(policy.enforcedProxy ? { proxy: { enabled: true, url: policy.enforcedProxy.url, bypass: policy.enforcedProxy.bypass } } : {}),
    ...(policy.enforcedCaPath ? { caPath: policy.enforcedCaPath } : {})
  }
}

/** History with entries past the retention period removed. */
export function pruneHistory(history: HistoryEntry[], policy: ManagedPolicy = activePolicy(), now = Date.now()): HistoryEntry[] {
  const days = policy.historyRetentionDays
  if (days === undefined) return history
  if (days === 0) return []
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return history.filter((h) => h.timestamp >= cutoff)
}

export const SCRIPTS_DISABLED = "Scripts are turned off by your organisation's policy"
export const SEND_REQUEST_DISABLED = "pm.sendRequest is turned off by your organisation's policy"
export const MOCKS_DISABLED = "Mock servers are turned off by your organisation's policy"

// ---------- the policy in force ----------

let active: ManagedPolicy = NO_POLICY

/** Set by the main process at startup and by the CLI's --policy; nothing else changes it. */
export function setActivePolicy(policy: ManagedPolicy): void {
  active = Object.freeze({ ...policy })
}

export const activePolicy = (): ManagedPolicy => active
