// Guards for content that comes from someone else (imported collections, CLI collection files).
// Pure: shared by the renderer and the CLI.

import { mapItems } from './tree'
import type { ApiRequest, Collection } from './types'

export interface FileAttachment {
  requestName: string
  path: string
}

/** Every local file a collection would read and upload when its requests are sent. */
export function fileAttachments(collection: Collection): FileAttachment[] {
  const out: FileAttachment[] = []
  mapItems(collection.items, (i) => {
    if (i.type === 'request') for (const path of requestFiles(i.request)) out.push({ requestName: i.request.name, path })
    return i
  })
  return out
}

function requestFiles(r: ApiRequest): string[] {
  const b = r.body
  if (b.mode === 'binary') return b.filePath ? [b.filePath] : []
  if (b.mode === 'formdata') return b.formdata.filter((f) => f.type === 'file' && f.filePath).map((f) => f.filePath as string)
  return []
}

/** Rewrite every file path in a collection (an empty result detaches the file). */
export function mapFilePaths(collection: Collection, fn: (path: string, requestName: string) => string): Collection {
  const items = mapItems(collection.items, (i) => {
    if (i.type !== 'request') return i
    const b = i.request.body
    const name = i.request.name
    if (b.mode === 'binary' && b.filePath) return { ...i, request: { ...i.request, body: { ...b, filePath: fn(b.filePath, name) } } }
    if (b.mode === 'formdata')
      return {
        ...i,
        request: { ...i.request, body: { ...b, formdata: b.formdata.map((f) => (f.type === 'file' && f.filePath ? { ...f, filePath: fn(f.filePath, name) || undefined } : f)) } }
      }
    return i
  })
  return { ...collection, items }
}

/**
 * Clear file paths from an imported collection. A shared collection could otherwise point a form
 * field at ~/.ssh/id_rsa and upload it the first time the request is sent; the fields stay, so the
 * user just re-picks the file.
 */
export function detachFiles(collection: Collection): { collection: Collection; detached: FileAttachment[] } {
  const detached = fileAttachments(collection)
  return { collection: detached.length ? mapFilePaths(collection, () => '') : collection, detached }
}
