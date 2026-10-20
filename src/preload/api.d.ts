import type { MockLogEntry } from '../core/mockRoutes'
import type { PolicyInfo } from '../core/policy'
import type {
  Collection,
  GrpcServiceInfo,
  RealtimeOpenInput,
  StreamEvent,
  Cookie,
  NetworkSettings,
  OAuth2Config,
  OAuth2TokenResult,
  RunnerOptions,
  RunnerRequestResult,
  RunnerSummary,
  RunRequestInput,
  RunRequestResult,
  RunStep,
  RunVariables,
  Workspace
} from '../core/types'

type PersistentVars = Pick<RunVariables, 'environment' | 'collection' | 'globals'>
type OpenedFile = { path: string; content: string } | null
export type NetContext = { cookies: Cookie[]; network?: NetworkSettings }
export type TokenResponse = ({ ok: true; token: OAuth2TokenResult } | { ok: false; error: string }) & { cookies: Cookie[] }

/** The bridge the renderer sees as `window.api`. */
export interface Api {
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(ws: Workspace): Promise<void>
  runRequest(id: string, input: RunRequestInput): Promise<RunRequestResult>
  /** Cancels a request or a collection run by id. */
  cancel(id: string): Promise<void>
  startRunner(
    runId: string,
    steps: RunStep[],
    vars: PersistentVars,
    options: RunnerOptions,
    ctx: NetContext & { collection?: Collection }
  ): Promise<{ summary: RunnerSummary; variables: PersistentVars; cookies: Cookie[] }>
  oauth2Token(cfg: OAuth2Config, ctx: NetContext): Promise<TokenResponse>
  oauth2Refresh(cfg: OAuth2Config, ctx: NetContext): Promise<TokenResponse>
  /** Subscribe to per-request runner results; returns an unsubscribe function. */
  onRunnerResult(cb: (runId: string, result: RunnerRequestResult) => void): () => void
  pickFile(): Promise<string | null>
  pickFiles(extensions?: string[]): Promise<string[]>
  realtimeOpen(id: string, input: RealtimeOpenInput): Promise<{ ok: true } | { ok: false; error: string }>
  realtimeSend(id: string, data: string): Promise<void>
  realtimeEnd(id: string): Promise<void>
  realtimeClose(id: string): Promise<void>
  /** Subscribe to events from all realtime sessions; returns an unsubscribe function. */
  onRealtimeEvent(cb: (id: string, event: StreamEvent) => void): () => void
  mockStart(collectionId: string, collection: Collection, port: number): Promise<{ ok: true; port: number } | { ok: false; error: string }>
  mockStop(collectionId: string): Promise<void>
  mockUpdate(collectionId: string, collection: Collection): Promise<void>
  onMockLog(cb: (collectionId: string, entry: MockLogEntry) => void): () => void
  grpcDescribe(input: RealtimeOpenInput): Promise<{ ok: true; services: GrpcServiceInfo[] } | { ok: false; error: string }>
  openJson(): Promise<OpenedFile>
  openDataFile(): Promise<OpenedFile>
  saveJson(defaultName: string, content: string): Promise<boolean>
  saveBinary(defaultName: string, base64: string): Promise<boolean>
  saveText(defaultName: string, content: string, extensions: string[]): Promise<boolean>
  /** Desktop notification; clicking it focuses the app. */
  notify(title: string, body: string): Promise<void>
  /** The administrator-managed policy in force (read-only). */
  getPolicy(): Promise<PolicyInfo>
}

declare global {
  interface Window {
    api: Api
  }
}
