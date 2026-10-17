// Mock-server routing: which saved example answers a request. Pure — the renderer uses it to
// list routes; the Node server lives in mock.ts.

import { allRequests } from './tree'
import type { Collection, HttpMethod, SavedExample } from './types'

export interface MockRoute {
  requestId: string
  requestName: string
  method: HttpMethod
  /** Path segments; null = wildcard (a {{variable}} or :param in the saved URL). */
  segments: (string | null)[]
  path: string
  examples: SavedExample[]
}

export interface MockLogEntry {
  timestamp: number
  method: string
  path: string
  status: number
  matched?: string
}

/** The path part of a saved request URL, with the base ({{baseUrl}} or scheme://host) removed. */
export function mockPath(url: string): string {
  let rest = url.trim().split('#')[0].split('?')[0]
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '') // scheme://host
  rest = rest.replace(/^\{\{[^{}]+\}\}/, '') // leading {{baseUrl}}
  if (!rest.startsWith('/')) rest = rest.includes('/') ? rest.slice(rest.indexOf('/')) : '/' // bare host[:port]
  return rest.replace(/\/+$/, '') || '/'
}

export function buildRoutes(collection: Collection): MockRoute[] {
  return allRequests(collection.items)
    .filter((i) => (i.request.protocol ?? 'http') === 'http' && i.request.examples?.length)
    .map(({ request }) => {
      const path = mockPath(request.url)
      return {
        requestId: request.id,
        requestName: request.name,
        method: request.method,
        path,
        segments: path
          .split('/')
          .filter(Boolean)
          .map((seg) => (/^\{\{[^{}]+\}\}$/.test(seg) || seg.startsWith(':') ? null : seg)),
        examples: request.examples!
      }
    })
}

export interface MockMatch {
  route: MockRoute
  example: SavedExample
}

/**
 * Pick the route for a request: method must match (HEAD falls back to GET), literal segments
 * beat wildcards. Then pick the example: x-mock-response-name, x-mock-response-code, else the
 * first 2xx, else the first.
 */
export function matchMock(routes: MockRoute[], method: string, path: string, headers: Record<string, string | string[] | undefined> = {}): MockMatch | null {
  const segs = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponentSafe)
  const want = method.toUpperCase()
  const candidates = routes
    .filter((r) => r.method === want || (want === 'HEAD' && r.method === 'GET'))
    .filter((r) => r.segments.length === segs.length && r.segments.every((s, i) => s === null || s === segs[i]))
    .sort((a, b) => wildcards(a) - wildcards(b) || (a.method === want ? -1 : 1))
  const route = candidates[0]
  if (!route) return null

  const header = (n: string): string | undefined => {
    const v = headers[n]
    return Array.isArray(v) ? v[0] : v
  }
  const byName = header('x-mock-response-name')
  const byCode = header('x-mock-response-code')
  const example =
    (byName && route.examples.find((e) => e.name === byName)) ||
    (byCode && route.examples.find((e) => String(e.status) === byCode)) ||
    route.examples.find((e) => e.status >= 200 && e.status < 300) ||
    route.examples[0]
  return { route, example }
}

const wildcards = (r: MockRoute): number => r.segments.filter((s) => s === null).length

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

