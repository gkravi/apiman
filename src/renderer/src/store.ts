import { create } from 'zustand'
import { newCollection, newEnvironment, newFolder, newRequest, newRequestItem, uid } from '@core/factory'
import { prepareRequest } from '@core/prepare'
import { insertItem, locate, parentAuths, removeItem, runnableRequests, scriptChain, updateItem } from '@core/tree'
import { applyVarChanges, toVarMap } from '@core/varsync'
import type { Scope } from '@core/variables'
import type {
  ApiRequest,
  ApiResponse,
  Collection,
  CollectionItem,
  ConsoleEntry,
  Cookie,
  Environment,
  Folder,
  NetworkSettings,
  PreparedRequest,
  RunnerOptions,
  RunnerRequestResult,
  RunnerSummary,
  RunRequestInput,
  RunStep,
  RunVariables,
  TestResult,
  Workspace
} from '@core/types'
import { DEFAULT_NETWORK } from '@core/types'

const HISTORY_LIMIT = 200
const CONSOLE_LIMIT = 1000

export interface Tab {
  id: string
  /** Working copy being edited. */
  draft: ApiRequest
  /** Collection item this tab was opened from; null for scratch requests. */
  itemId: string | null
  dirty: boolean
  loading: boolean
  execId?: string
  response?: ApiResponse
  error?: string
  sentAt?: number
  tests?: TestResult[]
  scriptError?: string
}

export interface RunnerState {
  runId: string
  collectionId: string
  folderId: string | null
  status: 'running' | 'done'
  results: RunnerRequestResult[]
  summary?: RunnerSummary
  error?: string
}

export type SidebarView = 'collections' | 'environments' | 'history'

export type Modal =
  | { kind: 'import' }
  | { kind: 'code'; tabId: string }
  | { kind: 'saveAs'; tabId: string }
  | { kind: 'environment'; environmentId: string | 'globals' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'runner'; collectionId: string; folderId: string | null }
  | { kind: 'cookies'; domain?: string }
  | { kind: 'settings' }
  | { kind: 'prompt'; title: string; initial: string; onSubmit: (value: string) => void }

interface State {
  ready: boolean
  workspace: Workspace
  tabs: Tab[]
  activeTabId: string | null
  sidebar: SidebarView
  modal: Modal | null
  toast: string | null
  console: ConsoleEntry[]
  consoleOpen: boolean
  runner: RunnerState | null

  init(): Promise<void>
  setSidebar(v: SidebarView): void
  openModal(m: Modal | null): void
  showToast(msg: string): void
  toggleConsole(open?: boolean): void
  clearConsole(): void

  // tabs
  newTab(req?: ApiRequest): void
  openItem(itemId: string): void
  openHistory(entryId: string): void
  closeTab(id: string): void
  activateTab(id: string): void
  updateDraft(tabId: string, patch: Partial<ApiRequest>): void
  saveTab(tabId: string): void
  saveTabAs(tabId: string, collectionId: string, folderId: string | null, name: string): void
  send(tabId: string): Promise<void>
  cancel(tabId: string): void

  // collections
  addCollection(c?: Collection): string
  updateCollection(id: string, patch: Partial<Collection>): void
  deleteCollection(id: string): void
  addFolder(collectionId: string, parentId: string | null, name: string): void
  addRequestTo(collectionId: string, parentId: string | null): void
  renameItem(itemId: string, name: string): void
  deleteItem(itemId: string): void
  duplicateItem(itemId: string): void
  updateFolder(folderId: string, patch: Partial<Folder>): void

  // collection runner
  startRunner(collectionId: string, folderId: string | null, requestIds: string[], options: RunnerOptions & { persistVariables: boolean }): Promise<void>
  stopRunner(): void
  clearRunner(): void

  // environments
  addEnvironment(e?: Environment): string
  updateEnvironment(id: string, patch: Partial<Environment>): void
  deleteEnvironment(id: string): void
  setActiveEnvironment(id: string | null): void
  updateGlobals(globals: Workspace['globals']): void
  setCookies(cookies: Cookie[]): void
  updateNetwork(patch: Partial<NetworkSettings>): void
  clearHistory(): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(ws: Workspace): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.saveWorkspace(ws), 300)
}

const blankTab = (req: ApiRequest = newRequest(), itemId: string | null = null): Tab => ({
  id: uid(),
  draft: structuredClone(req),
  itemId,
  dirty: false,
  loading: false
})

/** Deep-copy an item with fresh ids (for duplicate). */
function cloneItem(item: CollectionItem): CollectionItem {
  if (item.type === 'folder') return { ...item, id: uid(), name: `${item.name} Copy`, items: item.items.map(cloneItem) }
  const request = { ...structuredClone(item.request), id: uid(), name: `${item.request.name} Copy` }
  return { id: request.id, type: 'request', request }
}

