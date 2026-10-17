import { app, ipcMain } from 'electron'
import { startMockServer, type MockServer } from '@core/mock'
import type { Collection } from '@core/types'

// One mock server per collection. Routes follow edits live via 'mock:update'.
const servers = new Map<string, MockServer>()

export function registerMocks(): void {
  ipcMain.handle('mock:start', async (e, collectionId: string, collection: Collection, port: number) => {
    await servers.get(collectionId)?.close()
    servers.delete(collectionId)
    try {
      const server = await startMockServer(collection, port, (entry) => !e.sender.isDestroyed() && e.sender.send('mock:log', collectionId, entry))
      servers.set(collectionId, server)
      return { ok: true, port: server.port }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('mock:stop', async (_e, collectionId: string) => {
    await servers.get(collectionId)?.close()
    servers.delete(collectionId)
  })
  ipcMain.handle('mock:update', (_e, collectionId: string, collection: Collection) => servers.get(collectionId)?.setCollection(collection))
  app.on('before-quit', () => servers.forEach((s) => void s.close()))
}
