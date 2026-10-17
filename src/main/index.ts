import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execute } from '@core/executor'
import type { PreparedRequest } from '@core/types'
import { loadWorkspace, saveWorkspace } from './storage'

const inflight = new Map<string, AbortController>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ApiMan',
    backgroundColor: '#1e1f22',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  // Links in responses (e.g. HTML preview) open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('workspace:load', () => loadWorkspace())
ipcMain.handle('workspace:save', (_e, ws) => saveWorkspace(ws))

ipcMain.handle('http:execute', async (_e, id: string, req: PreparedRequest) => {
  const ctrl = new AbortController()
  inflight.set(id, ctrl)
  try {
    return await execute(req, ctrl.signal)
  } finally {
    inflight.delete(id)
  }
})
ipcMain.handle('http:cancel', (_e, id: string) => inflight.get(id)?.abort())

ipcMain.handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:openJson', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled) return null
  return { path: r.filePaths[0], content: await readFile(r.filePaths[0], 'utf8') }
})

ipcMain.handle('dialog:saveJson', async (_e, defaultName: string, content: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, content, 'utf8')
  return true
})

ipcMain.handle('dialog:saveBinary', async (_e, defaultName: string, base64: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, Buffer.from(base64, 'base64'))
  return true
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
