import { app, safeStorage } from 'electron'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openSecrets, sealSecrets, type Cipher } from '@core/secretsAtRest'
import { pruneHistory } from '@core/policy'
import type { Workspace } from '@core/types'

// The workspace is one JSON file in the user-data dir. Writes go to a temp file and are
// renamed into place so a crash mid-write never corrupts it. Credentials in it are encrypted with
// the OS keychain (macOS Keychain, Windows DPAPI, libsecret/kwallet on Linux) and the file is
// readable only by the current user.

const file = (): string => join(app.getPath('userData'), 'workspace.json')

export const EMPTY_WORKSPACE: Workspace = {
  collections: [],
  environments: [],
  globals: [],
  activeEnvironmentId: null,
  history: []
}

/** Electron's safeStorage, when it's backed by a real keychain (not Linux's plain-text fallback). */
function cipher(): Cipher | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return null
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  let raw: Workspace
  try {
    raw = { ...EMPTY_WORKSPACE, ...JSON.parse(await readFile(file(), 'utf8')) }
  } catch {
    return EMPTY_WORKSPACE
  }
  // Managed history retention applies to what's on disk as well as to what the app shows.
  raw.history = pruneHistory(raw.history ?? [])
  const c = cipher()
  if (!c) return raw
  const { workspace, failed } = openSecrets(raw, c)
  if (failed) console.warn(`ApiMan: ${failed} stored secret(s) could not be decrypted (the OS keychain entry changed) and were cleared`)
  return workspace
}

let queue: Promise<void> = Promise.resolve()

export function saveWorkspace(ws: Workspace): Promise<void> {
  ws = { ...ws, history: pruneHistory(ws.history ?? []) }
  queue = queue.then(async () => {
    await mkdir(app.getPath('userData'), { recursive: true })
    const c = cipher()
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify(c ? sealSecrets(ws, c) : ws, null, 2), { encoding: 'utf8', mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, file())
  })
  return queue
}

export const workspacePath = file
