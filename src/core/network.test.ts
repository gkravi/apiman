import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CookieJar, parseSetCookie } from './cookies'
import { execute } from './executor'
import { prepareRequest } from './prepare'
import { newRequest } from './factory'
import { clientCredentialsToken, parseRedirect, passwordToken, refreshToken, authorizeUrl } from './oauth2'
import { runRequest } from './run'
import { DEFAULT_NETWORK, DEFAULT_OAUTH2, type NetworkSettings } from './types'

const listen = async (server: net.Server): Promise<number> => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return (server.address() as AddressInfo).port
}

describe('cookie jar', () => {
  const u = new URL('https://api.example.com/v1/users')
  it('parses attributes and applies domain/path/secure rules', () => {
    const jar = new CookieJar()
    jar.setFromHeaders(['sid=1; Path=/; HttpOnly; Secure', 'pref=dark; Domain=.example.com; Path=/', 'scoped=x; Path=/v1', 'evil=1; Domain=other.com'], u)
    expect(jar.cookies.map((c) => c.name)).toEqual(['sid', 'pref', 'scoped'])
    expect(jar.cookieHeader(new URL('https://api.example.com/v1/x'))).toBe('scoped=x; sid=1; pref=dark')
    expect(jar.cookieHeader(new URL('http://api.example.com/'))).toBe('pref=dark') // secure cookie not sent over http
    expect(jar.cookieHeader(new URL('https://www.example.com/'))).toBe('pref=dark') // host-only sid stays on api.
  })
  it('expires, replaces and deletes', () => {
    const jar = new CookieJar()
    const now = 1_000_000
    jar.setFromHeaders(['a=1; Max-Age=10', 'b=1'], u, now)
    jar.setFromHeaders(['b=2'], u, now)
    expect(jar.cookieHeader(u, now + 5000)).toBe('a=1; b=2')
    expect(jar.cookieHeader(u, now + 11_000)).toBe('b=2')
    jar.setFromHeaders(['b=; Max-Age=0'], u, now)
    expect(jar.cookies).toHaveLength(0)
    expect(parseSetCookie('x=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT', u)?.expires).toBe(Date.UTC(2015, 9, 21, 7, 28))
  })
})

