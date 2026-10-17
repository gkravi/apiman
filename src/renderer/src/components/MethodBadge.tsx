import type { HttpMethod, Protocol } from '@core/types'

const SHORT: Partial<Record<HttpMethod, string>> = { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' }
const PROTOCOL_LABEL: Partial<Record<Protocol, string>> = { websocket: 'WS', sse: 'SSE', grpc: 'gRPC' }

export function MethodBadge({ method, protocol }: { method: HttpMethod; protocol?: Protocol }): React.JSX.Element {
  const p = protocol && PROTOCOL_LABEL[protocol]
  if (p) return <span className={`method proto-${protocol}`}>{p}</span>
  return <span className={`method m-${method.toLowerCase()}`}>{SHORT[method] ?? method}</span>
}