/** Variable scopes for a tab, highest priority first: environment → collection → globals. */
export function scopesFor(ws: Workspace, itemId: string | null): Scope[] {
  const env = ws.environments.find((e) => e.id === ws.activeEnvironmentId)
  const loc = itemId ? locate(ws.collections, itemId) : undefined
  return [env?.variables ?? [], loc?.collection.variables ?? [], ws.globals]
}

/** Variables a run starts with: active environment, the tab's collection, globals. */
function persistentVars(ws: Workspace, collectionId: string | undefined): Pick<RunVariables, 'environment' | 'collection' | 'globals'> {
  const env = ws.environments.find((e) => e.id === ws.activeEnvironmentId)
  const col = ws.collections.find((c) => c.id === collectionId)
  return { environment: toVarMap(env?.variables ?? []), collection: toVarMap(col?.variables ?? []), globals: toVarMap(ws.globals) }
}

/** Write variable changes made by scripts back into the workspace tables. */
function applyRunVariables(
  ws: Workspace,
  collectionId: string | undefined,
  before: Pick<RunVariables, 'environment' | 'collection' | 'globals'>,
  after: Pick<RunVariables, 'environment' | 'collection' | 'globals'>
): Workspace {
  return {
    ...ws,
    environments: ws.environments.map((e) =>
      e.id === ws.activeEnvironmentId ? { ...e, variables: applyVarChanges(e.variables, before.environment, after.environment) } : e
    ),
    collections: ws.collections.map((c) =>
      c.id === collectionId ? { ...c, variables: applyVarChanges(c.variables, before.collection, after.collection) } : c
    ),
    globals: applyVarChanges(ws.globals, before.globals, after.globals)
  }
}

export function prepareTab(ws: Workspace, tab: Tab): PreparedRequest {
  const loc = tab.itemId ? locate(ws.collections, tab.itemId) : undefined
  return prepareRequest(tab.draft, scopesFor(ws, tab.itemId), loc ? parentAuths(loc) : [])
}

