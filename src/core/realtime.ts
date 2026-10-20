// Node-only: long-lived connections — WebSocket and Server-Sent Events — with the same variables,
// auth, cookies, proxy and TLS settings as normal requests. gRPC lives in grpc.ts.

import tls from 'node:tls'
import WebSocket from 'ws'
import { CookieJar } from './cookies'
import { connectTunnel, encodeBody, openClientRequest, proxyFor, tlsFor, type Transport } from './executor'
import { prepareRequest } from './prepare'
import { chainingEnv, renderRequestTemplates, scopesFromVariables } from './run'
import { SseParser } from './sse'
import { assertHostAllowed, effectiveNetwork, effectiveVerifySsl, hostBlockedReason } from './policy'
import type { PreparedRequest, RealtimeOpenInput, StreamEvent } from './types'

export type Emit = (e: Omit<StreamEvent, 'timestamp'>) => void

export interface RealtimeSession {
  send(data: string): void
  /** Half-close: finish a client stream (gRPC); no-op elsewhere. */
  end(): void
  close(): void
}

const headerText = (headers: [string, string][]): string => headers.map(([k, v]) => `${k}: ${v}`).join('\n')

function rawHeaders(raw: string[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]])
  return out
}

/**
 * Render template functions ({{ $response(...) }}, {{ $uuid() }}…) in a live request before it
 * connects. Referenced requests are sent as needed; their variable and cookie changes apply here.
 */
export async function renderLiveTemplates(input: RealtimeOpenInput, signal: AbortSignal = new AbortController().signal): Promise<RealtimeOpenInput> {
  let variables = input.variables
  const jar = new CookieJar(input.cookies ?? [])
  const env = chainingEnv({
    input: { ...input, info: { requestName: input.request.name, requestId: input.request.id, iteration: 0, iterationCount: 1 } },
    signal,
    jar,
    getVariables: () => variables,
    setVariables: (v) => (variables = v),
    log: () => {}
  })
  try {
    const request = await renderRequestTemplates(input.request, env)
    return { ...input, request, variables, cookies: jar.toJSON() }
  } catch (e) {
    throw new Error(`Template: ${(e as Error).message}`)
  }
}

/** Prepare a realtime request: variables, auth and the right URL scheme. */
export function prepareRealtime(input: RealtimeOpenInput): PreparedRequest {
  const prepared = prepareRequest(input.request, scopesFromVariables(input.variables), input.parentAuths)
  if (input.request.protocol === 'websocket') prepared.url = prepared.url.replace(/^http(s?):\/\//i, 'ws$1://')
  prepared.settings = { ...prepared.settings, verifySsl: effectiveVerifySsl(prepared.settings.verifySsl) }
  return prepared
}

function withCookies(prepared: PreparedRequest, url: URL, jar: CookieJar): [string, string][] {
  // Jar matching works on http(s) URLs; ws(s) share cookies with their http(s) origin.
  const httpUrl = new URL(url.toString().replace(/^ws/i, 'http'))
  const cookie = [prepared.headers.find(([k]) => k.toLowerCase() === 'cookie')?.[1], jar.cookieHeader(httpUrl)].filter(Boolean).join('; ')
  const rest = prepared.headers.filter(([k]) => k.toLowerCase() !== 'cookie')
  return cookie ? [...rest, ['Cookie', cookie]] : rest
}

export async function openWebSocket(input: RealtimeOpenInput, emit: Emit): Promise<RealtimeSession> {
  const prepared = prepareRealtime(input)
  const url = new URL(prepared.url)
  if (!/^wss?:$/.test(url.protocol)) throw new Error('WebSocket URL must start with ws:// or wss://')
  assertHostAllowed(url)
  const secure = url.protocol === 'wss:'
  const network = effectiveNetwork(input.network)
  const jar = new CookieJar(input.cookies ?? [])
  const headers = withCookies(prepared, url, jar)
  const tlsOpts = await tlsFor(url, network)
  const proxy = proxyFor(new URL(url.toString().replace(/^ws/i, 'http')), network)
  const tunnel = proxy ? await connectTunnel(proxy, new URL(url.toString().replace(/^ws/i, 'http')), prepared.settings.timeoutMs, new AbortController().signal) : undefined
  const protocols = (input.request.subprotocols ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  emit({ kind: 'connecting', data: url.toString(), meta: headerText(headers) })
  const ws = new WebSocket(url, protocols, {
    headers: Object.fromEntries(headers),
    rejectUnauthorized: prepared.settings.verifySsl,
    ...tlsOpts,
    handshakeTimeout: prepared.settings.timeoutMs,
    followRedirects: prepared.settings.followRedirects,
    ...(tunnel
      ? { createConnection: () => (secure ? tls.connect({ socket: tunnel, servername: url.hostname, rejectUnauthorized: prepared.settings.verifySsl, ...tlsOpts }) : tunnel) }
      : {})
  } as WebSocket.ClientOptions)

  // Redirects are followed inside ws, so each target is checked against the host policy here.
  ws.on('redirect', (to: string) => {
    const reason = hostBlockedReason(to)
    if (!reason) return
    emit({ kind: 'error', data: `Redirect refused: ${reason}` })
    ws.terminate()
  })
  ws.on('upgrade', (res) => emit({ kind: 'info', data: `${res.statusCode} ${res.statusMessage ?? ''} — handshake response`, meta: headerText(rawHeaders(res.rawHeaders)) }))
  ws.on('open', () => emit({ kind: 'open', data: `Connected to ${url}`, meta: ws.protocol ? `Sub-protocol: ${ws.protocol}` : undefined }))
  ws.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
    emit(isBinary ? { kind: 'message', data: buf.toString('base64'), binary: true, meta: `${buf.length} bytes` } : { kind: 'message', data: buf.toString('utf8') })
  })
  ws.on('unexpected-response', (_req, res) => {
    let body = ''
    res.on('data', (c: Buffer) => (body += c.toString('utf8').slice(0, 2000)))
    res.on('end', () => {
      emit({ kind: 'error', data: `Handshake failed: ${res.statusCode} ${res.statusMessage ?? ''}${body ? `\n${body}` : ''}`, meta: headerText(rawHeaders(res.rawHeaders)) })
      emit({ kind: 'close', data: 'Connection closed', meta: `HTTP ${res.statusCode}` })
    })
  })
  ws.on('error', (err) => emit({ kind: 'error', data: err.message }))
  ws.on('close', (code, reason) => emit({ kind: 'close', data: 'Disconnected', meta: `Code ${code}${reason.length ? ` — ${reason.toString()}` : ''}` }))

  return {
    send(data) {
      if (ws.readyState !== WebSocket.OPEN) return emit({ kind: 'error', data: 'Not connected' })
      ws.send(data, (err) => emit(err ? { kind: 'error', data: `Send failed: ${err.message}` } : { kind: 'sent', data }))
    },
    end() {},
    close() {
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate()
      else ws.close(1000, 'Closed by client')
    }
  }
}

