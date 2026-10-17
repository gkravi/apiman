import { useState } from 'react'
import { parse, print } from 'graphql'
import { newKeyValue, uid } from '@core/factory'
import { parseCurl } from '@core/curl'
import { normalizeUrl, paramsFromUrl, urlWithParams } from '@core/url'
import { resolve, unresolvedVariables, type Scope } from '@core/variables'
import { OAuth2Fields } from './OAuth2Fields'
import { effectiveAuth } from '@core/prepare'
import { locate, parentAuths } from '@core/tree'
import { DEFAULT_OAUTH2, HTTP_METHODS, type Protocol, type Auth, type AuthType, type BodyMode, type FormField, type HttpMethod, type RawLanguage, type RequestBody } from '@core/types'
import { scopesFor, useStore, type Tab } from '../store'
import { KeyValueTable } from './KeyValueTable'
import { CodeEditor } from './CodeEditor'
import { ScriptsEditor } from './ScriptsEditor'
import { GrpcServicePanel, MessageComposer } from './LiveEditors'
import { grpcMethodOf } from '../format'
import { ExamplesPanel } from './ExamplesPanel'
import { DocsEditor } from './DocsEditor'

type Section = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings' | 'message' | 'service' | 'examples' | 'docs'

const PROTOCOLS: { id: Protocol; label: string; placeholder: string }[] = [
  { id: 'http', label: 'HTTP', placeholder: 'Enter URL or paste a cURL command' },
  { id: 'websocket', label: 'WebSocket', placeholder: 'ws://localhost:8080/socket' },
  { id: 'sse', label: 'SSE', placeholder: 'https://example.com/events' },
  { id: 'grpc', label: 'gRPC', placeholder: 'grpc://localhost:50051  (grpcs:// for TLS)' }
]

/** Tabs shown per protocol; the first one is where a freshly opened request starts. */
const SECTION_ORDER: Record<Protocol, Section[]> = {
  http: ['params', 'auth', 'headers', 'body', 'scripts', 'settings', 'examples', 'docs'],
  websocket: ['message', 'params', 'headers', 'auth', 'settings', 'docs'],
  sse: ['params', 'headers', 'auth', 'body', 'settings', 'docs'],
  grpc: ['message', 'service', 'headers', 'auth', 'settings', 'docs']
}

