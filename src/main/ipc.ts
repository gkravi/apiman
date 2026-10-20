import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Only the app's own page may call into the main process. Every other frame (an OAuth sign-in
// window, an HTML response preview, anything that slipped past navigation guards) is refused.

const indexFile = (): string => pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** True for the app's own page: the dev server in development, the bundled index.html otherwise. */
export function isAppUrl(url: string): boolean {
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }
  return url.split(/[?#]/)[0] === indexFile()
}

export function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, (e, ...args) => {
    const frame = e.senderFrame
    if (!frame || frame !== e.sender.mainFrame || !isAppUrl(frame.url)) throw new Error(`Blocked IPC "${channel}" from an untrusted frame`)
    return fn(e, ...(args as A))
  })
}
