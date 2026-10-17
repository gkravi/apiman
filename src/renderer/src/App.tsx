import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { RequestEditor } from './components/RequestEditor'
import { ResponseViewer } from './components/ResponseViewer'
import { ModalHost } from './components/Modals'
import { ConsolePanel } from './components/ConsolePanel'
import { LiveViewer } from './components/LiveEditors'
import { Logo } from './components/Logo'
import { watchSystemTheme } from './theme'
import { CookieIcon, EyeIcon, ImportIcon, MoonIcon, PlusIcon, SearchIcon, SettingsIcon, SunIcon, SystemThemeIcon } from './components/Icons'
import { CommandPalette } from './components/CommandPalette'

const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' } as const

function ThemeButton(): React.JSX.Element {
  const pref = useStore((st) => st.themePref)
  const setPref = useStore((st) => st.setThemePref)
  const label = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }[pref]
  return (
    <button className="icon-btn theme-btn" onClick={() => setPref(NEXT_THEME[pref])} title={`${label} — click for ${NEXT_THEME[pref]}`}>
      {pref === 'system' ? <SystemThemeIcon /> : pref === 'light' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

function EnvironmentSelect(): React.JSX.Element {
  const s = useStore()
  const ws = s.workspace
  return (
    <div className="env-select">
      <select value={ws.activeEnvironmentId ?? ''} onChange={(e) => s.setActiveEnvironment(e.target.value || null)} title="Active environment">
        <option value="">No Environment</option>
        {ws.environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <button
        className="icon-btn"
        title="Edit environment"
        onClick={() => s.openModal({ kind: 'environment', environmentId: ws.activeEnvironmentId ?? 'globals' })}
      >
        <EyeIcon />
      </button>
    </div>
  )
}

/** Request editor on top, response below, with a draggable divider. */
function Workbench(): React.JSX.Element | null {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [split, setSplit] = useState(0.5)
  const box = useRef<HTMLDivElement>(null)

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const move = (ev: MouseEvent): void => {
      const r = box.current?.getBoundingClientRect()
      if (r) setSplit(Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height)))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!tab) return null
  return (
    <div className="workbench" ref={box}>
      <div className="pane" style={{ flexBasis: `${split * 100}%` }}>
        <RequestEditor key={tab.id} tab={tab} />
      </div>
      <div className="splitter" onMouseDown={startDrag} />
      <div className="pane" style={{ flexBasis: `${(1 - split) * 100}%` }}>
        {(tab.draft.protocol ?? 'http') === 'http' ? <ResponseViewer key={tab.id} tab={tab} /> : <LiveViewer key={tab.id} tab={tab} />}
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const s = useStore()

  useEffect(() => {
    void useStore.getState().init()
    // Monitors: check every 30 s which ones are due (first check shortly after start-up).
    const unwatchTheme = watchSystemTheme(() => useStore.getState().syncTheme())
    const first = setTimeout(() => useStore.getState().tickMonitors(), 5000)
    const timer = setInterval(() => useStore.getState().tickMonitors(), 30_000)
    return () => {
      unwatchTheme()
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const st = useStore.getState()
      const id = st.activeTabId
      if (e.key === 'Enter' && id) {
        e.preventDefault()
        void st.send(id)
      } else if (e.key === 's' && id) {
        e.preventDefault()
        st.saveTab(id)
      } else if (e.key === 't') {
        e.preventDefault()
        st.newTab()
      } else if (e.key === 'k' || e.key === 'p') {
        e.preventDefault()
        st.togglePalette()
      } else if (e.key === 'o') {
        e.preventDefault()
        st.openModal({ kind: 'import' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!s.ready) return <div className="loading-screen">Loading workspace…</div>

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo size={22} /> ApiMan
        </div>
        <button className="btn small" onClick={() => s.newTab()} title="New request (⌘T)">
          <PlusIcon size={14} /> New
        </button>
        <button className="btn small" onClick={() => s.openModal({ kind: 'import' })} title="Import (⌘O)">
          <ImportIcon size={14} /> Import
        </button>
        <button className="palette-trigger" onClick={() => s.togglePalette(true)} title="Search requests, environments and commands (⌘K)">
          <SearchIcon size={14} />
          <span>Search or run a command</span>
          <kbd>⌘K</kbd>
        </button>
        <span className="spacer" />
        <ThemeButton />
        <button className="btn small ghost" onClick={() => s.openModal({ kind: 'cookies' })}>
          <CookieIcon size={14} /> Cookies
        </button>
        <button className="btn small ghost" onClick={() => s.openModal({ kind: 'settings' })} title="Proxy & certificates">
          <SettingsIcon size={14} /> Settings
        </button>
        <EnvironmentSelect />
      </header>
      <div className="main">
        <Sidebar />
        <section className="content">
          <TabBar />
          <Workbench />
        </section>
      </div>
      <ConsolePanel />
      <ModalHost />
      {s.paletteOpen && <CommandPalette />}
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  )
}
