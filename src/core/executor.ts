// Node-only: sends a PreparedRequest over the wire. Runs in the Electron main process
// (and later the CLI), so it is free of CORS and forbidden-header restrictions.

import http from 'node:http'
import https from 'node:https'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import zlib from 'node:zlib'
import net from 'node:net'
import tls from 'node:tls'
import { CookieJar } from './cookies'
import { digestAuthorization } from './digest'
import { signAwsV4 } from './awsv4'
import type { ApiResponse, ExecuteResult, NetworkSettings, PreparedBody, PreparedRequest, Timings } from './types'

const USER_AGENT = 'ApiMan/0.1'
const MAX_BODY_BYTES = 50 * 1024 * 1024

async function encodeBody(body: PreparedBody): Promise<{ data?: Buffer; contentType?: string }> {
  switch (body.kind) {
    case 'none':
      return {}
    case 'text':
      return { data: Buffer.from(body.text, 'utf8'), contentType: body.contentType }
    case 'file':
      return { data: await readFile(body.filePath), contentType: 'application/octet-stream' }
    case 'multipart': {
      const boundary = `----ApiManBoundary${randomBytes(12).toString('hex')}`
      const parts: Buffer[] = []
      for (const f of body.fields) {
        const name = f.name.replace(/"/g, '%22')
        if (f.filePath) {
          const file = await readFile(f.filePath)
          parts.push(
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${basename(f.filePath)}"\r\n` +
                'Content-Type: application/octet-stream\r\n\r\n'
            ),
            file,
            Buffer.from('\r\n')
          )
        } else {
          parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${f.value ?? ''}\r\n`))
        }
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`))
      return { data: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
    }
  }
}

function decompress(buf: Buffer, encoding: string | undefined): Buffer {
  try {
    switch (encoding?.toLowerCase()) {
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(buf)
      case 'deflate':
        return zlib.inflateSync(buf)
      case 'br':
        return zlib.brotliDecompressSync(buf)
      default:
        return buf
    }
  } catch {
    return buf // server lied about the encoding; show the raw bytes
  }
}

const isTextual = (contentType: string): boolean =>
  !contentType || /^text\/|json|xml|javascript|html|graphql|x-www-form-urlencoded|csv|yaml/i.test(contentType)

interface Hop {
  status: number
  statusText: string
  headers: [string, string][]
  body: Buffer
  httpVersion: string
  timings: Omit<Timings, 'total'>
}

/** Per-hop connection details: TLS material for the target host and an optional proxy. */
interface Transport {
  verifySsl: boolean
  timeoutMs: number
  tls: Pick<tls.ConnectionOptions, 'ca' | 'cert' | 'key' | 'pfx' | 'passphrase'>
  proxy?: URL
}

const proxyAuthHeader = (proxy: URL): [string, string][] =>
  proxy.username ? [['Proxy-Authorization', `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`]] : []

/** Open a CONNECT tunnel through an HTTP proxy for an https:// target. */
function connectTunnel(proxy: URL, target: URL, timeoutMs: number, signal: AbortSignal): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const port = target.port || '443'
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: Object.fromEntries([['Host', `${target.hostname}:${port}`], ...proxyAuthHeader(proxy)]),
      signal
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Proxy CONNECT timed out after ${timeoutMs} ms`)))
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket)
      else {
        socket.destroy()
        reject(new Error(`Proxy refused tunnel: ${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
      }
    })
    req.on('error', (e) => reject(new Error(`Proxy error: ${e.message}`)))
    req.end()
  })
}

