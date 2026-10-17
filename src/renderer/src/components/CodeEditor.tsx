import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import { useMemo } from 'react'
import { graphql } from 'cm6-graphql'
import type { GraphQLSchema } from 'graphql'

export type EditorLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'text' | 'python' | 'shell' | 'graphql'

interface Props {
  value: string
  onChange?: (v: string) => void
  language?: EditorLanguage
  readOnly?: boolean
  wrap?: boolean
  placeholder?: string
  height?: string
  /** For language="graphql": enables schema-aware autocomplete and validation. */
  schema?: GraphQLSchema
}

export function CodeEditor({ value, onChange, language = 'text', readOnly, wrap, placeholder, height = '100%', schema }: Props): React.JSX.Element {
  const extensions = useMemo(() => {
    const ext = []
    if (language === 'json') ext.push(json())
    else if (language === 'xml') ext.push(xml())
    else if (language === 'html') ext.push(html())
    else if (language === 'javascript') ext.push(javascript())
    else if (language === 'graphql') ext.push(graphql(schema))
    if (wrap) ext.push(EditorView.lineWrapping)
    return ext
  }, [language, wrap, schema])

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
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: language === 'graphql' }}
    />
  )
}
