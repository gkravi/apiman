import type { ApiRequest, Auth, Collection, CollectionItem, Folder, RequestItem } from './types'

// Immutable helpers for the collection tree (collection → folders → requests).

export interface Located {
  collection: Collection
  item: CollectionItem
  /** Ancestor folders, nearest first. */
  folders: Folder[]
}

export function locate(collections: Collection[], itemId: string): Located | undefined {
  const walk = (items: CollectionItem[], folders: Folder[], collection: Collection): Located | undefined => {
    for (const item of items) {
      if (item.id === itemId) return { collection, item, folders }
      if (item.type === 'folder') {
        const hit = walk(item.items, [item, ...folders], collection)
        if (hit) return hit
      }
    }
    return undefined
  }
  for (const c of collections) {
    const hit = walk(c.items, [], c)
    if (hit) return hit
  }
  return undefined
}

/** Auths to inherit from, nearest first: parent folders, then the collection. */
export function parentAuths(loc: Located): (Auth | undefined)[] {
  return [...loc.folders.map((f) => f.auth), loc.collection.auth]
}

export function mapItems(items: CollectionItem[], fn: (item: CollectionItem) => CollectionItem | null): CollectionItem[] {
  const out: CollectionItem[] = []
  for (const item of items) {
    const mapped = fn(item)
    if (!mapped) continue
    out.push(mapped.type === 'folder' ? { ...mapped, items: mapItems(mapped.items, fn) } : mapped)
  }
  return out
}

export const removeItem = (items: CollectionItem[], id: string): CollectionItem[] => mapItems(items, (i) => (i.id === id ? null : i))

export const updateItem = (items: CollectionItem[], id: string, patch: (i: CollectionItem) => CollectionItem): CollectionItem[] =>
  mapItems(items, (i) => (i.id === id ? patch(i) : i))

/** Insert `child` into folder `parentId`, or at the top level when parentId is null. */
export function insertItem(items: CollectionItem[], parentId: string | null, child: CollectionItem): CollectionItem[] {
  if (parentId === null) return [...items, child]
  return mapItems(items, (i) => (i.id === parentId && i.type === 'folder' ? { ...i, items: [...i.items, child] } : i))
}

export function allRequests(items: CollectionItem[]): RequestItem[] {
  return items.flatMap((i) => (i.type === 'folder' ? allRequests(i.items) : [i]))
}

/**
 * Scripts that run around a request, outermost first (collection → folders → request),
 * matching Postman's execution order.
 */
export function scriptChain(collection: Collection | undefined, folders: Folder[], request: ApiRequest): { pre: string[]; test: string[] } {
  const owners = [collection?.scripts, ...[...folders].reverse().map((f) => f.scripts), request.scripts]
  const pick = (k: 'preRequest' | 'test'): string[] => owners.map((s) => s?.[k] ?? '').filter((code) => code.trim())
  return { pre: pick('preRequest'), test: pick('test') }
}

export interface RunnableRequest {
  item: RequestItem
  /** Ancestor folders, nearest first. */
  folders: Folder[]
}

/** Requests in run order (depth-first), optionally limited to one folder of the collection. */
export function runnableRequests(collection: Collection, folderId: string | null = null): RunnableRequest[] {
  const walk = (items: CollectionItem[], folders: Folder[]): RunnableRequest[] =>
    // Only request/response (HTTP) requests can run unattended; live connections are skipped.
    items.flatMap((i) => (i.type === 'folder' ? walk(i.items, [i, ...folders]) : (i.request.protocol ?? 'http') === 'http' ? [{ item: i, folders }] : []))
  if (!folderId) return walk(collection.items, [])
  const loc = locate([collection], folderId)
  if (!loc || loc.item.type !== 'folder') return []
  return walk(loc.item.items, [loc.item, ...loc.folders])
}

/**
 * Find a request by name for $response(): "Name", or "Folder/Name" (any depth) when names repeat.
 * The first match in sidebar order wins.
 */
export function findRequestByRef(collection: Collection, ref: string): RunnableRequest | undefined {
  const parts = ref.split('/').map((p) => p.trim()).filter(Boolean)
  const name = parts.pop()
  const all: RunnableRequest[] = []
  const walk = (items: CollectionItem[], folders: Folder[]): void => {
    for (const i of items) {
      if (i.type === 'folder') walk(i.items, [i, ...folders])
      else all.push({ item: i, folders })
    }
  }
  walk(collection.items, [])
  return all.find(({ item, folders }) => {
    if (item.request.name !== name) return false
    if (!parts.length) return true
    // Folder names must match the end of the request's folder path, outermost first.
    const path = [...folders].reverse().map((f) => f.name)
    return parts.every((p, k) => path[path.length - parts.length + k] === p)
  })
}
