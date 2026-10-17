// Shared data model. Pure types only — safe to import from main, preload and renderer.

import type { Cookie } from './cookies'

export type { Cookie }

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
  | { type: 'digest'; username: string; password: string }
  | ({ type: 'awsv4' } & AwsCredentials)
  | ({ type: 'oauth2' } & OAuth2Config)

export interface AwsCredentials {
  accessKey: string
  secretKey: string
  sessionToken: string
  region: string
  service: string
}

export type OAuth2Grant = 'authorization_code' | 'client_credentials' | 'password'

export interface OAuth2Config {
  grantType: OAuth2Grant
  authUrl: string
  accessTokenUrl: string
  clientId: string
  clientSecret: string
  scope: string
  redirectUri: string
  usePkce: boolean
  /** How client credentials are sent to the token endpoint. */
  clientAuth: 'header' | 'body'
  username: string
  password: string
  headerPrefix: string
  /** The current token — fetched with "Get New Access Token", stored with the request. */
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt?: number
}

export const DEFAULT_OAUTH2: OAuth2Config = {
  grantType: 'authorization_code',
  authUrl: '',
  accessTokenUrl: '',
  clientId: '',
  clientSecret: '',
  scope: '',
  redirectUri: 'http://localhost:5937/callback',
  usePkce: true,
  clientAuth: 'header',
  username: '',
  password: '',
  headerPrefix: 'Bearer',
  accessToken: ''
}

export interface OAuth2TokenResult {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  raw: Record<string, unknown>
}

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

export interface ProxySettings {
  enabled: boolean
  /** e.g. http://user:pass@proxy.local:8080 */
  url: string
  /** Comma-separated hosts that skip the proxy; supports *.domain and host:port. */
  bypass: string
}

export interface ClientCertificate {
  id: string
  /** Hostname the certificate is used for; `*.example.com` matches subdomains; optional :port. */
  host: string
  certPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
}

export interface NetworkSettings {
  proxy: ProxySettings
  /** Extra CA bundle (PEM) trusted in addition to the system roots. */
  caPath?: string
  certificates: ClientCertificate[]
}

export const DEFAULT_NETWORK: NetworkSettings = {
  proxy: { enabled: false, url: '', bypass: 'localhost,127.0.0.1' },
  certificates: []
}

export interface Workspace {
  collections: Collection[]
  environments: Environment[]
  globals: Variable[]
  activeEnvironmentId: string | null
  history: HistoryEntry[]
  cookies?: Cookie[]
  settings?: NetworkSettings
}

/** A request with every variable and inherited auth resolved — what the executor actually sends. */
export interface PreparedRequest {
  method: HttpMethod
  url: string
  headers: [string, string][]
  body: PreparedBody
  settings: RequestSettings
  /** Auth that needs the wire-level request (challenge round-trip or signing); handled by the executor. */
  digest?: { username: string; password: string }
  awsv4?: AwsCredentials
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
  /** Cookie jar contents going in; the updated jar comes back on the result. */
  cookies?: Cookie[]
  network?: NetworkSettings
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number }
}

export interface RunRequestResult {
  /** Undefined when a pre-request script failed and the request was never sent. */
  result?: ExecuteResult
  sent?: { method: string; url: string; headers: [string, string][] }
  tests: TestResult[]
  console: ConsoleEntry[]
  variables: RunVariables
  cookies: Cookie[]
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
