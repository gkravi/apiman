import type { ManagedPolicy } from '@core/policy'

/** Marks a control an administrator's policy has locked. */
export function ManagedBadge({ title }: { title?: string }): React.JSX.Element {
  return (
    <span className="managed-badge" title={title ?? 'Set by your administrator. You can’t change this here.'}>
      Managed by your organisation
    </span>
  )
}

/** One line per policy in force, for the Settings summary. */
export function policySummary(p: ManagedPolicy): string[] {
  const out: string[] = []
  if (p.disableScripts) out.push('Scripts are turned off')
  if (p.disableSendRequest) out.push('pm.sendRequest is turned off')
  if (p.allowedHosts) out.push(p.allowedHosts.length ? `Requests only to: ${p.allowedHosts.join(', ')}` : 'No destination hosts are allowed')
  if (p.blockedHosts?.length) out.push(`Requests never to: ${p.blockedHosts.join(', ')}`)
  if (p.forbidInsecureTls) out.push('TLS certificates are always verified')
  if (p.enforcedProxy) out.push(`All requests go through ${p.enforcedProxy.url}`)
  if (p.enforcedCaPath) out.push(`Organisation CA bundle: ${p.enforcedCaPath}`)
  if (p.disableMockServers) out.push('Mock servers are turned off')
  if (p.historyRetentionDays !== undefined) out.push(p.historyRetentionDays === 0 ? 'History is not kept' : `History is kept for ${p.historyRetentionDays} days`)
  return out
}
