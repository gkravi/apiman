import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRoutes, matchMock, mockPath, startMockServer, type MockLogEntry, type MockServer } from './mock'
import { newCollection, newFolder, newRequest, newRequestItem } from './factory'
import { exportPostmanCollection, importPostmanCollection } from './postman'
import type { Collection, SavedExample } from './types'

const ex = (name: string, status: number, body: string, headers: [string, string][] = [['Content-Type', 'application/json']]): SavedExample => ({
  id: name,
  name,
  status,
  statusText: '',
  headers,
  body
})

function collection(): Collection {
  const c = newCollection('Shop')
  const folder = newFolder('Users')
  folder.items = [
    newRequestItem(newRequest({ name: 'List users', url: '{{baseUrl}}/users?page=1', examples: [ex('ok', 200, '[{"id":1}]')] })),
    newRequestItem(newRequest({ name: 'Get user', url: '{{baseUrl}}/users/{{id}}', examples: [ex('missing', 404, '{"error":"nope"}'), ex('found', 200, '{"id":"{{$guid}}"}')] })),
    newRequestItem(newRequest({ name: 'Me', url: 'https://api.shop.io/users/me', examples: [ex('me', 200, '{"me":true}')] })),
    newRequestItem(newRequest({ name: 'Create', method: 'POST', url: 'localhost:3000/users', examples: [ex('created', 201, '{}')] })),
    newRequestItem(newRequest({ name: 'No examples', url: '{{baseUrl}}/health' }))
  ]
  c.items = [folder]
  return c
}

describe('mock routing', () => {
  it('extracts paths from saved URLs', () => {
    expect(['{{baseUrl}}/a/b?x=1', 'https://h.io:8443/a/', 'localhost:3000/a', '{{host}}', 'http://h.io'].map(mockPath)).toEqual(['/a/b', '/a', '/a', '/', '/'])
  })

  it('prefers literal segments, picks 2xx by default and honours x-mock headers', () => {
    const routes = buildRoutes(collection())
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /users', 'GET /users/{{id}}', 'GET /users/me', 'POST /users'])
    expect(matchMock(routes, 'GET', '/users/me')?.route.requestName).toBe('Me')
    expect(matchMock(routes, 'GET', '/users/7')?.example.name).toBe('found')
    expect(matchMock(routes, 'GET', '/users/7', { 'x-mock-response-code': '404' })?.example.name).toBe('missing')
    expect(matchMock(routes, 'GET', '/users/7', { 'x-mock-response-name': 'missing' })?.example.name).toBe('missing')
    expect(matchMock(routes, 'HEAD', '/users?page=2')?.route.requestName).toBe('List users')
    expect(matchMock(routes, 'DELETE', '/users/7')).toBeNull()
    expect(matchMock(routes, 'GET', '/health')).toBeNull()
  })

  it('round-trips examples through Postman format', () => {
    const back = importPostmanCollection(exportPostmanCollection(collection()))
    const routes = buildRoutes(back)
    expect(routes.find((r) => r.requestName === 'Get user')?.examples.map((e) => [e.name, e.status, e.headers])).toEqual([
      ['missing', 404, [['Content-Type', 'application/json']]],
      ['found', 200, [['Content-Type', 'application/json']]]
    ])
  })
})

describe('mock server', () => {
  let server: MockServer
  const log: MockLogEntry[] = []
  beforeAll(async () => {
    server = await startMockServer(collection(), 0, (e) => log.push(e))
  })
  afterAll(() => server.close())
  const url = (p: string): string => `http://127.0.0.1:${server.port}${p}`

  it('serves examples with headers, status and dynamic variables', async () => {
    const r = await fetch(url('/users/42'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(r.headers.get('x-mock-matched')).toBe('Get user / found')
    expect((await r.json()).id).toMatch(/^[0-9a-f-]{36}$/)
    const created = await fetch(url('/users'), { method: 'POST', body: '{"a":1}' })
    expect(created.status).toBe(201)
  })

  it('answers CORS preflight and explains misses', async () => {
    const pre = await fetch(url('/users'), { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
    expect([pre.status, pre.headers.get('access-control-allow-origin')]).toEqual([204, 'http://localhost:5173'])
    const miss = await fetch(url('/nothing'))
    expect(miss.status).toBe(404)
    expect((await miss.json()).routes).toContain('GET /users/{{id}}')
    expect(log.map((l) => l.status)).toEqual([200, 201, 204, 404])
  })

  it('picks up collection changes without restarting', async () => {
    const c = collection()
    c.items.push(newRequestItem(newRequest({ url: '{{baseUrl}}/new', examples: [ex('n', 202, 'fresh', [])] })))
    server.setCollection(c)
    const r = await fetch(url('/new'))
    expect([r.status, await r.text()]).toEqual([202, 'fresh'])
  })

  it('reports a busy port clearly', async () => {
    await expect(startMockServer(collection(), server.port, () => {})).rejects.toThrow(`Port ${server.port} is already in use`)
  })
})
