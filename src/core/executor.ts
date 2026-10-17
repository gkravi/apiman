// Node-only: sends a PreparedRequest over the wire. Runs in the Electron main process
// (and later the CLI), so it is free of CORS and forbidden-header restrictions.

import http from 'node:http'
import https from 'node:https'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import zlib from 'node:zlib'
import type { ApiResponse, ExecuteResult, PreparedBody, PreparedRequest, Timings } from './types'

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

function sendOnce(
  method: string,
  url: URL,
  headers: [string, string][],
  data: Buffer | undefined,
  verifySsl: boolean,
  timeoutMs: number,
  signal: AbortSignal
): Promise<Hop> {
  return new Promise((resolvePromise, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const start = performance.now()
    const t: Omit<Timings, 'total'> = {}
    const elapsed = (): number => Math.round((performance.now() - start) * 10) / 10

    const outHeaders: Record<string, string | string[]> = {}
    for (const [k, v] of headers) {
      const existing = outHeaders[k]
      outHeaders[k] = existing === undefined ? v : ([] as string[]).concat(existing, v)
    }

    const req = lib.request(url, {
      method,
      headers: outHeaders,
      rejectUnauthorized: verifySsl,
      agent: false, // fresh socket per request so connect/TLS timings are real
      signal
    })

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs} ms`)))

    req.on('socket', (socket) => {
      socket.once('lookup', () => (t.dns = elapsed()))
      socket.once('connect', () => (t.connect = elapsed()))
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

export async function execute(req: PreparedRequest, signal: AbortSignal = new AbortController().signal): Promise<ExecuteResult> {
  const started = performance.now()
  try {
    let url = new URL(req.url)
    let method: string = req.method
    let { data, contentType } = await encodeBody(req.body)
    let headers = [...req.headers]
    const has = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name)
    if (contentType && !has('content-type')) headers.push(['Content-Type', contentType])
    if (!has('user-agent')) headers.push(['User-Agent', USER_AGENT])
    if (!has('accept')) headers.push(['Accept', '*/*'])
    if (!has('accept-encoding')) headers.push(['Accept-Encoding', 'gzip, deflate, br'])

    const redirects: ApiResponse['redirects'] = []
    for (;;) {
      const hop = await sendOnce(method, url, headers, data, req.settings.verifySsl, req.settings.timeoutMs, signal)
      const location = hop.headers.find(([k]) => k.toLowerCase() === 'location')?.[1]
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
        if (next.host !== url.host) headers = headers.filter(([k]) => !/^(authorization|cookie)$/i.test(k))
        url = next
        continue
      }

      const ct = hop.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
      const textual = isTextual(ct)
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
