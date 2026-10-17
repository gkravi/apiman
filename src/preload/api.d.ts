import type {
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
    ctx: NetContext
  ): Promise<{ summary: RunnerSummary; variables: PersistentVars; cookies: Cookie[] }>
  oauth2Token(cfg: OAuth2Config, ctx: NetContext): Promise<TokenResponse>
  oauth2Refresh(cfg: OAuth2Config, ctx: NetContext): Promise<TokenResponse>
  /** Subscribe to per-request runner results; returns an unsubscribe function. */
  onRunnerResult(cb: (runId: string, result: RunnerRequestResult) => void): () => void
  pickFile(): Promise<string | null>
  openJson(): Promise<OpenedFile>
  openDataFile(): Promise<OpenedFile>
  saveJson(defaultName: string, content: string): Promise<boolean>
  saveBinary(defaultName: string, base64: string): Promise<boolean>
}

declare global {
  interface Window {
    api: Api
  }
}