export function RequestEditor({ tab }: { tab: Tab }): React.JSX.Element {
  const s = useStore()
  const [section, setSection] = useState<Section>(() => SECTION_ORDER[tab.draft.protocol ?? 'http'][0])
  const r = tab.draft
  const update = (patch: Parameters<typeof s.updateDraft>[1]): void => s.updateDraft(tab.id, patch)

  const scopes = scopesFor(s.workspace, tab.itemId)
  const unresolved = [...new Set(unresolvedVariables(r.url, scopes))]
  const loc = tab.itemId ? locate(s.workspace.collections, tab.itemId) : undefined
  const scriptChainHasPre = Boolean(loc && (loc.collection.scripts?.preRequest.trim() || loc.folders.some((f) => f.scripts?.preRequest.trim())))
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

  const protocol: Protocol = r.protocol ?? 'http'
  const isLive = protocol !== 'http'
  const live = tab.live
  const connected = live !== undefined && live.status !== 'closed'
  const grpcMethod = protocol === 'grpc' ? grpcMethodOf(s.grpc[tab.id]?.services, r.grpc) : undefined
  const singleCall = protocol === 'grpc' && grpcMethod !== undefined && !grpcMethod.clientStreaming

  const count = (n: number): string => (n ? ` (${n})` : '')
  const all: Record<Section, string> = {
    message: 'Message',
    service: `Service${r.grpc?.method ? '' : ' •'}`,
    params: `Params${count(r.params.filter((p) => p.enabled).length)}`,
    auth: 'Authorization',
    headers: `${protocol === 'grpc' ? 'Metadata' : 'Headers'}${count(r.headers.filter((h) => h.enabled).length)}`,
    body: 'Body',
    scripts: 'Scripts',
    settings: 'Settings',
    examples: `Examples${count(r.examples?.length ?? 0)}`,
    docs: 'Docs'
  }
  const order = SECTION_ORDER
  const sections = order[protocol].map((id) => ({ id, label: all[id] }))
  const current: Section = order[protocol].includes(section) ? section : order[protocol][0]

  const setProtocol = (p: Protocol): void => {
    const patch: Parameters<typeof s.updateDraft>[1] = { protocol: p }
    if (p === 'websocket') patch.url = r.url.replace(/^http(s?):\/\//i, 'ws$1://')
    if (p !== 'websocket') patch.url = r.url.replace(/^ws(s?):\/\//i, 'http$1://')
    if (p === 'grpc') {
      patch.grpc = r.grpc ?? { protoFiles: [], includeDirs: [], service: '', method: '' }
      if (!r.url.trim()) patch.url = 'grpc://localhost:50051'
    }
    if (live && live.status !== 'closed') s.disconnect(tab.id)
    update(patch)
    setSection(SECTION_ORDER[p][0])
  }
  const go = (): void => {
    if (!isLive) return void s.send(tab.id)
    if (connected && !singleCall) s.disconnect(tab.id)
    else void s.connect(tab.id)
  }

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
          <button
            className="btn ghost"
            onClick={() => {
              let domain: string | undefined
              try {
                domain = new URL(normalizeUrl(resolve(r.url, scopes))).hostname
              } catch {
                /* incomplete URL */
              }
              s.openModal({ kind: 'cookies', domain })
            }}
          >
            Cookies
          </button>
          <button className="btn ghost" onClick={() => s.openModal({ kind: 'code', tabId: tab.id })} title="Generate code snippet">
            {'</>'} Code
          </button>
          <button className="btn" onClick={() => s.saveTab(tab.id)} title="Save (⌘S)">
            Save
          </button>
        </div>
      </div>

      <div className="url-bar">
        <select className="protocol-select" value={protocol} onChange={(e) => setProtocol(e.target.value as Protocol)} title="Protocol">
          {PROTOCOLS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {(protocol === 'http' || protocol === 'sse') && (
          <select className={`method-select m-${r.method.toLowerCase()}`} value={r.method} onChange={(e) => update({ method: e.target.value as HttpMethod })}>
            {HTTP_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        )}
        <input
          className="url-input"
          placeholder={PROTOCOLS.find((p) => p.id === protocol)?.placeholder}
          value={r.url}
          spellCheck={false}
          onChange={(e) => onUrl(e.target.value)}
          onPaste={protocol === 'http' ? onPaste : undefined}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          title={r.url.includes('{{') ? `Resolved: ${resolve(r.url, scopes)}` : undefined}
        />
        {tab.loading ? (
          <button className="btn danger send" onClick={() => s.cancel(tab.id)}>
            Cancel
          </button>
        ) : isLive ? (
          <button className={`btn send ${connected && !singleCall ? 'danger' : 'primary'}`} onClick={go} disabled={!r.url.trim()}>
            {singleCall ? (live?.status === 'connecting' ? 'Calling…' : 'Invoke') : live?.status === 'connecting' ? 'Cancel' : connected ? 'Disconnect' : 'Connect'}
          </button>
        ) : (
          <button className="btn primary send" onClick={go} disabled={!r.url.trim()}>
            Send
          </button>
        )}
      </div>
      {unresolved.length > 0 && (
        <div className="warn-line">
          Unresolved variable{unresolved.length > 1 ? 's' : ''}: {unresolved.map((v) => `{{${v}}}`).join(', ')}
          {!s.workspace.activeEnvironmentId && ' — no environment is selected'}
          {(r.scripts?.preRequest.trim() || scriptChainHasPre) && ' (a pre-request script may set it)'}
        </div>
      )}

      <div className="subtabs">
        {sections.map((sec) => (
          <button key={sec.id} className={`subtab ${current === sec.id ? 'active' : ''}`} onClick={() => setSection(sec.id)}>
            {sec.label}
            {sec.id === 'body' && r.body.mode !== 'none' && <span className="dot" />}
            {sec.id === 'auth' && r.auth.type !== 'inherit' && r.auth.type !== 'none' && <span className="dot" />}
            {sec.id === 'scripts' && (r.scripts?.preRequest.trim() || r.scripts?.test.trim()) && <span className="dot" />}
            {sec.id === 'docs' && r.description?.trim() && <span className="dot" />}
          </button>
        ))}
      </div>

      <div className="section-body">
        {current === 'message' && <MessageComposer tab={tab} method={grpcMethod} />}
        {current === 'service' && <GrpcServicePanel tab={tab} />}
        {current === 'examples' && <ExamplesPanel tab={tab} />}
        {current === 'docs' && <DocsEditor key={tab.id} value={r.description} onChange={(description) => update({ description })} placeholder="Describe what this request does, its parameters and responses…" />}
        {current === 'params' && (
          <>
            <div className="section-title">Query Params</div>
            <KeyValueTable rows={r.params} onChange={(params) => update({ params, url: urlWithParams(r.url, params) })} />
          </>
        )}
        {current === 'headers' && (
          <>
            <div className="section-title">Headers</div>
            <KeyValueTable rows={r.headers} onChange={(headers) => update({ headers })} keyPlaceholder="Header" />
            <div className="hint">
              {protocol === 'grpc'
                ? 'Sent as gRPC metadata (keys are lower-cased). Authorization from the Auth tab is included.'
                : protocol === 'websocket'
                  ? 'Sent with the WebSocket handshake.'
                  : 'Content-Type, User-Agent, Accept and Accept-Encoding are added automatically when not set.'}
            </div>
          </>
        )}
        {current === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => update({ auth })} inherited={loc ? effectiveAuth({ type: 'inherit' }, parentAuths(loc)) : undefined} scopes={scopes} />}
        {current === 'body' && <BodyEditor body={r.body} onChange={(body) => update({ body })} tabId={tab.id} />}
        {current === 'scripts' && <ScriptsEditor scripts={r.scripts} onChange={(scripts) => update({ scripts })} scopeLabel="request" />}
        {current === 'settings' && (
          <div className="settings-grid">
            {protocol === 'websocket' && (
              <label className="field">
                Sub-protocols (comma-separated)
                <input placeholder="e.g. graphql-ws, chat" value={r.subprotocols ?? ''} onChange={(e) => update({ subprotocols: e.target.value })} />
              </label>
            )}
            {protocol !== 'grpc' && <label className="check">
              <input type="checkbox" checked={r.settings.followRedirects} onChange={(e) => update({ settings: { ...r.settings, followRedirects: e.target.checked } })} />
              Automatically follow redirects
            </label>}
            {protocol !== 'grpc' && (
              <label className="field">
                Max redirects
                <input type="number" min={0} max={50} value={r.settings.maxRedirects} onChange={(e) => update({ settings: { ...r.settings, maxRedirects: Number(e.target.value) } })} />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={r.settings.verifySsl} onChange={(e) => update({ settings: { ...r.settings, verifySsl: e.target.checked } })} />
              Verify SSL certificates
            </label>
            <label className="field">
              {isLive ? (protocol === 'grpc' ? 'Deadline for unary calls (ms)' : 'Connect timeout (ms)') : 'Timeout (ms)'}
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
  apikey: 'API Key',
  digest: 'Digest Auth',
  awsv4: 'AWS Signature',
  oauth2: 'OAuth 2.0'
}

export function AuthEditor({
  auth,
  onChange,
  inherited,
  allowInherit = true,
  scopes
}: {
  auth: Auth
  onChange(a: Auth): void
  inherited?: Auth
  allowInherit?: boolean
  /** Variables used to resolve OAuth 2.0 settings; defaults to environment + globals. */
  scopes?: Scope[]
}): React.JSX.Element {
  const ws = useStore((st) => st.workspace)
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
      case 'digest':
        return onChange({ type, username: '', password: '' })
      case 'awsv4':
        return onChange({ type, accessKey: '', secretKey: '', sessionToken: '', region: 'us-east-1', service: '' })
      case 'oauth2':
        return onChange({ type, ...DEFAULT_OAUTH2 })
    }
  }
  const field = <A extends Auth>(a: A, k: keyof A & string, label: string, opts: { type?: string; placeholder?: string } = {}): React.JSX.Element => (
    <label className="field" key={k}>
      {label}
      <input type={opts.type ?? 'text'} placeholder={opts.placeholder} value={String(a[k] ?? '')} onChange={(e) => onChange({ ...a, [k]: e.target.value })} />
    </label>
  )
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
        {auth.type === 'digest' && (
          <>
            {field(auth, 'username', 'Username')}
            {field(auth, 'password', 'Password', { type: 'password' })}
            <p className="hint">The first request gets the server&apos;s challenge; ApiMan answers it automatically (MD5, MD5-sess, SHA-256).</p>
          </>
        )}
        {auth.type === 'awsv4' && (
          <>
            {field(auth, 'accessKey', 'Access Key', { placeholder: '{{aws_access_key_id}}' })}
            {field(auth, 'secretKey', 'Secret Key', { type: 'password', placeholder: '{{aws_secret_access_key}}' })}
            {field(auth, 'region', 'AWS Region', { placeholder: 'us-east-1' })}
            {field(auth, 'service', 'Service Name', { placeholder: 'execute-api, s3, …' })}
            {field(auth, 'sessionToken', 'Session Token (optional)', { type: 'password' })}
          </>
        )}
        {auth.type === 'oauth2' && (
          <OAuth2Fields
            cfg={auth}
            onChange={(cfg) => onChange({ type: 'oauth2', ...cfg })}
            scopes={scopes ?? [ws.environments.find((e) => e.id === ws.activeEnvironmentId)?.variables ?? [], ws.globals]}
          />
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

function GraphQLBody({ body, onChange, tabId }: { body: Extract<RequestBody, { mode: 'graphql' }>; onChange(b: RequestBody): void; tabId: string }): React.JSX.Element {
  const schemaState = useStore((st) => st.schemas[tabId])
  const fetchSchema = useStore((st) => st.fetchSchema)
  const types = schemaState?.schema ? Object.keys(schemaState.schema.getTypeMap()).filter((t) => !t.startsWith('__')).length : 0
  const prettify = (): void => {
    try {
      onChange({ ...body, query: print(parse(body.query)) })
    } catch {
      /* invalid query — leave it */
    }
  }
  return (
    <div className="graphql">
      <div className="graphql-pane">
        <div className="section-title graphql-head">
          <span>Query</span>
          <span className="spacer" />
          <span className={`schema-status ${schemaState?.error ? 'err' : ''}`} title={schemaState?.error}>
            {schemaState?.loading
              ? 'Fetching schema…'
              : schemaState?.error
                ? 'Schema unavailable'
                : schemaState?.schema
                  ? `Schema: ${types} types · autocomplete on`
                  : 'No schema loaded'}
          </span>
          <button className="btn small ghost" onClick={() => void fetchSchema(tabId)} disabled={schemaState?.loading}>
            {schemaState?.schema ? 'Refresh schema' : 'Fetch schema'}
          </button>
          <button className="btn small ghost" onClick={prettify}>
            Prettify
          </button>
        </div>
        {schemaState?.error && <div className="error-msg small">{schemaState.error}</div>}
        <div className="editor-box">
          <CodeEditor value={body.query} onChange={(query) => onChange({ ...body, query })} language="graphql" schema={schemaState?.schema} placeholder="query { … }  — Ctrl+Space for suggestions" />
        </div>
      </div>
      <div className="graphql-pane">
        <div className="section-title">GraphQL Variables</div>
        <div className="editor-box">
          <CodeEditor value={body.variables} onChange={(variables) => onChange({ ...body, variables })} language="json" placeholder="{ }" />
        </div>
      </div>
    </div>
  )
}

function BodyEditor({ body, onChange, tabId }: { body: RequestBody; onChange(b: RequestBody): void; tabId: string }): React.JSX.Element {
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
      {body.mode === 'graphql' && <GraphQLBody body={body} onChange={onChange} tabId={tabId} />}
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
