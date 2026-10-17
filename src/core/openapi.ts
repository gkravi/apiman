// Import an OpenAPI 3.x or Swagger 2.0 document (JSON or YAML) as a collection: one folder per
// tag, a {{baseUrl}} collection variable, path params as {{variables}}, example bodies generated
// from schemas, and collection auth from the security schemes.

import { parse as parseYaml } from 'yaml'
import { newCollection, newFolder, newKeyValue, newRequest, newRequestItem } from './factory'
import { paramsFromUrl } from './url'
import { DEFAULT_OAUTH2, HTTP_METHODS, type Auth, type Collection, type CollectionItem, type HttpMethod, type KeyValue, type RequestBody } from './types'

type Json = any

export function parseSpecText(text: string): Json {
  const t = text.trim()
  if (t.startsWith('{')) return JSON.parse(t)
  return parseYaml(t)
}

export const isOpenApi = (doc: Json): boolean => Boolean(doc && typeof doc === 'object' && (typeof doc.openapi === 'string' || doc.swagger === '2.0') && doc.paths)

/** Follow a local "#/a/b" $ref. */
function deref(doc: Json, node: Json, seen = new Set<string>()): Json {
  let cur = node
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    const ref: string = cur.$ref
    if (!ref.startsWith('#/') || seen.has(ref)) return {}
    seen.add(ref)
    cur = ref
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((o: Json, k) => o?.[k], doc)
  }
  return cur ?? {}
}

/** Build an example value from a JSON schema. Depth- and cycle-limited. */
export function sampleFromSchema(doc: Json, schema: Json, depth = 0, seen = new Set<string>()): unknown {
  if (!schema || depth > 8) return null
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return {}
    return sampleFromSchema(doc, deref(doc, schema), depth + 1, new Set(seen).add(schema.$ref))
  }
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0]
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc: Json, s: Json) => {
      const v = sampleFromSchema(doc, s, depth + 1, seen)
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...v } : acc
    }, {})
  }
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0]
  if (variant) return sampleFromSchema(doc, variant, depth + 1, seen)

  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type
  if (type === 'object' || (!type && schema.properties)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = sampleFromSchema(doc, v, depth + 1, seen)
    return out
  }
  if (type === 'array') return [sampleFromSchema(doc, schema.items ?? {}, depth + 1, seen)]
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0
  if (type === 'boolean') return true
  if (type === 'string') {
    switch (schema.format) {
      case 'date-time':
        return '2024-01-01T00:00:00Z'
      case 'date':
        return '2024-01-01'
      case 'email':
        return 'user@example.com'
      case 'uuid':
        return '3fa85f64-5717-4562-b3fc-2c963f66afa6'
      case 'uri':
      case 'url':
        return 'https://example.com'
      case 'binary':
        return ''
    }
    return 'string'
  }
  return null
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function baseUrlOf(doc: Json): string {
  if (doc.swagger === '2.0') {
    const scheme = doc.schemes?.[0] ?? 'https'
    return doc.host ? `${scheme}://${doc.host}${doc.basePath ?? ''}`.replace(/\/$/, '') : (doc.basePath ?? '').replace(/\/$/, '')
  }
  const server = doc.servers?.[0]
  if (!server?.url) return ''
  let url: string = server.url
  for (const [name, v] of Object.entries<Json>(server.variables ?? {})) url = url.replaceAll(`{${name}}`, str(v.default))
  return url.replace(/\/$/, '')
}

