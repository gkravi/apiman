import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uid } from '@core/factory'
import type { GrpcConfig, GrpcMethodInfo, StreamEvent } from '@core/types'
import { useStore, type Tab } from '../store'
import { CodeEditor } from './CodeEditor'

const streamLabel = (m: GrpcMethodInfo): string =>
  m.clientStreaming && m.serverStreaming ? 'bidirectional stream' : m.clientStreaming ? 'client stream' : m.serverStreaming ? 'server stream' : 'unary'

/** WebSocket / gRPC message editor. */
export function MessageComposer({ tab, method }: { tab: Tab; method?: GrpcMethodInfo }): React.JSX.Element {
  const s = useStore()
  const r = tab.draft
  const isGrpc = r.protocol === 'grpc'
  const open = tab.live?.status === 'open'
  const [lang, setLang] = useState<'json' | 'text'>(isGrpc ? 'json' : 'text')
  const text = r.message ?? ''
  const streamingSend = !isGrpc || method?.clientStreaming
  const send = (): void => {
    if (open && streamingSend) s.sendLive(tab.id, text)
  }

  return (
    <div className="composer" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.stopPropagation(), send())}>
      <div className="composer-bar">
        {!isGrpc && (
          <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as 'json' | 'text')}>
            <option value="text">Text</option>
            <option value="json">JSON</option>
          </select>
        )}
        {isGrpc && method && (
          <span className="muted small">
            {method.requestType} → {method.responseType} · {streamLabel(method)}
          </span>
        )}
        {isGrpc && !method && <span className="muted small">Choose a service and method in the Service tab</span>}
        <span className="spacer" />
        {isGrpc && method && (
          <button className="btn small ghost" onClick={() => s.updateDraft(tab.id, { message: JSON.stringify(method.sample, null, 2) })}>
            Use example message
          </button>
        )}
        {streamingSend && (
          <button className="btn small primary" disabled={!open} onClick={send} title="Send (⌘↵)">
            Send
          </button>
        )}
        {isGrpc && method?.clientStreaming && (
          <button className="btn small" disabled={!open} onClick={() => s.endLive(tab.id)}>
            End stream
          </button>
        )}
      </div>
      <div className="editor-box">
        <CodeEditor value={text} onChange={(message) => s.updateDraft(tab.id, { message })} language={isGrpc ? 'json' : lang} placeholder={isGrpc ? '{ }' : 'Message to send…'} />
      </div>
      <SavedMessages tab={tab} canSend={open && !!streamingSend} />
      <div className="hint">
        {isGrpc
          ? method?.clientStreaming
            ? 'Connect, then send as many messages as you like and End stream to get the response.'
            : 'This message is sent when you click Invoke.'
          : open
            ? 'Connected — ⌘↵ sends the message.'
            : 'Connect first, then send messages.'}
      </div>
    </div>
  )
}

/** Named messages saved with the request: click to load, ↑ to send straight away. */
function SavedMessages({ tab, canSend }: { tab: Tab; canSend: boolean }): React.JSX.Element {
  const s = useStore()
  const saved = tab.draft.savedMessages ?? []
  const text = tab.draft.message ?? ''
  const save = (): void =>
    s.openModal({
      kind: 'prompt',
      title: 'Save message as',
      initial: text.trim().split('\n')[0].slice(0, 40) || 'Message',
      onSubmit: (name) => s.updateDraft(tab.id, { savedMessages: [...saved.filter((m) => m.name !== name), { id: uid(), name, body: text }] })
    })
  return (
    <div className="saved-messages">
      <span className="muted small">Saved:</span>
      {saved.length === 0 && <span className="muted small">none yet</span>}
      {saved.map((m) => (
        <span key={m.id} className="msg-chip" title={m.body}>
          <button className="chip-load" onClick={() => s.updateDraft(tab.id, { message: m.body })}>
            {m.name}
          </button>
          {canSend && (
            <button className="chip-send" title="Send now" onClick={() => s.sendLive(tab.id, m.body)}>
              ↑
            </button>
          )}
          <button className="chip-del" title="Delete" onClick={() => s.updateDraft(tab.id, { savedMessages: saved.filter((x) => x.id !== m.id) })}>
            ✕
          </button>
        </span>
      ))}
      <button className="btn small ghost" disabled={!text.trim()} onClick={save}>
        + Save current
      </button>
    </div>
  )
}

