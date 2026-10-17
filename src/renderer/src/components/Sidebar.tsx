import { useState } from 'react'
import { newCollection, newEnvironment } from '@core/factory'
import { exportPostmanCollection, exportPostmanEnvironment } from '@core/postman'
import type { CollectionItem, Collection } from '@core/types'
import { useStore, type SidebarView } from '../store'
import { MethodBadge } from './MethodBadge'

function ItemMenu({ items }: { items: { label: string; onClick(): void; danger?: boolean }[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn row-menu" title="More actions" onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu">
            {items.map((it) => (
              <button
                key={it.label}
                className={it.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

function TreeItem({ item, collection, depth }: { item: CollectionItem; collection: Collection; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const s = useStore()
  const activeItemId = s.tabs.find((t) => t.id === s.activeTabId)?.itemId
  const pad = { paddingLeft: 8 + depth * 14 }
  const rename = (current: string): void =>
    s.openModal({ kind: 'prompt', title: 'Rename', initial: current, onSubmit: (v) => s.renameItem(item.id, v) })

  if (item.type === 'request') {
    return (
      <div className={`tree-row ${activeItemId === item.id ? 'active' : ''}`} style={pad} onClick={() => s.openItem(item.id)}>
        <MethodBadge method={item.request.method} />
        <span className="tree-label">{item.request.name}</span>
        <ItemMenu
          items={[
            { label: 'Rename', onClick: () => rename(item.request.name) },
            { label: 'Duplicate', onClick: () => s.duplicateItem(item.id) },
            { label: 'Delete', danger: true, onClick: () => s.deleteItem(item.id) }
          ]}
        />
      </div>
    )
  }

  return (
    <>
      <div className="tree-row" style={pad} onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="folder-icon">📁</span>
        <span className="tree-label">{item.name}</span>
        <ItemMenu
          items={[
            { label: 'Run folder', onClick: () => s.openModal({ kind: 'runner', collectionId: collection.id, folderId: item.id }) },
            { label: 'Add request', onClick: () => s.addRequestTo(collection.id, item.id) },
            {
              label: 'Add folder',
              onClick: () => s.openModal({ kind: 'prompt', title: 'Folder name', initial: 'New Folder', onSubmit: (v) => s.addFolder(collection.id, item.id, v) })
            },
            { label: 'Edit scripts & auth', onClick: () => s.openModal({ kind: 'folder', folderId: item.id }) },
            { label: 'Rename', onClick: () => rename(item.name) },
            { label: 'Duplicate', onClick: () => s.duplicateItem(item.id) },
            { label: 'Delete', danger: true, onClick: () => s.deleteItem(item.id) }
          ]}
        />
      </div>
      {open && item.items.map((child) => <TreeItem key={child.id} item={child} collection={collection} depth={depth + 1} />)}
      {open && item.items.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
          Empty folder
        </div>
      )}
    </>
  )
}

function CollectionNode({ collection }: { collection: Collection }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const s = useStore()
  return (
    <div className="collection">
      <div className="tree-row collection-row" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="tree-label strong">{collection.name}</span>
        <ItemMenu
          items={[
            { label: 'Run collection', onClick: () => s.openModal({ kind: 'runner', collectionId: collection.id, folderId: null }) },
            { label: 'Add request', onClick: () => s.addRequestTo(collection.id, null) },
            {
              label: 'Add folder',
              onClick: () => s.openModal({ kind: 'prompt', title: 'Folder name', initial: 'New Folder', onSubmit: (v) => s.addFolder(collection.id, null, v) })
            },
            { label: 'Edit variables, auth & scripts', onClick: () => s.openModal({ kind: 'collection', collectionId: collection.id }) },
            {
              label: 'Rename',
              onClick: () => s.openModal({ kind: 'prompt', title: 'Rename collection', initial: collection.name, onSubmit: (v) => s.updateCollection(collection.id, { name: v }) })
            },
            {
              label: 'Export (Postman v2.1)',
              onClick: async () => {
                const ok = await window.api.saveJson(`${collection.name}.postman_collection.json`, JSON.stringify(exportPostmanCollection(collection), null, 2))
                if (ok) s.showToast('Collection exported')
              }
            },
            { label: 'Delete', danger: true, onClick: () => confirm(`Delete collection "${collection.name}"?`) && s.deleteCollection(collection.id) }
          ]}
        />
      </div>
      {open && collection.items.map((item) => <TreeItem key={item.id} item={item} collection={collection} depth={1} />)}
      {open && collection.items.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 22 }}>
          This collection is empty.{' '}
          <button className="link" onClick={() => s.addRequestTo(collection.id, null)}>
            Add a request
          </button>
        </div>
      )}
    </div>
  )
}

function Collections(): React.JSX.Element {
  const s = useStore()
  const [filter, setFilter] = useState('')
  const visible = s.workspace.collections.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <div className="sidebar-toolbar">
        <button
          className="btn small"
          onClick={() => s.openModal({ kind: 'prompt', title: 'Collection name', initial: 'New Collection', onSubmit: (v) => s.addCollection(newCollection(v)) })}
        >
          + New
        </button>
        <input className="search" placeholder="Filter collections" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="sidebar-scroll">
        {visible.length === 0 && (
          <div className="empty-hint">
            No collections yet. Create one, or import a Postman collection or cURL command.
          </div>
        )}
        {visible.map((c) => (
          <CollectionNode key={c.id} collection={c} />
        ))}
      </div>
    </>
  )
}

function Environments(): React.JSX.Element {
  const s = useStore()
  const ws = s.workspace
  return (
    <>
      <div className="sidebar-toolbar">
        <button
          className="btn small"
          onClick={() =>
            s.openModal({
              kind: 'prompt',
              title: 'Environment name',
              initial: 'New Environment',
              onSubmit: (v) => {
                const id = s.addEnvironment(newEnvironment(v))
                s.openModal({ kind: 'environment', environmentId: id })
              }
            })
          }
        >
          + New
        </button>
      </div>
      <div className="sidebar-scroll">
        <div className="tree-row" onClick={() => s.openModal({ kind: 'environment', environmentId: 'globals' })}>
          <span className="env-dot globe">🌐</span>
          <span className="tree-label">Globals</span>
          <span className="muted small">{ws.globals.length}</span>
        </div>
        {ws.environments.map((e) => (
          <div key={e.id} className="tree-row" onClick={() => s.openModal({ kind: 'environment', environmentId: e.id })}>
            <span className={`env-dot ${ws.activeEnvironmentId === e.id ? 'on' : ''}`} title={ws.activeEnvironmentId === e.id ? 'Active' : ''} />
            <span className="tree-label">{e.name}</span>
            <ItemMenu
              items={[
                { label: ws.activeEnvironmentId === e.id ? 'Deactivate' : 'Set active', onClick: () => s.setActiveEnvironment(ws.activeEnvironmentId === e.id ? null : e.id) },
                {
                  label: 'Rename',
                  onClick: () => s.openModal({ kind: 'prompt', title: 'Rename environment', initial: e.name, onSubmit: (v) => s.updateEnvironment(e.id, { name: v }) })
                },
                {
                  label: 'Export',
                  onClick: async () => {
                    if (await window.api.saveJson(`${e.name}.postman_environment.json`, JSON.stringify(exportPostmanEnvironment(e), null, 2))) s.showToast('Environment exported')
                  }
                },
                { label: 'Delete', danger: true, onClick: () => confirm(`Delete environment "${e.name}"?`) && s.deleteEnvironment(e.id) }
              ]}
            />
          </div>
        ))}
        {ws.environments.length === 0 && <div className="empty-hint">Environments hold variables like {'{{baseUrl}}'} that change between dev, staging and prod.</div>}
      </div>
    </>
  )
}

function History(): React.JSX.Element {
  const s = useStore()
  const groups = new Map<string, typeof s.workspace.history>()
  for (const h of s.workspace.history) {
    const day = new Date(h.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    groups.set(day, [...(groups.get(day) ?? []), h])
  }
  return (
    <>
      <div className="sidebar-toolbar">
        <span className="muted small">{s.workspace.history.length} requests</span>
        {s.workspace.history.length > 0 && (
          <button className="btn small ghost" onClick={() => confirm('Clear all history?') && s.clearHistory()}>
            Clear
          </button>
        )}
      </div>
      <div className="sidebar-scroll">
        {s.workspace.history.length === 0 && <div className="empty-hint">Requests you send show up here.</div>}
        {[...groups].map(([day, entries]) => (
          <div key={day}>
            <div className="group-label">{day}</div>
            {entries.map((h) => (
              <div key={h.id} className="tree-row" onClick={() => s.openHistory(h.id)} title={h.request.url}>
                <MethodBadge method={h.request.method} />
                <span className="tree-label">{h.request.url || h.request.name}</span>
                {h.status !== undefined && <span className={`status-chip s${Math.floor(h.status / 100)}`}>{h.status}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

const VIEWS: { id: SidebarView; label: string; icon: string }[] = [
  { id: 'collections', label: 'Collections', icon: '🗂' },
  { id: 'environments', label: 'Environments', icon: '⚙︎' },
  { id: 'history', label: 'History', icon: '⟲' }
]

export function Sidebar(): React.JSX.Element {
  const { sidebar, setSidebar } = useStore()
  return (
    <aside className="sidebar">
      <nav className="sidebar-rail">
        {VIEWS.map((v) => (
          <button key={v.id} className={`rail-btn ${sidebar === v.id ? 'active' : ''}`} onClick={() => setSidebar(v.id)} title={v.label}>
            <span className="rail-icon">{v.icon}</span>
            <span className="rail-label">{v.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-panel">
        {sidebar === 'collections' && <Collections />}
        {sidebar === 'environments' && <Environments />}
        {sidebar === 'history' && <History />}
      </div>
    </aside>
  )
}
