import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runScript, type ScriptContext } from './sandbox'
import { runCollection, runRequest } from './run'
import { newRequest } from './factory'
import type { RunStep, RunVariables } from './types'

const vars = (over: Partial<RunVariables> = {}): RunVariables => ({ local: {}, data: {}, environment: {}, collection: {}, globals: {}, ...over })
const info = { requestName: 'R', requestId: 'r1', iteration: 0, iterationCount: 1 }
const ctx = (over: Partial<ScriptContext> = {}): ScriptContext => ({
  event: 'test',
  variables: vars(),
  request: { url: 'https://x.io/a', method: 'GET', headers: [], body: null },
  response: { code: 200, status: 'OK', headers: [['Content-Type', 'application/json']], body: '{"id":7,"tags":["a","b"],"user":{"name":"Ada"}}', responseTime: 12, responseSize: 40 },
  info,
  ...over
})

describe('sandbox', () => {
  it('runs pm.test with chai-style assertions', async () => {
    const out = await runScript(
      `
      pm.test('status', () => pm.response.to.have.status(200));
      pm.test('ok', () => pm.response.to.be.ok);
      pm.test('json', () => {
        const j = pm.response.json();
        pm.expect(j.id).to.equal(7);
        pm.expect(j).to.have.property('user').that.has.property('name', 'Ada');
        pm.expect(j.tags).to.be.an('array').with.lengthOf(2).and.include('b');
        pm.expect(j).to.have.nested.property('user.name', 'Ada');
        pm.expect(j.id).to.be.above(5).and.below(10);
      });
      pm.test('fails', () => pm.expect(1).to.not.equal(1));
      pm.test('header', () => pm.response.to.have.header('content-type', 'application/json'));
    `,
      ctx()
    )
    expect(out.error).toBeUndefined()
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ['status', true],
      ['ok', true],
      ['json', true],
      ['fails', false],
      ['header', true]
    ])
    expect(out.tests[3].error).toBe('expected 1 to not equal 1')
  })

  it('reads and writes variable scopes and console', async () => {
    const out = await runScript(
      `
      pm.environment.set('token', pm.response.json().id);
      pm.collectionVariables.set('obj', { a: 1 });
      pm.globals.unset('old');
      pm.variables.set('local1', 'L');
      console.log('base is', pm.variables.get('base'), { n: 1 });
      console.warn(pm.variables.replaceIn('{{base}}/x/{{local1}}'));
    `,
      ctx({ variables: vars({ environment: { base: 'http://e' }, globals: { old: '1', base: 'http://g' } }) })
    )
    expect(out.variables.environment).toEqual({ base: 'http://e', token: '7' })
    expect(out.variables.collection).toEqual({ obj: '{"a":1}' })
    expect(out.variables.globals).toEqual({ base: 'http://g' })
    expect(out.variables.local).toEqual({ local1: 'L' })
    expect(out.console.map((c) => [c.level, c.message])).toEqual([
      ['log', 'base is http://e {\n  "n": 1\n}'],
      ['warn', 'http://e/x/L']
    ])
  })

  it('lets pre-request scripts edit the request', async () => {
    const out = await runScript(
      `
      pm.request.headers.add({ key: 'X-Sig', value: btoa('hi') });
      pm.request.headers.upsert({ key: 'Accept', value: 'text/plain' });
      pm.request.url = pm.request.url.toString() + '?t=1';
      pm.request.method = 'post';
      pm.request.body.raw = JSON.stringify({ ok: true });
    `,
      ctx({ event: 'prerequest', response: undefined, request: { url: 'https://x.io/a', method: 'GET', headers: [['accept', '*/*']], body: '{}' } })
    )
    expect(out.error).toBeUndefined()
    expect(out.request).toEqual({ url: 'https://x.io/a?t=1', method: 'POST', headers: [['Accept', 'text/plain'], ['X-Sig', 'aGk=']], body: '{"ok":true}' })
  })

  it('reports syntax/runtime errors with line numbers and keeps earlier results', async () => {
    const out = await runScript(`pm.test('before', () => {});\npm.environment.set('a', '1');\nundefinedFn();`, ctx())
    expect(out.error).toMatch(/ReferenceError: .*undefinedFn.*\(line 3\)/)
    expect(out.tests).toHaveLength(1)
    expect(out.variables.environment.a).toBe('1')
  })

  it('stops infinite loops and blocks host access', async () => {
    const loop = await runScript('while (true) {}', ctx(), { timeoutMs: 200 })
    expect(loop.error).toMatch(/timed out/)
    const host = await runScript(`pm.test('no node modules', () => ['fs', 'child_process', 'net', 'crypto'].forEach((m) => pm.expect(() => require(m)).to.throw('Cannot find module')));
      pm.test('no process', () => pm.expect(typeof process).to.equal('undefined'));`, ctx())
    expect(host.tests.every((t) => t.passed)).toBe(true)
  })

  it('provides CryptoJS, lodash, uuid and a secure crypto.getRandomValues via require()', async () => {
  const out = await runScript(`
    const CJ = require('crypto-js');
    pm.test('hmac', () => pm.expect(CryptoJS.HmacSHA256('msg', 'key').toString()).to.equal('2d93cbc1be167bcb1637a4a23cbff01a7878f0c50ee833954ea5221bb1b8c628'));
    pm.test('md5', () => pm.expect(CJ.MD5('hello').toString()).to.equal('5d41402abc4b2a76b9719d911017c592'));
    pm.test('b64', () => pm.expect(CJ.enc.Base64.stringify(CJ.enc.Utf8.parse('hi'))).to.equal('aGk='));
    pm.test('aes roundtrip', () => { const c = CJ.AES.encrypt('secret', 'pass').toString(); pm.expect(CJ.AES.decrypt(c, 'pass').toString(CJ.enc.Utf8)).to.equal('secret'); });
    pm.test('lodash', () => pm.expect(_.chunk([1,2,3,4,5], 2)).to.eql([[1,2],[3,4],[5]]));
    pm.test('lodash require', () => pm.expect(require('lodash').get({a:{b:[1,{c:9}]}}, 'a.b[1].c')).to.equal(9));
    pm.test('uuid', () => pm.expect(require('uuid').v4()).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    pm.test('missing', () => pm.expect(() => require('fs')).to.throw('Cannot find module'));
  `, ctx())
    expect(out.error).toBeUndefined()
    expect(out.tests.filter((t) => !t.passed)).toEqual([])
    expect(out.tests).toHaveLength(8)
  })

  it('supports async tests with promises', async () => {
    const out = await runScript(`pm.test('async', async () => { await Promise.resolve(); pm.expect(1).to.equal(2); });`, ctx())
    expect(out.tests[0]).toMatchObject({ passed: false, error: 'expected 1 to equal 2' })
  })
})

