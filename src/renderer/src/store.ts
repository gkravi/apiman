import { create } from 'zustand'
import { newCollection, newEnvironment, newFolder, newRequest, newRequestItem, uid } from '@core/factory'
import { prepareRequest } from '@core/prepare'
import { insertItem, locate, parentAuths, removeItem, runnableRequests, scriptChain, updateItem } from '@core/tree'
import { applyVarChanges, toVarMap } from '@core/varsync'
import { introspectionRequest, schemaFromResponse } from '@core/graphql'
import type { GraphQLSchema } from 'graphql'
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
  Workspace,
  Monitor,
  MonitorRun,
  StreamEvent,
  GrpcServiceInfo
} from '@core/types'
import { DEFAULT_NETWORK } from '@core/types'
import type { MockLogEntry } from '@core/mockRoutes'
import { applyTheme, loadThemePref, resolveTheme, saveThemePref, type Theme, type ThemePref } from './theme'

const HISTORY_LIMIT = 200
const CONSOLE_LIMIT = 1000
const LIVE_EVENT_LIMIT = 2000
let unsubscribeLive: (() => void) | undefined
let unsubscribeMock: (() => void) | undefined

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
  /** WebSocket / SSE / gRPC connection state and message log. */
  live?: LiveState
}

export interface LiveState {
  sessionId: string
  status: 'connecting' | 'open' | 'closed'
  events: StreamEvent[]
}

export interface MockState {
  status: 'starting' | 'running' | 'stopped'
  port: number
  error?: string
  log: MockLogEntry[]
}

export interface GrpcState {
  loading: boolean
  services?: GrpcServiceInfo[]
  error?: string
}

export interface SchemaState {
  loading: boolean
  schema?: GraphQLSchema
  error?: string
  fetchedAt?: number
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

export type SidebarView = 'collections' | 'environments' | 'history' | 'monitors'

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
  | { kind: 'mock'; collectionId: string }
  | { kind: 'monitor'; monitorId: string | null }
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
  themePref: ThemePref
  theme: Theme
  paletteOpen: boolean
  runner: RunnerState | null
  /** GraphQL schemas by tab id (in memory only; refetched per session). */
  schemas: Record<string, SchemaState>
  /** gRPC services discovered from each tab's proto files. */
  grpc: Record<string, GrpcState>
  /** Mock servers by collection id. */
  mocks: Record<string, MockState>

