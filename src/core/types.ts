// Shared data model. Pure types only — safe to import from main, preload and renderer.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export interface KeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
  description?: string
}

export interface FormField extends KeyValue {
  type: 'text' | 'file'
  /** Absolute path on disk when type === 'file'. */
  filePath?: string
}

export type RawLanguage = 'json' | 'text' | 'xml' | 'html' | 'javascript'

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; raw: string; language: RawLanguage }
  | { mode: 'urlencoded'; urlencoded: KeyValue[] }
  | { mode: 'formdata'; formdata: FormField[] }
  | { mode: 'binary'; filePath: string }
  | { mode: 'graphql'; query: string; variables: string }

export type BodyMode = RequestBody['mode']

export type Auth =
  | { type: 'inherit' }
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }

export type AuthType = Auth['type']

export interface RequestSettings {
  followRedirects: boolean
  maxRedirects: number
  verifySsl: boolean
  timeoutMs: number
}

export const DEFAULT_SETTINGS: RequestSettings = {
  followRedirects: true,
  maxRedirects: 10,
  verifySsl: true,
  timeoutMs: 30000
}

/** JavaScript run in the sandbox before the request is sent and after the response arrives. */
export interface Scripts {
  preRequest: string
  test: string
}

export interface ApiRequest {
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
  auth: Auth
  settings: RequestSettings
  scripts?: Scripts
}

export interface Folder {
  id: string
  type: 'folder'
  name: string
  items: CollectionItem[]
  auth?: Auth
  scripts?: Scripts
}

export interface RequestItem {
  id: string
  type: 'request'
  request: ApiRequest
}

export type CollectionItem = Folder | RequestItem

export interface Collection {
  id: string
  name: string
  items: CollectionItem[]
  variables: KeyValue[]
  auth: Auth
  scripts?: Scripts
}

export interface Variable extends KeyValue {
  secret?: boolean
}

export interface Environment {
  id: string
  name: string
  variables: Variable[]
}

export interface HistoryEntry {
  id: string
  timestamp: number
  request: ApiRequest
  status?: number
  durationMs?: number
}

export interface Workspace {
  collections: Collection[]
  environments: Environment[]
  globals: Variable[]
  activeEnvironmentId: string | null
  history: HistoryEntry[]
}

/** A request with every variable and inherited auth resolved — what the executor actually sends. */
export interface PreparedRequest {
  method: HttpMethod
  url: string
  headers: [string, string][]
  body: PreparedBody
  settings: RequestSettings
}

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'file'; filePath: string }
  | { kind: 'multipart'; fields: { name: string; value?: string; filePath?: string }[] }

export interface Timings {
  dns?: number
  connect?: number
  tls?: number
  firstByte?: number
  download?: number
  total: number
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: [string, string][]
  /** Body as UTF-8 text, or base64 when `bodyEncoding === 'base64'`. */
  body: string
  bodyEncoding: 'utf8' | 'base64'
  size: number
  timings: Timings
  url: string
  redirects: { url: string; status: number }[]
  httpVersion: string
}

export type ExecuteResult = { ok: true; response: ApiResponse } | { ok: false; error: string }

// ---------- scripting & runs ----------

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error'

export interface ConsoleEntry {
  level: LogLevel
  message: string
  timestamp: number
  /** Which request produced it, for the console panel. */
  source?: string
}

export type VarMap = Record<string, string>

/** Variable state carried through a run, highest priority first when resolving. */
export interface RunVariables {
  local: VarMap
  data: VarMap
  environment: VarMap
  collection: VarMap
  globals: VarMap
}

export interface RunRequestInput extends RunStep {
  variables: RunVariables
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number }
}

export interface RunRequestResult {
  /** Undefined when a pre-request script failed and the request was never sent. */
  result?: ExecuteResult
  sent?: { method: string; url: string; headers: [string, string][] }
  tests: TestResult[]
  console: ConsoleEntry[]
  variables: RunVariables
  scriptError?: string
  /** Set by pm.execution.setNextRequest: a request name, or null to stop. Undefined means "carry on". */
  nextRequest?: string | null
}

export interface RunnerOptions {
  iterations: number
  delayMs: number
  /** One row per iteration; when present, iterations defaults to its length. */
  data: VarMap[]
  stopOnError: boolean
}

export interface RunnerRequestResult {
  iteration: number
  requestId: string
  name: string
  method: HttpMethod
  url: string
  status?: number
  statusText?: string
  durationMs?: number
  size?: number
  /** Network/transport error, or the script error that stopped the request. */
  error?: string
  scriptError?: string
  tests: TestResult[]
  console: ConsoleEntry[]
}

/** One request in a run with everything it inherits from its folders and collection. */
export interface RunStep {
  request: ApiRequest
  parentAuths: (Auth | undefined)[]
  preRequestScripts: string[]
  testScripts: string[]
}

export interface RunnerSummary {
  iterations: number
  requests: number
  testsPassed: number
  testsFailed: number
  errors: number
  durationMs: number
  aborted: boolean
}
