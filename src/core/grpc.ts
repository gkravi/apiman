// Node-only: gRPC over @grpc/grpc-js — service discovery from .proto files or server reflection,
// example messages, and unary / server / client / bidirectional streaming calls as realtime sessions.

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import protobuf from 'protobufjs'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { tlsFor } from './executor'
import { prepareRealtime, type Emit, type RealtimeSession } from './realtime'
import { reflectFileDescriptorSet } from './grpc-reflection'
import 'protobufjs/ext/descriptor' // adds Root.fromDescriptor
import type { GrpcServiceInfo, PreparedRequest, RealtimeOpenInput } from './types'

const LOADER_OPTIONS = { keepCase: true, longs: String, enums: String, bytes: String, defaults: true, oneofs: true }

type PackageDefinition = protoLoader.PackageDefinition

/** Everything needed about a set of services: grpc-js definitions to call, protobufjs types to sample. */
export interface Definitions {
  pkg: PackageDefinition
  root: protobuf.Root
}

async function load(protoFiles: string[], includeDirs: string[]): Promise<PackageDefinition> {
  if (!protoFiles.length) throw new Error('Select at least one .proto file')
  try {
    return await protoLoader.load(protoFiles, { ...LOADER_OPTIONS, includeDirs: withFileDirs(protoFiles, includeDirs) })
  } catch (e) {
    throw new Error(`Could not load proto files: ${(e as Error).message}`)
  }
}

const isService = (def: unknown): def is protoLoader.ServiceDefinition =>
  !!def && typeof def === 'object' && !('format' in (def as object)) && Object.values(def as object).every((m) => m && typeof m === 'object' && 'path' in m)

/** Imports resolve against the proto files' own folders too, so a single-folder setup just works. */
const withFileDirs = (files: string[], dirs: string[]): string[] => [...new Set([...dirs, ...files.map((f) => dirname(f))])]

/** A protobufjs Root for reflection (proto-loader's descriptors can't tell oneof members apart). */
function reflectionRoot(protoFiles: string[], includeDirs: string[]): protobuf.Root {
  const dirs = withFileDirs(protoFiles, includeDirs)
  const root = new protobuf.Root()
  const original = root.resolvePath.bind(root)
  root.resolvePath = (origin, target) => {
    if (isAbsolute(target)) return target
    for (const d of dirs) if (existsSync(join(d, target))) return join(d, target)
    return original(origin, target)
  }
  root.loadSync(protoFiles, { keepCase: true })
  root.resolveAll()
  return root
}

const LONG_TYPES = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64'])

function sampleScalar(field: protobuf.Field, depth: number): unknown {
  const rt = field.resolvedType
  if (rt instanceof protobuf.Enum) return Object.keys(rt.values)[0] ?? 0
  if (rt instanceof protobuf.Type) return sampleMessage(rt, depth + 1)
  if (field.type === 'string' || field.type === 'bytes') return ''
  if (field.type === 'bool') return false
  if (LONG_TYPES.has(field.type)) return '0'
  return 0
}

/** Example JSON for a message type: zero values, first enum value, first field of each oneof. */
export function sampleMessage(type: protobuf.Type, depth = 0): Record<string, unknown> {
  if (depth > 6) return {}
  const out: Record<string, unknown> = {}
  const oneofsSeen = new Set<string>()
  for (const field of type.fieldsArray) {
    if (field.partOf && !field.partOf.name.startsWith('_')) {
      // proto3 `optional` fields are synthetic oneofs named "_field"; real oneofs get one example.
      if (oneofsSeen.has(field.partOf.name)) continue
      oneofsSeen.add(field.partOf.name)
    }
    if (field instanceof protobuf.MapField) out[field.name] = {}
    else out[field.name] = field.repeated ? [sampleScalar(field, depth)] : sampleScalar(field, depth)
  }
  return out
}

async function fromFiles(protoFiles: string[], includeDirs: string[]): Promise<Definitions> {
  return { pkg: await load(protoFiles, includeDirs), root: reflectionRoot(protoFiles, includeDirs) }
}

