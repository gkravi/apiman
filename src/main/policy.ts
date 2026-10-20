import { app, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergePolicies, parsePolicy, setActivePolicy, type ManagedPolicy, type PolicyInfo } from '@core/policy'
import { handle } from './ipc'

// Administrator-managed policy, read once at startup from a machine-wide location that only an
// administrator can write. A policy that can't be read or is invalid stops the app: running
// without the restrictions an organisation asked for would be worse than not running.

const APP_ID = 'dev.apiman.app'

/** Where an administrator puts policy.json on this platform. */
export function policyFilePath(): string {
  // Development and test instances may point at their own file; packaged builds never do.
  if (!app.isPackaged && process.env.APIMAN_POLICY_FILE) return process.env.APIMAN_POLICY_FILE
  if (process.platform === 'darwin') return '/Library/Application Support/ApiMan/policy.json'
  if (process.platform === 'win32') return join(process.env.ProgramData ?? 'C:\\ProgramData', 'ApiMan', 'policy.json')
  return '/etc/apiman/policy.json'
}

/** macOS configuration profiles (MDM) for the app's domain, machine-wide then per-user. */
function managedPreferenceFiles(): string[] {
  if (process.platform !== 'darwin' || (!app.isPackaged && process.env.APIMAN_POLICY_FILE)) return []
  const user = process.env.USER
  return [`/Library/Managed Preferences/${APP_ID}.plist`, ...(user ? [`/Library/Managed Preferences/${user}/${APP_ID}.plist`] : [])]
}

let info: PolicyInfo = { policy: {}, sources: [] }

function read(): PolicyInfo {
  const found: { source: string; policy: ManagedPolicy }[] = []
  const file = policyFilePath()
  if (existsSync(file)) {
    let doc: unknown
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${(e as Error).message}`)
    }
    found.push({ source: file, ...parse(doc, file) })
  }
  for (const plist of managedPreferenceFiles()) {
    if (!existsSync(plist)) continue
    // plutil ships with macOS and turns the (often binary) plist into JSON.
    const doc = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }))
    found.push({ source: plist, ...parse(doc, plist) })
  }
  return { policy: mergePolicies(...found.map((f) => f.policy)), sources: found.map((f) => f.source) }
}

function parse(doc: unknown, source: string): { policy: ManagedPolicy } {
  const { policy, warnings } = parsePolicy(doc, source)
  for (const w of warnings) console.warn(`ApiMan policy: ${w}`)
  return { policy }
}

/** Load and activate the policy; call before any window or IPC handler can send a request. */
export function loadPolicy(): void {
  try {
    info = read()
  } catch (e) {
    dialog.showErrorBox('ApiMan can’t start', `Your organisation’s ApiMan policy couldn’t be read:\n\n${(e as Error).message}\n\nContact your administrator.`)
    app.exit(1)
    return
  }
  setActivePolicy(info.policy)
  if (info.sources.length) console.log(`ApiMan policy loaded from ${info.sources.join(', ')}`)
}

export function registerPolicy(): void {
  // Read-only: the renderer can show what's locked but has no way to change it.
  handle('policy:get', () => info)
}
