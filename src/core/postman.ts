// Import/export of Postman Collection v2.0/v2.1 and Postman environment files,
// so existing collections work from day one.

import { newCollection, newEnvironment, newKeyValue, newRequest, uid } from './factory'
import { paramsFromUrl } from './url'
import {
  HTTP_METHODS,
  type ApiRequest,
  type Auth,
  type Collection,
  type CollectionItem,
  type Environment,
  type FormField,
  type HttpMethod,
  type KeyValue,
  type RawLanguage,
  type RequestBody,
  type SavedExample,
  type Scripts
} from './types'

type Json = any

const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

const toKv = (list: Json[] | undefined): KeyValue[] =>
  (list ?? []).map((x) => ({ ...newKeyValue(String(x.key ?? ''), String(x.value ?? '')), enabled: !x.disabled, description: x.description }))

const authParam = (list: Json[] | undefined, key: string): string =>
  String((Array.isArray(list) ? list.find((p) => p.key === key)?.value : list?.[key]) ?? '')

function importAuth(a: Json): Auth | undefined {
  if (!a) return undefined
  switch (a.type) {
    case 'noauth':
      return { type: 'none' }
    case 'basic':
      return { type: 'basic', username: authParam(a.basic, 'username'), password: authParam(a.basic, 'password') }
    case 'bearer':
      return { type: 'bearer', token: authParam(a.bearer, 'token') }
    case 'apikey':
      return { type: 'apikey', key: authParam(a.apikey, 'key'), value: authParam(a.apikey, 'value'), in: authParam(a.apikey, 'in') === 'query' ? 'query' : 'header' }
    default:
      return undefined // unsupported types (oauth2, digest…) fall back to inherit for now
  }
}

function exportAuth(a: Auth | undefined): Json {
  if (!a || a.type === 'inherit') return undefined
  const kv = (o: Record<string, string>): Json[] => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }))
  switch (a.type) {
    case 'none':
      return { type: 'noauth' }
    case 'basic':
      return { type: 'basic', basic: kv({ username: a.username, password: a.password }) }
    case 'bearer':
      return { type: 'bearer', bearer: kv({ token: a.token }) }
    case 'apikey':
      return { type: 'apikey', apikey: kv({ key: a.key, value: a.value, in: a.in }) }
  }
}

const scriptText = (events: Json[] | undefined, listen: string): string => {
  const exec = events?.find((e) => e?.listen === listen)?.script?.exec
  return Array.isArray(exec) ? exec.join('\n') : String(exec ?? '')
}

function importScripts(events: Json[] | undefined): Scripts | undefined {
  const preRequest = scriptText(events, 'prerequest')
  const test = scriptText(events, 'test')
  return preRequest || test ? { preRequest, test } : undefined
}

function exportScripts(s: Scripts | undefined): Json[] | undefined {
  const events = [
    s?.preRequest.trim() && { listen: 'prerequest', script: { type: 'text/javascript', exec: s.preRequest.split('\n') } },
    s?.test.trim() && { listen: 'test', script: { type: 'text/javascript', exec: s.test.split('\n') } }
  ].filter(Boolean)
  return events.length ? events : undefined
}

/** Postman descriptions are a string or { content, type }. */
const descriptionText = (d: Json): string | undefined => {
  const text = typeof d === 'string' ? d : typeof d?.content === 'string' ? d.content : undefined
  return text?.trim() ? text : undefined
}

function importExamples(responses: Json[] | undefined): SavedExample[] | undefined {
  if (!Array.isArray(responses) || responses.length === 0) return undefined
  return responses.map((r) => ({
    id: uid(),
    name: String(r?.name ?? 'Example'),
    status: Number(r?.code ?? 200),
    statusText: String(r?.status ?? ''),
    headers: (Array.isArray(r?.header) ? r.header : []).map((h: Json): [string, string] => [String(h.key ?? ''), String(h.value ?? '')]),
    body: String(r?.body ?? '')
  }))
}

function exportExamples(examples: SavedExample[] | undefined, request: Json): Json[] | undefined {
  if (!examples?.length) return undefined
  return examples.map((e) => ({
    name: e.name,
    originalRequest: request,
    status: e.statusText,
    code: e.status,
    header: e.headers.map(([key, value]) => ({ key, value })),
    body: e.body
  }))
}

function importBody(b: Json): RequestBody {
  if (!b || b.disabled) return { mode: 'none' }
  switch (b.mode) {
    case 'raw': {
      const lang = b.options?.raw?.language as RawLanguage | undefined
      return { mode: 'raw', raw: String(b.raw ?? ''), language: lang && ['json', 'text', 'xml', 'html', 'javascript'].includes(lang) ? lang : 'text' }
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: toKv(b.urlencoded) }
    case 'formdata':
      return {
        mode: 'formdata',
        formdata: (b.formdata ?? []).map(
          (f: Json): FormField => ({
            ...newKeyValue(String(f.key ?? ''), f.type === 'file' ? '' : String(f.value ?? '')),
            enabled: !f.disabled,
            type: f.type === 'file' ? 'file' : 'text',
            filePath: f.type === 'file' ? (Array.isArray(f.src) ? f.src[0] : f.src) : undefined
          })
        )
      }
    case 'file':
      return { mode: 'binary', filePath: String(b.file?.src ?? '') }
    case 'graphql':
      return { mode: 'graphql', query: String(b.graphql?.query ?? ''), variables: String(b.graphql?.variables ?? '') }
    default:
      return { mode: 'none' }
  }
}