async function sendOnce(method: string, url: URL, headers: [string, string][], data: Buffer | undefined, tr: Transport, signal: AbortSignal): Promise<Hop> {
  const start = performance.now()
  const t: Omit<Timings, 'total'> = {}
  const elapsed = (): number => Math.round((performance.now() - start) * 10) / 10
  const isHttps = url.protocol === 'https:'

  let tunnel: net.Socket | undefined
  if (tr.proxy && isHttps) {
    tunnel = await connectTunnel(tr.proxy, url, tr.timeoutMs, signal)
    t.connect = elapsed()
  }

  return new Promise((resolvePromise, reject) => {
    const outHeaders: Record<string, string | string[]> = {}
    const all = tr.proxy && !isHttps ? [...headers, ...proxyAuthHeader(tr.proxy)] : headers
    for (const [k, v] of all) {
      const existing = outHeaders[k]
      outHeaders[k] = existing === undefined ? v : ([] as string[]).concat(existing, v)
    }

    const options: https.RequestOptions = {
      method,
      headers: outHeaders,
      rejectUnauthorized: tr.verifySsl,
      ...tr.tls,
      agent: false, // fresh socket per request so connect/TLS timings are real
      signal
    }
    let req: http.ClientRequest
    if (tr.proxy && !isHttps) {
      // Plain HTTP through a proxy: send the absolute URL to the proxy itself.
      req = http.request({ ...options, host: tr.proxy.hostname, port: tr.proxy.port || 80, path: url.toString(), headers: { Host: url.host, ...outHeaders } })
    } else if (tunnel) {
      const socket = tunnel
      req = https.request(url, {
        ...options,
        createConnection: () => tls.connect({ socket, servername: url.hostname, rejectUnauthorized: tr.verifySsl, ...tr.tls })
      })
    } else {
      req = (isHttps ? https : http).request(url, options)
    }

    req.setTimeout(tr.timeoutMs, () => req.destroy(new Error(`Request timed out after ${tr.timeoutMs} ms`)))

    req.on('socket', (socket) => {
      socket.once('lookup', () => (t.dns = elapsed()))
      socket.once('connect', () => (t.connect ??= elapsed()))
      socket.once('secureConnect', () => (t.tls = elapsed()))
    })

    req.on('response', (res) => {
      t.firstByte = elapsed()
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY_BYTES) {
          req.destroy(new Error(`Response exceeded ${MAX_BODY_BYTES / 1024 / 1024} MB limit`))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => {
        t.download = elapsed()
        const raw: [string, string][] = []
        for (let i = 0; i < res.rawHeaders.length; i += 2) raw.push([res.rawHeaders[i], res.rawHeaders[i + 1]])
        resolvePromise({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: raw,
          body: decompress(Buffer.concat(chunks), res.headers['content-encoding'] as string | undefined),
          httpVersion: res.httpVersion,
          timings: t
        })
      })
      res.on('error', reject)
    })

    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ---------- network settings ----------

function hostMatches(pattern: string, url: URL): boolean {
  const p = pattern.trim().toLowerCase()
  if (!p) return false
  const [host, port] = p.split(':')
  if (port && port !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false
  const h = url.hostname.toLowerCase()
  if (host === '*') return true
  if (host.startsWith('*.')) return h.endsWith(host.slice(1)) || h === host.slice(2)
  if (host.startsWith('.')) return h.endsWith(host) || h === host.slice(1)
  return h === host
}

export function proxyFor(url: URL, network?: NetworkSettings): URL | undefined {
  const proxy = network?.proxy
  if (!proxy?.enabled || !proxy.url.trim()) return undefined
  if (proxy.bypass.split(',').some((b) => hostMatches(b, url))) return undefined
  return new URL(/^[a-z]+:\/\//i.test(proxy.url) ? proxy.url : `http://${proxy.url}`)
}

const fileCache = new Map<string, Buffer>()
async function readCached(path: string): Promise<Buffer> {
  // Cert files rarely change; re-read only when the app restarts.
  let b = fileCache.get(path)
  if (!b) {
    b = await readFile(path)
    fileCache.set(path, b)
  }
  return b
}

async function tlsFor(url: URL, network?: NetworkSettings): Promise<Transport['tls']> {
  if (url.protocol !== 'https:' || !network) return {}
  const out: Transport['tls'] = {}
  if (network.caPath) out.ca = [...tls.rootCertificates, (await readCached(network.caPath)).toString()]
  const cert = network.certificates.find((c) => hostMatches(c.host, url))
  if (cert) {
    if (cert.pfxPath) out.pfx = await readCached(cert.pfxPath)
    if (cert.certPath) out.cert = await readCached(cert.certPath)
    if (cert.keyPath) out.key = await readCached(cert.keyPath)
    if (cert.passphrase) out.passphrase = cert.passphrase
  }
  return out
}

const friendlyError = (err: unknown): string => {
  const e = err as NodeJS.ErrnoException
  if (e?.name === 'AbortError') return 'Request cancelled'
  switch (e?.code) {
    case 'ENOTFOUND':
      return `Could not resolve host (${e.message.split(' ').pop()})`
    case 'ECONNREFUSED':
      return `Connection refused — is the server running? (${e.message.split(' ').pop()})`
    case 'ECONNRESET':
      return 'Connection reset by server'
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `SSL error: ${e.message}. Disable "Verify SSL" in request settings to bypass.`
  }
  return e?.message ?? String(err)
}

export interface ExecuteOptions {
  /** Cookies are read from and written back to this jar on every hop, redirects included. */
  jar?: CookieJar
  network?: NetworkSettings
  /** When set, a 401 with a Digest challenge is answered once with these credentials. */
  digest?: { username: string; password: string }
}

export async function execute(req: PreparedRequest, signal: AbortSignal = new AbortController().signal, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const started = performance.now()
  try {
    let url = new URL(req.url)
    const origin = url.host
    let method: string = req.method
    let { data, contentType } = await encodeBody(req.body)
    let headers = [...req.headers]
    const has = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name)
    if (contentType && !has('content-type')) headers.push(['Content-Type', contentType])
    if (!has('user-agent')) headers.push(['User-Agent', USER_AGENT])
    if (!has('accept')) headers.push(['Accept', '*/*'])
    if (!has('accept-encoding')) headers.push(['Accept-Encoding', 'gzip, deflate, br'])

    // A Cookie header typed by the user goes only to the original host; jar cookies are per hop.
    const userCookie = headers.find(([k]) => k.toLowerCase() === 'cookie')?.[1]
    headers = headers.filter(([k]) => k.toLowerCase() !== 'cookie')

    const redirects: ApiResponse['redirects'] = []
    let digestTried = false
    const digest = opts.digest ?? req.digest
    for (;;) {
      const cookie = [url.host === origin ? userCookie : undefined, opts.jar?.cookieHeader(url)].filter(Boolean).join('; ')
      let hopHeaders: [string, string][] = cookie ? [...headers, ['Cookie', cookie]] : headers
      if (req.awsv4) hopHeaders = signAwsV4(method, url, hopHeaders, data, req.awsv4)
      const transport: Transport = {
        verifySsl: req.settings.verifySsl,
        timeoutMs: req.settings.timeoutMs,
        tls: await tlsFor(url, opts.network),
        proxy: proxyFor(url, opts.network)
      }
      const hop = await sendOnce(method, url, hopHeaders, data, transport, signal)
      const header = (name: string): string | undefined => hop.headers.find(([k]) => k.toLowerCase() === name)?.[1]
      opts.jar?.setFromHeaders(hop.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v), url)

      const challenge = header('www-authenticate')
      if (hop.status === 401 && digest && !digestTried && challenge && /^digest\s/i.test(challenge)) {
        digestTried = true
        const auth = digestAuthorization(challenge, method, url.pathname + url.search, digest.username, digest.password, data)
        headers = [...headers.filter(([k]) => k.toLowerCase() !== 'authorization'), ['Authorization', auth]]
        continue
      }

      const location = header('location')
      const isRedirect = hop.status >= 300 && hop.status < 400 && location
      if (isRedirect && req.settings.followRedirects && redirects.length < req.settings.maxRedirects) {
        redirects.push({ url: url.toString(), status: hop.status })
        const next = new URL(location, url)
        // 303 always becomes GET; 301/302 do too for non-GET per browser behaviour. 307/308 keep method+body.
        if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method !== 'GET' && method !== 'HEAD')) {
          method = 'GET'
          data = undefined
          headers = headers.filter(([k]) => !/^content-(type|length)$/i.test(k))
        }
        if (next.host !== url.host) headers = headers.filter(([k]) => k.toLowerCase() !== 'authorization')
        url = next
        continue
      }

      const textual = isTextual(header('content-type') ?? '')
      const total = Math.round((performance.now() - started) * 10) / 10
      return {
        ok: true,
        response: {
          status: hop.status,
          statusText: hop.statusText,
          headers: hop.headers,
          body: hop.body.toString(textual ? 'utf8' : 'base64'),
          bodyEncoding: textual ? 'utf8' : 'base64',
          size: hop.body.length,
          timings: { ...hop.timings, total },
          url: url.toString(),
          redirects,
          httpVersion: hop.httpVersion
        }
      }
    }
  } catch (err) {
    return { ok: false, error: friendlyError(err) }
  }
}