export const useStore = create<State>((set, get) => {
  /** Apply a change to the workspace and schedule a save. */
  const mutate = (fn: (ws: Workspace) => Workspace): void => {
    const workspace = fn(get().workspace)
    set({ workspace })
    persist(workspace)
  }
  const patchTab = (id: string, patch: Partial<Tab>): void =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const mapCollection = (id: string, fn: (c: Collection) => Collection): void =>
    mutate((ws) => ({ ...ws, collections: ws.collections.map((c) => (c.id === id ? fn(c) : c)) }))
  const mapCollectionOf = (itemId: string, fn: (c: Collection) => Collection): void => {
    const loc = locate(get().workspace.collections, itemId)
    if (loc) mapCollection(loc.collection.id, fn)
  }

  return {
    ready: false,
    workspace: { collections: [], environments: [], globals: [], activeEnvironmentId: null, history: [] },
    tabs: [],
    activeTabId: null,
    sidebar: 'collections',
    modal: null,
    toast: null,
    console: [],
    consoleOpen: false,
    runner: null,

    async init() {
      const workspace = await window.api.loadWorkspace()
      const tab = blankTab()
      set({ workspace, ready: true, tabs: [tab], activeTabId: tab.id })
    },
    setSidebar: (sidebar) => set({ sidebar }),
    openModal: (modal) => set({ modal }),
    showToast(toast) {
      set({ toast })
      setTimeout(() => get().toast === toast && set({ toast: null }), 2500)
    },

    toggleConsole: (open) => set((s) => ({ consoleOpen: open ?? !s.consoleOpen })),
    clearConsole: () => set({ console: [] }),

    newTab(req) {
      const tab = blankTab(req)
      if (req) tab.dirty = true
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    },
    openItem(itemId) {
      const existing = get().tabs.find((t) => t.itemId === itemId)
      if (existing) return set({ activeTabId: existing.id })
      const loc = locate(get().workspace.collections, itemId)
      if (!loc || loc.item.type !== 'request') return
      const tab = blankTab(loc.item.request, itemId)
      // Replace the active tab if it's an untouched scratch tab, like Postman's preview tab.
      set((s) => {
        const active = s.tabs.find((t) => t.id === s.activeTabId)
        const reuse = active && !active.itemId && !active.dirty && !active.response && !active.draft.url
        return { tabs: reuse ? s.tabs.map((t) => (t.id === active.id ? tab : t)) : [...s.tabs, tab], activeTabId: tab.id }
      })
    },
    openHistory(entryId) {
      const entry = get().workspace.history.find((h) => h.id === entryId)
      if (entry) get().newTab({ ...structuredClone(entry.request), id: uid() })
    },
    closeTab(id) {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id)
        const tab = s.tabs[idx]
        if (tab?.execId) void window.api.cancel(tab.execId)
        let tabs = s.tabs.filter((t) => t.id !== id)
        if (tabs.length === 0) tabs = [blankTab()]
        const activeTabId = s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTabId
        return { tabs, activeTabId }
      })
    },
    activateTab: (activeTabId) => set({ activeTabId }),
    updateDraft(tabId, patch) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft: { ...t.draft, ...patch }, dirty: true } : t)) }))
    },
    saveTab(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (!tab.itemId || !locate(get().workspace.collections, tab.itemId)) return set({ modal: { kind: 'saveAs', tabId } })
      const itemId = tab.itemId
      mapCollectionOf(itemId, (c) => ({
        ...c,
        items: updateItem(c.items, itemId, (i) => (i.type === 'request' ? { ...i, request: { ...structuredClone(tab.draft), id: i.id } } : i))
      }))
      patchTab(tabId, { dirty: false })
      get().showToast('Saved')
    },
    saveTabAs(tabId, collectionId, folderId, name) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab) return
      const request = { ...structuredClone(tab.draft), id: uid(), name }
      mapCollection(collectionId, (c) => ({ ...c, items: insertItem(c.items, folderId, newRequestItem(request)) }))
      patchTab(tabId, { itemId: request.id, draft: request, dirty: false })
      set({ modal: null })
      get().showToast(`Saved to collection`)
    },
    async send(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || tab.loading || !tab.draft.url.trim()) return
      const ws = get().workspace
      const loc = tab.itemId ? locate(ws.collections, tab.itemId) : undefined
      const scripts = scriptChain(loc?.collection, loc?.folders ?? [], tab.draft)
      const before = persistentVars(ws, loc?.collection.id)
      const input: RunRequestInput = {
        request: tab.draft,
        parentAuths: loc ? parentAuths(loc) : [],
        preRequestScripts: scripts.pre,
        testScripts: scripts.test,
        variables: { local: {}, data: {}, ...before },
        info: { requestName: tab.draft.name, requestId: tab.draft.id, iteration: 0, iterationCount: 1 }
      }

      input.cookies = ws.cookies ?? []
      input.network = ws.settings

      const execId = uid()
      patchTab(tabId, { loading: true, execId, error: undefined, scriptError: undefined, tests: undefined, sentAt: Date.now() })
      const run = await window.api.runRequest(execId, input)
      const result = run.result

      // Script variable changes persist even when the request itself failed.
      mutate((w) => {
        const next = applyRunVariables(w, loc?.collection.id, before, run.variables)
        return {
          ...next,
          cookies: run.cookies,
          history: [
            {
              id: uid(),
              timestamp: Date.now(),
              request: structuredClone(tab.draft),
              status: result?.ok ? result.response.status : undefined,
              durationMs: result?.ok ? result.response.timings.total : undefined
            },
            ...next.history
          ].slice(0, HISTORY_LIMIT)
        }
      })

      const summary: ConsoleEntry = {
        level: result?.ok ? (result.response.status >= 400 ? 'warn' : 'info') : 'error',
        message: run.sent
          ? `${run.sent.method} ${run.sent.url} → ${result?.ok ? `${result.response.status} ${result.response.statusText} · ${Math.round(result.response.timings.total)} ms` : (result?.error ?? '')}`
          : `${tab.draft.method} ${tab.draft.url} → not sent${run.scriptError ? ` (${run.scriptError})` : result && !result.ok ? ` (${result.error})` : ''}`,
        timestamp: Date.now(),
        source: tab.draft.name
      }
      set((s) => ({ console: [...s.console, ...run.console, summary].slice(-CONSOLE_LIMIT) }))

      if (!get().tabs.some((t) => t.id === tabId)) return
      patchTab(tabId, {
        loading: false,
        execId: undefined,
        response: result?.ok ? result.response : undefined,
        error: result && !result.ok ? result.error : !result ? run.scriptError : undefined,
        scriptError: run.scriptError,
        tests: run.tests
      })
    },
    cancel(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (tab?.execId) void window.api.cancel(tab.execId)
    },

    addCollection(c = newCollection()) {
      mutate((ws) => ({ ...ws, collections: [...ws.collections, c] }))
      return c.id
    },
    updateCollection: (id, patch) => mapCollection(id, (c) => ({ ...c, ...patch })),
    deleteCollection: (id) => mutate((ws) => ({ ...ws, collections: ws.collections.filter((c) => c.id !== id) })),
    addFolder: (collectionId, parentId, name) => mapCollection(collectionId, (c) => ({ ...c, items: insertItem(c.items, parentId, newFolder(name)) })),
    addRequestTo(collectionId, parentId) {
      const item = newRequestItem()
      mapCollection(collectionId, (c) => ({ ...c, items: insertItem(c.items, parentId, item) }))
      get().openItem(item.id)
    },
    renameItem(itemId, name) {
      mapCollectionOf(itemId, (c) => ({
        ...c,
        items: updateItem(c.items, itemId, (i) => (i.type === 'folder' ? { ...i, name } : { ...i, request: { ...i.request, name } }))
      }))
      set((s) => ({ tabs: s.tabs.map((t) => (t.itemId === itemId ? { ...t, draft: { ...t.draft, name } } : t)) }))
    },
    deleteItem(itemId) {
      mapCollectionOf(itemId, (c) => ({ ...c, items: removeItem(c.items, itemId) }))
      set((s) => ({ tabs: s.tabs.map((t) => (t.itemId === itemId ? { ...t, itemId: null, dirty: true } : t)) }))
    },
    duplicateItem(itemId) {
      const loc = locate(get().workspace.collections, itemId)
      if (!loc) return
      const parent = loc.folders[0]?.id ?? null
      mapCollection(loc.collection.id, (c) => ({ ...c, items: insertItem(c.items, parent, cloneItem(loc.item)) }))
    },

    updateFolder(folderId, patch) {
      mapCollectionOf(folderId, (c) => ({ ...c, items: updateItem(c.items, folderId, (i) => (i.type === 'folder' ? { ...i, ...patch } : i)) }))
    },

    async startRunner(collectionId, folderId, requestIds, { persistVariables, ...options }) {
      if (get().runner?.status === 'running') return
      const ws = get().workspace
      const collection = ws.collections.find((c) => c.id === collectionId)
      if (!collection) return
      const wanted = new Set(requestIds)
      const steps: RunStep[] = runnableRequests(collection, folderId)
        .filter((r) => wanted.has(r.item.id))
        .map(({ item, folders }) => {
          const scripts = scriptChain(collection, folders, item.request)
          return {
            request: item.request,
            parentAuths: [...folders.map((f) => f.auth), collection.auth],
            preRequestScripts: scripts.pre,
            testScripts: scripts.test
          }
        })
      const runId = uid()
      const before = persistentVars(ws, collectionId)
      set({ runner: { runId, collectionId, folderId, status: 'running', results: [] } })

      const off = window.api.onRunnerResult((id, r) => {
        if (id !== runId) return
        set((s) => ({
          runner: s.runner && s.runner.runId === runId ? { ...s.runner, results: [...s.runner.results, r] } : s.runner,
          console: [...s.console, ...r.console].slice(-CONSOLE_LIMIT)
        }))
      })
      try {
        const { summary, variables, cookies } = await window.api.startRunner(runId, steps, before, options, { cookies: ws.cookies ?? [], network: ws.settings })
        mutate((w) => ({ ...(persistVariables ? applyRunVariables(w, collectionId, before, variables) : w), cookies }))
        set((s) => ({ runner: s.runner?.runId === runId ? { ...s.runner, status: 'done', summary } : s.runner }))
      } catch (e) {
        set((s) => ({ runner: s.runner?.runId === runId ? { ...s.runner, status: 'done', error: (e as Error).message } : s.runner }))
      } finally {
        off()
      }
    },
    stopRunner() {
      const r = get().runner
      if (r?.status === 'running') void window.api.cancel(r.runId)
    },
    clearRunner: () => set((s) => (s.runner?.status === 'running' ? {} : { runner: null })),

    addEnvironment(e = newEnvironment()) {
      mutate((ws) => ({ ...ws, environments: [...ws.environments, e] }))
      return e.id
    },
    updateEnvironment: (id, patch) =>
      mutate((ws) => ({ ...ws, environments: ws.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    deleteEnvironment: (id) =>
      mutate((ws) => ({
        ...ws,
        environments: ws.environments.filter((e) => e.id !== id),
        activeEnvironmentId: ws.activeEnvironmentId === id ? null : ws.activeEnvironmentId
      })),
    setActiveEnvironment: (id) => mutate((ws) => ({ ...ws, activeEnvironmentId: id })),
    updateGlobals: (globals) => mutate((ws) => ({ ...ws, globals })),
    clearHistory: () => mutate((ws) => ({ ...ws, history: [] })),
    setCookies: (cookies) => mutate((ws) => ({ ...ws, cookies })),
    updateNetwork: (patch) => mutate((ws) => ({ ...ws, settings: { ...DEFAULT_NETWORK, ...ws.settings, ...patch } }))
  }
})