describe('executor network features', () => {
  let server: http.Server
  let base = ''
  const nonce = 'dcd98b7102dd2f0e8b11d0f600bfb0c093'
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/login') {
        res.writeHead(302, { Location: '/me', 'Set-Cookie': ['session=abc; Path=/; HttpOnly', 'theme=dark'] })
        return res.end()
      }
      if (req.url === '/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }))
      }
      if (req.url?.startsWith('/digest')) {
        const auth = req.headers.authorization ?? ''
        if (!auth.startsWith('Digest ')) {
          res.writeHead(401, { 'WWW-Authenticate': `Digest realm="test@host", qop="auth,auth-int", nonce="${nonce}", opaque="5ccc069c403ebaf9f0171e9517f40e41"` })
          return res.end()
        }
        // Verify independently of the client implementation.
        const p = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]))
        const md5 = (s: string): string => createHash('md5').update(s).digest('hex')
        const expected = md5(`${md5('Mufasa:test@host:Circle of Life')}:${nonce}:${p.nc}:${p.cnonce}:${p.qop}:${md5(`GET:${req.url}`)}`)
        res.writeHead(p.response === expected ? 200 : 403)
        return res.end(p.response === expected ? 'welcome' : 'bad digest')
      }
      if (req.url === '/token') {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const f = new URLSearchParams(body)
          const basic = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString()
          const clientOk = basic === 'app:s3cret' || (f.get('client_id') === 'app' && f.get('client_secret') === 's3cret')
          res.setHeader('Content-Type', 'application/json')
          if (!clientOk) return res.writeHead(401).end(JSON.stringify({ error: 'invalid_client' }))
          const g = f.get('grant_type')
          if (g === 'password' && f.get('password') !== 'pw') return res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant', error_description: 'bad password' }))
          res.end(JSON.stringify({ access_token: `at-${g}`, token_type: 'Bearer', expires_in: 3600, ...(g !== 'refresh_token' ? { refresh_token: 'rt-1' } : {}), scope: f.get('scope') }))
        })
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ url: req.url, host: req.headers.host, via: req.headers['x-via'] ?? null }))
    })
    base = `http://127.0.0.1:${await listen(server)}`
  })
  afterAll(() => server.close())

  it('stores cookies across a redirect and sends them on later requests', async () => {
    const jar = new CookieJar()
    const r = await execute(prepareRequest(newRequest({ url: `${base}/login` }), []), undefined, { jar })
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(r.response.body).cookie).toBe('session=abc; theme=dark')
    const again = await execute(prepareRequest(newRequest({ url: `${base}/me`, headers: [{ id: 'h', key: 'Cookie', value: 'manual=1', enabled: true }] }), []), undefined, { jar })
    if (!again.ok) throw new Error(again.error)
    expect(JSON.parse(again.response.body).cookie).toBe('manual=1; session=abc; theme=dark')
  })

  it('answers a Digest challenge', async () => {
    const ok = await execute(prepareRequest(newRequest({ url: `${base}/digest?x=1`, auth: { type: 'digest', username: 'Mufasa', password: 'Circle of Life' } }), []))
    if (!ok.ok) throw new Error(ok.error)
    expect([ok.response.status, ok.response.body]).toEqual([200, 'welcome'])
    const bad = await execute(prepareRequest(newRequest({ url: `${base}/digest`, auth: { type: 'digest', username: 'Mufasa', password: 'nope' } }), []))
    expect(bad.ok && bad.response.status).toBe(403)
  })

  it('fetches OAuth 2.0 tokens (client credentials, password, refresh)', async () => {
    const cfg = { ...DEFAULT_OAUTH2, accessTokenUrl: `${base}/token`, clientId: 'app', clientSecret: 's3cret', scope: 'read write' }
    const cc = await clientCredentialsToken(cfg)
    expect(cc).toMatchObject({ accessToken: 'at-client_credentials', refreshToken: 'rt-1', scope: 'read write' })
    expect(cc.expiresAt).toBeGreaterThan(Date.now())
    expect((await passwordToken({ ...cfg, clientAuth: 'body', grantType: 'password', username: 'u', password: 'pw' })).accessToken).toBe('at-password')
    await expect(passwordToken({ ...cfg, username: 'u', password: 'x' })).rejects.toThrow('400 — invalid_grant: bad password')
    const refreshed = await refreshToken({ ...cfg, refreshToken: 'rt-1' })
    expect(refreshed).toMatchObject({ accessToken: 'at-refresh_token', refreshToken: 'rt-1' })
  })

  it('builds authorize URLs and validates redirects', () => {
    const cfg = { ...DEFAULT_OAUTH2, authUrl: 'https://id.example.com/authorize', clientId: 'app', scope: 'openid' }
    const u = new URL(authorizeUrl(cfg, 'st8', 'chal'))
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'app', state: 'st8', code_challenge: 'chal', code_challenge_method: 'S256' })
    expect(parseRedirect(cfg, 'https://unrelated.com/', 'st8')).toBeNull()
    expect(parseRedirect(cfg, `${cfg.redirectUri}?code=abc&state=st8`, 'st8')).toEqual({ code: 'abc' })
    expect(parseRedirect(cfg, `${cfg.redirectUri}?code=abc&state=forged`, 'st8')).toEqual({ error: 'State mismatch — possible CSRF; token request aborted' })
    expect(parseRedirect(cfg, `${cfg.redirectUri}?error=access_denied`, 'st8')).toEqual({ error: 'access_denied' })
  })

  it('uses OAuth 2.0 tokens and cookies through runRequest, with pm.cookies', async () => {
    const r = await runRequest({
      request: newRequest({ url: `${base}/login`, auth: { type: 'oauth2', ...DEFAULT_OAUTH2, accessToken: 'tok' } }),
      parentAuths: [],
      preRequestScripts: [],
      testScripts: [`pm.test('cookie', () => pm.expect(pm.cookies.get('session')).to.equal('abc'));`],
      variables: { local: {}, data: {}, environment: {}, collection: {}, globals: {} },
      cookies: [],
      info: { requestName: 'r', requestId: 'r', iteration: 0, iterationCount: 1 }
    })
    expect(r.sent?.headers).toContainEqual(['Authorization', 'Bearer tok'])
    expect(r.tests).toEqual([{ name: 'cookie', passed: true }])
    expect(r.cookies.map((c) => c.name)).toEqual(['session', 'theme'])
  })
})

