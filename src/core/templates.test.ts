import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { collectPrompts, findTemplates, requestTexts, responseReference, TemplateSyntaxError } from './templateParse'
import { renderTemplates, TemplateError, type TemplateEnv } from './templates'
import { newCollection, newFolder, newKeyValue, newRequest, newRequestItem } from './factory'
import { findRequestByRef } from './tree'
import { runRequest } from './run'
import { forgetResponses } from './responseStore'
import type { ApiRequest, Collection, RunRequestInput } from './types'

const env = (over: Partial<TemplateEnv> = {}): TemplateEnv => ({
  scopes: [[{ key: 'secret', value: 'key', enabled: true }]],
  prompts: {},
  response: async () => {
    throw new Error('no responses here')
  },
  ...over
})
const render = (t: string, over?: Partial<TemplateEnv>): Promise<string> => renderTemplates(t, env(over))

describe('template parsing', () => {
  it('finds function calls and leaves plain variables alone', () => {
    const m = findTemplates("a {{x}} {{$guid}} {{ $hash('sha256', 'abc') }} b")
    expect(m).toHaveLength(1)
    expect(m[0].call).toEqual({ name: 'hash', args: [{ kind: 'string', value: 'sha256' }, { kind: 'string', value: 'abc' }] })
  })
  it('parses numbers, booleans, escapes and nested calls', () => {
    const [m] = findTemplates(`{{ $f(1, -2.5, true, 'it\\'s', "q", $g()) }}`)
    expect(m.call.args.map((a) => (a.kind === 'call' ? a.call.name : a.value))).toEqual([1, -2.5, true, "it's", 'q', 'g'])
  })
  it('reports syntax errors', () => {
    expect(() => findTemplates("{{ $f('x' }}")).toThrow(TemplateSyntaxError)
    expect(() => findTemplates('{{ $f(bare) }}')).toThrow(/quote text/)
    expect(() => findTemplates("{{ $f('x') ")).toThrow(/Missing }}/)
  })
  it('collects prompts, including nested ones, once per label', () => {
    expect(collectPrompts(["{{ $prompt('OTP') }}", "{{ $base64($prompt('User', 'bob')) }} {{ $prompt('OTP', 'x') }}"])).toEqual([
      { label: 'OTP', defaultValue: '' },
      { label: 'User', defaultValue: 'bob' }
    ])
  })
  it('builds references with quoting', () => {
    expect(responseReference("Bob's login", '$.token')).toBe("{{ $response('Bob\\'s login', '$.token') }}")
    expect(responseReference('Login')).toBe("{{ $response('Login') }}")
  })
  it('lists a request’s text fields', () => {
    const r = newRequest({ url: 'u', headers: [newKeyValue('h', 'v')], body: { mode: 'raw', raw: 'b', language: 'json' } })
    expect(requestTexts(r)).toEqual(expect.arrayContaining(['u', 'h', 'v', 'b']))
  })
})

