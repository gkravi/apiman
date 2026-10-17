import { useState } from 'react'
import { uid } from '@core/factory'
import type { Monitor, MonitorRun } from '@core/types'
import { useStore } from '../store'

const INTERVALS: [number, string][] = [
  [5, 'Every 5 minutes'],
  [15, 'Every 15 minutes'],
  [30, 'Every 30 minutes'],
  [60, 'Every hour'],
  [360, 'Every 6 hours'],
  [1440, 'Every day']
]

const intervalLabel = (m: number): string => INTERVALS.find(([v]) => v === m)?.[1] ?? `Every ${m} min`
const ok = (r?: MonitorRun): boolean | undefined => (r ? r.testsFailed + r.errors === 0 : undefined)

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

/** Sidebar list. */
export function MonitorsPanel(): React.JSX.Element {
  const s = useStore()
  const monitors = s.workspace.monitors ?? []
  return (
    <>
      <div className="sidebar-toolbar">
        <button className="btn small" onClick={() => s.openModal({ kind: 'monitor', monitorId: null })} disabled={s.workspace.collections.length === 0}>
          + New
        </button>
        <span className="muted small">Run while ApiMan is open</span>
      </div>
      <div className="sidebar-scroll">
        {monitors.length === 0 && <div className="empty-hint">Monitors run a collection on a schedule and notify you when tests fail.</div>}
        {monitors.map((m) => {
          const last = m.runs[0]
          const state = s.monitorsRunning.includes(m.id) ? 'running' : !m.enabled ? 'paused' : ok(last) === undefined ? 'idle' : ok(last) ? 'pass' : 'fail'
          return (
            <div key={m.id} className="tree-row monitor-row" onClick={() => s.openModal({ kind: 'monitor', monitorId: m.id })}>
              <span className={`mon-dot ${state}`} title={state} />
              <span className="tree-label">{m.name}</span>
              <span className="muted small">{last ? ago(last.startedAt) : intervalLabel(m.intervalMinutes).replace('Every ', '')}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Create / edit a monitor, and see its history. */
export function MonitorModal({ monitorId, close }: { monitorId: string | null; close(): void }): React.JSX.Element {
  const s = useStore()
  const ws = s.workspace
  const [draft, setDraft] = useState<Monitor>(
    () =>
      ws.monitors?.find((m) => m.id === monitorId) ?? {
        id: uid(),
        name: ws.collections[0] ? `${ws.collections[0].name} monitor` : 'Monitor',
        collectionId: ws.collections[0]?.id ?? '',
        environmentId: ws.activeEnvironmentId,
        intervalMinutes: 60,
        enabled: true,
        notifyOnFailure: true,
        runs: []
      }
  )
  // A new monitor's id is fixed up front, so once saved the dialog keeps showing it (and its runs).
  const existing = ws.monitors?.find((m) => m.id === (monitorId ?? draft.id))
  const [editing, setEditing] = useState(!monitorId)
  const live = existing ?? draft
  const running = s.monitorsRunning.includes(live.id)
  const set = <K extends keyof Monitor>(k: K, v: Monitor[K]): void => setDraft({ ...draft, [k]: v })
  const save = (): void => {
    s.saveMonitor({ ...draft, runs: existing?.runs ?? [] })
    setEditing(false)
    if (!existing) void s.runMonitor(draft.id) // first run straight away so there is something to see
  }

  const runs = live.runs
  const passRate = runs.length ? Math.round((runs.filter((r) => ok(r)).length / runs.length) * 100) : null
  const maxDuration = Math.max(1, ...runs.map((r) => r.durationMs))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label="Monitor">
        <div className="modal-head">
          <h2>{existing ? live.name : 'New monitor'}</h2>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {editing ? (
            <div className="settings-grid wide">
              <label className="field">
                Name
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              </label>
              <label className="field">
                Collection
                <select value={draft.collectionId} onChange={(e) => set('collectionId', e.target.value)}>
                  {ws.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Environment
                <select value={draft.environmentId ?? ''} onChange={(e) => set('environmentId', e.target.value || null)}>
                  <option value="">No environment</option>
                  {ws.environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Schedule
                <select value={draft.intervalMinutes} onChange={(e) => set('intervalMinutes', Number(e.target.value))}>
                  {INTERVALS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.notifyOnFailure} onChange={(e) => set('notifyOnFailure', e.target.checked)} />
                Desktop notification when a run fails
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Enabled
              </label>
            </div>
          ) : (
            <>
              <div className="mon-summary">
                <span>
                  {ws.collections.find((c) => c.id === live.collectionId)?.name ?? 'Missing collection'} ·{' '}
                  {ws.environments.find((e) => e.id === live.environmentId)?.name ?? 'no environment'} · {intervalLabel(live.intervalMinutes).toLowerCase()}
                  {!live.enabled && ' · paused'}
                </span>
                <span className="spacer" />
                {passRate !== null && <span className={`pill ${passRate === 100 ? 'pass' : 'fail'}`}>{passRate}% passing</span>}
              </div>
              {runs.length > 0 && (
                <div className="mon-bars" title="Run duration, newest on the right">
                  {[...runs].reverse().map((r) => (
                    <span
                      key={r.id}
                      className={`mon-bar ${ok(r) ? 'pass' : 'fail'}`}
                      style={{ height: `${Math.max(8, (r.durationMs / maxDuration) * 100)}%` }}
                      title={`${new Date(r.startedAt).toLocaleString()} · ${r.durationMs} ms · ${r.testsPassed} passed, ${r.testsFailed} failed, ${r.errors} errors`}
                    />
                  ))}
                </div>
              )}
              <div className="mon-runs">
                {runs.length === 0 && <div className="empty-hint">{running ? 'First run in progress…' : 'No runs yet.'}</div>}
                {runs.map((r) => (
                  <details key={r.id} className="mon-run">
                    <summary>
                      <span className={`mon-dot ${ok(r) ? 'pass' : 'fail'}`} />
                      <span>{new Date(r.startedAt).toLocaleString()}</span>
                      <span className="muted small">
                        {r.requests} requests · {r.testsPassed} passed · {r.testsFailed} failed{r.errors ? ` · ${r.errors} errors` : ''} · {(r.durationMs / 1000).toFixed(2)} s
                      </span>
                    </summary>
                    {r.failures.length > 0 ? (
                      <ul className="mon-failures">
                        {r.failures.map((f, i) => (
                          <li key={i} className="mono small">
                            {f}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted small mon-failures">Everything passed.</div>
                    )}
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          {existing && !editing && (
            <>
              <button className="btn" disabled={running} onClick={() => void s.runMonitor(live.id)}>
                {running ? 'Running…' : 'Run now'}
              </button>
              <button className="btn ghost" onClick={() => s.saveMonitor({ ...live, enabled: !live.enabled })}>
                {live.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setDraft(live)
                  setEditing(true)
                }}
              >
                Edit
              </button>
              <button
                className="btn ghost danger-text"
                onClick={() => {
                  if (confirm(`Delete monitor "${live.name}" and its history?`)) {
                    s.deleteMonitor(live.id)
                    close()
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
          <span className="spacer" />
          {editing ? (
            <>
              <button className="btn ghost" onClick={() => (existing ? setEditing(false) : close())}>
                Cancel
              </button>
              <button className="btn primary" disabled={!draft.collectionId || !draft.name.trim()} onClick={save}>
                {existing ? 'Save' : 'Create & run'}
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={close}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
