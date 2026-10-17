import { useEffect, useRef, useState } from 'react'
import type { LogLevel } from '@core/types'
import { useStore } from '../store'

const time = (ts: number): string => new Date(ts).toLocaleTimeString(undefined, { hour12: false })

export function ConsolePanel(): React.JSX.Element | null {
  const { console: entries, consoleOpen, toggleConsole, clearConsole } = useStore()
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({ log: true, info: true, warn: true, error: true })
  const [query, setQuery] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Block body on purpose: scrollIntoView returns a Promise in recent Chromium, and an
    // effect must not return anything but a cleanup function.
    void end.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, consoleOpen])

  const errors = entries.filter((e) => e.level === 'error').length
  const shown = entries.filter((e) => levels[e.level] && (!query || e.message.toLowerCase().includes(query.toLowerCase())))

  return (
    <div className={`console ${consoleOpen ? 'open' : ''}`}>
      <div className="console-bar" onClick={() => toggleConsole()}>
        <span className="console-title">
          {consoleOpen ? '▾' : '▸'} Console
          {entries.length > 0 && <span className="muted small"> ({entries.length})</span>}
          {errors > 0 && <span className="err-count">{errors} error{errors > 1 ? 's' : ''}</span>}
        </span>
        {consoleOpen && (
          <div className="console-tools" onClick={(e) => e.stopPropagation()}>
            <input className="search" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
            {(Object.keys(levels) as LogLevel[]).map((l) => (
              <label key={l} className="check small">
                <input type="checkbox" checked={levels[l]} onChange={(e) => setLevels({ ...levels, [l]: e.target.checked })} />
                {l}
              </label>
            ))}
            <button className="btn small ghost" onClick={clearConsole}>
              Clear
            </button>
          </div>
        )}
      </div>
      {consoleOpen && (
        <div className="console-body">
          {shown.length === 0 && <div className="muted small console-empty">Requests and script output (console.log, errors) appear here.</div>}
          {shown.map((e, i) => (
            <div key={i} className={`log-line ${e.level}`}>
              <span className="log-time">{time(e.timestamp)}</span>
              {e.source && <span className="log-src">{e.source}</span>}
              <pre className="log-msg">{e.message}</pre>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  )
}
