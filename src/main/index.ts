import { app, BrowserWindow, dialog, Notification, session, shell } from 'electron'
import { handle, isAppUrl } from './ipc'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCollection, runRequest } from '@core/run'
import { CookieJar } from '@core/cookies'
import { getToken, refresh } from './oauth'
import { registerRealtime } from './realtime'
import { registerMocks } from './mock'
import { loadPolicy, registerPolicy } from './policy'
import type { Collection, Cookie, NetworkSettings, Workspace, OAuth2Config, RunnerOptions, RunRequestInput, RunStep, RunVariables } from '@core/types'
import { loadWorkspace, saveWorkspace } from './storage'

const inflight = new Map<string, AbortController>()

// Lets a second instance (tests, demos) use its own workspace instead of the real one.
if (process.env.APIMAN_USER_DATA) app.setPath('userData', process.env.APIMAN_USER_DATA)

// The managed policy is in force before any handler below can run.
loadPolicy()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ApiMan',
    backgroundColor: '#15161c',
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

  // The window only ever shows the app itself; links in docs or responses open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

handle('workspace:load', () => loadWorkspace())
handle('workspace:save', (_e, ws: Workspace) => saveWorkspace(ws))

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

handle('run:request', (_e, id: string, input: RunRequestInput) => cancellable(id, (signal) => runRequest(input, signal)))
handle('run:cancel', (_e, id: string) => inflight.get(id)?.abort())

handle(
  'runner:start',
  (
    e,
    runId: string,
    steps: RunStep[],
    vars: Pick<RunVariables, 'environment' | 'collection' | 'globals'>,
    options: RunnerOptions,
    ctx: { cookies: Cookie[]; network?: NetworkSettings; collection?: Collection }
  ) =>
    cancellable(runId, (signal) =>
      runCollection(steps, vars, options, {
        signal,
        cookies: ctx.cookies,
        network: ctx.network,
        collection: ctx.collection,
        onResult: (r) => !e.sender.isDestroyed() && e.sender.send('runner:result', runId, r)
      })
    )
)

// OAuth 2.0: token calls share the user's cookies and proxy/certificate settings.
handle('oauth2:token', async (e, cfg: OAuth2Config, ctx: { cookies: Cookie[]; network?: NetworkSettings }) => {
  const jar = new CookieJar(ctx.cookies)
  try {
    const token = await getToken(cfg, BrowserWindow.fromWebContents(e.sender), { jar, network: ctx.network })
    return { ok: true, token, cookies: jar.toJSON() }
  } catch (err) {
    return { ok: false, error: (err as Error).message, cookies: jar.toJSON() }
  }
})
handle('oauth2:refresh', async (_e, cfg: OAuth2Config, ctx: { cookies: Cookie[]; network?: NetworkSettings }) => {
  const jar = new CookieJar(ctx.cookies)
  try {
    return { ok: true, token: await refresh(cfg, { jar, network: ctx.network }), cookies: jar.toJSON() }
  } catch (err) {
    return { ok: false, error: (err as Error).message, cookies: jar.toJSON() }
  }
})

registerRealtime()
registerMocks()
registerPolicy()

handle('dialog:pickFiles', async (_e, extensions?: string[]) => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: extensions ? [{ name: extensions.join(', '), extensions }] : [] })
  return r.canceled ? [] : r.filePaths
})

handle('dialog:pickFile', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'] })
  return r.canceled ? null : r.filePaths[0]
})

handle('dialog:openJson', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Collections & API specs', extensions: ['json', 'yaml', 'yml'] }] })
  if (r.canceled) return null
  return { path: r.filePaths[0], content: await readFile(r.filePaths[0], 'utf8') }
})

handle('dialog:openData', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Data files', extensions: ['csv', 'json'] }] })
  if (r.canceled) return null
  return { path: r.filePaths[0], content: await readFile(r.filePaths[0], 'utf8') }
})

handle('dialog:saveJson', async (_e, defaultName: string, content: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, content, 'utf8')
  return true
})

handle('notify', (e, title: string, body: string) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  n.show()
})

handle('dialog:saveText', async (_e, defaultName: string, content: string, extensions: string[]) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: extensions.join(', ').toUpperCase(), extensions }] })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, content, 'utf8')
  return true
})

handle('dialog:saveBinary', async (_e, defaultName: string, base64: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, Buffer.from(base64, 'base64'))
  return true
})

// Defence in depth for every window, including OAuth sign-in: no <webview>, no new windows,
// and no device or OS permissions (camera, mic, geolocation, notifications from web content…).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  for (const ses of [session.defaultSession, session.fromPartition('persist:apiman-oauth')]) {
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  }
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
