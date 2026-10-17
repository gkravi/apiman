import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCollection, runRequest } from '@core/run'
import { CookieJar } from '@core/cookies'
import { getToken, refresh } from './oauth'
import type { Cookie, NetworkSettings, OAuth2Config, RunnerOptions, RunRequestInput, RunStep, RunVariables } from '@core/types'
import { loadWorkspace, saveWorkspace } from './storage'

const inflight = new Map<string, AbortController>()

// Lets a second instance (tests, demos) use its own workspace instead of the real one.
if (process.env.APIMAN_USER_DATA) app.setPath('userData', process.env.APIMAN_USER_DATA)

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

// Every in-flight request or runner is cancellable by the id the renderer gave it.
async function cancellable<T>(id: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  inflight.set(id, ctrl)
  try {
    return await fn(ctrl.signal)
  } finally {
    inflight.delete(id)
  }
}

ipcMain.handle('run:request', (_e, id: string, input: RunRequestInput) => cancellable(id, (signal) => runRequest(input, signal)))
ipcMain.handle('run:cancel', (_e, id: string) => inflight.get(id)?.abort())

ipcMain.handle(
  'runner:start',
  (
    e,
    runId: string,
    steps: RunStep[],
    vars: Pick<RunVariables, 'environment' | 'collection' | 'globals'>,
    options: RunnerOptions,
    ctx: { cookies: Cookie[]; network?: NetworkSettings }
  ) =>
    cancellable(runId, (signal) =>
      runCollection(steps, vars, options, {
        signal,
        cookies: ctx.cookies,
        network: ctx.network,
        onResult: (r) => !e.sender.isDestroyed() && e.sender.send('runner:result', runId, r)
      })
    )
)

// OAuth 2.0: token calls share the user's cookies and proxy/certificate settings.
ipcMain.handle('oauth2:token', async (e, cfg: OAuth2Config, ctx: { cookies: Cookie[]; network?: NetworkSettings }) => {
  const jar = new CookieJar(ctx.cookies)
  try {
    const token = await getToken(cfg, BrowserWindow.fromWebContents(e.sender), { jar, network: ctx.network })
    return { ok: true, token, cookies: jar.toJSON() }
  } catch (err) {
    return { ok: false, error: (err as Error).message, cookies: jar.toJSON() }
  }
})
ipcMain.handle('oauth2:refresh', async (_e, cfg: OAuth2Config, ctx: { cookies: Cookie[]; network?: NetworkSettings }) => {
  const jar = new CookieJar(ctx.cookies)
  try {
    return { ok: true, token: await refresh(cfg, { jar, network: ctx.network }), cookies: jar.toJSON() }
  } catch (err) {
    return { ok: false, error: (err as Error).message, cookies: jar.toJSON() }
  }
})

ipcMain.handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:openJson', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Collections & API specs', extensions: ['json', 'yaml', 'yml'] }] })
  if (r.canceled) return null
  return { path: r.filePaths[0], content: await readFile(r.filePaths[0], 'utf8') }
})

ipcMain.handle('dialog:openData', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Data files', extensions: ['csv', 'json'] }] })
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
