// Node-only: HTTP Digest authentication (RFC 7616) — MD5, MD5-sess, SHA-256, qop=auth / auth-int.

import { createHash, randomBytes } from 'node:crypto'

export function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = header.replace(/^digest\s+/i, '')
  for (const m of body.matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/gi)) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1')
  }
  return out
}

let nonceCounter = 0

export function digestAuthorization(
  challenge: string,
  method: string,
  uri: string,
  username: string,
  password: string,
  body?: Buffer,
  cnonce = randomBytes(8).toString('hex')
): string {
  const c = parseChallenge(challenge)
  const algorithm = (c.algorithm ?? 'MD5').toUpperCase()
  const hashName = algorithm.startsWith('SHA-256') ? 'sha256' : 'md5'
  const h = (s: string | Buffer): string => createHash(hashName).update(s).digest('hex')

  const qops = (c.qop ?? '').split(',').map((q) => q.trim())
  const qop = qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : undefined
  const nc = (++nonceCounter).toString(16).padStart(8, '0')

  let ha1 = h(`${username}:${c.realm ?? ''}:${password}`)
  if (algorithm.endsWith('-SESS')) ha1 = h(`${ha1}:${c.nonce}:${cnonce}`)
  const ha2 = qop === 'auth-int' ? h(`${method}:${uri}:${h(body ?? Buffer.alloc(0))}`) : h(`${method}:${uri}`)
  const response = qop ? h(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : h(`${ha1}:${c.nonce}:${ha2}`)

  const parts = [`username="${username}"`, `realm="${c.realm ?? ''}"`, `nonce="${c.nonce ?? ''}"`, `uri="${uri}"`, `algorithm=${c.algorithm ?? 'MD5'}`, `response="${response}"`]
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  if (c.opaque !== undefined) parts.push(`opaque="${c.opaque}"`)
  return `Digest ${parts.join(', ')}`
}