export async function openSse(input: RealtimeOpenInput, emit: Emit): Promise<RealtimeSession> {
  const prepared = prepareRealtime(input)
  const url = new URL(prepared.url)
  assertHostAllowed(url)
  const network = effectiveNetwork(input.network)
  const jar = new CookieJar(input.cookies ?? [])
  const headers = withCookies(prepared, url, jar)
  if (!headers.some(([k]) => k.toLowerCase() === 'accept')) headers.push(['Accept', 'text/event-stream'])
  headers.push(['Cache-Control', 'no-cache'])
  const { data, contentType } = await encodeBody(prepared.body)
  if (contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', contentType])

  const ctrl = new AbortController()
  const tr: Transport = { verifySsl: prepared.settings.verifySsl, timeoutMs: prepared.settings.timeoutMs, tls: await tlsFor(url, network), proxy: proxyFor(url, network) }
  emit({ kind: 'connecting', data: `${prepared.method} ${url}`, meta: headerText(headers) })
  const req = await openClientRequest(prepared.method, url, headers, tr, ctrl.signal)
  let closed = false
  const close = (detail: string): void => {
    if (closed) return
    closed = true
    emit({ kind: 'close', data: 'Stream closed', meta: detail })
  }

  // Only the connect phase is bounded by the timeout; a healthy stream may idle forever.
  req.setTimeout(tr.timeoutMs, () => req.destroy(new Error(`No response after ${tr.timeoutMs} ms`)))
  req.on('response', (res) => {
    req.setTimeout(0)
    const status = `${res.statusCode} ${res.statusMessage ?? ''}`.trim()
    const ct = String(res.headers['content-type'] ?? '')
    if ((res.statusCode ?? 0) >= 300 || !/text\/event-stream/i.test(ct)) {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c.slice(0, 4000)))
      res.on('end', () => {
        emit({ kind: 'error', data: `Expected an event stream but got ${status} (${ct || 'no content-type'})${body ? `\n${body}` : ''}`, meta: headerText(rawHeaders(res.rawHeaders)) })
        close(status)
      })
      return
    }
    emit({ kind: 'open', data: `Connected — ${status}`, meta: headerText(rawHeaders(res.rawHeaders)) })
    const parser = new SseParser()
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      for (const m of parser.push(chunk)) emit({ kind: 'message', data: m.data, meta: [m.event !== 'message' ? `event: ${m.event}` : '', m.id ? `id: ${m.id}` : ''].filter(Boolean).join(' · ') || undefined })
    })
    res.on('end', () => close('Server ended the stream'))
    res.on('error', (e) => emit({ kind: 'error', data: e.message }))
  })
  req.on('error', (e) => {
    if (closed) return
    if (e.name !== 'AbortError') emit({ kind: 'error', data: e.message })
    close(e.name === 'AbortError' ? 'Closed by client' : 'Connection error')
  })
  if (data) req.write(data)
  req.end()

  return {
    send() {
      emit({ kind: 'error', data: 'Server-Sent Events are one-way; nothing can be sent' })
    },
    end() {},
    close() {
      ctrl.abort()
      close('Closed by client')
    }
  }
}
