import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolve, unresolvedVariables } from './variables'
import { paramsFromUrl, urlWithParams } from './url'
import { parseCurl, toCurl } from './curl'
import { prepareRequest } from './prepare'
import { newKeyValue, newRequest } from './factory'
import { exportPostmanCollection, importPostmanCollection } from './postman'
import { generateSnippet } from './codegen'
import { execute } from './executor'

describe('variables', () => {
  const env = [{ key: 'host', value: 'api.dev', enabled: true }, { key: 'env', value: 'dev', enabled: true }]
  const globals = [{ key: 'host', value: 'api.prod', enabled: true }, { key: 'host_dev', value: 'nested.dev', enabled: true }]

  it('respects scope priority', () => {
    expect(resolve('https://{{host}}/x', [env, globals])).toBe('https://api.dev/x')
  })
  it('resolves nested names and leaves unknowns', () => {
    expect(resolve('{{host_{{env}}}} {{missing}}', [env, globals])).toBe('nested.dev {{missing}}')
    expect(unresolvedVariables('{{missing}} {{$guid}}', [env])).toEqual(['missing'])
  })
  it('supports dynamic variables', () => {
    expect(resolve('{{$guid}}', [])).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('url <-> params', () => {
  it('round-trips and keeps variables readable', () => {
    const params = paramsFromUrl('{{base}}/users?page=2&q=hello%20world&flag')
    expect(params.map((p) => [p.key, p.value])).toEqual([['page', '2'], ['q', 'hello world'], ['flag', '']])
    expect(urlWithParams('{{base}}/users', [...params, newKeyValue('t', '{{token}}')])).toBe('{{base}}/users?page=2&q=hello%20world&flag&t={{token}}')
  })
  it('keeps disabled params when URL changes', () => {
    const prev = [newKeyValue('a', '1'), { ...newKeyValue('off', 'x'), enabled: false }]
    const next = paramsFromUrl('/p?a=9', prev)
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([['a', '9', true], ['off', 'x', false]])
  })
})

describe('curl', () => {
  it('parses a typical command', () => {
    const r = parseCurl(`curl -X POST 'https://api.x.com/v1/items?limit=5' \\\n -H 'Authorization: Bearer abc' -H "Content-Type: application/json" --data '{"a":1}' -k`)
    expect(r.method).toBe('POST')
    expect(r.url).toBe('https://api.x.com/v1/items?limit=5')
    expect(r.params[0].key).toBe('limit')
    expect(r.headers.map((h) => h.key)).toEqual(['Authorization', 'Content-Type'])
    expect(r.body).toEqual({ mode: 'raw', raw: '{"a":1}', language: 'json' })
    expect(r.settings.verifySsl).toBe(false)
  })
  it('infers POST + urlencoded and basic auth', () => {
    const r = parseCurl('curl https://x.io/login -u bob:secret -d user=bob -d pass=1')
    expect(r.method).toBe('POST')
    expect(r.auth).toEqual({ type: 'basic', username: 'bob', password: 'secret' })
    expect(r.body.mode).toBe('urlencoded')
  })
  it('round-trips through toCurl', () => {
    const prepared = prepareRequest(parseCurl(`curl -X PUT https://x.io/a -H 'Content-Type: text/plain' --data-raw 'it'"'"'s'`), [])
    const again = parseCurl(toCurl(prepared))
    expect(again.method).toBe('PUT')
    expect(again.body).toMatchObject({ raw: "it's" })
  })
})

describe('prepare', () => {
  it('applies variables, inherited auth and content type', () => {
    const req = newRequest({
      method: 'POST',
      url: '{{base}}/u',
      body: { mode: 'raw', raw: '{"n":"{{name}}"}', language: 'json' },
      auth: { type: 'inherit' }
    })
    const p = prepareRequest(req, [[{ key: 'base', value: 'localhost:3000', enabled: true }, { key: 'name', value: 'Ada', enabled: true }]], [undefined, { type: 'bearer', token: 't0k' }])
    expect(p.url).toBe('http://localhost:3000/u')
    expect(p.headers).toContainEqual(['Authorization', 'Bearer t0k'])
    expect(p.headers).toContainEqual(['Content-Type', 'application/json'])
    expect(p.body).toEqual({ kind: 'text', text: '{"n":"Ada"}', contentType: 'application/json' })
  })
  it('adds api key to query', () => {
    const p = prepareRequest(newRequest({ url: 'https://x.io/a?b=1#h', auth: { type: 'apikey', key: 'k', value: 'v', in: 'query' } }), [])
    expect(p.url).toBe('https://x.io/a?b=1&k=v#h')
  })
})

describe('postman format', () => {
  it('imports and re-exports a v2.1 collection', () => {
    const src = {
      info: { name: 'Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] },
      item: [
        {
          name: 'Users',
          item: [{ name: 'List', request: { method: 'GET', url: { raw: '{{base}}/users?x=1', query: [{ key: 'x', value: '1' }, { key: 'y', value: '2', disabled: true }] } } }]
        }
      ],
      variable: [{ key: 'base', value: 'https://api.test' }]
    }
    const c = importPostmanCollection(src)
    expect(c.auth).toEqual({ type: 'bearer', token: '{{tok}}' })
    const folder = c.items[0]
    expect(folder.type).toBe('folder')
    if (folder.type !== 'folder' || folder.items[0].type !== 'request') throw new Error('bad shape')
    expect(folder.items[0].request.params.map((p) => [p.key, p.enabled])).toEqual([['x', true], ['y', false]])
    const out = exportPostmanCollection(c)
    expect(importPostmanCollection(out).items[0]).toMatchObject({ name: 'Users' })
  })
})

describe('codegen', () => {
  it('generates python and fetch snippets', () => {
    const p = prepareRequest(newRequest({ method: 'POST', url: 'https://x.io', body: { mode: 'raw', raw: '{}', language: 'json' } }), [])
    expect(generateSnippet('python', p)).toContain('requests.request("POST", url, headers=headers, data=payload)')
    expect(generateSnippet('fetch', p)).toContain('method: "POST"')
  })
})

describe('executor', () => {
  let server: http.Server
  let base = ''
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/echo' })
          return res.end()
        }
        if (req.url === '/gzip') {
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' })
          return res.end(zlib.gzipSync('compressed hello'))
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'yes' })
        res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  it('sends a JSON POST and returns timings', async () => {
    const p = prepareRequest(newRequest({ method: 'POST', url: `${base}/echo`, body: { mode: 'raw', raw: '{"a":1}', language: 'json' } }), [])
    const r = await execute(p)
    if (!r.ok) throw new Error(r.error)
    const echoed = JSON.parse(r.response.body)
    expect(echoed.method).toBe('POST')
    expect(echoed.body).toBe('{"a":1}')
    expect(echoed.headers['content-type']).toBe('application/json')
    expect(r.response.headers).toContainEqual(['X-Test', 'yes'])
    expect(r.response.timings.total).toBeGreaterThan(0)
  })
  it('follows redirects (302 POST -> GET)', async () => {
    const r = await execute(prepareRequest(newRequest({ method: 'POST', url: `${base}/redirect`, body: { mode: 'raw', raw: 'x', language: 'text' } }), []))
    if (!r.ok) throw new Error(r.error)
    expect(JSON.parse(r.response.body).method).toBe('GET')
    expect(r.response.redirects).toHaveLength(1)
  })
  it('decompresses gzip', async () => {
    const r = await execute(prepareRequest(newRequest({ url: `${base}/gzip` }), []))
    if (!r.ok) throw new Error(r.error)
    expect(r.response.body).toBe('compressed hello')
  })
  it('sends multipart form data', async () => {
    const r = await execute(prepareRequest(newRequest({ method: 'POST', url: `${base}/echo`, body: { mode: 'formdata', formdata: [{ ...newKeyValue('field', 'v1'), type: 'text' }] } }), []))
    if (!r.ok) throw new Error(r.error)
    const e = JSON.parse(r.response.body)
    expect(e.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(e.body).toContain('name="field"\r\n\r\nv1')
  })
  it('reports connection errors nicely', async () => {
    const r = await execute(prepareRequest(newRequest({ url: 'http://127.0.0.1:1/' }), []))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Connection refused/)
  })
})

import { applyVarChanges, parseDataFile, toVarMap } from './varsync'

describe('varsync', () => {
  it('applies script changes without disturbing other rows', () => {
    const rows = [newKeyValue('a', '1'), { ...newKeyValue('b', 'off'), enabled: false }, { ...newKeyValue('s', 'x'), secret: true }, newKeyValue('gone', 'y')]
    const before = toVarMap(rows)
    expect(before).toEqual({ a: '1', s: 'x', gone: 'y' })
    const out = applyVarChanges(rows, before, { a: '2', s: 'x2', n: 'new' })
    expect(out.map((r) => [r.key, r.value, r.enabled])).toEqual([['a', '2', true], ['b', 'off', false], ['s', 'x2', true], ['n', 'new', true]])
    expect(out[0].id).toBe(rows[0].id)
    expect((out[2] as { secret?: boolean }).secret).toBe(true)
  })
  it('parses CSV and JSON data files', () => {
    expect(parseDataFile('id,name\r\n1,"Ada, L"\n2,"say ""hi"""\n\n', 'd.csv')).toEqual([{ id: '1', name: 'Ada, L' }, { id: '2', name: 'say "hi"' }])
    expect(parseDataFile('[{"id":1,"tags":["x"]}]', 'd.json')).toEqual([{ id: '1', tags: '["x"]' }])
  })
})

describe('postman scripts', () => {
  it('imports and exports pre-request/test events at every level', () => {
    const ev = (pre: string, test: string): unknown[] => [
      { listen: 'prerequest', script: { exec: pre.split('\n') } },
      { listen: 'test', script: { exec: test.split('\n') } }
    ]
    const c = importPostmanCollection({
      info: { name: 'S', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      event: ev('// col pre', '// col test'),
      item: [{ name: 'F', event: ev('', '// folder test'), item: [{ name: 'R', event: ev("pm.variables.set('a', 1)\n// two", ''), request: { method: 'GET', url: 'x' } }] }]
    })
    expect(c.scripts).toEqual({ preRequest: '// col pre', test: '// col test' })
    const f = c.items[0]
    if (f.type !== 'folder' || f.items[0].type !== 'request') throw new Error('bad shape')
    expect(f.scripts).toEqual({ preRequest: '', test: '// folder test' })
    expect(f.items[0].request.scripts?.preRequest).toBe("pm.variables.set('a', 1)\n// two")
    const out = exportPostmanCollection(c)
    expect(out.event).toHaveLength(2)
    expect(out.item[0].event).toEqual([{ listen: 'test', script: { type: 'text/javascript', exec: ['// folder test'] } }])
    expect(out.item[0].item[0].event[0].script.exec).toEqual(["pm.variables.set('a', 1)", '// two'])
  })
})
