import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  assertHostAllowed,
  effectiveNetwork,
  effectiveVerifySsl,
  hostBlockedReason,
  mergePolicies,
  MOCKS_DISABLED,
  NO_POLICY,
  parsePolicy,
  PolicyError,
  pruneHistory,
  SCRIPTS_DISABLED,
  SEND_REQUEST_DISABLED,
  setActivePolicy,
  type ManagedPolicy
} from './policy'
import { execute } from './executor'
import { runRequest } from './run'
import { runScript } from './sandbox'
import { startMockServer } from './mock'
import { openSse, openWebSocket } from './realtime'
import { grpcConnection } from './grpc'
import { newRequest } from './factory'
import { DEFAULT_SETTINGS, type HistoryEntry, type PreparedRequest, type RealtimeOpenInput, type RunRequestInput } from './types'

afterEach(() => setActivePolicy(NO_POLICY))

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'])
    return true
  } catch {
    return false
  }
})()

const vars = { local: {}, data: {}, environment: {}, collection: {}, globals: {} }
const info = { requestName: 'r', requestId: 'r', iteration: 0, iterationCount: 1 }

function server(): Promise<{ url: string; hits: () => number; close(): void }> {
  let hits = 0
  const s = http.createServer((req, res) => {
    hits++
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://blocked.test/' })
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, hits: () => hits, close: () => s.close() }))
  )
}

const get = (url: string, settings = DEFAULT_SETTINGS): PreparedRequest => ({ method: 'GET', url, headers: [], body: { kind: 'none' }, settings })

const input = (url: string, scripts: { pre?: string[]; test?: string[] } = {}): RunRequestInput => ({
  request: newRequest({ url }),
  parentAuths: [],
  preRequestScripts: scripts.pre ?? [],
  testScripts: scripts.test ?? [],
  variables: vars,
  info
})

describe('parsePolicy', () => {
  it('accepts every documented key', () => {
    const { policy, warnings } = parsePolicy({
      disableScripts: true,
      allowedHosts: ['*.Example.com', 'localhost:8080'],
      blockedHosts: ['evil.test'],
      forbidInsecureTls: true,
      enforcedProxy: 'proxy.corp:3128',
      enforcedCaPath: '/etc/ssl/corp.pem',
      disableMockServers: true,
      disableSendRequest: true,
      historyRetentionDays: 30
    })
    expect(warnings).toEqual([])
    expect(policy).toEqual({
      disableScripts: true,
      allowedHosts: ['*.example.com', 'localhost:8080'],
      blockedHosts: ['evil.test'],
      forbidInsecureTls: true,
      enforcedProxy: { url: 'http://proxy.corp:3128', bypass: '' },
      enforcedCaPath: '/etc/ssl/corp.pem',
      disableMockServers: true,
      disableSendRequest: true,
      historyRetentionDays: 30
    })
  })

  it('accepts a proxy object with a bypass list', () => {
    expect(parsePolicy({ enforcedProxy: { url: 'http://p:8080', bypass: ['localhost', '*.corp'] } }).policy.enforcedProxy).toEqual({ url: 'http://p:8080', bypass: 'localhost,*.corp' })
  })

  it('rejects values of the wrong type rather than ignoring them', () => {
    expect(() => parsePolicy({ disableScripts: 'yes' })).toThrow(PolicyError)
    expect(() => parsePolicy({ allowedHosts: 'example.com' })).toThrow(/list of host patterns/)
    expect(() => parsePolicy({ allowedHosts: ['http://example.com/path'] })).toThrow(PolicyError)
    expect(() => parsePolicy({ historyRetentionDays: -1 })).toThrow(PolicyError)
    expect(() => parsePolicy({ enforcedProxy: 42 })).toThrow(PolicyError)
    expect(() => parsePolicy({ enforcedCaPath: '' })).toThrow(PolicyError)
    expect(() => parsePolicy([])).toThrow(PolicyError)
  })

  it('warns about unknown keys', () => {
    expect(parsePolicy({ disableScritps: true }).warnings[0]).toMatch(/unknown key "disableScritps"/)
  })
})

describe('mergePolicies', () => {
  it('keeps the strictest switches and retention, adds block lists, and lets the later source set the rest', () => {
    const merged = mergePolicies(
      { disableScripts: true, blockedHosts: ['a.test'], allowedHosts: ['*.corp'], historyRetentionDays: 7 },
      { disableScripts: false, blockedHosts: ['b.test'], allowedHosts: ['api.corp'], historyRetentionDays: 30, forbidInsecureTls: true }
    )
    expect(merged).toEqual({ disableScripts: true, blockedHosts: ['a.test', 'b.test'], allowedHosts: ['api.corp'], historyRetentionDays: 7, forbidInsecureTls: true })
  })
})