function servicesOf({ pkg, root }: Definitions): GrpcServiceInfo[] {
  const services: GrpcServiceInfo[] = []
  for (const [name, def] of Object.entries(pkg)) {
    if (!isService(def) || name.startsWith('grpc.reflection.')) continue
    services.push({
      name,
      methods: Object.entries(def).map(([methodName, m]) => {
        const reqName = fullName(pkg, m.requestType)
        return {
          name: methodName,
          requestType: reqName,
          responseType: fullName(pkg, m.responseType),
          clientStreaming: m.requestStream,
          serverStreaming: m.responseStream,
          sample: sampleMessage(root.lookupType(reqName))
        }
      })
    })
  }
  return services.sort((a, b) => a.name.localeCompare(b.name))
}

export async function describeProto(protoFiles: string[], includeDirs: string[] = []): Promise<GrpcServiceInfo[]> {
  return servicesOf(await fromFiles(protoFiles, includeDirs))
}

/** Address, credentials and metadata for a gRPC request — shared by calls and reflection. */
export interface GrpcConnection {
  address: string
  secure: boolean
  creds: grpc.ChannelCredentials
  metadata: grpc.Metadata
  prepared: PreparedRequest
}

export async function grpcConnection(input: RealtimeOpenInput): Promise<GrpcConnection> {
  const prepared = prepareRealtime(input)
  const { address, secure } = parseTarget(prepared.url)
  const metadata = new grpc.Metadata()
  for (const [k, v] of prepared.headers) if (!SKIP_METADATA.test(k)) metadata.add(k.toLowerCase(), v)
  let creds = grpc.credentials.createInsecure()
  if (secure) {
    const t = await tlsFor(new URL(`https://${address}`), input.network)
    const toBuf = (v: unknown): Buffer | null => (v === undefined ? null : Buffer.isBuffer(v) ? v : Buffer.from(Array.isArray(v) ? v.join('\n') : String(v)))
    creds = grpc.credentials.createSsl(toBuf(t.ca), toBuf(t.key), toBuf(t.cert), prepared.settings.verifySsl ? undefined : { checkServerIdentity: () => undefined })
  }
  return { address, secure, creds, metadata, prepared }
}

async function definitionsFor(input: RealtimeOpenInput, conn?: GrpcConnection): Promise<Definitions> {
  const cfg = input.request.grpc
  if (cfg?.source === 'reflection') {
    const set = await reflectFileDescriptorSet(conn ?? (await grpcConnection(input)))
    const root = (protobuf.Root as unknown as { fromDescriptor(b: Uint8Array): protobuf.Root }).fromDescriptor(set)
    root.resolveAll()
    return { pkg: protoLoader.loadFileDescriptorSetFromBuffer(Buffer.from(set), LOADER_OPTIONS), root }
  }
  return fromFiles(cfg?.protoFiles ?? [], cfg?.includeDirs ?? [])
}

/** Services for a request's gRPC config — from its .proto files or by asking the server. */
export async function describeGrpc(input: RealtimeOpenInput): Promise<GrpcServiceInfo[]> {
  return servicesOf(await definitionsFor(input))
}

/** proto-loader gives method types as definition objects; find the fully-qualified name. */
function fullName(pkg: PackageDefinition, def: protoLoader.MessageTypeDefinition<object, object>): string {
  const exact = Object.entries(pkg).find(([, v]) => v === def)?.[0]
  if (exact) return exact
  const short = (def.type as { name: string }).name
  return Object.keys(pkg).find((k) => k === short || k.endsWith(`.${short}`)) ?? short
}

