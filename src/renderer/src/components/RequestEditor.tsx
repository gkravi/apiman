import { useState } from 'react'
import { newKeyValue, uid } from '@core/factory'
import { parseCurl } from '@core/curl'
import { paramsFromUrl, urlWithParams } from '@core/url'
import { resolve, unresolvedVariables } from '@core/variables'
import { effectiveAuth } from '@core/prepare'
import { locate, parentAuths } from '@core/tree'
import { HTTP_METHODS, type Auth, type AuthType, type BodyMode, type FormField, type HttpMethod, type RawLanguage, type RequestBody } from '@core/types'
import { scopesFor, useStore, type Tab } from '../store'
import { KeyValueTable } from './KeyValueTable'
import { CodeEditor } from './CodeEditor'

type Section = 'params' | 'auth' | 'headers' | 'body' | 'settings'

export function RequestEditor({ tab }: { tab: Tab }): React.JSX.Element {
  const s = useStore()
  const [section, setSection] = useState<Section>('params')
  const r = tab.draft
  const update = (patch: Parameters<typeof s.updateDraft>[1]): void => s.updateDraft(tab.id, patch)

  const scopes = scopesFor(s.workspace, tab.itemId)
  const unresolved = [...new Set(unresolvedVariables(r.url, scopes))]
  const loc = tab.itemId ? locate(s.workspace.collections, tab.itemId) : undefined
  const breadcrumb = loc ? [loc.collection.name, ...loc.folders.map((f) => f.name).reverse()] : []

  const onUrl = (url: string): void => update({ url, params: paramsFromUrl(url, r.params) })

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text')
    if (!/^\s*curl\s/.test(text)) return
    e.preventDefault()
    try {
      const parsed = parseCurl(text)
      update({ ...parsed, id: r.id, name: r.name === 'New Request' ? parsed.name : r.name })
      s.showToast('Imported cURL command')
    } catch (err) {
      s.showToast((err as Error).message)
    }
  }

  const count = (n: number): string => (n ? ` (${n})` : '')
  const sections: { id: Section; label: string }[] = [
    { id: 'params', label: `Params${count(r.params.filter((p) => p.enabled).length)}` },
    { id: 'auth', label: 'Authorization' },
    { id: 'headers', label: `Headers${count(r.headers.filter((h) => h.enabled).length)}` },
    { id: 'body', label: 'Body' },
    { id: 'settings', label: 'Settings' }
  ]

  return (
    <div className="request-editor">
      <div className="request-header">
        <div className="breadcrumb">
          {breadcrumb.map((b, i) => (
            <span key={i} className="crumb">
              {b} /
            </span>
          ))}
          <span
            className="request-name"
            title="Click to rename"
            onClick={() =>
              s.openModal({
                kind: 'prompt',
                title: 'Rename request',
                initial: r.name,
                onSubmit: (name) => (tab.itemId ? s.renameItem(tab.itemId, name) : update({ name }))
              })
            }
          >
            {r.name}
          </span>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={() => s.openModal({ kind: 'code', tabId: tab.id })} title="Generate code snippet">
            {'</>'} Code
          </button>
          <button className="btn" onClick={() => s.saveTab(tab.id)} title="Save (⌘S)">
            Save
          </button>
        </div>
      </div>

      <div className="url-bar">
        <select className={`method-select m-${r.method.toLowerCase()}`} value={r.method} onChange={(e) => update({ method: e.target.value as HttpMethod })}>
          {HTTP_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="url-input"
          placeholder="Enter URL or paste a cURL command"
          value={r.url}
          spellCheck={false}
          onChange={(e) => onUrl(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => e.key === 'Enter' && void s.send(tab.id)}
          title={r.url.includes('{{') ? `Resolved: ${resolve(r.url, scopes)}` : undefined}
        />
        {tab.loading ? (
          <button className="btn danger send" onClick={() => s.cancel(tab.id)}>
            Cancel
          </button>
        ) : (
          <button className="btn primary send" onClick={() => void s.send(tab.id)} disabled={!r.url.trim()}>
            Send
          </button>
        )}
      </div>
      {unresolved.length > 0 && (
        <div className="warn-line">
          Unresolved variable{unresolved.length > 1 ? 's' : ''}: {unresolved.map((v) => `{{${v}}}`).join(', ')}
          {!s.workspace.activeEnvironmentId && ' — no environment is selected'}
        </div>
      )}

      <div className="subtabs">
        {sections.map((sec) => (
          <button key={sec.id} className={`subtab ${section === sec.id ? 'active' : ''}`} onClick={() => setSection(sec.id)}>
            {sec.label}
            {sec.id === 'body' && r.body.mode !== 'none' && <span className="dot" />}
            {sec.id === 'auth' && r.auth.type !== 'inherit' && r.auth.type !== 'none' && <span className="dot" />}
          </button>
        ))}
      </div>

      <div className="section-body">
        {section === 'params' && (
          <>
            <div className="section-title">Query Params</div>
            <KeyValueTable rows={r.params} onChange={(params) => update({ params, url: urlWithParams(r.url, params) })} />
          </>
        )}
        {section === 'headers' && (
          <>
            <div className="section-title">Headers</div>
            <KeyValueTable rows={r.headers} onChange={(headers) => update({ headers })} keyPlaceholder="Header" />
            <div className="hint">Content-Type, User-Agent, Accept and Accept-Encoding are added automatically when not set.</div>
          </>
        )}
        {section === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => update({ auth })} inherited={loc ? effectiveAuth({ type: 'inherit' }, parentAuths(loc)) : undefined} />}
        {section === 'body' && <BodyEditor body={r.body} onChange={(body) => update({ body })} />}
        {section === 'settings' && (
          <div className="settings-grid">
            <label className="check">
              <input type="checkbox" checked={r.settings.followRedirects} onChange={(e) => update({ settings: { ...r.settings, followRedirects: e.target.checked } })} />
              Automatically follow redirects
            </label>
            <label className="field">
              Max redirects
              <input type="number" min={0} max={50} value={r.settings.maxRedirects} onChange={(e) => update({ settings: { ...r.settings, maxRedirects: Number(e.target.value) } })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={r.settings.verifySsl} onChange={(e) => update({ settings: { ...r.settings, verifySsl: e.target.checked } })} />
              Verify SSL certificates
            </label>
            <label className="field">
              Timeout (ms)
              <input type="number" min={0} step={1000} value={r.settings.timeoutMs} onChange={(e) => update({ settings: { ...r.settings, timeoutMs: Number(e.target.value) } })} />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

const AUTH_LABELS: Record<AuthType, string> = {
  inherit: 'Inherit auth from parent',
  none: 'No Auth',
  basic: 'Basic Auth',
  bearer: 'Bearer Token',
  apikey: 'API Key'
}

export function AuthEditor({ auth, onChange, inherited, allowInherit = true }: { auth: Auth; onChange(a: Auth): void; inherited?: Auth; allowInherit?: boolean }): React.JSX.Element {
  const setType = (type: AuthType): void => {
    switch (type) {
      case 'inherit':
      case 'none':
        return onChange({ type })
      case 'basic':
        return onChange({ type, username: '', password: '' })
      case 'bearer':
        return onChange({ type, token: '' })
      case 'apikey':
        return onChange({ type, key: '', value: '', in: 'header' })
    }
  }
  return (
    <div className="auth-editor">
      <label className="field">
        Type
        <select value={auth.type} onChange={(e) => setType(e.target.value as AuthType)}>
          {(Object.keys(AUTH_LABELS) as AuthType[])
            .filter((t) => allowInherit || t !== 'inherit')
            .map((t) => (
              <option key={t} value={t}>
                {AUTH_LABELS[t]}
              </option>
            ))}
        </select>
      </label>
      <div className="auth-fields">
        {auth.type === 'inherit' && (
          <p className="hint">
            This request uses the auth of its parent folder or collection
            {inherited ? <> — currently <b>{AUTH_LABELS[inherited.type]}</b>.</> : '. Save it to a collection to inherit auth.'}
          </p>
        )}
        {auth.type === 'none' && <p className="hint">This request does not use any authorization.</p>}
        {auth.type === 'basic' && (
          <>
            <label className="field">
              Username
              <input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
            </label>
            <label className="field">
              Password
              <input type="password" value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
            </label>
          </>
        )}
        {auth.type === 'bearer' && (
          <label className="field">
            Token
            <input value={auth.token} placeholder="{{token}}" onChange={(e) => onChange({ ...auth, token: e.target.value })} />
          </label>
        )}
        {auth.type === 'apikey' && (
          <>
            <label className="field">
              Key
              <input value={auth.key} placeholder="X-API-Key" onChange={(e) => onChange({ ...auth, key: e.target.value })} />
            </label>
            <label className="field">
              Value
              <input value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} />
            </label>
            <label className="field">
              Add to
              <select value={auth.in} onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}>
                <option value="header">Header</option>
                <option value="query">Query Params</option>
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  )
}

const BODY_MODES: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'raw' },
  { id: 'binary', label: 'binary' },
  { id: 'graphql', label: 'GraphQL' }
]

const RAW_LANGS: { id: RawLanguage; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Text' },
  { id: 'xml', label: 'XML' },
  { id: 'html', label: 'HTML' },
  { id: 'javascript', label: 'JavaScript' }
]

function BodyEditor({ body, onChange }: { body: RequestBody; onChange(b: RequestBody): void }): React.JSX.Element {
  const setMode = (mode: BodyMode): void => {
    if (mode === body.mode) return
    switch (mode) {
      case 'none':
        return onChange({ mode })
      case 'raw':
        return onChange({ mode, raw: '', language: 'json' })
      case 'urlencoded':
        return onChange({ mode, urlencoded: [] })
      case 'formdata':
        return onChange({ mode, formdata: [] })
      case 'binary':
        return onChange({ mode, filePath: '' })
      case 'graphql':
        return onChange({ mode, query: '', variables: '' })
    }
  }

  const beautify = (): void => {
    if (body.mode !== 'raw' || body.language !== 'json') return
    try {
      onChange({ ...body, raw: JSON.stringify(JSON.parse(body.raw), null, 2) })
    } catch {
      /* not valid JSON yet — leave it */
    }
  }

  return (
    <div className="body-editor">
      <div className="body-modes">
        {BODY_MODES.map((m) => (
          <label key={m.id} className="radio">
            <input type="radio" checked={body.mode === m.id} onChange={() => setMode(m.id)} />
            {m.label}
          </label>
        ))}
        {body.mode === 'raw' && (
          <>
            <select className="lang-select" value={body.language} onChange={(e) => onChange({ ...body, language: e.target.value as RawLanguage })}>
              {RAW_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            {body.language === 'json' && (
              <button className="btn small ghost" onClick={beautify}>
                Beautify
              </button>
            )}
          </>
        )}
      </div>

      {body.mode === 'none' && <div className="empty-hint">This request does not have a body.</div>}
      {body.mode === 'raw' && (
        <div className="editor-box">
          <CodeEditor value={body.raw} onChange={(raw) => onChange({ ...body, raw })} language={body.language} />
        </div>
      )}
      {body.mode === 'urlencoded' && <KeyValueTable rows={body.urlencoded} onChange={(urlencoded) => onChange({ ...body, urlencoded })} />}
      {body.mode === 'formdata' && (
        <KeyValueTable<FormField>
          rows={body.formdata}
          onChange={(formdata) => onChange({ ...body, formdata })}
          make={() => ({ ...newKeyValue(), id: uid(), type: 'text' })}
          renderExtra={(row, up) => (
            <select className="cell small" value={row.type} onChange={(e) => up({ type: e.target.value as 'text' | 'file' })}>
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}
          renderValue={(row, up) =>
            row.type === 'file' ? (
              <FilePicker path={row.filePath} onPick={(filePath) => up({ filePath })} />
            ) : (
              <input className="cell" placeholder="Value" value={row.value} onChange={(e) => up({ value: e.target.value })} />
            )
          }
        />
      )}
      {body.mode === 'binary' && <FilePicker path={body.filePath} onPick={(filePath) => onChange({ ...body, filePath })} />}
      {body.mode === 'graphql' && (
        <div className="graphql">
          <div className="graphql-pane">
            <div className="section-title">Query</div>
            <div className="editor-box">
              <CodeEditor value={body.query} onChange={(query) => onChange({ ...body, query })} placeholder="query { … }" />
            </div>
          </div>
          <div className="graphql-pane">
            <div className="section-title">GraphQL Variables</div>
            <div className="editor-box">
              <CodeEditor value={body.variables} onChange={(variables) => onChange({ ...body, variables })} language="json" placeholder="{ }" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilePicker({ path, onPick }: { path?: string; onPick(p: string): void }): React.JSX.Element {
  return (
    <div className="file-picker">
      <button
        className="btn small"
        onClick={async () => {
          const p = await window.api.pickFile()
          if (p) onPick(p)
        }}
      >
        Select file
      </button>
      <span className="muted small file-path" title={path}>
        {path ? path.split(/[\\/]/).pop() : 'No file selected'}
      </span>
    </div>
  )
}