function securityAuth(doc: Json): Auth {
  const schemes: Record<string, Json> = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {}
  const first = Object.keys(doc.security?.[0] ?? {})[0] ?? Object.keys(schemes)[0]
  const s = first ? schemes[first] : undefined
  if (!s) return { type: 'none' }
  if ((s.type === 'http' && /^bearer$/i.test(s.scheme)) || s.type === 'openIdConnect') return { type: 'bearer', token: '{{bearerToken}}' }
  if ((s.type === 'http' && /^basic$/i.test(s.scheme)) || s.type === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' }
  if (s.type === 'http' && /^digest$/i.test(s.scheme)) return { type: 'digest', username: '{{username}}', password: '{{password}}' }
  if (s.type === 'apiKey') return { type: 'apikey', key: s.name ?? 'X-API-Key', value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' }
  if (s.type === 'oauth2') {
    // OpenAPI 3 nests flows; Swagger 2 puts flow fields on the scheme.
    const flows: Record<string, Json> = s.flows ?? { [s.flow]: s }
    const [name, flow] = Object.entries(flows)[0] ?? []
    const grant = name === 'clientCredentials' || name === 'application' ? 'client_credentials' : name === 'password' ? 'password' : 'authorization_code'
    return {
      type: 'oauth2',
      ...DEFAULT_OAUTH2,
      grantType: grant,
      authUrl: flow?.authorizationUrl ?? '',
      accessTokenUrl: flow?.tokenUrl ?? '',
      clientId: '{{clientId}}',
      clientSecret: '{{clientSecret}}',
      scope: Object.keys(flow?.scopes ?? {}).join(' ')
    }
  }
  return { type: 'none' }
}

function bodyFor(doc: Json, op: Json, params: Json[]): { body: RequestBody; contentType?: string } {
  // Swagger 2: body / formData parameters.
  const bodyParam = params.find((p) => p.in === 'body')
  if (bodyParam) return { body: { mode: 'raw', raw: JSON.stringify(sampleFromSchema(doc, bodyParam.schema), null, 2), language: 'json' } }
  const formParams = params.filter((p) => p.in === 'formData')
  if (formParams.length) {
    const multipart = formParams.some((p) => p.type === 'file') || (op.consumes ?? doc.consumes ?? []).includes('multipart/form-data')
    if (multipart) {
      return {
        body: { mode: 'formdata', formdata: formParams.map((p) => ({ ...newKeyValue(p.name, p.type === 'file' ? '' : str(p.default ?? p.example)), type: p.type === 'file' ? 'file' : 'text' })) }
      }
    }
    return { body: { mode: 'urlencoded', urlencoded: formParams.map((p) => newKeyValue(p.name, str(p.default ?? p.example))) } }
  }

  const content: Record<string, Json> = deref(doc, op.requestBody)?.content ?? {}
  const types = Object.keys(content)
  if (!types.length) return { body: { mode: 'none' } }
  const pick = types.find((t) => /json/i.test(t)) ?? types[0]
  const media = content[pick]
  const example = media.example ?? Object.values<Json>(media.examples ?? {})[0]?.value
  const value = example !== undefined ? example : sampleFromSchema(doc, media.schema)

  if (/json/i.test(pick)) return { body: { mode: 'raw', raw: JSON.stringify(value, null, 2), language: 'json' }, contentType: pick === 'application/json' ? undefined : pick }
  if (/x-www-form-urlencoded/i.test(pick)) {
    const obj = (value ?? {}) as Record<string, unknown>
    return { body: { mode: 'urlencoded', urlencoded: Object.entries(obj).map(([k, v]) => newKeyValue(k, str(v))) } }
  }
  if (/multipart\/form-data/i.test(pick)) {
    const props: Record<string, Json> = deref(doc, media.schema)?.properties ?? {}
    return {
      body: {
        mode: 'formdata',
        formdata: Object.entries(props).map(([k, p]) => {
          const isFile = deref(doc, p)?.format === 'binary'
          return { ...newKeyValue(k, isFile ? '' : str(sampleFromSchema(doc, p))), type: isFile ? 'file' : 'text' }
        })
      }
    }
  }
  if (/xml/i.test(pick)) return { body: { mode: 'raw', raw: typeof value === 'string' ? value : '', language: 'xml' }, contentType: pick }
  return { body: { mode: 'raw', raw: typeof value === 'string' ? value : str(value), language: 'text' }, contentType: pick }
}

export function importOpenApi(doc: Json): Collection {
  if (!isOpenApi(doc)) throw new Error('Not an OpenAPI 3.x / Swagger 2.0 document')
  const collection = newCollection(doc.info?.title ?? 'Imported API')
  const variables: KeyValue[] = [newKeyValue('baseUrl', baseUrlOf(doc))]
  const pathVars = new Map<string, string>()
  const folders = new Map<string, CollectionItem[]>()
  const root: CollectionItem[] = []

  for (const [path, rawItem] of Object.entries<Json>(doc.paths ?? {})) {
    const pathItem = deref(doc, rawItem)
    const shared: Json[] = (pathItem.parameters ?? []).map((p: Json) => deref(doc, p))
    for (const [m, rawOp] of Object.entries<Json>(pathItem)) {
      const method = m.toUpperCase() as HttpMethod
      if (!HTTP_METHODS.includes(method)) continue
      const op = rawOp ?? {}
      // Operation-level parameters override path-level ones with the same name+location.
      const own: Json[] = (op.parameters ?? []).map((p: Json) => deref(doc, p))
      const params = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own]
      const value = (p: Json): string => str(p.example ?? p.schema?.example ?? p.default ?? p.schema?.default ?? (p.schema?.enum ?? p.enum)?.[0])

      for (const p of params.filter((p) => p.in === 'path')) if (!pathVars.has(p.name)) pathVars.set(p.name, value(p))
      const query = params.filter((p) => p.in === 'query').map((p) => ({ ...newKeyValue(p.name, value(p)), enabled: !!p.required, description: p.description }))
      const headers: KeyValue[] = params
        .filter((p) => p.in === 'header' && !/^(accept|content-type|authorization)$/i.test(p.name))
        .map((p) => ({ ...newKeyValue(p.name, value(p)), enabled: !!p.required, description: p.description }))

      const { body, contentType } = bodyFor(doc, op, params)
      if (contentType) headers.push(newKeyValue('Content-Type', contentType))

      const base = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`
      const enabledQuery = query.filter((q) => q.enabled)
      const url = enabledQuery.length ? `${base}?${enabledQuery.map((q) => `${encodeURIComponent(q.key)}=${q.value}`).join('&')}` : base
      const request = newRequest({
        name: op.summary || op.operationId || `${method} ${path}`,
        method,
        url,
        params: [...paramsFromUrl(url), ...query.filter((q) => !q.enabled)],
        headers,
        body,
        auth: Array.isArray(op.security) && op.security.length === 0 ? { type: 'none' } : { type: 'inherit' }
      })
      const tag = op.tags?.[0]
      if (tag) folders.set(tag, [...(folders.get(tag) ?? []), newRequestItem(request)])
      else root.push(newRequestItem(request))
    }
  }

  for (const [name, value] of pathVars) variables.push(newKeyValue(name, value))
  const tagOrder: string[] = (doc.tags ?? []).map((t: Json) => t.name)
  const sortedTags = [...folders.keys()].sort((a, b) => {
    const ia = tagOrder.indexOf(a)
    const ib = tagOrder.indexOf(b)
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
  })
  collection.items = [...sortedTags.map((t) => ({ ...newFolder(t), items: folders.get(t)! })), ...root]
  collection.variables = variables
  collection.auth = securityAuth(doc)
  return collection
}
