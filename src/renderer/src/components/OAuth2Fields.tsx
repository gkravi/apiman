import { useState } from 'react'
import { resolve, type Scope } from '@core/variables'
import type { OAuth2Config, OAuth2Grant } from '@core/types'
import { useStore } from '../store'

const GRANTS: { id: OAuth2Grant; label: string }[] = [
  { id: 'authorization_code', label: 'Authorization Code' },
  { id: 'client_credentials', label: 'Client Credentials' },
  { id: 'password', label: 'Password Credentials' }
]

/** Resolve {{variables}} in every string field before talking to the token endpoint. */
function resolved(cfg: OAuth2Config, scopes: Scope[]): OAuth2Config {
  const out = { ...cfg }
  for (const k of Object.keys(out) as (keyof OAuth2Config)[]) {
    const v = out[k]
    if (typeof v === 'string' && k !== 'accessToken' && k !== 'refreshToken') (out as Record<string, unknown>)[k] = resolve(v, scopes)
  }
  return out
}

function expiry(expiresAt?: number): string {
  if (!expiresAt) return 'no expiry given'
  const s = Math.round((expiresAt - Date.now()) / 1000)
  if (s <= 0) return 'expired'
  return s > 3600 ? `expires in ${Math.round(s / 3600)} h` : s > 60 ? `expires in ${Math.round(s / 60)} min` : `expires in ${s} s`
}

export function OAuth2Fields({ cfg, onChange, scopes }: { cfg: OAuth2Config; onChange(c: OAuth2Config): void; scopes: Scope[] }): React.JSX.Element {
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof OAuth2Config>(k: K, v: OAuth2Config[K]): void => onChange({ ...cfg, [k]: v })
  const text = (k: keyof OAuth2Config, label: string, placeholder = '', type = 'text'): React.JSX.Element => (
    <label className="field">
      {label}
      <input type={type} value={String(cfg[k] ?? '')} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  )

  const fetchToken = async (kind: 'new' | 'refresh'): Promise<void> => {
    setBusy(true)
    setError('')
    const ws = s.workspace
    const ctx = { cookies: ws.cookies ?? [], network: ws.settings }
    const r = kind === 'new' ? await window.api.oauth2Token(resolved(cfg, scopes), ctx) : await window.api.oauth2Refresh(resolved(cfg, scopes), ctx)
    s.setCookies(r.cookies)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onChange({ ...cfg, accessToken: r.token.accessToken, refreshToken: r.token.refreshToken, expiresAt: r.token.expiresAt })
    s.showToast('Access token saved')
  }

  const expired = cfg.expiresAt !== undefined && cfg.expiresAt < Date.now()
  return (
    <div className="oauth2">
      <div className="token-box">
        <label className="field">
          Access token
          <input className="mono" value={cfg.accessToken} placeholder="Get a new token below, or paste one" onChange={(e) => set('accessToken', e.target.value)} />
        </label>
        {cfg.accessToken && (
          <div className={`small ${expired ? 'warn-text' : 'muted'}`}>
            {expiry(cfg.expiresAt)}
            {cfg.refreshToken ? ' · refresh token stored' : ''}
          </div>
        )}
        <label className="field narrow">
          Header prefix
          <input value={cfg.headerPrefix} onChange={(e) => set('headerPrefix', e.target.value)} />
        </label>
      </div>

      <div className="section-title">Configure new token</div>
      <label className="field">
        Grant type
        <select value={cfg.grantType} onChange={(e) => set('grantType', e.target.value as OAuth2Grant)}>
          {GRANTS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      {cfg.grantType === 'authorization_code' && (
        <>
          {text('authUrl', 'Auth URL', 'https://example.com/oauth/authorize')}
          {text('redirectUri', 'Callback URL')}
          <label className="check small">
            <input type="checkbox" checked={cfg.usePkce} onChange={(e) => set('usePkce', e.target.checked)} />
            Use PKCE (S256)
          </label>
        </>
      )}
      {text('accessTokenUrl', 'Access Token URL', 'https://example.com/oauth/token')}
      {text('clientId', 'Client ID')}
      {text('clientSecret', 'Client Secret', '', 'password')}
      {cfg.grantType === 'password' && (
        <>
          {text('username', 'Username')}
          {text('password', 'Password', '', 'password')}
        </>
      )}
      {text('scope', 'Scope', 'e.g. read write')}
      <label className="field">
        Client authentication
        <select value={cfg.clientAuth} onChange={(e) => set('clientAuth', e.target.value as 'header' | 'body')}>
          <option value="header">Send as Basic Auth header</option>
          <option value="body">Send client credentials in body</option>
        </select>
      </label>
      <div className="row-actions">
        <button className="btn primary" disabled={busy} onClick={() => void fetchToken('new')}>
          {busy ? 'Waiting…' : 'Get New Access Token'}
        </button>
        {cfg.refreshToken && (
          <button className="btn" disabled={busy} onClick={() => void fetchToken('refresh')}>
            Refresh token
          </button>
        )}
        {cfg.accessToken && (
          <button className="btn ghost" onClick={() => onChange({ ...cfg, accessToken: '', refreshToken: undefined, expiresAt: undefined })}>
            Clear token
          </button>
        )}
      </div>
      {error && <div className="error-msg">{error}</div>}
    </div>
  )
}
