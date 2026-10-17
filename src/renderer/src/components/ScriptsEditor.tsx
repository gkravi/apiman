import { useState } from 'react'
import type { Scripts } from '@core/types'
import { CodeEditor } from './CodeEditor'

type Phase = 'preRequest' | 'test'

const SNIPPETS: Record<Phase, { label: string; code: string }[]> = {
  preRequest: [
    { label: 'Set an environment variable', code: "pm.environment.set('variable_key', 'variable_value');" },
    { label: 'Set a collection variable', code: "pm.collectionVariables.set('variable_key', 'variable_value');" },
    { label: 'Get a variable', code: "pm.variables.get('variable_key');" },
    { label: 'Add a header', code: "pm.request.headers.add({ key: 'X-Request-Id', value: pm.variables.replaceIn('{{$guid}}') });" },
    { label: 'Set a timestamp variable', code: "pm.variables.set('now', String(Date.now()));" },
    {
      label: 'Fetch a token first',
      code: `pm.sendRequest({
  url: pm.environment.get('baseUrl') + '/auth/token',
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: JSON.stringify({ user: pm.environment.get('user') }) }
}, (err, res) => {
  if (err) return console.error(err);
  pm.environment.set('token', res.json().token);
});`
    },
    { label: 'Log to console', code: "console.log('Sending', pm.request.method, pm.request.url.toString());" }
  ],
  test: [
    { label: 'Status code is 200', code: "pm.test('Status code is 200', () => {\n  pm.response.to.have.status(200);\n});" },
    { label: 'Response time is below 500ms', code: "pm.test('Response time is below 500ms', () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});" },
    {
      label: 'JSON value check',
      code: "pm.test('Body has expected value', () => {\n  const json = pm.response.json();\n  pm.expect(json.value).to.eql(100);\n});"
    },
    { label: 'Body contains string', code: "pm.test('Body contains string', () => {\n  pm.expect(pm.response.text()).to.include('string_you_want_to_search');\n});" },
    { label: 'Content-Type header is present', code: "pm.test('Content-Type is present', () => {\n  pm.response.to.have.header('Content-Type');\n});" },
    { label: 'Save a value from the response', code: "pm.environment.set('id', pm.response.json().id);" },
    { label: 'Run another request next', code: "pm.execution.setNextRequest('Request name');" }
  ]
}

const EMPTY: Scripts = { preRequest: '', test: '' }

export function ScriptsEditor({ scripts = EMPTY, onChange, scopeLabel }: { scripts?: Scripts; onChange(s: Scripts): void; scopeLabel: string }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('preRequest')
  const value = scripts[phase]
  const insert = (code: string): void => onChange({ ...scripts, [phase]: value.trim() ? `${value.replace(/\s+$/, '')}\n\n${code}\n` : `${code}\n` })

  return (
    <div className="scripts-editor">
      <div className="scripts-phases">
        {(['preRequest', 'test'] as Phase[]).map((p) => (
          <button key={p} className={`phase-btn ${phase === p ? 'active' : ''}`} onClick={() => setPhase(p)}>
            {p === 'preRequest' ? 'Pre-request' : 'Post-response'}
            {scripts[p].trim() && <span className="dot" />}
          </button>
        ))}
      </div>
      <div className="scripts-main">
        <div className="editor-box">
          <CodeEditor
            value={value}
            onChange={(v) => onChange({ ...scripts, [phase]: v })}
            language="javascript"
            placeholder={phase === 'preRequest' ? `// Runs before this ${scopeLabel} is sent` : '// Runs after the response arrives — write tests with pm.test()'}
          />
        </div>
        <div className="snippets">
          <div className="section-title">Snippets</div>
          {SNIPPETS[phase].map((s) => (
            <button key={s.label} className="snippet" onClick={() => insert(s.code)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
