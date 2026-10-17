// Node-only: gRPC server reflection client (grpc.reflection.v1, falling back to v1alpha).
// Asks the server which services it has and downloads their file descriptors — plus every
// imported file — so calls work without local .proto files.

import * as grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import descriptor from 'protobufjs/ext/descriptor'
import type { GrpcConnection } from './grpc'

// The reflection protocol itself, identical in v1 and v1alpha apart from the package name.
const REFLECTION_PROTO = (pkg: string): string => `
syntax = "proto3";
package ${pkg};
service ServerReflection { rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse); }
message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    string list_services = 7;
  }
}
message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}
message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse { int32 error_code = 1; string error_message = 2; }
`

interface ReflectionResponse {
  fileDescriptorResponse?: { fileDescriptorProto: Uint8Array[] }
  listServicesResponse?: { service: { name: string }[] }
  errorResponse?: { errorCode: number; errorMessage: string }
}

interface FileProto {
  name: string
  dependency?: string[]
}

const TIMEOUT_MS = 10_000

/** One reflection conversation: send requests one at a time, read the matching response. */
async function converse(conn: GrpcConnection, pkg: string, work: (ask: (req: object) => Promise<ReflectionResponse>) => Promise<void>): Promise<void> {
  const root = protobuf.parse(REFLECTION_PROTO(pkg)).root
  const Req = root.lookupType(`${pkg}.ServerReflectionRequest`)
  const Res = root.lookupType(`${pkg}.ServerReflectionResponse`)
  const Client = grpc.makeGenericClientConstructor(
    {
      ServerReflectionInfo: {
        path: `/${pkg}.ServerReflection/ServerReflectionInfo`,
        requestStream: true,
        responseStream: true,
        requestSerialize: (v: object) => Buffer.from(Req.encode(Req.fromObject(v)).finish()),
        requestDeserialize: (b: Buffer) => Req.decode(b),
        responseSerialize: (v: object) => Buffer.from(Res.encode(Res.fromObject(v)).finish()),
        responseDeserialize: (b: Buffer) => Res.toObject(Res.decode(b), { defaults: false }) as ReflectionResponse
      }
    },
    'ServerReflection'
  )
  const client = new Client(conn.address, conn.creds)
  const call = (client as unknown as { ServerReflectionInfo(md: grpc.Metadata, opts: grpc.CallOptions): grpc.ClientDuplexStream<object, ReflectionResponse> }).ServerReflectionInfo(conn.metadata, {
    deadline: Date.now() + TIMEOUT_MS
  })

  const waiting: { resolve(r: ReflectionResponse): void; reject(e: Error): void }[] = []
  let failure: Error | undefined
  call.on('data', (r: ReflectionResponse) => waiting.shift()?.resolve(r))
  call.on('error', (e: grpc.ServiceError) => {
    failure = e
    for (const w of waiting.splice(0)) w.reject(e)
  })
  const ask = (req: object): Promise<ReflectionResponse> =>
    failure
      ? Promise.reject(failure)
      : new Promise((resolve, reject) => {
          waiting.push({ resolve, reject })
          call.write(req)
        })
  try {
    await work(ask)
  } finally {
    call.end()
    client.close()
  }
}

/** Download every file descriptor the server's services need, as a FileDescriptorSet. */
export async function reflectFileDescriptorSet(conn: GrpcConnection): Promise<Uint8Array> {
  const files = new Map<string, { proto: FileProto; bytes: Uint8Array }>()
  const collect = (r: ReflectionResponse): void => {
    if (r.errorResponse) throw new Error(`Reflection error ${r.errorResponse.errorCode}: ${r.errorResponse.errorMessage}`)
    for (const bytes of r.fileDescriptorResponse?.fileDescriptorProto ?? []) {
      const proto = descriptor.FileDescriptorProto.toObject(descriptor.FileDescriptorProto.decode(bytes)) as FileProto
      if (!files.has(proto.name)) files.set(proto.name, { proto, bytes })
    }
  }

  const attempt = (pkg: string): Promise<void> =>
    converse(conn, pkg, async (ask) => {
      const list = await ask({ listServices: '*' })
      if (list.errorResponse) throw new Error(`Reflection error: ${list.errorResponse.errorMessage}`)
      const services = (list.listServicesResponse?.service ?? []).map((s) => s.name).filter((n) => !n.startsWith('grpc.reflection.'))
      for (const name of services) collect(await ask({ fileContainingSymbol: name }))
      // Servers usually send imports along; fetch any that are still missing.
      for (let changed = true; changed; ) {
        changed = false
        for (const { proto } of [...files.values()]) {
          for (const dep of proto.dependency ?? []) {
            if (files.has(dep)) continue
            collect(await ask({ fileByFilename: dep }))
            changed = true
          }
        }
      }
    })

  try {
    await attempt('grpc.reflection.v1')
  } catch (e) {
    if ((e as grpc.ServiceError).code !== grpc.status.UNIMPLEMENTED) throw friendly(e)
    files.clear()
    try {
      await attempt('grpc.reflection.v1alpha')
    } catch (e2) {
      if ((e2 as grpc.ServiceError).code === grpc.status.UNIMPLEMENTED) throw new Error('This server does not support gRPC reflection — load its .proto files instead')
      throw friendly(e2)
    }
  }
  if (files.size === 0) throw new Error('The server reported no services')

  const set = descriptor.FileDescriptorSet.fromObject({ file: [...files.values()].map(({ bytes }) => descriptor.FileDescriptorProto.decode(bytes)) })
  return descriptor.FileDescriptorSet.encode(set).finish()
}

function friendly(e: unknown): Error {
  const err = e as grpc.ServiceError
  if (err?.code === grpc.status.UNAVAILABLE) return new Error(`Cannot reach the server: ${err.details}`)
  if (err?.code === grpc.status.DEADLINE_EXCEEDED) return new Error('Reflection timed out')
  return err instanceof Error ? err : new Error(String(e))
}