  init(): Promise<void>
  setSidebar(v: SidebarView): void
  openModal(m: Modal | null): void
  showToast(msg: string): void
  toggleConsole(open?: boolean): void
  setThemePref(pref: ThemePref): void
  /** Re-resolve 'system' after the OS theme changes. */
  syncTheme(): void
  togglePalette(open?: boolean): void
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
  fetchSchema(tabId: string): Promise<void>
  connect(tabId: string): Promise<void>
  disconnect(tabId: string): void
  sendLive(tabId: string, text: string): void
  endLive(tabId: string): void
  clearLive(tabId: string): void
  loadProtos(tabId: string): Promise<void>
  saveExample(tabId: string, name: string): void
  deleteExample(tabId: string, exampleId: string): void
  startMock(collectionId: string, port: number): Promise<void>
  /** Ids of monitors currently running. */
  monitorsRunning: string[]
  saveMonitor(m: Monitor): void
  deleteMonitor(id: string): void
  runMonitor(id: string): Promise<void>
  /** Called periodically: runs every enabled monitor that is due. */
  tickMonitors(): void
  stopMock(collectionId: string): Promise<void>

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

/** Variables a run starts with: an environment (the active one by default), the collection, globals. */
function persistentVars(
  ws: Workspace,
  collectionId: string | undefined,
  environmentId: string | null = ws.activeEnvironmentId
): Pick<RunVariables, 'environment' | 'collection' | 'globals'> {
  const env = ws.environments.find((e) => e.id === environmentId)
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

/** Everything a single send needs: inherited auth and scripts, variables, cookies, network settings. */
function runInputFor(ws: Workspace, tab: Tab, request: ApiRequest, withScripts = true) {
  const loc = tab.itemId ? locate(ws.collections, tab.itemId) : undefined
  const scripts = withScripts ? scriptChain(loc?.collection, loc?.folders ?? [], request) : { pre: [], test: [] }
  const before = persistentVars(ws, loc?.collection.id)
  const input: RunRequestInput = {
    request,
    parentAuths: loc ? parentAuths(loc) : [],
    preRequestScripts: scripts.pre,
    testScripts: scripts.test,
    variables: { local: {}, data: {}, ...before },
    cookies: ws.cookies ?? [],
    network: ws.settings,
    info: { requestName: request.name, requestId: request.id, iteration: 0, iterationCount: 1 }
  }
  return { input, before, loc }
}

/** Runner steps for a collection (or one folder), each with its inherited auth and scripts. */
function collectionSteps(collection: Collection, folderId: string | null, only?: Set<string>): RunStep[] {
  return runnableRequests(collection, folderId)
    .filter((r) => !only || only.has(r.item.id))
    .map(({ item, folders }) => {
      const scripts = scriptChain(collection, folders, item.request)
      return { request: item.request, parentAuths: [...folders.map((f) => f.auth), collection.auth], preRequestScripts: scripts.pre, testScripts: scripts.test }
    })
}

const MONITOR_HISTORY = 50

export function prepareTab(ws: Workspace, tab: Tab): PreparedRequest {
  const loc = tab.itemId ? locate(ws.collections, tab.itemId) : undefined
  return prepareRequest(tab.draft, scopesFor(ws, tab.itemId), loc ? parentAuths(loc) : [])
}

export const useStore = create<State>((set, get) => {
  /** Apply a change to the workspace and schedule a save. */
  const mutate = (fn: (ws: Workspace) => Workspace): void => {
    const before = get().workspace
    const workspace = fn(before)
    set({ workspace })
    persist(workspace)
    // Running mock servers follow collection edits (new examples, renamed paths…) immediately.
    for (const [id, m] of Object.entries(get().mocks)) {
      if (m.status !== 'running') continue
      const c = workspace.collections.find((x) => x.id === id)
      if (c && c !== before.collections.find((x) => x.id === id)) void window.api.mockUpdate(id, c)
    }
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
    themePref: loadThemePref(),
    theme: resolveTheme(loadThemePref()),
    paletteOpen: false,
    runner: null,
    schemas: {},
    grpc: {},
    mocks: {},
    monitorsRunning: [],

    async init() {
      const workspace = await window.api.loadWorkspace()
      const tab = blankTab()
      set({ workspace, ready: true, tabs: [tab], activeTabId: tab.id })
      unsubscribeMock?.()
      unsubscribeMock = window.api.onMockLog((id, entry) =>
        set((s) => (s.mocks[id] ? { mocks: { ...s.mocks, [id]: { ...s.mocks[id], log: [...s.mocks[id].log, entry].slice(-500) } } } : {}))
      )
      // One listener for every live session; events find their tab by session id.
      unsubscribeLive?.()
      unsubscribeLive = window.api.onRealtimeEvent((id, ev) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.live?.sessionId !== id) return t
            const status = ev.kind === 'open' ? 'open' : ev.kind === 'close' ? 'closed' : t.live.status
            return { ...t, live: { ...t.live, status, events: [...t.live.events, ev].slice(-LIVE_EVENT_LIMIT) } }
          })
        }))
      )
    },
    setSidebar: (sidebar) => set({ sidebar }),
    openModal: (modal) => set({ modal }),
    showToast(toast) {
      set({ toast })
      setTimeout(() => get().toast === toast && set({ toast: null }), 2500)
    },

    toggleConsole: (open) => set((s) => ({ consoleOpen: open ?? !s.consoleOpen })),
    setThemePref(themePref) {
      saveThemePref(themePref)
      const theme = resolveTheme(themePref)
      applyTheme(theme)
      set({ themePref, theme })
    },
    syncTheme() {
      const theme = resolveTheme(get().themePref)
      applyTheme(theme)
      set({ theme })
    },
    togglePalette: (open) => set((s) => ({ paletteOpen: open ?? !s.paletteOpen })),
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
        if (tab?.live && tab.live.status !== 'closed') void window.api.realtimeClose(tab.live.sessionId)
        let tabs = s.tabs.filter((t) => t.id !== id)
        const { [id]: _dropped, ...schemas } = s.schemas
        const { [id]: _droppedGrpc, ...grpc } = s.grpc
        if (tabs.length === 0) tabs = [blankTab()]
        const activeTabId = s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTabId
        return { tabs, activeTabId, schemas, grpc }
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
      const { input, before, loc } = runInputFor(ws, tab, tab.draft)

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
    async fetchSchema(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || !tab.draft.url.trim()) return
      const setSchema = (st: SchemaState): void => set((s) => ({ schemas: { ...s.schemas, [tabId]: st } }))
      setSchema({ ...get().schemas[tabId], loading: true, error: undefined })
      const { input } = runInputFor(get().workspace, tab, introspectionRequest(tab.draft), false)
      const run = await window.api.runRequest(uid(), input)
      if (run.cookies) get().setCookies(run.cookies)
      const r = run.result
      if (!r) return setSchema({ loading: false, error: run.scriptError ?? 'Request not sent' })
      if (!r.ok) return setSchema({ loading: false, error: r.error })
      try {
        setSchema({ loading: false, schema: schemaFromResponse(r.response.status, r.response.body), fetchedAt: Date.now() })
      } catch (e) {
        setSchema({ loading: false, error: (e as Error).message })
      }
    },
    async connect(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || !tab.draft.url.trim()) return
      if (tab.live && tab.live.status !== 'closed') get().disconnect(tabId)
      const { input } = runInputFor(get().workspace, tab, tab.draft, false)
      const sessionId = uid()
      // gRPC unary/server-streaming calls finish on their own, so keep earlier exchanges visible.
      const keep = tab.draft.protocol === 'grpc' ? (tab.live?.events ?? []) : []
      patchTab(tabId, { live: { sessionId, status: 'connecting', events: keep } })
      const r = await window.api.realtimeOpen(sessionId, {
        request: input.request,
        parentAuths: input.parentAuths,
        variables: input.variables,
        cookies: input.cookies,
        network: input.network
      })
      if (!r.ok) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.live?.sessionId === sessionId
              ? { ...t, live: { ...t.live, status: 'closed', events: [...t.live.events, { kind: 'error', data: r.error, timestamp: Date.now() }] } }
              : t
          )
        }))
      }
    },
    disconnect(tabId) {
      const live = get().tabs.find((t) => t.id === tabId)?.live
      if (live && live.status !== 'closed') void window.api.realtimeClose(live.sessionId)
    },
    sendLive(tabId, text) {
      const live = get().tabs.find((t) => t.id === tabId)?.live
      if (live?.status === 'open') void window.api.realtimeSend(live.sessionId, text)
    },
    endLive(tabId) {
      const live = get().tabs.find((t) => t.id === tabId)?.live
      if (live?.status === 'open') void window.api.realtimeEnd(live.sessionId)
    },
    clearLive(tabId) {
      const live = get().tabs.find((t) => t.id === tabId)?.live
      if (live) patchTab(tabId, { live: { ...live, events: [] } })
    },
    async loadProtos(tabId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      const cfg = tab?.draft.grpc
      const reflection = cfg?.source === 'reflection'
      if (!tab || !cfg || (reflection ? !tab.draft.url.trim() : !cfg.protoFiles.length)) {
        return set((s) => ({ grpc: { ...s.grpc, [tabId]: { loading: false } } }))
      }
      set((s) => ({ grpc: { ...s.grpc, [tabId]: { ...s.grpc[tabId], loading: true, error: undefined } } }))
      const { input } = runInputFor(get().workspace, tab, tab.draft, false)
      const r = await window.api.grpcDescribe({ request: input.request, parentAuths: input.parentAuths, variables: input.variables, cookies: input.cookies, network: input.network })
      set((s) => ({ grpc: { ...s.grpc, [tabId]: r.ok ? { loading: false, services: r.services } : { loading: false, error: r.error } } }))
    },
    saveExample(tabId, name) {
      const tab = get().tabs.find((t) => t.id === tabId)
      const res = tab?.response
      if (!tab || !res) return
      const example = {
        id: uid(),
        name,
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body: res.bodyEncoding === 'utf8' ? res.body : ''
      }
      const examples = [...(tab.draft.examples ?? []), example]
      patchTab(tabId, { draft: { ...tab.draft, examples } })
      // Examples belong to the saved request, like Postman: write them through without saving other edits.
      if (tab.itemId) {
        const itemId = tab.itemId
        mapCollectionOf(itemId, (c) => ({ ...c, items: updateItem(c.items, itemId, (i) => (i.type === 'request' ? { ...i, request: { ...i.request, examples } } : i)) }))
        get().showToast(`Saved example "${name}"`)
      } else get().showToast('Example added — save the request to a collection to keep it')
    },
    deleteExample(tabId, exampleId) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab) return
      const examples = (tab.draft.examples ?? []).filter((e) => e.id !== exampleId)
      patchTab(tabId, { draft: { ...tab.draft, examples } })
      if (tab.itemId) {
        const itemId = tab.itemId
        mapCollectionOf(itemId, (c) => ({ ...c, items: updateItem(c.items, itemId, (i) => (i.type === 'request' ? { ...i, request: { ...i.request, examples } } : i)) }))
      }
    },
    async startMock(collectionId, port) {
      const c = get().workspace.collections.find((x) => x.id === collectionId)
      if (!c) return
      const setMock = (m: Partial<MockState>): void =>
        set((s) => {
          const prev: MockState = (s.mocks[collectionId] as MockState | undefined) ?? { status: 'stopped', port, log: [] }
          return { mocks: { ...s.mocks, [collectionId]: { ...prev, ...m } } }
        })
      setMock({ status: 'starting', port, error: undefined })
      const r = await window.api.mockStart(collectionId, c, port)
      setMock(r.ok ? { status: 'running', port: r.port } : { status: 'stopped', error: r.error })
    },
    async stopMock(collectionId) {
      await window.api.mockStop(collectionId)
      set((s) => (s.mocks[collectionId] ? { mocks: { ...s.mocks, [collectionId]: { ...s.mocks[collectionId], status: 'stopped' } } } : {}))
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
      const steps = collectionSteps(collection, folderId, new Set(requestIds))
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
    saveMonitor(m) {
      mutate((ws) => {
        const list = ws.monitors ?? []
        return { ...ws, monitors: list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m] }
      })
    },
    deleteMonitor: (id) => mutate((ws) => ({ ...ws, monitors: (ws.monitors ?? []).filter((m) => m.id !== id) })),
    async runMonitor(id) {
      const ws = get().workspace
      const monitor = ws.monitors?.find((m) => m.id === id)
      const collection = ws.collections.find((c) => c.id === monitor?.collectionId)
      if (!monitor || get().monitorsRunning.includes(id)) return
      const record = (run: MonitorRun): void => {
        mutate((w) => ({ ...w, monitors: (w.monitors ?? []).map((m) => (m.id === id ? { ...m, runs: [run, ...m.runs].slice(0, MONITOR_HISTORY) } : m)) }))
        const failed = run.testsFailed + run.errors > 0
        if (failed && monitor.notifyOnFailure) {
          void window.api.notify(`Monitor failed: ${monitor.name}`, run.failures.slice(0, 3).join('\n') || `${run.testsFailed} failed tests, ${run.errors} errors`)
        }
      }
      const startedAt = Date.now()
      if (!collection) {
        return record({ id: uid(), startedAt, durationMs: 0, requests: 0, testsPassed: 0, testsFailed: 0, errors: 1, failures: ['The collection no longer exists'] })
      }
      set((s) => ({ monitorsRunning: [...s.monitorsRunning, id] }))
      const failures: string[] = []
      const runId = uid()
      const off = window.api.onRunnerResult((rid, r) => {
        if (rid !== runId) return
        if (r.error || r.scriptError) failures.push(`${r.name}: ${r.error ?? r.scriptError}`)
        for (const t of r.tests) if (!t.passed) failures.push(`${r.name} — ${t.name}: ${t.error ?? 'failed'}`)
      })
      try {
        // Monitors are hands-off: they never change your variables or cookies.
        const { summary } = await window.api.startRunner(
          runId,
          collectionSteps(collection, null),
          persistentVars(ws, collection.id, monitor.environmentId),
          { iterations: 1, delayMs: 0, data: [], stopOnError: false },
          { cookies: [], network: ws.settings }
        )
        record({
          id: runId,
          startedAt,
          durationMs: summary.durationMs,
          requests: summary.requests,
          testsPassed: summary.testsPassed,
          testsFailed: summary.testsFailed,
          errors: summary.errors,
          failures: failures.slice(0, 20)
        })
      } catch (e) {
        record({ id: runId, startedAt, durationMs: Date.now() - startedAt, requests: 0, testsPassed: 0, testsFailed: 0, errors: 1, failures: [(e as Error).message] })
      } finally {
        off()
        set((s) => ({ monitorsRunning: s.monitorsRunning.filter((x) => x !== id) }))
      }
    },
    tickMonitors() {
      const now = Date.now()
      for (const m of get().workspace.monitors ?? []) {
        if (!m.enabled) continue
        const last = m.runs[0]?.startedAt ?? 0
        if (now - last >= m.intervalMinutes * 60_000) void get().runMonitor(m.id)
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
