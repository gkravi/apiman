import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import { useMemo } from 'react'

export type EditorLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'text' | 'python' | 'shell'

interface Props {
  value: string
  onChange?: (v: string) => void
  language?: EditorLanguage
  readOnly?: boolean
  wrap?: boolean
  placeholder?: string
  height?: string
}

export function CodeEditor({ value, onChange, language = 'text', readOnly, wrap, placeholder, height = '100%' }: Props): React.JSX.Element {
  const extensions = useMemo(() => {
    const ext = []
    if (language === 'json') ext.push(json())
    else if (language === 'xml') ext.push(xml())
    else if (language === 'html') ext.push(html())
    else if (language === 'javascript') ext.push(javascript())
    if (wrap) ext.push(EditorView.lineWrapping)
    return ext
  }, [language, wrap])

  return (
    <CodeMirror
      className="code-editor"
      value={value}
      onChange={onChange}
      theme="dark"
      height={height}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
    />
  )
}
