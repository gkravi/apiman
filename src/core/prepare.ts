import { normalizeUrl, splitUrl, urlWithParams } from './url'
import { resolve, type Scope } from './variables'
import type { ApiRequest, Auth, PreparedBody, PreparedRequest } from './types'

const RAW_CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript'
}

const base64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * Walk from the request up through its folders to the collection and return the first
 * auth that isn't "inherit". `parents` is ordered nearest-first.
 */
export function effectiveAuth(own: Auth, parents: (Auth | undefined)[]): Auth {
  if (own.type !== 'inherit') return own
  for (const a of parents) if (a && a.type !== 'inherit') return a
  return { type: 'none' }
}

/** Turn an editor request into exactly what goes on the wire: variables substituted, auth applied. */
export function prepareRequest(req: ApiRequest, scopes: Scope[], parentAuths: (Auth | undefined)[] = []): PreparedRequest {
  const r = (s: string): string => resolve(s, scopes)

  const headers: [string, string][] = req.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [r(h.key.trim()), r(h.value)])
  const hasHeader = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name.toLowerCase())

  // The URL bar is the source of truth for enabled params; disabled ones never reach it.
  let url = normalizeUrl(r(req.url))

  const auth = effectiveAuth(req.auth, parentAuths)
  switch (auth.type) {
    case 'basic':
      if (!hasHeader('authorization'))
        headers.push(['Authorization', `Basic ${base64(`${r(auth.username)}:${r(auth.password)}`)}`])
      break
    case 'bearer':
      if (!hasHeader('authorization')) headers.push(['Authorization', `Bearer ${r(auth.token)}`])
      break
    case 'oauth2':
      if (auth.accessToken && !hasHeader('authorization'))
        headers.push(['Authorization', `${r(auth.headerPrefix || 'Bearer')} ${r(auth.accessToken)}`.trim()])
      break
    case 'apikey':
      if (auth.in === 'header') headers.push([r(auth.key), r(auth.value)])
      else {
        const { base, query, hash } = splitUrl(url)
        const pair = `${encodeURIComponent(r(auth.key))}=${encodeURIComponent(r(auth.value))}`
        url = `${base}?${query ? `${query}&` : ''}${pair}${hash}`
      }
      break
  }

  let body: PreparedBody = { kind: 'none' }
  const b = req.body
  switch (b.mode) {
    case 'raw':
      body = { kind: 'text', text: r(b.raw), contentType: RAW_CONTENT_TYPES[b.language] }
      break
    case 'urlencoded':
      body = {
        kind: 'text',
        text: urlWithParams('', b.urlencoded.map((kv) => ({ ...kv, key: r(kv.key), value: r(kv.value) }))).slice(1),
        contentType: 'application/x-www-form-urlencoded'
      }
      break
    case 'formdata':
      body = {
        kind: 'multipart',
        fields: b.formdata
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => (f.type === 'file' ? { name: r(f.key), filePath: f.filePath ?? '' } : { name: r(f.key), value: r(f.value) }))
      }
      break
    case 'binary':
      if (b.filePath) body = { kind: 'file', filePath: b.filePath }
      break
    case 'graphql': {
      let variables: unknown = undefined
      const vars = r(b.variables).trim()
      if (vars) {
        try {
          variables = JSON.parse(vars)
        } catch {
          throw new Error('GraphQL variables are not valid JSON')
        }
      }
      body = { kind: 'text', text: JSON.stringify({ query: r(b.query), variables }), contentType: 'application/json' }
      break
    }
  }

  if (body.kind === 'text' && body.contentType && !hasHeader('content-type')) {
    headers.push(['Content-Type', body.contentType])
  }

  const prepared: PreparedRequest = { method: req.method, url, headers, body, settings: req.settings }
  if (auth.type === 'digest') prepared.digest = { username: r(auth.username), password: r(auth.password) }
  if (auth.type === 'awsv4')
    prepared.awsv4 = { accessKey: r(auth.accessKey), secretKey: r(auth.secretKey), sessionToken: r(auth.sessionToken), region: r(auth.region), service: r(auth.service) }
  return prepared
}
