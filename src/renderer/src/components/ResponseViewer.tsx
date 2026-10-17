import { useMemo, useState } from 'react'
import type { ApiResponse } from '@core/types'
import { useStore, type Tab } from '../store'
import type { TestResult } from '@core/types'
import { CodeEditor, type EditorLanguage } from './CodeEditor'
import { formatBytes } from '../format'

type View = 'body' | 'headers' | 'cookies' | 'tests' | 'timeline'
type BodyView = 'pretty' | 'raw' | 'preview'

const header = (res: ApiResponse, name: string): string | undefined => res.headers.find(([k]) => k.toLowerCase() === name)?.[1]


const formatMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`)

function languageFor(contentType: string): EditorLanguage {
  if (/json/i.test(contentType)) return 'json'
  if (/html/i.test(contentType)) return 'html'
  if (/xml/i.test(contentType)) return 'xml'
  if (/javascript/i.test(contentType)) return 'javascript'
  return 'text'
}

function prettify(body: string, lang: EditorLanguage): string {
  if (lang === 'json') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return body
    }
  }
  if (lang === 'xml' || lang === 'html') {
    // Lightweight indenter: put tags on their own lines and indent by depth.
    let depth = 0
    return body
      .replace(/>\s*</g, '>\n<')
      .split('\n')
      .map((line) => {
        if (/^<\/[^>]+>/.test(line)) depth = Math.max(0, depth - 1)
        const out = '  '.repeat(depth) + line
        if (/^<[^!?/][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line) && !/^<(br|hr|img|input|meta|link)\b/i.test(line)) depth++
        return out
      })
      .join('\n')
  }
  return body
}

interface Cookie {
  name: string
  value: string
  attrs: Record<string, string>
}

function parseSetCookie(v: string): Cookie {
  const [pair, ...rest] = v.split(';')
  const eq = pair.indexOf('=')
  const attrs: Record<string, string> = {}
  for (const a of rest) {
    const i = a.indexOf('=')
    attrs[(i >= 0 ? a.slice(0, i) : a).trim().toLowerCase()] = i >= 0 ? a.slice(i + 1).trim() : 'true'
  }
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attrs }
}

function statusClass(status: number): string {
  return `s${Math.floor(status / 100)}`
}

export function ResponseViewer({ tab }: { tab: Tab }): React.JSX.Element {
  const [view, setView] = useState<View>('body')
  const [bodyView, setBodyView] = useState<BodyView>('pretty')
  const [wrap, setWrap] = useState(true)
  const res = tab.response
  const tests = tab.tests ?? []
  const failed = tests.filter((t) => !t.passed).length

  const contentType = res ? (header(res, 'content-type') ?? '') : ''
  const lang = languageFor(contentType)
  const pretty = useMemo(() => (res && res.bodyEncoding === 'utf8' ? prettify(res.body, lang) : ''), [res, lang])
  const cookies = useMemo(() => (res ? res.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => parseSetCookie(v)) : []), [res])

  if (tab.loading) {
    return (
      <div className="response empty">
        <div className="spinner" />
        <div className="muted">Sending request…</div>
      </div>
    )
  }
  if (tab.error) {
    return (
      <div className="response empty">
        <div className="error-title">Could not send request</div>
        <div className="error-msg">{tab.error}</div>
        <button className="btn small ghost" onClick={() => useStore.getState().toggleConsole(true)}>
          Open console
        </button>
      </div>
    )
  }
  if (!res) {
    return (
      <div className="response empty">
        <div className="muted big">Enter a URL and click Send to get a response</div>
        <div className="muted small">Tip: paste a cURL command into the URL bar · ⌘↵ to send · ⌘S to save</div>
      </div>
    )
  }

  const isImage = /^image\//i.test(contentType)
  const copy = (): void => void navigator.clipboard.writeText(res.bodyEncoding === 'utf8' ? res.body : '')
  const save = (): void => {
    const ext = lang === 'text' ? (isImage ? contentType.split('/')[1].split(';')[0] : 'txt') : lang
    const b64 = res.bodyEncoding === 'base64' ? res.body : utf8ToBase64(res.body)
    void window.api.saveBinary(`response.${ext}`, b64)
  }

  return (
    <div className="response">
      <div className="response-bar">
        <div className="subtabs inline">
          {(['body', 'headers', 'cookies', 'tests', 'timeline'] as View[]).map((v) => (
            <button key={v} className={`subtab ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
              {v === 'tests' ? 'Test Results' : v[0].toUpperCase() + v.slice(1)}
              {v === 'headers' && ` (${res.headers.length})`}
              {v === 'cookies' && cookies.length > 0 && ` (${cookies.length})`}
              {v === 'tests' && tests.length > 0 && (
                <span className={`test-count ${failed ? 'fail' : 'pass'}`}>
                  {tests.length - failed}/{tests.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="response-meta">
          <span className={`status ${statusClass(res.status)}`}>
            {res.status} {res.statusText}
          </span>
          <span className="meta-item" title={timingTooltip(res)}>
            {formatMs(res.timings.total)}
          </span>
          <span className="meta-item">{formatBytes(res.size)}</span>
        </div>
      </div>

      {tab.scriptError && (
        <div className="script-error" onClick={() => useStore.getState().toggleConsole(true)} title="Open console">
          ⚠ {tab.scriptError}
        </div>
      )}

      {view === 'body' && (
        <>
          <div className="body-toolbar">
            {res.bodyEncoding === 'utf8' && (
              <div className="seg">
                {(['pretty', 'raw', 'preview'] as BodyView[]).map((b) => (
                  <button key={b} className={bodyView === b ? 'active' : ''} onClick={() => setBodyView(b)}>
                    {b[0].toUpperCase() + b.slice(1)}
                  </button>
                ))}
              </div>
            )}
            {res.bodyEncoding === 'utf8' && <span className="muted small lang-tag">{lang.toUpperCase()}</span>}
            <span className="spacer" />
            <label className="check small">
              <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
              Wrap
            </label>
            {res.bodyEncoding === 'utf8' && (
              <button className="btn small ghost" onClick={copy}>
                Copy
              </button>
            )}
            <button className="btn small ghost" onClick={save}>
              Save to file
            </button>
            <button
              className="btn small ghost"
              title="Keep this response on the request; mock servers serve saved examples"
              onClick={() =>
                useStore.getState().openModal({
                  kind: 'prompt',
                  title: 'Example name',
                  initial: `${res.status} ${res.statusText}`.trim() || 'Example',
                  onSubmit: (name) => useStore.getState().saveExample(tab.id, name)
                })
              }
            >
              Save as example
            </button>
          </div>
          <div className="response-body">
            {res.bodyEncoding === 'base64' ? (
              isImage ? (
                <div className="image-preview">
                  <img src={`data:${contentType};base64,${res.body}`} alt="Response" />
                </div>
              ) : (
                <div className="empty-hint">Binary response ({contentType || 'unknown type'}, {formatBytes(res.size)}). Use "Save to file" to download it.</div>
              )
            ) : bodyView === 'preview' ? (
              // Sandboxed with no scripts so a malicious response can't touch the app.
              <iframe className="preview-frame" sandbox="" srcDoc={lang === 'html' ? res.body : `<pre style="color:#ddd;white-space:pre-wrap">${escapeHtml(pretty)}</pre>`} title="Preview" />
            ) : (
              <CodeEditor value={bodyView === 'pretty' ? pretty : res.body} language={bodyView === 'pretty' ? lang : 'text'} readOnly wrap={wrap} />
            )}
          </div>
        </>
      )}

      {view === 'headers' && (
        <div className="scroll-pad">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {res.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td className="mono key-col">{k}</td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'cookies' && (
        <div className="scroll-pad">
          {cookies.length === 0 ? (
            <div className="empty-hint">No cookies were set by this response.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Domain</th>
                  <th>Path</th>
                  <th>Expires</th>
                  <th>HttpOnly</th>
                  <th>Secure</th>
                </tr>
              </thead>
              <tbody>
                {cookies.map((c, i) => (
                  <tr key={i}>
                    <td className="mono">{c.name}</td>
                    <td className="mono">{c.value}</td>
                    <td>{c.attrs.domain ?? new URL(res.url).hostname}</td>
                    <td>{c.attrs.path ?? '/'}</td>
                    <td>{c.attrs.expires ?? (c.attrs['max-age'] ? `${c.attrs['max-age']}s` : 'Session')}</td>
                    <td>{c.attrs.httponly ? '✓' : ''}</td>
                    <td>{c.attrs.secure ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'tests' && <TestResults tests={tests} />}
      {view === 'timeline' && <Timeline res={res} />}
    </div>
  )
}

function timingTooltip(res: ApiResponse): string {
  const t = res.timings
  return [
    t.dns !== undefined && `DNS lookup: ${formatMs(t.dns)}`,
    t.connect !== undefined && `TCP connect: ${formatMs(t.connect)}`,
    t.tls !== undefined && `TLS handshake: ${formatMs(t.tls)}`,
    t.firstByte !== undefined && `First byte: ${formatMs(t.firstByte)}`,
    `Total: ${formatMs(t.total)}`
  ]
    .filter(Boolean)
    .join('\n')
}

function Timeline({ res }: { res: ApiResponse }): React.JSX.Element {
  const t = res.timings
  // Each phase runs from the previous milestone to its own, all relative to the final hop's start.
  const milestones: [string, number | undefined][] = [
    ['DNS lookup', t.dns],
    ['TCP connect', t.connect],
    ['TLS handshake', t.tls],
    ['Waiting (TTFB)', t.firstByte],
    ['Content download', t.download]
  ]
  let prev = 0
  const phases = milestones
    .filter(([, v]) => v !== undefined)
    .map(([label, v]) => {
      const p = { label, start: prev, dur: Math.max(0, (v as number) - prev) }
      prev = v as number
      return p
    })
  const span = Math.max(prev, 1)
  return (
    <div className="scroll-pad timeline">
      <div className="timeline-url mono">
        {res.httpVersion && `HTTP/${res.httpVersion} · `}
        {res.url}
      </div>
      {res.redirects.length > 0 && (
        <div className="redirects">
          {res.redirects.map((r, i) => (
            <div key={i} className="mono small">
              <span className={`status-chip ${statusClass(r.status)}`}>{r.status}</span> {r.url}
            </div>
          ))}
          <div className="muted small">Timings below are for the final hop.</div>
        </div>
      )}
      {phases.map((p) => (
        <div key={p.label} className="phase">
          <span className="phase-label">{p.label}</span>
          <div className="phase-track">
            <div className="phase-bar" style={{ left: `${(p.start / span) * 100}%`, width: `max(2px, ${(p.dur / span) * 100}%)` }} />
          </div>
          <span className="phase-ms mono">{formatMs(p.dur)}</span>
        </div>
      ))}
      <div className="phase total">
        <span className="phase-label">Total</span>
        <div className="phase-track" />
        <span className="phase-ms mono">{formatMs(t.total)}</span>
      </div>
    </div>
  )
}

const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  // Chunked so large bodies don't overflow the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function TestResults({ tests }: { tests: TestResult[] }): React.JSX.Element {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all')
  if (tests.length === 0) {
    return (
      <div className="scroll-pad">
        <div className="empty-hint">
          No tests ran. Add some in the request&apos;s <b>Scripts → Post-response</b> tab, e.g. <code>pm.test(&apos;Status is 200&apos;, () =&gt; pm.response.to.have.status(200))</code>
        </div>
      </div>
    )
  }
  const shown = tests.filter((t) => filter === 'all' || (filter === 'passed') === t.passed)
  return (
    <div className="scroll-pad">
      <div className="seg test-filter">
        {(['all', 'passed', 'failed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} ({f === 'all' ? tests.length : tests.filter((t) => (f === 'passed') === t.passed).length})
          </button>
        ))}
      </div>
      {shown.map((t, i) => (
        <div key={i} className="test-row">
          <span className={`test-badge ${t.passed ? 'pass' : 'fail'}`}>{t.passed ? 'PASS' : 'FAIL'}</span>
          <span className="test-name">{t.name}</span>
          {t.error && <span className="test-error mono">{t.error}</span>}
        </div>
      ))}
    </div>
  )
}
