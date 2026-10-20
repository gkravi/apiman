import { useEffect, useMemo, useState } from 'react'
import { newCollection, newKeyValue } from '@core/factory'
import { parseCurl } from '@core/curl'
import { generateSnippet, SNIPPET_LANGUAGES, type SnippetLanguage } from '@core/codegen'
import { detachFiles } from '@core/security'
import { importPostmanCollection, importPostmanEnvironment, isPostmanCollection, isPostmanEnvironment } from '@core/postman'
import { importOpenApi, isOpenApi, parseSpecText } from '@core/openapi'
import type { CollectionItem, Variable } from '@core/types'
import { prepareTab, useStore, type Modal } from '../store'
import { CodeEditor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { AuthEditor } from './RequestEditor'
import { ScriptsEditor } from './ScriptsEditor'
import { EyeIcon, LockIcon, UnlockIcon } from './Icons'
import { DocsEditor } from './DocsEditor'
import { RunnerModal } from './RunnerModal'
import { CookiesModal, SettingsModal } from './SettingsModals'
import { MockModal } from './MockModal'
import { MonitorModal } from './Monitors'
import { locate } from '@core/tree'

function Shell({ title, onClose, children, wide, footer }: { title: string; onClose(): void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Import a Postman collection/environment file, or paste JSON / a cURL command. */
function ImportModal({ close }: { close(): void }): React.JSX.Element {
  const s = useStore()
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const importText = (content: string): void => {
    setError('')
    const trimmed = content.trim()
    try {
      if (trimmed.startsWith('curl')) {
        s.newTab(parseCurl(trimmed))
        s.showToast('cURL imported into a new tab')
        return close()
      }
      const json = parseSpecText(trimmed)
      if (isOpenApi(json)) {
        const c = importOpenApi(json)
        s.addCollection(c)
        s.setSidebar('collections')
        s.showToast(`Imported "${c.name}" from ${json.swagger ? 'Swagger 2.0' : `OpenAPI ${json.openapi}`}`)
      } else if (isPostmanCollection(json)) {
        // Shared collections never get to choose which local files are uploaded.
        const { collection: c, detached } = detachFiles(importPostmanCollection(json))
        s.addCollection(c)
        s.setSidebar('collections')
        s.showToast(
          detached.length
            ? `Imported collection "${c.name}" — ${detached.length} file attachment${detached.length === 1 ? '' : 's'} cleared for safety; choose the file${detached.length === 1 ? '' : 's'} again before sending`
            : `Imported collection "${c.name}"`
        )
      } else if (isPostmanEnvironment(json)) {
        const e = importPostmanEnvironment(json)
        s.addEnvironment(e)
        s.setSidebar('environments')
        s.showToast(`Imported environment "${e.name}"`)
      } else throw new Error('Unrecognised format — expected a Postman collection (v2.x) or environment, an OpenAPI/Swagger spec, or a cURL command.')
      close()
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Could not parse that as JSON or YAML' : (e as Error).message)
    }
  }

  return (
    <Shell
      title="Import"
      onClose={close}
      wide
      footer={
        <>
          <button
            className="btn"
            onClick={async () => {
              const file = await window.api.openJson()
              if (file) importText(file.content)
            }}
          >
            Choose file…
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => importText(text)}>
            Import
          </button>
        </>
      }
    >
      <p className="hint">Paste a cURL command, a Postman collection (v2.0/v2.1) or environment, or an OpenAPI 3 / Swagger 2 spec (JSON or YAML) — or choose a file.</p>
      <div className="editor-box tall">
        <CodeEditor value={text} onChange={setText} placeholder={"curl https://api.example.com/users -H 'Accept: application/json'"} />
      </div>
      {error && <div className="error-msg">{error}</div>}
    </Shell>
  )
}

function CodeModal({ tabId, close }: { tabId: string; close(): void }): React.JSX.Element {
  const s = useStore()
  const [lang, setLang] = useState<SnippetLanguage>('curl')
  const tab = s.tabs.find((t) => t.id === tabId)
  const snippet = useMemo(() => {
    if (!tab) return ''
    if ((tab.draft.protocol ?? 'http') !== 'http') return '// Code snippets are available for HTTP requests only.'
    try {
      return generateSnippet(lang, prepareTab(s.workspace, tab))
    } catch (e) {
      return `// ${(e as Error).message}`
    }
  }, [tab, lang, s.workspace])
  const editorLang = lang === 'fetch' || lang === 'node-axios' ? 'javascript' : 'text'
  return (
    <Shell
      title="Code snippet"
      onClose={close}
      wide
      footer={
        <>
          <select value={lang} onChange={(e) => setLang(e.target.value as SnippetLanguage)}>
            {SNIPPET_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button
            className="btn primary"
            onClick={() => {
              void navigator.clipboard.writeText(snippet)
              s.showToast('Copied to clipboard')
            }}
          >
            Copy
          </button>
        </>
      }
    >
      <div className="editor-box tall">
        <CodeEditor value={snippet} language={editorLang} readOnly wrap />
      </div>
      <p className="hint">Variables are resolved using the active environment. Secrets will appear in plain text.</p>
    </Shell>
  )
}

function folderOptions(items: CollectionItem[], depth = 1): { id: string; label: string }[] {
  return items.flatMap((i) => (i.type === 'folder' ? [{ id: i.id, label: `${'— '.repeat(depth)}${i.name}` }, ...folderOptions(i.items, depth + 1)] : []))
}

function SaveAsModal({ tabId, close }: { tabId: string; close(): void }): React.JSX.Element {
  const s = useStore()
  const tab = s.tabs.find((t) => t.id === tabId)
  const collections = s.workspace.collections
  const [name, setName] = useState(tab?.draft.name ?? 'New Request')
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '__new')
  const [newName, setNewName] = useState('My Collection')
  const [folderId, setFolderId] = useState<string>('')
  const collection = collections.find((c) => c.id === collectionId)

  const submit = (): void => {
    let target = collectionId
    if (target === '__new') target = s.addCollection(newCollection(newName.trim() || 'My Collection'))
    s.saveTabAs(tabId, target, folderId || null, name.trim() || 'New Request')
  }

  return (
    <Shell
      title="Save request"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        Request name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      <label className="field">
        Collection
        <select
          value={collectionId}
          onChange={(e) => {
            setCollectionId(e.target.value)
            setFolderId('')
          }}
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">+ New collection…</option>
        </select>
      </label>
      {collectionId === '__new' ? (
        <label className="field">
          New collection name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
      ) : (
        collection && (
          <label className="field">
            Folder
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">(collection root)</option>
              {folderOptions(collection.items).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )
      )}
    </Shell>
  )
}

function VariablesTable({ rows, onChange }: { rows: Variable[]; onChange(rows: Variable[]): void }): React.JSX.Element {
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  return (
    <KeyValueTable<Variable>
      rows={rows}
      onChange={onChange}
      keyPlaceholder="Variable"
      make={() => newKeyValue()}
      renderValue={(row, up) => (
        <div className="secret-cell">
          <input
            className="cell"
            type={row.secret && !reveal[row.id] ? 'password' : 'text'}
            placeholder="Value"
            value={row.value}
            onChange={(e) => up({ value: e.target.value })}
          />
          <button
            className={`icon-btn ${row.secret ? 'on' : ''}`}
            title={row.secret ? 'Secret — click to show/hide' : 'Mark as secret'}
            onClick={() => (row.secret ? setReveal({ ...reveal, [row.id]: !reveal[row.id] }) : up({ secret: true }))}
            onContextMenu={(e) => {
              e.preventDefault()
              up({ secret: !row.secret })
            }}
          >
            {row.secret ? reveal[row.id] ? <EyeIcon size={14} /> : <LockIcon size={14} /> : <UnlockIcon size={14} />}
          </button>
        </div>
      )}
    />
  )
}

function EnvironmentModal({ environmentId, close }: { environmentId: string | 'globals'; close(): void }): React.JSX.Element | null {
  const s = useStore()
  const isGlobals = environmentId === 'globals'
  const env = s.workspace.environments.find((e) => e.id === environmentId)
  if (!isGlobals && !env) return null
  const rows = isGlobals ? s.workspace.globals : env!.variables
  const active = s.workspace.activeEnvironmentId === environmentId
  return (
    <Shell
      title={isGlobals ? 'Globals' : env!.name}
      onClose={close}
      wide
      footer={
        <>
          {!isGlobals && (
            <button className="btn" onClick={() => s.setActiveEnvironment(active ? null : environmentId)}>
              {active ? 'Deactivate' : 'Set as active'}
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <p className="hint">
        Use variables as <code>{'{{name}}'}</code> in URLs, headers, bodies and auth. Changes save automatically. Click the lock to mark a value as secret
        (right-click to unmark).
      </p>
      <VariablesTable rows={rows} onChange={(v) => (isGlobals ? s.updateGlobals(v) : s.updateEnvironment(environmentId, { variables: v }))} />
    </Shell>
  )
}

function CollectionModal({ collectionId, close }: { collectionId: string; close(): void }): React.JSX.Element | null {
  const s = useStore()
  const [section, setSection] = useState<'variables' | 'auth' | 'scripts' | 'docs'>('variables')
  const c = s.workspace.collections.find((x) => x.id === collectionId)
  if (!c) return null
  return (
    <Shell
      title={c.name}
      onClose={close}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="subtabs">
        <button className={`subtab ${section === 'variables' ? 'active' : ''}`} onClick={() => setSection('variables')}>
          Variables
        </button>
        <button className={`subtab ${section === 'auth' ? 'active' : ''}`} onClick={() => setSection('auth')}>
          Authorization
        </button>
        <button className={`subtab ${section === 'scripts' ? 'active' : ''}`} onClick={() => setSection('scripts')}>
          Scripts
        </button>
        <button className={`subtab ${section === 'docs' ? 'active' : ''}`} onClick={() => setSection('docs')}>
          Docs
        </button>
      </div>
      <div className="section-body modal-section">
        {section === 'docs' ? (
          <DocsEditor value={c.description} onChange={(description) => s.updateCollection(c.id, { description })} placeholder="Introduce the API: what it's for, how to authenticate, conventions…" />
        ) : section === 'scripts' ? (
          <>
            <p className="hint">These run around every request in the collection, before folder and request scripts.</p>
            <ScriptsEditor scripts={c.scripts} onChange={(scripts) => s.updateCollection(c.id, { scripts })} scopeLabel="collection's requests" />
          </>
        ) : section === 'variables' ? (
          <>
            <p className="hint">Collection variables apply to every request in this collection. The active environment overrides them.</p>
            <VariablesTable rows={c.variables} onChange={(variables) => s.updateCollection(c.id, { variables })} />
          </>
        ) : (
          <>
            <p className="hint">Requests set to "Inherit auth from parent" use this.</p>
            <AuthEditor auth={c.auth} onChange={(auth) => s.updateCollection(c.id, { auth })} allowInherit={false} />
          </>
        )}
      </div>
    </Shell>
  )
}

function FolderModal({ folderId, close }: { folderId: string; close(): void }): React.JSX.Element | null {
  const s = useStore()
  const [section, setSection] = useState<'auth' | 'scripts' | 'docs'>('scripts')
  const loc = locate(s.workspace.collections, folderId)
  if (!loc || loc.item.type !== 'folder') return null
  const folder = loc.item
  return (
    <Shell
      title={folder.name}
      onClose={close}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="subtabs">
        <button className={`subtab ${section === 'scripts' ? 'active' : ''}`} onClick={() => setSection('scripts')}>
          Scripts
        </button>
        <button className={`subtab ${section === 'auth' ? 'active' : ''}`} onClick={() => setSection('auth')}>
          Authorization
        </button>
        <button className={`subtab ${section === 'docs' ? 'active' : ''}`} onClick={() => setSection('docs')}>
          Docs
        </button>
      </div>
      <div className="section-body modal-section">
        {section === 'docs' ? (
          <DocsEditor value={folder.description} onChange={(description) => s.updateFolder(folderId, { description })} placeholder="Describe this group of requests…" />
        ) : section === 'scripts' ? (
          <>
            <p className="hint">Folder scripts run after the collection&apos;s and before each request&apos;s own.</p>
            <ScriptsEditor scripts={folder.scripts} onChange={(scripts) => s.updateFolder(folderId, { scripts })} scopeLabel="folder's requests" />
          </>
        ) : (
          <AuthEditor auth={folder.auth ?? { type: 'inherit' }} onChange={(auth) => s.updateFolder(folderId, { auth })} />
        )}
      </div>
    </Shell>
  )
}

function PromptModal({ title, initial, onSubmit, close }: { title: string; initial: string; onSubmit(v: string): void; close(): void }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    if (!value.trim()) return
    close()
    onSubmit(value.trim())
  }
  return (
    <Shell
      title={title}
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            OK
          </button>
        </>
      }
    >
      <input className="full" autoFocus value={value} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
    </Shell>
  )
}

/** Values for {{ $prompt('Label', 'default') }} templates, asked for just before sending. */
function TemplatePromptsModal({
  requestName,
  prompts,
  onSubmit,
  close
}: {
  requestName: string
  prompts: { label: string; defaultValue: string }[]
  onSubmit(answers: Record<string, string>): void
  close(): void
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(prompts.map((p) => [p.label, p.defaultValue])))
  const submit = (): void => {
    close()
    onSubmit(values)
  }
  return (
    <Shell
      title={`Values for ${requestName}`}
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Send
          </button>
        </>
      }
    >
      <div className="template-prompts">
        {prompts.map((p, i) => (
          <label key={p.label}>
            <span>{p.label}</span>
            <input
              className="full"
              autoFocus={i === 0}
              value={values[p.label] ?? ''}
              spellCheck={false}
              onChange={(e) => setValues((v) => ({ ...v, [p.label]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
        ))}
      </div>
    </Shell>
  )
}

export function ModalHost(): React.JSX.Element | null {
  const modal: Modal | null = useStore((s) => s.modal)
  const openModal = useStore((s) => s.openModal)
  const close = (): void => openModal(null)
  if (!modal) return null
  switch (modal.kind) {
    case 'import':
      return <ImportModal close={close} />
    case 'code':
      return <CodeModal tabId={modal.tabId} close={close} />
    case 'saveAs':
      return <SaveAsModal tabId={modal.tabId} close={close} />
    case 'environment':
      return <EnvironmentModal environmentId={modal.environmentId} close={close} />
    case 'collection':
      return <CollectionModal collectionId={modal.collectionId} close={close} />
    case 'prompt':
      return <PromptModal title={modal.title} initial={modal.initial} onSubmit={modal.onSubmit} close={close} />
    case 'templatePrompts':
      return <TemplatePromptsModal requestName={modal.requestName} prompts={modal.prompts} onSubmit={modal.onSubmit} close={close} />
    case 'folder':
      return <FolderModal folderId={modal.folderId} close={close} />
    case 'runner':
      return <RunnerModal collectionId={modal.collectionId} folderId={modal.folderId} close={close} />
    case 'cookies':
      return <CookiesModal initialDomain={modal.domain} close={close} />
    case 'settings':
      return <SettingsModal close={close} />
    case 'mock':
      return <MockModal collectionId={modal.collectionId} close={close} />
    case 'monitor':
      return <MonitorModal monitorId={modal.monitorId} close={close} />
  }
}