export function GrpcServicePanel({ tab }: { tab: Tab }): React.JSX.Element {
  const s = useStore()
  const cfg: GrpcConfig = tab.draft.grpc ?? { protoFiles: [], includeDirs: [], service: '', method: '' }
  const state = s.grpc[tab.id]
  const set = (patch: Partial<GrpcConfig>): void => s.updateDraft(tab.id, { grpc: { ...cfg, ...patch } })
  const reflection = cfg.source === 'reflection'
  // Proto files reload as soon as the list changes; reflection waits for an explicit Fetch (it's a network call).
  const filesKey = reflection ? 'reflection' : cfg.protoFiles.join('|') + '#' + cfg.includeDirs.join('|')

  useEffect(() => {
    if (!reflection || !state) void s.loadProtos(tab.id)
    // Reload when the file list changes, not on every keystroke elsewhere in the draft.
  }, [filesKey])

  const service = state?.services?.find((x) => x.name === cfg.service)
  const choose = (svc: string, method: string): void => {
    const m = state?.services?.find((x) => x.name === svc)?.methods.find((x) => x.name === method)
    s.updateDraft(tab.id, {
      grpc: { ...cfg, service: svc, method },
      ...(m && !(tab.draft.message ?? '').trim() ? { message: JSON.stringify(m.sample, null, 2) } : {})
    })
  }

  return (
    <div className="grpc-panel">
      <div className="seg source-toggle">
        <button className={!reflection ? 'active' : ''} onClick={() => set({ source: 'proto' })}>
          Proto files
        </button>
        <button className={reflection ? 'active' : ''} onClick={() => set({ source: 'reflection' })}>
          Server reflection
        </button>
      </div>
      {reflection ? (
        <div className="row-actions">
          <button className="btn small" onClick={() => void s.loadProtos(tab.id)} disabled={state?.loading || !tab.draft.url.trim()}>
            {state?.loading ? 'Asking server…' : state?.services ? 'Refresh from server' : 'Fetch services from server'}
          </button>
          <span className="muted small">Uses the URL, metadata, auth and TLS settings of this request.</span>
        </div>
      ) : (
      <>
      <div className="section-title">Proto files</div>
      {cfg.protoFiles.map((f) => (
        <div key={f} className="proto-row">
          <code className="file-path" title={f}>
            {f.split(/[\\/]/).pop()}
          </code>
          <span className="muted small proto-dir">{f.split(/[\\/]/).slice(0, -1).join('/')}</span>
          <button className="icon-btn" title="Remove" onClick={() => set({ protoFiles: cfg.protoFiles.filter((x) => x !== f) })}>
            ✕
          </button>
        </div>
      ))}
      <div className="row-actions">
        <button
          className="btn small"
          onClick={async () => {
            const files = await window.api.pickFiles(['proto'])
            if (files.length) set({ protoFiles: [...new Set([...cfg.protoFiles, ...files])] })
          }}
        >
          + Add .proto files
        </button>
        {cfg.protoFiles.length > 0 && (
          <button className="btn small ghost" onClick={() => void s.loadProtos(tab.id)} disabled={state?.loading}>
            {state?.loading ? 'Loading…' : 'Reload'}
          </button>
        )}
      </div>
      <label className="field">
        Extra import paths (comma-separated folders; each file&apos;s own folder is always included)
        <input
          value={cfg.includeDirs.join(', ')}
          placeholder="/path/to/protos, /path/to/third_party"
          onChange={(e) =>
            set({
              includeDirs: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            })
          }
        />
      </label>
      </>
      )}
      {state?.error && <div className="error-msg">{state.error}</div>}

      {state?.services && (
        <div className="settings-grid wide">
          <label className="field">
            Service
            <select value={cfg.service} onChange={(e) => choose(e.target.value, '')}>
              <option value="">Select a service…</option>
              {state.services.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Method
            <select value={cfg.method} onChange={(e) => choose(cfg.service, e.target.value)} disabled={!service}>
              <option value="">Select a method…</option>
              {service?.methods.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} — {streamLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {state?.services?.length === 0 && <div className="empty-hint">No services found in these files.</div>}
      {!reflection && <p className="hint">Server supports reflection? Switch to &quot;Server reflection&quot; to skip the .proto files.</p>}
    </div>
  )
}

const ICONS: Record<StreamEvent['kind'], string> = { connecting: '…', open: '●', sent: '↑', message: '↓', error: '✕', close: '○', info: 'i' }

/** One-line preview: compact JSON when the message is JSON, else the first line. */
function summary(data: string): string {
  const t = data.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(t))
    } catch {
      /* not JSON */
    }
  }
  return data.split('\n')[0]
}

function pretty(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2)
  } catch {
    return data
  }
}