describe('template functions', () => {
  it('hashes and HMACs with known vectors', async () => {
    expect(await render("{{ $hash('sha256', 'abc') }}")).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await render("{{ $hash('md5', 'hello') }}")).toBe('5d41402abc4b2a76b9719d911017c592')
    expect(await render("{{ $hmac('sha256', '{{secret}}', 'The quick brown fox jumps over the lazy dog') }}")).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    )
    expect(await render("{{ $hash('SHA-1', 'abc', 'base64') }}")).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=')
  })
  it('encodes, decodes and transforms text', async () => {
    expect(await render("{{ $base64('user:pass') }}|{{ $base64Decode('aGk=') }}")).toBe('dXNlcjpwYXNz|hi')
    expect(await render("{{ $urlEncode('a b&c') }}|{{ $urlDecode('a%20b') }}")).toBe('a%20b%26c|a b')
    expect(await render("{{ $upper($trim('  hi ')) }}{{ $lower('X') }}")).toBe('HIx')
    expect(await render(`{{ $jsonPath('{"a":[1,{"b":"z"}]}', '$.a[1].b') }}`)).toBe('z')
  })
  it('generates ids, times and numbers', async () => {
    expect(await render('{{ $uuid() }}')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await render("{{ $now('YYYY-MM-DD') }}")).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const unix = Number(await render("{{ $now('unix', '+1h') }}"))
    expect(Math.abs(unix - (Date.now() / 1000 + 3600))).toBeLessThan(5)
    const n = Number(await render('{{ $random(5, 7) }}'))
    expect(n >= 5 && n <= 7).toBe(true)
  })
  it('answers prompts from the env, falling back to defaults', async () => {
    expect(await render("{{ $prompt('OTP') }}-{{ $prompt('Region', 'eu') }}", { prompts: { OTP: '123' } })).toBe('123-eu')
  })
  it('explains unknown functions and bad arguments', async () => {
    await expect(render('{{ $readFile() }}')).rejects.toThrow(/Unknown template function \$readFile\(\).*\$hmac/)
    await expect(render("{{ $hash('sha999', 'x') }}")).rejects.toThrow(TemplateError)
    await expect(render('{{ $random(9, 1) }}')).rejects.toThrow(/min ≤ max/)
  })
})

