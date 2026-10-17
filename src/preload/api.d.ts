import type { ExecuteResult, PreparedRequest, Workspace } from '../core/types'

/** The bridge the renderer sees as `window.api`. */
export interface Api {
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(ws: Workspace): Promise<void>
  execute(id: string, req: PreparedRequest): Promise<ExecuteResult>
  cancel(id: string): Promise<void>
  pickFile(): Promise<string | null>
  openJson(): Promise<{ path: string; content: string } | null>
  saveJson(defaultName: string, content: string): Promise<boolean>
  saveBinary(defaultName: string, base64: string): Promise<boolean>
}

declare global {
  interface Window {
    api: Api
  }
}
