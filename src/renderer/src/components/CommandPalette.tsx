import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyMatch, highlightSegments } from '@core/fuzzy'
import { newCollection } from '@core/factory'
import type { CollectionItem, HttpMethod, Protocol } from '@core/types'
import { useStore } from '../store'
import { MethodBadge } from './MethodBadge'
import { CommandIcon, EnvironmentsIcon, HistoryIcon, SearchIcon } from './Icons'

type Group = 'Requests' | 'Open tabs' | 'Environments' | 'Commands' | 'History'

interface Item {
  id: string
  group: Group
  label: string
  /** Extra searchable text shown dimmed on the right (folder path, URL…). */
  hint?: string
  badge?: { method: HttpMethod; protocol?: Protocol }
  icon?: React.ReactNode
  shortcut?: string
  run(): void
}

const GROUP_ORDER: Group[] = ['Open tabs', 'Requests', 'Environments', 'Commands', 'History']
const MAX_RESULTS = 60

/** ⌘K: jump to any request, tab or environment, or run any command — Hoppscotch/Yaak style. */
export function CommandPalette(): React.JSX.Element {
  const s = useStore()
  const close = (): void => s.togglePalette(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => input.current?.focus(), [])

  const items = useMemo<Item[]>(() => {
    const ws = s.workspace
    const out: Item[] = []
    const active = s.tabs.find((t) => t.id === s.activeTabId)

    // Requests in every collection, with their folder path.
    const walk = (items: CollectionItem[], path: string[], collectionId: string): void => {
      for (const it of items) {
        if (it.type === 'folder') walk(it.items, [...path, it.name], collectionId)
        else
          out.push({
            id: `req:${it.id}`,
            group: 'Requests',
            label: it.request.name,
            hint: [...path, it.request.url].join(' / '),
            badge: { method: it.request.method, protocol: it.request.protocol },
            run: () => s.openItem(it.id)
          })
      }
    }
    for (const c of ws.collections) walk(c.items, [c.name], c.id)

    // Unsaved open tabs (saved ones are already reachable as requests).
    for (const t of s.tabs) {
      if (t.itemId) continue
      out.push({
        id: `tab:${t.id}`,
        group: 'Open tabs',
        label: t.draft.name,
        hint: t.draft.url || 'unsaved',
        badge: { method: t.draft.method, protocol: t.draft.protocol },
        run: () => s.activateTab(t.id)
      })
    }

    out.push({
      id: 'env:none',
      group: 'Environments',
      label: 'Use no environment',
      hint: ws.activeEnvironmentId ? undefined : 'active',
      icon: <EnvironmentsIcon />,
      run: () => s.setActiveEnvironment(null)
    })
    for (const e of ws.environments) {
      out.push({
        id: `env:${e.id}`,
        group: 'Environments',
        label: `Use environment: ${e.name}`,
        hint: ws.activeEnvironmentId === e.id ? 'active' : `${e.variables.length} variables`,
        icon: <EnvironmentsIcon />,
        run: () => s.setActiveEnvironment(e.id)
      })
    }

    const cmd = (id: string, label: string, run: () => void, shortcut?: string, hint?: string): void => {
      out.push({ id: `cmd:${id}`, group: 'Commands', label, run, shortcut, hint, icon: <CommandIcon /> })
    }
    if (active) {
      cmd('send', 'Send request', () => void s.send(active.id), '⌘↵', active.draft.name)
      cmd('save', 'Save request', () => s.saveTab(active.id), '⌘S', active.draft.name)
      cmd('code', 'Generate code snippet', () => s.openModal({ kind: 'code', tabId: active.id }))
      cmd('close-tab', 'Close tab', () => s.closeTab(active.id), undefined, active.draft.name)
    }
    cmd('new', 'New request', () => s.newTab(), '⌘T')
    cmd('import', 'Import collection, OpenAPI or cURL', () => s.openModal({ kind: 'import' }), '⌘O')
    cmd('new-collection', 'New collection', () =>
      s.openModal({ kind: 'prompt', title: 'Collection name', initial: 'New Collection', onSubmit: (name) => s.addCollection(newCollection(name)) })
    )
    cmd('console', s.consoleOpen ? 'Hide console' : 'Show console', () => s.toggleConsole())
    cmd('cookies', 'Manage cookies', () => s.openModal({ kind: 'cookies' }))
    cmd('settings', 'Open settings (proxy, certificates, appearance)', () => s.openModal({ kind: 'settings' }))
    cmd('theme-system', 'Theme: System', () => s.setThemePref('system'), undefined, s.themePref === 'system' ? 'current' : undefined)
    cmd('theme-light', 'Theme: Light', () => s.setThemePref('light'), undefined, s.themePref === 'light' ? 'current' : undefined)
    cmd('theme-dark', 'Theme: Dark', () => s.setThemePref('dark'), undefined, s.themePref === 'dark' ? 'current' : undefined)
    cmd('view-collections', 'Show collections', () => s.setSidebar('collections'))
    cmd('view-environments', 'Show environments', () => s.setSidebar('environments'))
    cmd('view-history', 'Show history', () => s.setSidebar('history'))
    cmd('view-monitors', 'Show monitors', () => s.setSidebar('monitors'))
    cmd('globals', 'Edit globals', () => s.openModal({ kind: 'environment', environmentId: 'globals' }))
    for (const c of ws.collections) {
      cmd(`run:${c.id}`, `Run collection: ${c.name}`, () => s.openModal({ kind: 'runner', collectionId: c.id, folderId: null }))
      cmd(`mock:${c.id}`, `Mock server: ${c.name}`, () => s.openModal({ kind: 'mock', collectionId: c.id }))
      cmd(`settings:${c.id}`, `Collection settings: ${c.name}`, () => s.openModal({ kind: 'collection', collectionId: c.id }))
    }

    for (const h of ws.history.slice(0, 30)) {
      out.push({
        id: `hist:${h.id}`,
        group: 'History',
        label: h.request.url || h.request.name,
        hint: `${h.status ?? '—'} · ${new Date(h.timestamp).toLocaleString()}`,
        badge: { method: h.request.method, protocol: h.request.protocol },
        icon: <HistoryIcon />,
        run: () => s.openHistory(h.id)
      })
    }
    return out
    // Rebuild only when the things listed change, not on every keystroke elsewhere.
  }, [s.workspace, s.tabs, s.activeTabId, s.consoleOpen, s.themePref])

  const commandsOnly = query.startsWith('>')
  const q = commandsOnly ? query.slice(1) : query
  const results = useMemo(() => {
    const pool = commandsOnly ? items.filter((i) => i.group === 'Commands') : items
    if (!q.trim()) {
      // No query: open tabs, a few requests, environments and the most useful commands — not history.
      return pool
        .filter((i) => i.group !== 'History')
        .slice(0, MAX_RESULTS)
        .map((item) => ({ item, labelHits: [] as number[] }))
    }
    return pool
      .map((item) => {
        const label = fuzzyMatch(q, item.label)
        const hint = item.hint ? fuzzyMatch(q, item.hint) : null
        const score = Math.max(label?.score ?? -Infinity, (hint?.score ?? -Infinity) - 60) // label matches beat hint matches
        return { item, score, labelHits: label?.indices ?? [] }
      })
      .filter((r) => r.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
  }, [items, q, commandsOnly])

  // Keep the visual order grouped when browsing; ranked order when searching.
  const ordered = q.trim() ? results : [...results].sort((a, b) => GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group))

  useEffect(() => setSelected(0), [query])
  useEffect(() => {
    list.current?.querySelector('.pal-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (i: number): void => {
    const r = ordered[i]
    if (!r) return
    close()
    r.item.run()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((x) => Math.min(ordered.length - 1, x + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((x) => Math.max(0, x - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(selected)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  let lastGroup: Group | null = null
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <div className="pal-input">
          <SearchIcon size={16} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests, environments and commands…  (type > for commands only)"
            spellCheck={false}
            aria-activedescendant={`pal-${selected}`}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox">
          {ordered.length === 0 && <div className="pal-empty">No matches for “{q.trim()}”</div>}
          {ordered.map(({ item, labelHits }, i) => {
            const header = !q.trim() && item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.id}>
                {header && <div className="pal-group">{header}</div>}
                <div
                  id={`pal-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  className={`pal-row ${i === selected ? 'selected' : ''}`}
                  onMouseMove={() => i !== selected && setSelected(i)}
                  onClick={() => run(i)}
                >
                  <span className="pal-icon">{item.badge ? <MethodBadge method={item.badge.method} protocol={item.badge.protocol} /> : item.icon}</span>
                  <span className="pal-label">
                    {highlightSegments(item.label, labelHits).map((seg, k) => (seg.hit ? <mark key={k}>{seg.text}</mark> : <span key={k}>{seg.text}</span>))}
                  </span>
                  {item.hint && <span className="pal-hint">{item.hint}</span>}
                  {q.trim() && <span className="pal-kind">{item.group === 'Commands' ? 'Command' : item.group.replace(/s$/, '')}</span>}
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>&gt;</kbd> commands only
          </span>
        </div>
      </div>
    </div>
  )
}
