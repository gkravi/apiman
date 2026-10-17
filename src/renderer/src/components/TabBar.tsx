import { useStore } from '../store'
import { MethodBadge } from './MethodBadge'

export function TabBar(): React.JSX.Element {
  const { tabs, activeTabId, activateTab, closeTab, newTab } = useStore()
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? 'active' : ''}`}
          onClick={() => activateTab(t.id)}
          onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
          title={t.draft.url || t.draft.name}
        >
          <MethodBadge method={t.draft.method} protocol={t.draft.protocol} />
          <span className="tab-name">{t.draft.name}</span>
          {t.dirty && <span className="dirty-dot" title="Unsaved changes" />}
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              if (!t.dirty || !t.itemId || confirm('Discard unsaved changes?')) closeTab(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="tab-new" title="New request (⌘T)" onClick={() => newTab()}>
        +
      </button>
    </div>
  )
}
