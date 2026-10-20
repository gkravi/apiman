// Node-only mock server: serves a collection's saved examples over HTTP (routing in mockRoutes.ts).

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildRoutes, matchMock, type MockLogEntry } from './mockRoutes'
import { resolve } from './variables'
import { activePolicy, MOCKS_DISABLED } from './policy'
import type { Collection } from './types'

export { buildRoutes, matchMock, mockPath, type MockLogEntry, type MockRoute } from './mockRoutes'

const HOP_HEADERS = /^(content-length|transfer-encoding|content-encoding|connection|keep-alive|date)$/i

export interface MockServer {
  port: number
  setCollection(c: Collection): void
  close(): Promise<void>
}

/** Host header names a loopback address (localhost, *.localhost, 127.x, [::1]), with any port. */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '')
  return /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(name)
}

export function isLocalOrigin(origin: string): boolean {
  try {
    return isLocalHost(new URL(origin).host)
  } catch {
    return false
  }
}

export function startMockServer(collection: Collection, port: number, onLog: (e: MockLogEntry) => void, host = '127.0.0.1'): Promise<MockServer> {
  if (activePolicy().disableMockServers) return Promise.reject(new Error(MOCKS_DISABLED))
  let routes = buildRoutes(collection)
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/'
    const log = (status: number, matched?: string): void => onLog({ timestamp: Date.now(), method: req.method ?? 'GET', path, status, matched })
    // DNS-rebinding guard: a web page that points its own hostname at 127.0.0.1 still sends that
    // hostname in Host, so only local names are served.
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(421, { 'Content-Type': 'text/plain' }).end('ApiMan mock servers only answer requests addressed to localhost')
      return log(421, 'blocked: non-local Host header')
    }
    // CORS for local front-end dev servers only: a website you happen to have open can't read
    // mock responses (which may be saved examples of real data).
    const origin = req.headers.origin
    if (origin && isLocalOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    } else if (!origin) res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', '*')
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] ?? '*'))
      res.writeHead(204).end()
      return log(204, 'CORS preflight')
    }
    req.resume() // bodies are ignored
    const match = matchMock(routes, req.method ?? 'GET', path, req.headers)
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify(
          {
            error: 'No mock example matches this request',
            request: `${req.method} ${path.split('?')[0]}`,
            routes: routes.map((r) => `${r.method} ${r.path}`)
          },
          null,
          2
        )
      )
      return log(404)
    }
    const { example, route } = match
    for (const [k, v] of example.headers) if (!HOP_HEADERS.test(k)) res.appendHeader(k, v)
    res.setHeader('X-Mock-Matched', `${route.requestName} / ${example.name}`)
    // Dynamic variables ({{$guid}}, {{$timestamp}}, …) are filled per response.
    res.writeHead(example.status, example.statusText || undefined)
    res.end(req.method === 'HEAD' ? undefined : resolve(example.body, []))
    log(example.status, `${route.requestName} → ${example.name}`)
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use` : e.message)))
    server.listen(port, host, () => {
      resolvePromise({
        port: (server.address() as AddressInfo).port,
        setCollection: (c) => (routes = buildRoutes(c)),
        close: () => new Promise((r) => server.close(() => r()))
      })
    })
  })
}
