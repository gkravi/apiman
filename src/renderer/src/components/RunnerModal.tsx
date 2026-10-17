import { useMemo, useState } from 'react'
import { runnableRequests } from '@core/tree'
import { parseDataFile } from '@core/varsync'
import type { RunnerRequestResult, VarMap } from '@core/types'
import { useStore } from '../store'
import { MethodBadge } from './MethodBadge'
import { formatBytes } from '../format'

function ResultRow({ r }: { r: RunnerRequestResult }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const failed = r.tests.filter((t) => !t.passed).length
  const bad = !!r.error || !!r.scriptError || failed > 0
  return (
    <div className={`run-row ${bad ? 'bad' : ''}`}>
      <div className="run-head" onClick={() => setOpen(!open)}>
        <span className="caret">{r.tests.length || r.error || r.scriptError ? (open ? '▾' : '▸') : ''}</span>
        <MethodBadge method={r.method} />
        <span className="run-name">{r.name}</span>
        <span className="run-url mono muted" title={r.url}>
          {r.url}
        </span>
        {r.status !== undefined ? (
          <span className={`status-chip s${Math.floor(r.status / 100)}`}>
            {r.status} {r.statusText}
          </span>
        ) : (
          <span className="status-chip s5">{r.scriptError && !r.error ? 'Not sent' : 'Error'}</span>
        )}
        <span className="muted small run-num">{r.durationMs !== undefined ? `${Math.round(r.durationMs)} ms` : ''}</span>
        <span className="muted small run-num">{r.size !== undefined ? formatBytes(r.size) : ''}</span>
        {r.tests.length > 0 && <span className={`test-count ${failed ? 'fail' : 'pass'}`}>{r.tests.length - failed}/{r.tests.length}</span>}
      </div>
      {open && (
        <div className="run-detail">
          {r.error && <div className="error-msg">{r.error}</div>}
          {r.scriptError && r.scriptError !== r.error && <div className="error-msg">{r.scriptError}</div>}
          {r.tests.map((t, i) => (
            <div key={i} className="test-row">
              <span className={`test-badge ${t.passed ? 'pass' : 'fail'}`}>{t.passed ? 'PASS' : 'FAIL'}</span>
              <span className="test-name">{t.name}</span>
              {t.error && <span className="test-error mono">{t.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RunnerModal({ collectionId, folderId, close }: { collectionId: string; folderId: string | null; close(): void }): React.JSX.Element | null {
  const s = useStore()
  const collection = s.workspace.collections.find((c) => c.id === collectionId)
  const requests = useMemo(() => (collection ? runnableRequests(collection, folderId) : []), [collection, folderId])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.item.id)))
  const [iterations, setIterations] = useState(1)
  const [delayMs, setDelayMs] = useState(0)
  const [stopOnError, setStopOnError] = useState(false)
  const [persistVariables, setPersistVariables] = useState(true)
  const [data, setData] = useState<{ name: string; rows: VarMap[] } | null>(null)
  const [dataError, setDataError] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)

  if (!collection) return null
  const runner = s.runner && s.runner.collectionId === collectionId && s.runner.folderId === folderId ? s.runner : null
  const running = s.runner?.status === 'running'
  const folderName = folderId ? requests[0]?.folders.find((f) => f.id === folderId)?.name : undefined
  const env = s.workspace.environments.find((e) => e.id === s.workspace.activeEnvironmentId)

  const loadData = async (): Promise<void> => {
    setDataError('')
    const file = await window.api.openDataFile()
    if (!file) return
    try {
      const rows = parseDataFile(file.content, file.path)
      setData({ name: file.path.split(/[\\/]/).pop() ?? file.path, rows })
      setIterations(Math.max(1, rows.length))
    } catch (e) {
      setDataError((e as Error).message)
    }
  }

  const start = (): void =>
    void s.startRunner(collectionId, folderId, [...selected], { iterations, delayMs, data: data?.rows ?? [], stopOnError, persistVariables })

  const exportResults = async (): Promise<void> => {
    if (!runner) return
    const payload = { collection: collection.name, folder: folderName ?? null, environment: env?.name ?? null, summary: runner.summary, results: runner.results }
    if (await window.api.saveJson(`${collection.name}.run.json`, JSON.stringify(payload, null, 2))) s.showToast('Results exported')
  }

  const byIteration = new Map<number, RunnerRequestResult[]>()
  for (const r of runner?.results ?? []) {
    if (onlyFailed && !r.error && !r.scriptError && r.tests.every((t) => t.passed)) continue
    byIteration.set(r.iteration, [...(byIteration.get(r.iteration) ?? []), r])
  }
  const totals = (runner?.results ?? []).reduce(
    (a, r) => ({ passed: a.passed + r.tests.filter((t) => t.passed).length, failed: a.failed + r.tests.filter((t) => !t.passed).length, errors: a.errors + (r.error || r.scriptError ? 1 : 0) }),
    { passed: 0, failed: 0, errors: 0 }
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !running && close()}>
      <div className="modal xl" role="dialog" aria-label="Collection runner">
        <div className="modal-head">
          <h2>
            Run {collection.name}
            {folderName ? ` / ${folderName}` : ''}
          </h2>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>
        <div className="runner">
          <div className="runner-config">
            <div className="section-title">Run order</div>
            <div className="runner-list">
              <label className="check small select-all">
                <input
                  type="checkbox"
                  checked={selected.size === requests.length}
                  onChange={(e) => setSelected(new Set(e.target.checked ? requests.map((r) => r.item.id) : []))}
                />
                Select all ({selected.size}/{requests.length})
              </label>
              {requests.map(({ item, folders }) => (
                <label key={item.id} className="check runner-item">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(item.id)
                      else next.delete(item.id)
                      setSelected(next)
                    }}
                  />
                  <MethodBadge method={item.request.method} protocol={item.request.protocol} />
                  <span className="tree-label" title={[...folders].reverse().map((f) => f.name).concat(item.request.name).join(' / ')}>
                    {item.request.name}
                  </span>
                </label>
              ))}
              {requests.length === 0 && <div className="empty-hint">No requests to run.</div>}
            </div>

            <div className="runner-fields">
              <label className="field">
                Iterations
                <input type="number" min={1} max={10000} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">
                Delay (ms)
                <input type="number" min={0} step={100} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} />
              </label>
            </div>
            <div className="field">
              Data file
              <div className="file-picker">
                <button className="btn small" onClick={() => void loadData()}>
                  Select CSV / JSON
                </button>
                {data && (
                  <>
                    <span className="muted small file-path" title={data.name}>
                      {data.name} · {data.rows.length} rows
                    </span>
                    <button className="icon-btn" title="Remove data file" onClick={() => setData(null)}>
                      ✕
                    </button>
                  </>
                )}
              </div>
              {dataError && <div className="error-msg">{dataError}</div>}
              {data && data.rows[0] && <div className="muted small">Variables: {Object.keys(data.rows[0]).map((k) => `{{${k}}}`).join(', ')}</div>}
            </div>
            <label className="check">
              <input type="checkbox" checked={persistVariables} onChange={(e) => setPersistVariables(e.target.checked)} />
              Keep variable values set by scripts
            </label>
            <label className="check">
              <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
              Stop run on first error or failed test
            </label>
            <div className="muted small">Environment: {env?.name ?? 'none'}</div>
            <div className="runner-actions">
              {running ? (
                <button className="btn danger full" onClick={() => s.stopRunner()}>
                  Stop run
                </button>
              ) : (
                <button className="btn primary full" disabled={selected.size === 0} onClick={start}>
                  Run {collection.name}
                </button>
              )}
            </div>
          </div>

          <div className="runner-results">
            {!runner ? (
              <div className="empty-hint">Choose requests and settings, then run. Each request&apos;s pre-request and test scripts run in order, and variables carry between requests.</div>
            ) : (
              <>
                <div className="runner-summary">
                  <span className={`run-state ${runner.status}`}>{runner.status === 'running' ? 'Running…' : runner.summary?.aborted ? 'Stopped' : 'Completed'}</span>
                  <span className="pill pass">{totals.passed} passed</span>
                  <span className="pill fail">{totals.failed} failed</span>
                  {totals.errors > 0 && <span className="pill fail">{totals.errors} errors</span>}
                  <span className="muted small">
                    {runner.results.length} requests
                    {runner.summary && ` · ${runner.summary.iterations} iteration${runner.summary.iterations > 1 ? 's' : ''} · ${(runner.summary.durationMs / 1000).toFixed(2)} s`}
                  </span>
                  <span className="spacer" />
                  <label className="check small">
                    <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
                    Only failures
                  </label>
                  {runner.status === 'done' && (
                    <>
                      <button className="btn small ghost" onClick={() => void exportResults()}>
                        Export
                      </button>
                      <button className="btn small ghost" onClick={() => s.clearRunner()}>
                        Clear
                      </button>
                    </>
                  )}
                </div>
                {runner.error && <div className="error-msg">{runner.error}</div>}
                {running && <div className="progress" />}
                <div className="runner-scroll">
                  {[...byIteration].map(([it, rows]) => (
                    <div key={it}>
                      <div className="group-label">Iteration {it + 1}</div>
                      {rows.map((r, i) => (
                        <ResultRow key={i} r={r} />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