// TLS + proxy tests need openssl to mint certificates.
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'])
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasOpenssl)('proxy and client certificates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiman-tls-'))
  const f = (n: string): string => join(dir, n)
  let tlsServer: https.Server
  let proxy: http.Server
  let tlsPort = 0
  let proxyPort = 0
  let httpPort = 0
  let httpServer: http.Server
  let proxied: string[] = []

  beforeAll(async () => {
    const ssl = (...args: string[]): void => void execFileSync('openssl', args, { stdio: 'ignore' })
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.pem'), '-days', '1', '-subj', '/CN=Test CA')
    for (const name of ['server', 'client']) {
      ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f(`${name}.key`), '-out', f(`${name}.csr`), '-subj', `/CN=${name === 'server' ? 'localhost' : 'client'}`)
      const ext = f(`${name}.ext`)
      writeFileSync(ext, name === 'server' ? 'subjectAltName=DNS:localhost,IP:127.0.0.1' : 'extendedKeyUsage=clientAuth')
      ssl('x509', '-req', '-in', f(`${name}.csr`), '-CA', f('ca.pem'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f(`${name}.pem`), '-days', '1', '-extfile', ext)
    }
    tlsServer = https.createServer(
      { key: readFileSync(f('server.key')), cert: readFileSync(f('server.pem')), ca: readFileSync(f('ca.pem')), requestCert: true, rejectUnauthorized: true },
      (req, res) => res.end(JSON.stringify({ client: (req.socket as import('node:tls').TLSSocket).getPeerCertificate().subject?.CN }))
    )
    tlsPort = await listen(tlsServer)

    httpServer = http.createServer((req, res) => res.end(JSON.stringify({ url: req.url, viaProxy: req.headers['x-forwarded-by'] ?? null })))
    httpPort = await listen(httpServer)

    // Minimal forward proxy: absolute-URI HTTP requests and CONNECT tunnels, with Basic auth.
    proxy = http.createServer((req, res) => {
      if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('pu:pp').toString('base64')}`) return res.writeHead(407).end()
      proxied.push(`HTTP ${req.url}`)
      const target = new URL(req.url!)
      const up = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, 'x-forwarded-by': 'proxy' } }, (r) => {
        res.writeHead(r.statusCode!, r.headers)
        r.pipe(res)
      })
      req.pipe(up)
    })
    proxy.on('connect', (req, socket) => {
      proxied.push(`CONNECT ${req.url}`)
      const [host, port] = req.url!.split(':')
      const up = net.connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        up.pipe(socket)
        socket.pipe(up)
      })
      up.on('error', () => socket.destroy())
    })
    proxyPort = await listen(proxy)
  })
  afterAll(() => {
    tlsServer?.close()
    proxy?.close()
    httpServer?.close()
  })

  const network = (over: Partial<NetworkSettings> = {}): NetworkSettings => ({
    ...DEFAULT_NETWORK,
    caPath: f('ca.pem'),
    certificates: [{ id: 'c', host: 'localhost', certPath: f('client.pem'), keyPath: f('client.key') }],
    ...over
  })

  it('trusts a custom CA and presents a client certificate', async () => {
    const r = await execute(prepareRequest(newRequest({ url: `https://localhost:${tlsPort}/` }), []), undefined, { network: network() })
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(r.response.body)).toEqual({ client: 'client' })
    const noCert = await execute(prepareRequest(newRequest({ url: `https://localhost:${tlsPort}/` }), []), undefined, { network: network({ certificates: [] }) })
    expect(noCert.ok).toBe(false)
  })

  it('tunnels HTTPS and forwards HTTP through an authenticated proxy, honouring bypass', async () => {
    proxied = []
    const proxyCfg = { enabled: true, url: `http://pu:pp@127.0.0.1:${proxyPort}`, bypass: '' }
    const viaTunnel = await execute(prepareRequest(newRequest({ url: `https://localhost:${tlsPort}/` }), []), undefined, { network: network({ proxy: proxyCfg }) })
    if (!viaTunnel.ok) throw new Error(viaTunnel.error)
    expect(JSON.parse(viaTunnel.response.body)).toEqual({ client: 'client' })

    const viaHttp = await execute(prepareRequest(newRequest({ url: `http://127.0.0.1:${httpPort}/plain?q=1` }), []), undefined, { network: network({ proxy: proxyCfg }) })
    if (!viaHttp.ok) throw new Error(viaHttp.error)
    expect(JSON.parse(viaHttp.response.body)).toEqual({ url: '/plain?q=1', viaProxy: 'proxy' })

    await execute(prepareRequest(newRequest({ url: `http://127.0.0.1:${httpPort}/direct` }), []), undefined, { network: network({ proxy: { ...proxyCfg, bypass: '127.0.0.1' } }) })
    expect(proxied).toEqual([`CONNECT localhost:${tlsPort}`, `HTTP http://127.0.0.1:${httpPort}/plain?q=1`])
  })
})
