import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { WebSocketServer } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SseParser } from './sse'
import { openSse, openWebSocket, type RealtimeSession } from './realtime'
import { describeGrpc, describeProto, openGrpc } from './grpc'
import { ReflectionService } from '@grpc/reflection'
import { newRequest } from './factory'
import type { ApiRequest, RealtimeOpenInput, StreamEvent } from './types'

const input = (request: ApiRequest, env: Record<string, string> = {}): RealtimeOpenInput => ({
  request,
  parentAuths: [],
  variables: { local: {}, data: {}, environment: env, collection: {}, globals: {} }
})

/** Collect events until `until` matches one, with a timeout. */
function collector(): { emit: (e: Omit<StreamEvent, 'timestamp'>) => void; events: Omit<StreamEvent, 'timestamp'>[]; waitFor: (pred: (e: Omit<StreamEvent, 'timestamp'>) => boolean) => Promise<void> } {
  const events: Omit<StreamEvent, 'timestamp'>[] = []
  const waiters: { pred: (e: Omit<StreamEvent, 'timestamp'>) => boolean; resolve: () => void }[] = []
  return {
    events,
    emit: (e) => {
      events.push(e)
      for (const w of [...waiters]) if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve()
      }
    },
    waitFor: (pred) =>
      events.some(pred)
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            waiters.push({ pred, resolve })
            setTimeout(() => reject(new Error(`timed out; events: ${JSON.stringify(events.map((e) => [e.kind, e.data]))}`)), 4000)
          })
  }
}

describe('SSE parser', () => {
  it('handles multi-line data, named events, ids, comments and split chunks', () => {
    const p = new SseParser()
    const out = [
      ...p.push('﻿: keep-alive\ndata: hel'),
      ...p.push('lo\ndata: world\n\nevent: tick\nid: 7\r'),
      ...p.push('\ndata: {"n":1}\r\n\r\ndata: no-terminator')
    ]
    expect(out).toEqual([
      { event: 'message', data: 'hello\nworld', id: undefined, retry: undefined },
      { event: 'tick', data: '{"n":1}', id: '7', retry: undefined }
    ])
  })
})

describe('WebSocket and SSE sessions', () => {
  let server: http.Server
  let port = 0
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/events')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          res.write(`event: hello\ndata: ${req.headers.authorization} ${body}\n\n`)
          res.write('data: one\n\n')
          setTimeout(() => res.end('data: two\n\n'), 20)
        })
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nope')
    })
    const wss = new WebSocketServer({ server, verifyClient: (info: { req: http.IncomingMessage }) => !info.req.url?.startsWith('/deny') })
    wss.on('connection', (socket, req) => {
      socket.send(`welcome ${req.headers['x-user']} via ${socket.protocol || 'none'}`)
      socket.on('message', (m) => (String(m) === 'bye' ? socket.close(4000, 'asked to') : socket.send(`echo: ${m}`)))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => server.close())

  it('connects a WebSocket with headers/variables/sub-protocol and exchanges messages', async () => {
    const c = collector()
    const s = await openWebSocket(
      input(newRequest({ protocol: 'websocket', url: '127.0.0.1:{{port}}/socket', subprotocols: 'chat', headers: [{ id: 'h', key: 'X-User', value: 'ada', enabled: true }] }), { port: String(port) }),
      c.emit
    )
    await c.waitFor((e) => e.kind === 'message' && e.data === 'welcome ada via chat')
    s.send('ping')
    await c.waitFor((e) => e.data === 'echo: ping')
    s.send('bye')
    await c.waitFor((e) => e.kind === 'close')
    expect(c.events.map((e) => e.kind)).toEqual(['connecting', 'info', 'open', 'message', 'sent', 'message', 'sent', 'close'])
    expect(c.events.at(-1)?.meta).toBe('Code 4000 — asked to')
  })

  it('reports a failed WebSocket handshake', async () => {
    const c = collector()
    await openWebSocket(input(newRequest({ protocol: 'websocket', url: `ws://127.0.0.1:${port}/deny` })), c.emit)
    await c.waitFor((e) => e.kind === 'close')
    expect(c.events.find((e) => e.kind === 'error')?.data).toMatch(/^Handshake failed: 401/)
  })

  it('streams Server-Sent Events from a POST with auth', async () => {
    const c = collector()
    await openSse(
      input(newRequest({ protocol: 'sse', method: 'POST', url: `http://127.0.0.1:${port}/events`, auth: { type: 'bearer', token: 't0k' }, body: { mode: 'raw', raw: '{"q":1}', language: 'json' } })),
      c.emit
    )
    await c.waitFor((e) => e.kind === 'close')
    expect(c.events.filter((e) => e.kind === 'message').map((e) => [e.data, e.meta])).toEqual([
      ['Bearer t0k {"q":1}', 'event: hello'],
      ['one', undefined],
      ['two', undefined]
    ])
  })

  it('explains a non-stream SSE response', async () => {
    const c = collector()
    await openSse(input(newRequest({ protocol: 'sse', url: `http://127.0.0.1:${port}/missing` })), c.emit)
    await c.waitFor((e) => e.kind === 'close')
    expect(c.events.find((e) => e.kind === 'error')?.data).toMatch(/^Expected an event stream but got 404 Not Found \(text\/plain\)\nnope/)
  })
})