describe('runRequest + runner', () => {
  let server: http.Server
  let base = ''
  let hits: string[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`)
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.url === '/login') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ token: 'tok-123' }))
        }
        res.writeHead(req.headers.authorization === 'Bearer tok-123' ? 200 : 401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ url: req.url, auth: req.headers.authorization ?? null, sig: req.headers['x-sig'] ?? null, body }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  it('runs pre-request (with pm.sendRequest) then tests', async () => {
    hits = []
    const r = await runRequest({
      request: newRequest({ name: 'Me', url: '{{base}}/me', auth: { type: 'bearer', token: '{{token}}' } }),
      parentAuths: [],
      preRequestScripts: [
        `pm.sendRequest(pm.environment.get('base') + '/login', (err, res) => { pm.environment.set('token', res.json().token); });`,
        `pm.request.headers.add({ key: 'X-Sig', value: 'abc' });`
      ],
      testScripts: [`pm.test('authorised', () => pm.response.to.have.status(200)); pm.test('sig', () => pm.expect(pm.response.json().sig).to.equal('abc'));`],
      variables: vars({ environment: { base } }),
      info
    })
    expect(r.scriptError).toBeUndefined()
    expect(hits).toEqual(['GET /login', 'GET /me'])
    expect(r.result?.ok).toBe(true)
    expect(r.tests.every((t) => t.passed)).toBe(true)
    expect(r.variables.environment.token).toBe('tok-123')
    expect(r.sent?.headers).toContainEqual(['Authorization', 'Bearer tok-123'])
  })

  it('does not send when a pre-request script throws', async () => {
    hits = []
    const r = await runRequest({ request: newRequest({ url: `${base}/x` }), parentAuths: [], preRequestScripts: ['throw new Error("boom")'], testScripts: [], variables: vars(), info })
    expect(hits).toEqual([])
    expect(r.scriptError).toBe('Pre-request script: Error: boom (line 1)')
  })

  it('runs a collection with data rows, carried variables and setNextRequest', async () => {
    hits = []
    const step = (name: string, url: string, test = ''): RunStep => ({
      request: newRequest({ name, url, auth: { type: 'bearer', token: '{{token}}' } }),
      parentAuths: [],
      preRequestScripts: [],
      testScripts: test ? [test] : []
    })
    const steps = [
      step('Login', '{{base}}/login', `pm.environment.set('token', pm.response.json().token);`),
      step('Get', '{{base}}/item/{{id}}', `pm.test('ok', () => pm.response.to.be.ok); if (pm.iterationData.get('id') === '2') pm.execution.setNextRequest('Final');`),
      step('Skipped on row 2', '{{base}}/never'),
      step('Final', '{{base}}/final', `pm.test('fails on purpose', () => pm.expect(pm.info.iteration).to.equal(0));`)
    ]
    const results: string[] = []
    const { summary, variables } = await runCollection(
      steps,
      { environment: { base }, collection: {}, globals: {} },
      { iterations: 0, delayMs: 0, data: [{ id: '1' }, { id: '2' }], stopOnError: false },
      { onResult: (r) => results.push(`${r.iteration}:${r.name}:${r.status}`) }
    )
    expect(results).toEqual(['0:Login:200', '0:Get:200', '0:Skipped on row 2:200', '0:Final:200', '1:Login:200', '1:Get:200', '1:Final:200'])
    expect(hits).toContain('GET /item/2')
    expect(summary).toMatchObject({ iterations: 2, requests: 7, testsPassed: 3, testsFailed: 1, errors: 0, aborted: false })
    expect(variables.environment.token).toBe('tok-123')
  })

  it('stops on first failure when asked, and on setNextRequest(null)', async () => {
    const steps: RunStep[] = ['A', 'B', 'C'].map((n) => ({
      request: newRequest({ name: n, url: `${base}/${n}` }),
      parentAuths: [],
      preRequestScripts: [],
      testScripts: [n === 'A' ? `pm.execution.setNextRequest(null)` : '']
    }))
    const seen: string[] = []
    const r1 = await runCollection(steps, { environment: {}, collection: {}, globals: {} }, { iterations: 3, delayMs: 0, data: [], stopOnError: false }, { onResult: (r) => seen.push(r.name) })
    expect(seen).toEqual(['A'])
    expect(r1.summary.requests).toBe(1)

    const failing: RunStep[] = [{ ...steps[1], testScripts: [`pm.test('x', () => pm.expect(1).to.equal(2))`] }, steps[2]]
    const r2 = await runCollection(failing, { environment: {}, collection: {}, globals: {} }, { iterations: 2, delayMs: 0, data: [], stopOnError: true })
    expect(r2.summary).toMatchObject({ requests: 1, testsFailed: 1, aborted: true })
  })
})
