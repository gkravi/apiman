import { ipcMain, type WebContents } from 'electron'
import { openSse, openWebSocket, type RealtimeSession } from '@core/realtime'
import { describeProto, openGrpc } from '@core/grpc'
import type { RealtimeOpenInput, StreamEvent } from '@core/types'

// Live WebSocket / SSE / gRPC sessions, keyed by an id the renderer chooses. Events stream back
// on 'rt:event'; a session is forgotten once it reports 'close'.
const sessions = new Map<string, { session: RealtimeSession; owner: WebContents }>()

export function registerRealtime(): void {
  ipcMain.handle('rt:open', async (e, id: string, input: RealtimeOpenInput) => {
    const owner = e.sender
    const emit = (ev: Omit<StreamEvent, 'timestamp'>): void => {
      if (!owner.isDestroyed()) owner.send('rt:event', id, { ...ev, timestamp: Date.now() })
      if (ev.kind === 'close') sessions.delete(id)
    }
    try {
      const open = input.request.protocol === 'grpc' ? openGrpc : input.request.protocol === 'sse' ? openSse : openWebSocket
      const session = await open(input, emit)
      sessions.set(id, { session, owner })
      owner.once('destroyed', () => session.close())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('rt:send', (_e, id: string, data: string) => sessions.get(id)?.session.send(data))
  ipcMain.handle('rt:end', (_e, id: string) => sessions.get(id)?.session.end())
  ipcMain.handle('rt:close', (_e, id: string) => sessions.get(id)?.session.close())

  ipcMain.handle('grpc:describe', async (_e, files: string[], includeDirs: string[]) => {
    try {
      return { ok: true, services: await describeProto(files, includeDirs) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
