import { useEffect, useState } from 'react'
import { uid } from '@core/factory'
import { CookieJar, formatCookie, type Cookie } from '@core/cookies'
import { DEFAULT_NETWORK, type ClientCertificate } from '@core/types'
import { useStore } from '../store'
import { ManagedBadge, policySummary } from './Managed'

function Frame({ title, close, children }: { title: string; close(): void; children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export function CookiesModal({ initialDomain, close }: { initialDomain?: string; close(): void }): React.JSX.Element {
  const s = useStore()
  const cookies = (s.workspace.cookies ?? []).filter((c) => c.expires === undefined || c.expires > Date.now())
  const domains = [...new Set(cookies.map((c) => c.domain))].sort()
  const [domain, setDomain] = useState(initialDomain && domains.includes(initialDomain) ? initialDomain : (domains[0] ?? ''))
  const [draft, setDraft] = useState({ domain: '', raw: '' })
  const [error, setError] = useState('')
  const shown = cookies.filter((c) => c.domain === domain)

  const remove = (c?: Cookie): void =>
    s.setCookies(cookies.filter((x) => (c ? !(x.domain === c.domain && x.name === c.name && x.path === c.path) : x.domain !== domain)))

  const add = (): void => {
    setError('')
    const host = draft.domain.trim().replace(/^https?:\/\//, '').split('/')[0]
    if (!host || !draft.raw.includes('=')) return setError('Enter a domain and a cookie like name=value; Path=/')
    // Reuse the real Set-Cookie parser so manual cookies behave exactly like server-set ones.
    const jar = new CookieJar(cookies)
    jar.setFromHeaders([draft.raw], new URL(`https://${host}/`))
    s.setCookies(jar.toJSON())
    setDomain(host.toLowerCase())
    setDraft({ domain: host, raw: '' })
  }

  return (
    <Frame title="Cookies" close={close}>
      <p className="hint">Cookies set by responses are saved here and sent automatically to matching requests and in collection runs.</p>
      <div className="cookie-layout">
        <div className="cookie-domains">
          {domains.length === 0 && <div className="muted small">No cookies yet.</div>}
          {domains.map((d) => (
            <button key={d} className={`domain-btn ${d === domain ? 'active' : ''}`} onClick={() => setDomain(d)}>
              <span className="tree-label">{d}</span>
              <span className="muted small">{cookies.filter((c) => c.domain === d).length}</span>
            </button>
          ))}
        </div>
        <div className="cookie-list">
          {shown.map((c) => (
            <div key={`${c.name}|${c.path}`} className="cookie-row">
              <code className="cookie-text" title={formatCookie(c)}>
                {formatCookie(c)}
              </code>
              <button className="icon-btn" title="Delete cookie" onClick={() => remove(c)}>
                ✕
              </button>
            </div>
          ))}
          {domain && shown.length > 0 && (
            <button className="btn small ghost danger-text" onClick={() => remove()}>
              Clear all for {domain}
            </button>
          )}
        </div>
      </div>
      <div className="section-title">Add cookie</div>
      <div className="add-cookie">
        <input placeholder="Domain, e.g. api.example.com" value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} />
        <input className="mono grow" placeholder="name=value; Path=/; Secure" value={draft.raw} onChange={(e) => setDraft({ ...draft, raw: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add}>
          Add
        </button>
      </div>
      {error && <div className="error-msg">{error}</div>}
    </Frame>
  )
}

export function SettingsModal({ close }: { close(): void }): React.JSX.Element {
  const s = useStore()
  const policy = s.policy.policy
  const managed = policySummary(policy)
  const net = { ...DEFAULT_NETWORK, ...s.workspace.settings }
  // Enforced values are shown in place of the user's, read-only.
  const proxyLocked = !!policy.enforcedProxy
  const proxy = policy.enforcedProxy ? { enabled: true, ...policy.enforcedProxy } : net.proxy
  const caLocked = !!policy.enforcedCaPath
  const setCert = (id: string, patch: Partial<ClientCertificate>): void =>
    s.updateNetwork({ certificates: net.certificates.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const pick = async (fn: (path: string) => void): Promise<void> => {
    const p = await window.api.pickFile()
    if (p) fn(p)
  }
  const fileField = (label: string, value: string | undefined, onPick: (p: string | undefined) => void, locked = false): React.JSX.Element => (
    <div className="field">
      {label}
      <div className="file-picker">
        <button className="btn small" disabled={locked} onClick={() => void pick(onPick)}>
          Select file
        </button>
        <span className="muted small file-path" title={value}>
          {value ? value.split(/[\\/]/).pop() : 'None'}
        </span>
        {value && !locked && (
          <button className="icon-btn" title="Remove" onClick={() => onPick(undefined)}>
            ✕
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Frame title="Settings" close={close}>
      {managed.length > 0 && (
        <div className="managed-summary">
          <div className="section-title">
            Policies <ManagedBadge />
          </div>
          <ul>
            {managed.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="hint">Set by your administrator in {s.policy.sources.join(', ')}.</p>
        </div>
      )}

      <div className="section-title">Appearance</div>
      <div className="seg theme-seg">
        {(['system', 'light', 'dark'] as const).map((t) => (
          <button key={t} className={s.themePref === t ? 'active' : ''} onClick={() => s.setThemePref(t)}>
            {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>

      <div className="section-title">Proxy {proxyLocked && <ManagedBadge />}</div>
      <label className="check">
        <input type="checkbox" checked={proxy.enabled} disabled={proxyLocked} onChange={(e) => s.updateNetwork({ proxy: { ...proxy, enabled: e.target.checked } })} />
        Use a proxy for requests
      </label>
      <div className="settings-grid wide">
        <label className="field">
          Proxy URL
          <input placeholder="http://user:pass@proxy.local:8080" value={proxy.url} disabled={proxyLocked} onChange={(e) => s.updateNetwork({ proxy: { ...proxy, url: e.target.value } })} />
        </label>
        <label className="field">
          Bypass for hosts
          <input placeholder="localhost, 127.0.0.1, *.internal" value={proxy.bypass} disabled={proxyLocked} onChange={(e) => s.updateNetwork({ proxy: { ...proxy, bypass: e.target.value } })} />
        </label>
      </div>

      <div className="section-title">Certificates {caLocked && <ManagedBadge />}</div>
      {fileField('Extra CA certificates (PEM) — trusted in addition to system roots', policy.enforcedCaPath ?? net.caPath, (caPath) => s.updateNetwork({ caPath }), caLocked)}

      <div className="field">Client certificates</div>
      {net.certificates.map((c) => (
        <div key={c.id} className="cert-card">
          <div className="cert-head">
            <label className="field grow">
              Host
              <input placeholder="api.example.com or *.example.com:8443" value={c.host} onChange={(e) => setCert(c.id, { host: e.target.value })} />
            </label>
            <button className="icon-btn" title="Remove certificate" onClick={() => s.updateNetwork({ certificates: net.certificates.filter((x) => x.id !== c.id) })}>
              ✕
            </button>
          </div>
          <div className="settings-grid wide">
            {fileField('CRT file', c.certPath, (certPath) => setCert(c.id, { certPath }))}
            {fileField('KEY file', c.keyPath, (keyPath) => setCert(c.id, { keyPath }))}
            {fileField('PFX file (instead of CRT + KEY)', c.pfxPath, (pfxPath) => setCert(c.id, { pfxPath }))}
            <label className="field">
              Passphrase
              <input type="password" value={c.passphrase ?? ''} onChange={(e) => setCert(c.id, { passphrase: e.target.value })} />
            </label>
          </div>
        </div>
      ))}
      <button className="btn small" onClick={() => s.updateNetwork({ certificates: [...net.certificates, { id: uid(), host: '' }] })}>
        + Add certificate
      </button>
      <p className="hint">Certificate files are read when a request is sent; restart the app after replacing a file at the same path.</p>
    </Frame>
  )
}