describe('gRPC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiman-grpc-'))
  const proto = join(dir, 'greeter.proto')
  writeFileSync(
    proto,
    `syntax = "proto3";
package demo.v1;
enum Mood { MOOD_UNSPECIFIED = 0; HAPPY = 1; }
message Hello { string name = 1; int64 count = 2; Mood mood = 3; repeated string tags = 4; Inner inner = 5; map<string, int32> scores = 6;
  oneof pick { string a = 7; int32 b = 8; } }
message Inner { bool ok = 1; }
message Reply { string text = 1; }
service Greeter {
  rpc Say (Hello) returns (Reply);
  rpc Count (Hello) returns (stream Reply);
  rpc Collect (stream Hello) returns (Reply);
  rpc Chat (stream Hello) returns (stream Reply);
}`
  )
  let server: grpc.Server
  let port = 0
  beforeAll(async () => {
    const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(proto, { keepCase: true, longs: String, defaults: true })) as any
    server = new grpc.Server()
    server.addService(pkg.demo.v1.Greeter.service, {
      Say: (call: any, cb: any) => {
        if (call.request.name === 'fail') return cb({ code: grpc.status.INVALID_ARGUMENT, details: 'bad name' })
        cb(null, { text: `hi ${call.request.name} (${call.metadata.get('authorization')[0]})` })
      },
      Count: (call: any) => {
        for (let i = 1; i <= Number(call.request.count); i++) call.write({ text: `${i}` })
        call.end()
      },
      Collect: (call: any, cb: any) => {
        const names: string[] = []
        call.on('data', (m: any) => names.push(m.name))
        call.on('end', () => cb(null, { text: names.join('+') }))
      },
      Chat: (call: any) => {
        call.on('data', (m: any) => call.write({ text: `re: ${m.name}` }))
        call.on('end', () => call.end())
      }
    })
    port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))))
  })
  afterAll(() => server.forceShutdown())

  const grpcReq = (method: string, message = '{}'): ApiRequest =>
    newRequest({ protocol: 'grpc', url: `grpc://127.0.0.1:${port}`, message, grpc: { protoFiles: [proto], includeDirs: [], service: 'demo.v1.Greeter', method }, auth: { type: 'bearer', token: 'abc' } })

  it('lists services with streaming flags and example messages', async () => {
    const [svc] = await describeProto([proto])
    expect(svc.name).toBe('demo.v1.Greeter')
    expect(svc.methods.map((m) => [m.name, m.clientStreaming, m.serverStreaming])).toEqual([
      ['Say', false, false],
      ['Count', false, true],
      ['Collect', true, false],
      ['Chat', true, true]
    ])
    expect(svc.methods[0].requestType).toBe('demo.v1.Hello')
    expect(svc.methods[0].sample).toEqual({ name: '', count: '0', mood: 'MOOD_UNSPECIFIED', tags: [''], inner: { ok: false }, scores: {}, a: '' })
  })

  it('makes unary calls with metadata and reports status errors', async () => {
    const c = collector()
    await openGrpc(input(grpcReq('Say', '{"name":"ada"}')), c.emit)
    await c.waitFor((e) => e.kind === 'close')
    expect(c.events.filter((e) => e.kind === 'message').map((e) => JSON.parse(e.data!))).toEqual([{ text: 'hi ada (Bearer abc)' }])
    expect(c.events.at(-1)?.meta).toBe('Status 0 OK')

    const bad = collector()
    await openGrpc(input(grpcReq('Say', '{"name":"fail"}')), bad.emit)
    await bad.waitFor((e) => e.kind === 'close')
    expect(bad.events.find((e) => e.kind === 'error')?.data).toBe('INVALID_ARGUMENT: bad name')
  })

  it('handles server, client and bidirectional streams', async () => {
    const server = collector()
    await openGrpc(input(grpcReq('Count', '{"count": 3}')), server.emit)
    await server.waitFor((e) => e.kind === 'close')
    expect(server.events.filter((e) => e.kind === 'message').map((e) => JSON.parse(e.data!).text)).toEqual(['1', '2', '3'])

    const client = collector()
    const cs: RealtimeSession = await openGrpc(input(grpcReq('Collect')), client.emit)
    cs.send('{"name":"a"}')
    cs.send('{"name":"b"}')
    cs.send('not json')
    cs.end()
    await client.waitFor((e) => e.kind === 'close')
    expect(client.events.find((e) => e.kind === 'message')?.data).toContain('"a+b"')
    expect(client.events.some((e) => e.kind === 'error' && /not valid JSON/.test(e.data!))).toBe(true)

    const bidi = collector()
    const bs = await openGrpc(input(grpcReq('Chat')), bidi.emit)
    bs.send('{"name":"x"}')
    await bidi.waitFor((e) => e.kind === 'message')
    bs.end()
    await bidi.waitFor((e) => e.kind === 'close')
    expect(JSON.parse(bidi.events.find((e) => e.kind === 'message')!.data!)).toEqual({ text: 're: x' })
  })
})

