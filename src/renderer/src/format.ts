import type { GrpcConfig, GrpcMethodInfo, GrpcServiceInfo } from '@core/types'

// Small helpers shared by components. Kept out of component files so React Fast Refresh
// can hot-swap those files (a component module must only export components).

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** The method a gRPC request points at, once its proto files are loaded. */
export function grpcMethodOf(services: GrpcServiceInfo[] | undefined, cfg: GrpcConfig | undefined): GrpcMethodInfo | undefined {
  return services?.find((s) => s.name === cfg?.service)?.methods.find((m) => m.name === cfg?.method)
}
