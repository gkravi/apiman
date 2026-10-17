// Node-only: OAuth 2.0 token endpoint calls (client credentials, password, authorization code
// with PKCE, refresh). The interactive browser step of the authorization-code grant lives in the
// Electron main process; everything else is here so the CLI can reuse it.

import { createHash, randomBytes } from 'node:crypto'
import { execute, type ExecuteOptions } from './executor'
import { DEFAULT_SETTINGS, type OAuth2Config, type OAuth2TokenResult } from './types'

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export const randomState = (): string => b64url(randomBytes(16))

export function authorizeUrl(cfg: OAuth2Config, state: string, codeChallenge?: string): string {
  const u = new URL(cfg.authUrl)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  if (cfg.scope) u.searchParams.set('scope', cfg.scope)
  u.searchParams.set('state', state)
  if (codeChallenge) {
    u.searchParams.set('code_challenge', codeChallenge)
    u.searchParams.set('code_challenge_method', 'S256')
  }
  return u.toString()
}

async function tokenRequest(cfg: OAuth2Config, params: Record<string, string>, opts: ExecuteOptions = {}): Promise<OAuth2TokenResult> {
  if (!cfg.accessTokenUrl) throw new Error('Access token URL is required')
  const form = new URLSearchParams(params)
  const headers: [string, string][] = [
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Accept', 'application/json']
  ]
  if (cfg.clientAuth === 'header' && cfg.clientId) {
    // RFC 6749 §2.3.1: form-encode the credentials before Basic-encoding them.
    const enc = (s: string): string => encodeURIComponent(s).replace(/%20/g, '+')
    headers.push(['Authorization', `Basic ${Buffer.from(`${enc(cfg.clientId)}:${enc(cfg.clientSecret)}`).toString('base64')}`])
  } else {
    form.set('client_id', cfg.clientId)
    if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret)
  }

  const res = await execute(
    { method: 'POST', url: cfg.accessTokenUrl, headers, body: { kind: 'text', text: form.toString() }, settings: DEFAULT_SETTINGS },
    undefined,
    opts
  )
  if (!res.ok) throw new Error(`Token request failed: ${res.error}`)
  const { status, body } = res.response
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(body)
  } catch {
    raw = Object.fromEntries(new URLSearchParams(body)) // some providers (e.g. GitHub) reply form-encoded
  }
  if (status >= 400 || raw.error) {
    const detail = [raw.error, raw.error_description].filter(Boolean).join(': ')
    throw new Error(`Token endpoint returned ${status}${detail ? ` — ${detail}` : ''}`)
  }
  if (typeof raw.access_token !== 'string') throw new Error('Token response has no access_token')
  const expiresIn = Number(raw.expires_in)
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : undefined,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
    raw
  }
}

const withScope = (cfg: OAuth2Config, p: Record<string, string>): Record<string, string> => (cfg.scope ? { ...p, scope: cfg.scope } : p)

export const clientCredentialsToken = (cfg: OAuth2Config, opts?: ExecuteOptions): Promise<OAuth2TokenResult> =>
  tokenRequest(cfg, withScope(cfg, { grant_type: 'client_credentials' }), opts)

export const passwordToken = (cfg: OAuth2Config, opts?: ExecuteOptions): Promise<OAuth2TokenResult> =>
  tokenRequest(cfg, withScope(cfg, { grant_type: 'password', username: cfg.username, password: cfg.password }), opts)

export const exchangeCode = (cfg: OAuth2Config, code: string, verifier?: string, opts?: ExecuteOptions): Promise<OAuth2TokenResult> =>
  tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, ...(verifier ? { code_verifier: verifier } : {}) }, opts)

export function refreshToken(cfg: OAuth2Config, opts?: ExecuteOptions): Promise<OAuth2TokenResult> {
  if (!cfg.refreshToken) return Promise.reject(new Error('No refresh token stored'))
  // No scope: RFC 6749 §6 keeps the originally granted scope, and re-sending a wider configured
  // scope makes strict servers reject the refresh with invalid_scope.
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refreshToken }, opts).then((t) => ({
    ...t,
    refreshToken: t.refreshToken ?? cfg.refreshToken // many servers don't rotate refresh tokens
  }))
}

/** Parse the redirect the provider sent the browser to; returns null if it isn't ours. */
export function parseRedirect(cfg: OAuth2Config, url: string, expectedState: string): { code: string } | { error: string } | null {
  if (!url.startsWith(cfg.redirectUri.split('?')[0])) return null
  const u = new URL(url)
  const p = u.searchParams.size ? u.searchParams : new URLSearchParams(u.hash.slice(1))
  if (p.get('error')) return { error: [p.get('error'), p.get('error_description')].filter(Boolean).join(': ') }
  if (p.get('state') !== expectedState) return { error: 'State mismatch — possible CSRF; token request aborted' }
  const code = p.get('code')
  return code ? { code } : { error: 'Redirect had no authorization code' }
}