/** Message log shown in the response pane for WebSocket / SSE / gRPC. */
export function LiveViewer({ tab }: { tab: Tab }): React.JSX.Element {
  const s = useStore()
  const live = tab.live
  const [filter, setFilter] = useState<'all' | 'sent' | 'message'>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [live?.events.length])

  if (!live) {
    const verb = tab.draft.protocol === 'grpc' ? 'Invoke the method' : 'Connect'
    return (
      <div className="response empty">
        <div className="muted big">{verb} to see messages here</div>
        <div className="muted small">Sent and received messages, connection events and errors appear in order.</div>
      </div>
    )
  }

  const events = live.events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => filter === 'all' || e.kind === filter)
    .filter(({ e }) => !query || (e.data ?? '').toLowerCase().includes(query.toLowerCase()))
  const sent = live.events.filter((e) => e.kind === 'sent').length
  const received = live.events.filter((e) => e.kind === 'message').length
  const statusText = live.status === 'open' ? 'Connected' : live.status === 'connecting' ? 'Connecting…' : 'Disconnected'

  return (
    <div className="response">
      <div className="response-bar live-bar">
        <span className={`live-status ${live.status}`}>{statusText}</span>
        <div className="seg">
          {(
            [
              ['all', `All (${live.events.length})`],
              ['sent', `Sent (${sent})`],
              ['message', `Received (${received})`]
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <input className="search live-search" placeholder="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn small ghost" onClick={() => s.clearLive(tab.id)}>
          Clear
        </button>
      </div>
      <div
        className="live-log"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {events.map(({ e, i }) => {
          const isOpen = expanded.has(i)
          const toggle = (): void => {
            const next = new Set(expanded)
            if (isOpen) next.delete(i)
            else next.add(i)
            setExpanded(next)
          }
          const firstLine = summary(e.data ?? '')
          return (
            <div key={i} className={`live-row k-${e.kind}`}>
              <div className="live-head" onClick={toggle}>
                <span className="live-icon">{ICONS[e.kind]}</span>
                <span className="live-text mono">{e.binary ? `[binary] ${e.meta ?? ''}` : firstLine || <span className="muted">(empty)</span>}</span>
                {e.meta && !e.binary && !isOpen && <span className="live-meta muted small">{e.meta.split('\n')[0]}</span>}
                <span className="live-time muted small">{new Date(e.timestamp).toLocaleTimeString(undefined, { hour12: false })}</span>
              </div>
              {isOpen && (
                <div className="live-detail">
                  {e.data && <pre className="mono">{e.binary ? e.data : pretty(e.data)}</pre>}
                  {e.meta && <pre className="mono muted">{e.meta}</pre>}
                  {e.data && (
                    <button className="btn small ghost" onClick={() => void navigator.clipboard.writeText(e.data ?? '')}>
                      Copy
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
