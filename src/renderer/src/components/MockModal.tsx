import { useMemo, useState } from 'react'
import { buildRoutes } from '@core/mockRoutes'
import { useStore } from '../store'
import { useEscape } from '../useEscape'
import { MethodBadge } from './MethodBadge'

export function MockModal({ collectionId, close }: { collectionId: string; close(): void }): React.JSX.Element | null {
  const s = useStore()
  const collection = s.workspace.collections.find((c) => c.id === collectionId)
  const mock = s.mocks[collectionId]
  const [port, setPort] = useState(mock?.port ?? 4010)
  const routes = useMemo(() => (collection ? buildRoutes(collection) : []), [collection])
  useEscape(close)
  if (!collection) return null
  const running = mock?.status === 'running'
  const base = `http://127.0.0.1:${mock?.port ?? port}`

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label="Mock server">
        <div className="modal-head">
          <h2>Mock server — {collection.name}</h2>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Serves this collection&apos;s saved examples on your machine. Requests match by method and path ({'{{variables}}'} and :params match any segment).
            Pick a specific example with the <code>x-mock-response-name</code> or <code>x-mock-response-code</code> header. Edits apply while it runs.
          </p>
          <div className="mock-controls">
            <label className="field">
              Port
              <input type="number" min={1} max={65535} value={port} disabled={running} onChange={(e) => setPort(Number(e.target.value))} />
            </label>
            {running ? (
              <>
                <code className="mock-url">{base}</code>
                <button className="btn small ghost" onClick={() => void navigator.clipboard.writeText(base).then(() => s.showToast('URL copied'))}>
                  Copy URL
                </button>
                <button className="btn danger" onClick={() => void s.stopMock(collectionId)}>
                  Stop
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={mock?.status === 'starting' || routes.length === 0} onClick={() => void s.startMock(collectionId, port)}>
                {mock?.status === 'starting' ? 'Starting…' : 'Start mock server'}
              </button>
            )}
          </div>
          {mock?.error && <div className="error-msg">{mock.error}</div>}

          <div className="section-title">Routes ({routes.length})</div>
          <div className="mock-routes">
            {routes.length === 0 && (
              <div className="empty-hint">No examples yet. Send a request, then use &quot;Save as example&quot; in the response panel to add one.</div>
            )}
            {routes.map((r) => (
              <div key={r.requestId} className="mock-route">
                <MethodBadge method={r.method} />
                <code className="mock-path">{r.path}</code>
                <span className="muted small">
                  {r.requestName} · {r.examples.map((e) => `${e.name} (${e.status})`).join(', ')}
                </span>
              </div>
            ))}
          </div>

          {mock && mock.log.length > 0 && (
            <>
              <div className="section-title">Requests</div>
              <div className="mock-log">
                {[...mock.log].reverse().map((l, i) => (
                  <div key={i} className="mock-log-row mono">
                    <span className="muted">{new Date(l.timestamp).toLocaleTimeString(undefined, { hour12: false })}</span>
                    <span>
                      {l.method} {l.path}
                    </span>
                    <span className={`status-chip s${Math.floor(l.status / 100)}`}>{l.status}</span>
                    <span className="muted">{l.matched ?? 'no match'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted small">{running ? 'Running — keeps going when this dialog is closed.' : 'Stopped'}</span>
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