describe('request chaining', () => {
  let server: http.Server
  let base = ''
  const hits: Record<string, number> = {}

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/'
      hits[path] = (hits[path] ?? 0) + 1
      res.setHeader('content-type', 'application/json')
      if (path === '/login') {
        res.setHeader('x-request-id', 'r-1')
        res.setHeader('set-cookie', 'sid=abc; Path=/')
        return res.end(JSON.stringify({ token: `tok-${hits[path]}`, user: { id: 7 } }))
      }
      if (path === '/echo') {
        let data = ''
        req.on('data', (c) => (data += c))
        return req.on('end', () => res.end(JSON.stringify({ body: data })))
      }
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())
  beforeEach(() => {
    forgetResponses()
    for (const k of Object.keys(hits)) delete hits[k]
  })

  const collectionWith = (...reqs: ApiRequest[]): Collection => {
    const c = newCollection('Shop')
    const folder = newFolder('Auth')
    folder.items.push(newRequestItem(reqs[0]))
    c.items.push(folder, ...reqs.slice(1).map((r) => newRequestItem(r)))
    return c
  }
  const input = (request: ApiRequest, collection: Collection): RunRequestInput => ({
    request,
    collection,
    parentAuths: [],
    preRequestScripts: [],
    testScripts: [],
    variables: { local: {}, data: {}, environment: {}, collection: {}, globals: {} },
    info: { requestName: request.name, requestId: request.id, iteration: 0, iterationCount: 1 }
  })
  const body = (r: Awaited<ReturnType<typeof runRequest>>): Record<string, unknown> => {
    if (!r.result?.ok) throw new Error(r.result?.error ?? r.scriptError)
    return JSON.parse(r.result.response.body)
  }

  it('finds requests by name or folder path', () => {
    const c = collectionWith(newRequest({ name: 'Login' }), newRequest({ name: 'Me' }))
    expect(findRequestByRef(c, 'Login')?.item.request.name).toBe('Login')
    expect(findRequestByRef(c, 'Auth/Login')?.folders[0].name).toBe('Auth')
    expect(findRequestByRef(c, 'Other/Login')).toBeUndefined()
  })

  it('sends a referenced request first, then reuses its response', async () => {
    const login = newRequest({ name: 'Login', method: 'POST', url: `${base}/login`, scripts: { preRequest: '', test: "pm.environment.set('userId', pm.response.json().user.id)" } })
    const me = newRequest({ name: 'Me', url: `${base}/me`, headers: [newKeyValue('Authorization', "Bearer {{ $response('Login', '$.token') }}")] })
    const c = collectionWith(login, me)

    const r1 = await runRequest(input(me, c))
    expect(body(r1)).toEqual({ auth: 'Bearer tok-1', cookie: 'sid=abc' })
    expect(r1.variables.environment.userId).toBe('7') // the login's test script ran and its variables carried over
    expect(r1.console.some((e) => e.message.includes('↳ sent "Login"'))).toBe(true)

    const r2 = await runRequest(input(me, c))
    expect(body(r2).auth).toBe('Bearer tok-1')
    expect(hits['/login']).toBe(1)
  })

  it("honours 'always', 'never', max age, headers and status", async () => {
    const login = newRequest({ name: 'Login', url: `${base}/login` })
    const make = (h: string): ApiRequest => newRequest({ name: 'Me', url: `${base}/me`, headers: [newKeyValue('Authorization', h)] })

    let c = collectionWith(login, make("{{ $response('Login', '$.token', 'never') }}"))
    let r = await runRequest(input((c.items[1] as { request: ApiRequest }).request, c))
    expect(r.result?.ok).toBe(false)
    expect(r.result && !r.result.ok && r.result.error).toMatch(/hasn't been sent yet/)
    expect(r.sent).toBeUndefined()

    c = collectionWith(login, make("{{ $response('Login', '$.token', 'always') }}"))
    const me = (c.items[1] as { request: ApiRequest }).request
    expect(body(await runRequest(input(me, c))).auth).toBe('tok-1')
    expect(body(await runRequest(input(me, c))).auth).toBe('tok-2')

    c = collectionWith(login, make("{{ $response('Login', '$.token', 3600) }}"))
    expect(body(await runRequest(input((c.items[1] as { request: ApiRequest }).request, c))).auth).toBe('tok-2')
    c = collectionWith(login, make("{{ $response('Login', '$.token', 0) }}"))
    await new Promise((r) => setTimeout(r, 5))
    expect(body(await runRequest(input((c.items[1] as { request: ApiRequest }).request, c))).auth).toBe('tok-3')

    c = collectionWith(login, make("{{ $response('Login', 'header:X-Request-Id') }}/{{ $response('Login', 'status') }}"))
    expect(body(await runRequest(input((c.items[1] as { request: ApiRequest }).request, c))).auth).toBe('r-1/200')
  })

  it('detects cycles and reports missing requests and paths', async () => {
    const a = newRequest({ name: 'A', url: `${base}/a?{{ $response('B') }}` })
    const b = newRequest({ name: 'B', url: `${base}/b?{{ $response('A') }}` })
    const c = collectionWith(a, b)
    const r = await runRequest(input(a, c))
    expect(r.result && !r.result.ok && r.result.error).toMatch(/Circular reference: A → B → A/)
    expect(hits['/a'] ?? 0).toBe(0)

    const lost = newRequest({ name: 'C', url: `${base}/c?{{ $response('Nope') }}` })
    const r2 = await runRequest(input(lost, collectionWith(lost)))
    expect(r2.result && !r2.result.ok && r2.result.error).toMatch(/No request named "Nope"/)

    const login = newRequest({ name: 'Login', url: `${base}/login` })
    const bad = newRequest({ name: 'D', url: `${base}/d?{{ $response('Login', '$.missing') }}` })
    const r3 = await runRequest(input(bad, collectionWith(login, bad)))
    expect(r3.result && !r3.result.ok && r3.result.error).toMatch(/\$\.missing matched nothing/)
  })

  it('renders templates in bodies after pre-request scripts', async () => {
    const echo = newRequest({ name: 'Echo', method: 'POST', url: `${base}/echo`, body: { mode: 'raw', raw: "{{ $upper('{{who}}') }}", language: 'text' } })
    const i = { ...input(echo, collectionWith(echo)), preRequestScripts: ["pm.variables.set('who', 'ada')"] }
    expect(body(await runRequest(i))).toEqual({ body: 'ADA' })
  })
})