describe('gRPC server reflection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiman-refl-'))
  writeFileSync(join(dir, 'common.proto'), 'syntax = "proto3"; package shop.common; message Money { string currency = 1; int64 cents = 2; }')
  writeFileSync(
    join(dir, 'shop.proto'),
    `syntax = "proto3"; package shop.v1; import "common.proto"; import "google/protobuf/timestamp.proto";
     message Order { string id = 1; shop.common.Money total = 2; google.protobuf.Timestamp at = 3; }
     message GetOrder { string id = 1; }
     service Orders { rpc Get (GetOrder) returns (Order); }`
  )
  let reflServer: grpc.Server
  let plainServer: grpc.Server
  let reflPort = 0
  let plainPort = 0
  beforeAll(async () => {
    const def = protoLoader.loadSync(join(dir, 'shop.proto'), { keepCase: true, longs: String, includeDirs: [dir] })
    const pkg = grpc.loadPackageDefinition(def) as any
    const impl = { Get: (call: any, cb: any) => cb(null, { id: call.request.id, total: { currency: 'EUR', cents: '1250' } }) }
    reflServer = new grpc.Server()
    reflServer.addService(pkg.shop.v1.Orders.service, impl)
    new ReflectionService(def).addToServer(reflServer)
    plainServer = new grpc.Server()
    plainServer.addService(pkg.shop.v1.Orders.service, impl)
    const bind = (srv: grpc.Server): Promise<number> =>
      new Promise((resolve, reject) => srv.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))))
    reflPort = await bind(reflServer)
    plainPort = await bind(plainServer)
  })
  afterAll(() => {
    reflServer.forceShutdown()
    plainServer.forceShutdown()
  })

  const req = (port: number, message = '{}'): ApiRequest =>
    newRequest({ protocol: 'grpc', url: `grpc://127.0.0.1:${port}`, message, grpc: { source: 'reflection', protoFiles: [], includeDirs: [], service: 'shop.v1.Orders', method: 'Get' } })

  it('discovers services, nested imports and well-known types without .proto files', async () => {
    const [svc] = await describeGrpc(input(req(reflPort)))
    expect(svc.name).toBe('shop.v1.Orders')
    expect(svc.methods[0]).toMatchObject({ name: 'Get', requestType: 'shop.v1.GetOrder', responseType: 'shop.v1.Order', sample: { id: '' } })
  })

  it('calls a method using reflected definitions', async () => {
    const c = collector()
    await openGrpc(input(req(reflPort, '{"id":"A-1"}')), c.emit)
    await c.waitFor((e) => e.kind === 'close')
    expect(JSON.parse(c.events.find((e) => e.kind === 'message')!.data!)).toMatchObject({ id: 'A-1', total: { currency: 'EUR', cents: '1250' } })
  })

  it('explains when a server has no reflection', async () => {
    await expect(describeGrpc(input(req(plainPort)))).rejects.toThrow('does not support gRPC reflection')
  })
})
