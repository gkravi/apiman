import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace } from '@core/types'

// The workspace is one JSON file in the user-data dir. Writes go to a temp file and are
// renamed into place so a crash mid-write never corrupts it.

const file = (): string => join(app.getPath('userData'), 'workspace.json')

export const EMPTY_WORKSPACE: Workspace = {
  collections: [],
  environments: [],
  globals: [],
  activeEnvironmentId: null,
  history: []
}

export async function loadWorkspace(): Promise<Workspace> {
  try {
    return { ...EMPTY_WORKSPACE, ...JSON.parse(await readFile(file(), 'utf8')) }
  } catch {
    return EMPTY_WORKSPACE
  }
}

let queue: Promise<void> = Promise.resolve()

export function saveWorkspace(ws: Workspace): Promise<void> {
  queue = queue.then(async () => {
    await mkdir(app.getPath('userData'), { recursive: true })
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify(ws, null, 2), 'utf8')
    await rename(tmp, file())
  })
  return queue
}

export const workspacePath = file
