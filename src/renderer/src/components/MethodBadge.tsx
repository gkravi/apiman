import type { HttpMethod } from '@core/types'

const SHORT: Partial<Record<HttpMethod, string>> = { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' }

export function MethodBadge({ method }: { method: HttpMethod }): React.JSX.Element {
  return <span className={`method m-${method.toLowerCase()}`}>{SHORT[method] ?? method}</span>
}