function exportBody(b: RequestBody): Json {
  const kv = (list: KeyValue[]): Json[] => list.map((x) => ({ key: x.key, value: x.value, disabled: !x.enabled || undefined, type: 'text' }))
  switch (b.mode) {
    case 'none':
      return undefined
    case 'raw':
      return { mode: 'raw', raw: b.raw, options: { raw: { language: b.language } } }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: kv(b.urlencoded) }
    case 'formdata':
      return {
        mode: 'formdata',
        formdata: b.formdata.map((f) =>
          f.type === 'file'
            ? { key: f.key, type: 'file', src: f.filePath, disabled: !f.enabled || undefined }
            : { key: f.key, value: f.value, type: 'text', disabled: !f.enabled || undefined }
        )
      }
    case 'binary':
      return { mode: 'file', file: { src: b.filePath } }
    case 'graphql':
      return { mode: 'graphql', graphql: { query: b.query, variables: b.variables } }
  }
}

function importRequest(name: string, r: Json, events?: Json[]): ApiRequest {
  if (typeof r === 'string') return newRequest({ name, url: r, params: paramsFromUrl(r), scripts: importScripts(events) })
  const url = typeof r.url === 'string' ? r.url : String(r.url?.raw ?? '')
  const method = String(r.method ?? 'GET').toUpperCase() as HttpMethod
  const params = paramsFromUrl(url)
  // Postman stores disabled query params only in url.query; keep them.
  const disabled = (typeof r.url === 'object' ? (r.url.query ?? []) : []).filter((q: Json) => q.disabled)
  return newRequest({
    name,
    method: HTTP_METHODS.includes(method) ? method : 'GET',
    url,
    params: [...params, ...toKv(disabled)],
    headers: toKv(r.header),
    body: importBody(r.body),
    auth: importAuth(r.auth) ?? { type: 'inherit' },
    scripts: importScripts(events),
    description: descriptionText(r.description)
  })
}

function importItems(items: Json[] | undefined): CollectionItem[] {
  return (items ?? []).map((it: Json): CollectionItem => {
    if (Array.isArray(it.item)) {
      return {
        id: uid(),
        type: 'folder',
        name: String(it.name ?? 'Folder'),
        items: importItems(it.item),
        auth: importAuth(it.auth),
        scripts: importScripts(it.event),
        description: descriptionText(it.description)
      }
    }
    const request = importRequest(String(it.name ?? 'Request'), it.request ?? {}, it.event)
    request.examples = importExamples(it.response)
    return { id: request.id, type: 'request', request }
  })
}

export function isPostmanCollection(json: Json): boolean {
  return Boolean(json?.info && Array.isArray(json.item))
}

export function isPostmanEnvironment(json: Json): boolean {
  return Boolean(json && Array.isArray(json.values) && typeof json.name === 'string' && !json.item)
}

export function importPostmanCollection(json: Json): Collection {
  if (!isPostmanCollection(json)) throw new Error('Not a Postman collection (expected "info" and "item")')
  const schema = String(json.info.schema ?? '')
  if (schema && !/v2\.[01]/.test(schema)) throw new Error('Only Postman Collection v2.0 / v2.1 is supported')
  return {
    ...newCollection(String(json.info.name ?? 'Imported Collection')),
    items: importItems(json.item),
    variables: toKv(json.variable),
    auth: importAuth(json.auth) ?? { type: 'none' },
    scripts: importScripts(json.event),
    description: descriptionText(json.info.description)
  }
}

export function importPostmanEnvironment(json: Json): Environment {
  if (!isPostmanEnvironment(json)) throw new Error('Not a Postman environment')
  return {
    ...newEnvironment(json.name),
    variables: (json.values as Json[]).map((v) => ({
      ...newKeyValue(String(v.key ?? ''), String(v.value ?? '')),
      enabled: v.enabled !== false,
      secret: v.type === 'secret'
    }))
  }
}

function exportItems(items: CollectionItem[]): Json[] {
  return items.map((it) => {
    if (it.type === 'folder') return { name: it.name, description: it.description || undefined, item: exportItems(it.items), auth: exportAuth(it.auth), event: exportScripts(it.scripts) }
    const r = it.request
    const request = {
      method: r.method,
      header: r.headers.map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled || undefined })),
      body: exportBody(r.body),
      auth: exportAuth(r.auth),
      description: r.description || undefined,
      url: {
        raw: r.url,
        query: r.params.map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled || undefined }))
      }
    }
    return { name: r.name, event: exportScripts(r.scripts), request, response: exportExamples(r.examples, request) }
  })
}

export function exportPostmanCollection(c: Collection): Json {
  return {
    info: { _postman_id: c.id, name: c.name, schema: SCHEMA_V21, description: c.description || undefined },
    item: exportItems(c.items),
    variable: c.variables.map((v) => ({ key: v.key, value: v.value, disabled: !v.enabled || undefined })),
    auth: exportAuth(c.auth),
    event: exportScripts(c.scripts)
  }
}

export function exportPostmanEnvironment(e: Environment): Json {
  return {
    id: e.id,
    name: e.name,
    values: e.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled, type: v.secret ? 'secret' : 'default' })),
    _postman_variable_scope: 'environment'
  }
}
