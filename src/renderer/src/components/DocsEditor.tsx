import { useState } from 'react'
import { renderMarkdown } from '@core/markdown'
import { CodeEditor } from './CodeEditor'

/** Markdown description with an edit/preview toggle. renderMarkdown escapes all HTML, so preview is safe. */
export function DocsEditor({ value = '', onChange, placeholder }: { value?: string; onChange(v: string): void; placeholder: string }): React.JSX.Element {
  const [preview, setPreview] = useState(Boolean(value.trim()))
  return (
    <div className="docs-editor">
      <div className="composer-bar">
        <div className="seg">
          <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
            Edit
          </button>
          <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        <span className="muted small">Markdown — shown in exported documentation</span>
      </div>
      {preview ? (
        <div className="md-preview" onDoubleClick={() => setPreview(false)} title="Double-click to edit">
          {value.trim() ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /> : <span className="muted">{placeholder}</span>}
        </div>
      ) : (
        <div className="editor-box">
          <CodeEditor value={value} onChange={onChange} wrap placeholder={placeholder} />
        </div>
      )}
    </div>
  )
}