describe('allowedHosts / blockedHosts', () => {
  const policy: ManagedPolicy = { allowedHosts: ['*.example.com', 'api-*.corp', 'localhost:8080', '[::1]'], blockedHosts: ['secret.example.com'] }

  it('matches glob patterns, subdomains and ports', () => {
    expect(hostBlockedReason('https://example.com/x', policy)).toBeNull()
    expect(hostBlockedReason('https://a.b.example.com/x', policy)).toBeNull()
    expect(hostBlockedReason('https://API-eu.corp', policy)).toBeNull()
    expect(hostBlockedReason('http://localhost:8080/', policy)).toBeNull()
    expect(hostBlockedReason('http://[::1]:9000/', policy)).toBeNull()
    expect(hostBlockedReason('http://localhost:9090/', policy)).toMatch(/aren't allowed/)
    expect(hostBlockedReason('https://example.com.evil.test/', policy)).toMatch(/aren't allowed/)
    expect(hostBlockedReason('https://notexample.com/', policy)).toMatch(/aren't allowed/)
  })

  it('checks the block list first', () => {
    expect(hostBlockedReason('https://secret.example.com', policy)).toMatch(/blocked/)
    expect(hostBlockedReason('https://evil.test', { blockedHosts: ['*.test'] })).toMatch(/blocked/)
    expect(hostBlockedReason('https://fine.dev', { blockedHosts: ['*.test'] })).toBeNull()
  })

  it('checks the normalised host, so numeric IP spellings are caught', () => {
    expect(hostBlockedReason('http://2130706433/', { blockedHosts: ['127.0.0.1'] })).toMatch(/blocked/)
    expect(hostBlockedReason('http://0x7f.1/', { blockedHosts: ['127.*'] })).toMatch(/blocked/)
  })

  it('an empty allow list allows nothing', () => {
    expect(() => assertHostAllowed('https://example.com', { allowedHosts: [] })).toThrow(PolicyError)
  })

  it('is enforced by the executor, including on redirects', async () => {
    const s = await server()
    try {
      setActivePolicy({ allowedHosts: ['127.0.0.1'] })
      expect((await execute(get(`${s.url}/`))).ok).toBe(true)
      const redirected = await execute(get(`${s.url}/redirect`))
      expect(redirected).toEqual({ ok: false, error: "Requests to blocked.test aren't allowed by your organisation's policy" })
      setActivePolicy({ blockedHosts: ['127.0.0.1'] })
      const before = s.hits()
      expect(await execute(get(`${s.url}/`))).toEqual({ ok: false, error: expect.stringMatching(/blocked by your organisation/) })
      expect(s.hits()).toBe(before)
    } finally {
      s.close()
    }
  })

  it('applies to pm.sendRequest', async () => {
    const s = await server()
    try {
      setActivePolicy({ blockedHosts: ['127.0.0.1'] })
      const r = await runRequest(
        input('https://allowed.invalid/', {
          pre: [`pm.sendRequest('${s.url}/', (err) => pm.environment.set('err', String(err)))`, 'pm.execution.skipRequest()']
        })
      )
      expect(r.variables.environment.err).toMatch(/blocked by your organisation/)
      expect(s.hits()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('applies to WebSocket, SSE and gRPC', async () => {
    setActivePolicy({ allowedHosts: ['*.corp'] })
    const live = (url: string, protocol: 'websocket' | 'sse' | 'grpc'): RealtimeOpenInput => ({ request: newRequest({ url, protocol }), parentAuths: [], variables: vars })
    await expect(openWebSocket(live('ws://127.0.0.1:1/', 'websocket'), () => {})).rejects.toThrow(/aren't allowed/)
    await expect(openSse(live('http://127.0.0.1:1/', 'sse'), () => {})).rejects.toThrow(/aren't allowed/)
    await expect(grpcConnection(live('grpc://127.0.0.1:50051', 'grpc'))).rejects.toThrow(/aren't allowed/)
    await expect(grpcConnection(live('grpcs://api.corp', 'grpc'))).resolves.toBeTruthy()
  })
})

describe('forbidInsecureTls', () => {
  it('turns verification back on', () => {
    expect(effectiveVerifySsl(false, {})).toBe(false)
    expect(effectiveVerifySsl(false, { forbidInsecureTls: true })).toBe(true)
  })

})

// A self-signed TLS server: reachable only with verification off, or with its cert as the CA.
describe.skipIf(!hasOpenssl)('TLS policies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiman-policy-'))
  let tlsServer: https.Server
  let url = ''

  beforeAll(async () => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' })
    tlsServer = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (_req, res) => res.end('secure'))
    await new Promise<void>((r) => tlsServer.listen(0, '127.0.0.1', r))
    url = `https://localhost:${(tlsServer.address() as AddressInfo).port}/`
  })
  afterAll(() => tlsServer.close())

  const insecure = { ...DEFAULT_SETTINGS, verifySsl: false }

  it('forbidInsecureTls verifies certificates even when Verify SSL is off', async () => {
    expect((await execute(get(url, insecure))).ok).toBe(true)
    setActivePolicy({ forbidInsecureTls: true })
    const r = await execute(get(url, insecure))
    expect(r.ok).toBe(false)
  })

  it('enforcedCaPath trusts the organisation CA', async () => {
    expect((await execute(get(url))).ok).toBe(false)
    setActivePolicy({ forbidInsecureTls: true, enforcedCaPath: join(dir, 'c.pem') })
    const r = await execute(get(url), undefined, { network: { proxy: { enabled: false, url: '', bypass: '' }, caPath: '/somewhere/else.pem', certificates: [] } })
    expect(r.ok && r.response.body).toBe('secure')
  })
})

describe('enforcedProxy / enforcedCaPath', () => {
  it('replaces the user proxy and CA', () => {
    const user = { proxy: { enabled: false, url: 'http://mine:1', bypass: '*' }, caPath: '/mine.pem', certificates: [] }
    expect(effectiveNetwork(user, {})).toBe(user)
    expect(effectiveNetwork(user, { enforcedProxy: { url: 'http://corp:3128', bypass: 'localhost' }, enforcedCaPath: '/corp.pem' })).toEqual({
      proxy: { enabled: true, url: 'http://corp:3128', bypass: 'localhost' },
      caPath: '/corp.pem',
      certificates: []
    })
    expect(effectiveNetwork(undefined, { enforcedCaPath: '/corp.pem' })?.caPath).toBe('/corp.pem')
  })

  it('sends requests through the enforced proxy even when the user turned the proxy off', async () => {
    const seen: string[] = []
    const proxy = http.createServer((req, res) => {
      seen.push(req.url ?? '')
      res.end('via proxy')
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    try {
      setActivePolicy({ enforcedProxy: { url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, bypass: '' } })
      const r = await execute(get('http://api.example.invalid/x'), undefined, { network: { proxy: { enabled: false, url: '', bypass: '' }, certificates: [] } })
      expect(r.ok && r.response.body).toBe('via proxy')
      expect(seen).toEqual(['http://api.example.invalid/x'])
    } finally {
      proxy.close()
    }
  })

  it('fails when the enforced CA file is missing, instead of silently trusting less', async () => {
    setActivePolicy({ enforcedCaPath: '/nonexistent/corp-ca.pem' })
    const r = await execute(get('https://127.0.0.1:1/'))
    expect(r.ok).toBe(false)
  })
})

describe('disableScripts', () => {
  it('skips scripts and says why', async () => {
    const s = await server()
    try {
      setActivePolicy({ disableScripts: true })
      const r = await runRequest(input(`${s.url}/`, { pre: ['pm.environment.set("ran", "yes")'], test: ['pm.test("t", () => {})'] }))
      expect(r.result?.ok).toBe(true)
      expect(r.variables.environment.ran).toBeUndefined()
      expect(r.tests).toEqual([])
      expect(r.console.some((c) => c.message.includes(SCRIPTS_DISABLED))).toBe(true)
    } finally {
      s.close()
    }
  })

  it('is enforced in the sandbox itself', async () => {
    setActivePolicy({ disableScripts: true })
    const out = await runScript('pm.environment.set("x", "1")', { event: 'prerequest', variables: vars, request: { url: '', method: 'GET', headers: [], body: null }, info })
    expect(out.error).toBe(SCRIPTS_DISABLED)
    expect(out.variables.environment.x).toBeUndefined()
  })
})

describe('disableSendRequest', () => {
  it('fails pm.sendRequest and sends nothing', async () => {
    const s = await server()
    try {
      setActivePolicy({ disableSendRequest: true })
      const r = await runRequest(input('https://x.invalid/', { pre: [`pm.sendRequest('${s.url}/', (err) => pm.environment.set('err', String(err)))`, 'pm.execution.skipRequest()'] }))
      expect(r.variables.environment.err).toContain(SEND_REQUEST_DISABLED)
      expect(s.hits()).toBe(0)
    } finally {
      s.close()
    }
  })
})

describe('disableMockServers', () => {
  it('refuses to start a mock server', async () => {
    setActivePolicy({ disableMockServers: true })
    await expect(startMockServer({ id: 'c', name: 'c', items: [], variables: [] } as never, 0, () => {})).rejects.toThrow(MOCKS_DISABLED)
  })
})

describe('historyRetentionDays', () => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 9, 17)
  const entry = (ageDays: number): HistoryEntry => ({ id: String(ageDays), timestamp: now - ageDays * day, request: newRequest() })
  const history = [entry(0), entry(5), entry(31)]

  it('drops entries older than the retention period', () => {
    expect(pruneHistory(history, {}, now)).toBe(history)
    expect(pruneHistory(history, { historyRetentionDays: 30 }, now).map((h) => h.id)).toEqual(['0', '5'])
    expect(pruneHistory(history, { historyRetentionDays: 0 }, now)).toEqual([])
  })
})
