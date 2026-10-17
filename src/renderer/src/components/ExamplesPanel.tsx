import { useState } from 'react'
import { useStore, type Tab } from '../store'
import { CodeEditor } from './CodeEditor'

export function ExamplesPanel({ tab }: { tab: Tab }): React.JSX.Element {
  const s = useStore()
  const examples = tab.draft.examples ?? []
  const [openId, setOpenId] = useState<string | null>(examples[0]?.id ?? null)
  const open = examples.find((e) => e.id === openId)
  if (examples.length === 0) {
    return <div className="empty-hint">No saved examples. Send the request, then click &quot;Save as example&quot; above the response. Mock servers serve these.</div>
  }
  const ct = open?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  return (
    <div className="examples">
      <div className="example-list">
        {examples.map((e) => (
          <div key={e.id} className={`example-row ${e.id === openId ? 'active' : ''}`} onClick={() => setOpenId(e.id)}>
            <span className={`status-chip s${Math.floor(e.status / 100)}`}>{e.status}</span>
            <span className="tree-label">{e.name}</span>
            <button
              className="icon-btn"
              title="Delete example"
              onClick={(ev) => {
                ev.stopPropagation()
                if (confirm(`Delete example "${e.name}"?`)) s.deleteExample(tab.id, e.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {open && (
        <div className="example-view">
          <div className="muted small">
            {open.status} {open.statusText} · {open.headers.length} headers
          </div>
          <div className="editor-box">
            <CodeEditor value={open.body} language={/json/i.test(ct) ? 'json' : /html/i.test(ct) ? 'html' : /xml/i.test(ct) ? 'xml' : 'text'} readOnly wrap />
          </div>
        </div>
      )}
    </div>
  )
}