function parseTarget(url: string): { address: string; secure: boolean } {
  const m = /^(grpcs?|https?):\/\/([^/?#]+)/i.exec(url)
  if (!m) return { address: url.replace(/\/+$/, ''), secure: false }
  const secure = /^(grpcs|https)$/i.test(m[1])
  const host = m[2]
  return { address: host.includes(':') ? host : `${host}:${secure ? 443 : 80}`, secure }
}

const SKIP_METADATA = /^(content-type|user-agent|accept|accept-encoding|host|content-length|te|connection)$/i

export async function openGrpc(input: RealtimeOpenInput, emit: Emit): Promise<RealtimeSession> {
  const cfg = input.request.grpc
  if (!cfg?.service || !cfg.method) throw new Error('Choose a service and method')
  const conn = await grpcConnection(input)
  const { address, secure, creds, metadata, prepared } = conn
  const { pkg } = await definitionsFor(input, conn)
  const svcDef = pkg[cfg.service]
  if (!isService(svcDef) || !svcDef[cfg.method]) {
    throw new Error(`${cfg.service}/${cfg.method} is not in the ${cfg.source === 'reflection' ? "server's reflection data" : 'loaded proto files'}`)
  }
  const method = svcDef[cfg.method]

  const Client = grpc.makeGenericClientConstructor({ [cfg.method]: method } as grpc.ServiceDefinition, cfg.service)
  const client = new Client(address, creds, { 'grpc.max_receive_message_length': 50 * 1024 * 1024 })
  const kind = method.requestStream ? (method.responseStream ? 'bidi' : 'client') : method.responseStream ? 'server' : 'unary'

  emit({ kind: 'connecting', data: `${secure ? 'grpcs' : 'grpc'}://${address}/${cfg.service}/${cfg.method} (${kind === 'unary' ? 'unary' : `${kind} streaming`})`, meta: metadataText(metadata) })

  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text || '{}')
    } catch (e) {
      throw new Error(`Message is not valid JSON: ${(e as Error).message}`)
    }
  }
  const show = (msg: unknown): string => JSON.stringify(msg, null, 2)
  let closed = false
  const finish = (status: grpc.StatusObject): void => {
    if (closed) return
    closed = true
    const name = grpc.status[status.code] ?? String(status.code)
    if (status.code !== grpc.status.OK) emit({ kind: 'error', data: `${name}: ${status.details}`, meta: metadataText(status.metadata) })
    emit({ kind: 'close', data: 'Call finished', meta: `Status ${status.code} ${name}` })
    client.close()
  }

  // Generic client methods are typed loosely; the four call shapes below are grpc-js's own.
  const fn = (client as unknown as Record<string, (...args: unknown[]) => grpc.ClientUnaryCall & grpc.ClientDuplexStream<unknown, unknown>>)[cfg.method].bind(client)
  const deadline = Date.now() + prepared.settings.timeoutMs
  const onResult = (err: grpc.ServiceError | null, res?: unknown): void => {
    if (!err) emit({ kind: 'message', data: show(res) })
  }

  let call: grpc.ClientUnaryCall & grpc.ClientDuplexStream<unknown, unknown>
  if (kind === 'unary' || kind === 'server') {
    const first = parse(input.request.message ?? '')
    emit({ kind: 'sent', data: show(first) })
    call = kind === 'unary' ? fn(first, metadata, { deadline }, onResult) : fn(first, metadata)
  } else {
    call = kind === 'client' ? fn(metadata, onResult) : fn(metadata)
    emit({ kind: 'open', data: 'Stream open — send messages, then End stream' })
  }
  call.on('metadata', (md: grpc.Metadata) => emit({ kind: 'info', data: 'Response headers', meta: metadataText(md) }))
  if (kind === 'server' || kind === 'bidi') call.on('data', (msg: unknown) => emit({ kind: 'message', data: show(msg) }))
  call.on('status', finish)
  call.on('error', () => {
    /* reported via 'status' */
  })

  return {
    send(text) {
      if (kind === 'unary' || kind === 'server') return emit({ kind: 'error', data: 'This method takes a single request message; reconnect to send another' })
      try {
        const msg = parse(text)
        call.write(msg)
        emit({ kind: 'sent', data: show(msg) })
      } catch (e) {
        emit({ kind: 'error', data: (e as Error).message })
      }
    },
    end() {
      if (kind === 'client' || kind === 'bidi') {
        call.end()
        emit({ kind: 'info', data: 'Client stream ended' })
      }
    },
    close() {
      call.cancel()
    }
  }
}

function metadataText(md?: grpc.Metadata): string | undefined {
  if (!md) return undefined
  const entries = Object.entries(md.getMap())
  return entries.length ? entries.map(([k, v]) => `${k}: ${Buffer.isBuffer(v) ? v.toString('base64') : v}`).join('\n') : undefined
}
