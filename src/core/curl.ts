import { newKeyValue, newRequest } from './factory'
import { paramsFromUrl } from './url'
import { HTTP_METHODS, type ApiRequest, type FormField, type HttpMethod, type PreparedRequest } from './types'

/** Split a shell command line into argv, honouring quotes, escapes and line continuations. */
export function shellSplit(cmd: string): string[] {
  const args: string[] = []
  let cur = ''
  let inArg = false
  let quote: '"' | "'" | null = null
  const s = cmd.replace(/\\\r?\n/g, ' ')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else cur += c
    } else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i]
      else cur += c
    } else if (c === "'" || c === '"') {
      quote = c
      inArg = true
    } else if (c === '$' && s[i + 1] === "'") {
      // ANSI-C quoting $'...' — handle the common escapes
      let j = i + 2
      while (j < s.length && s[j] !== "'") {
        if (s[j] === '\\' && j + 1 < s.length) {
          const e = s[++j]
          cur += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
        } else cur += s[j]
        j++
      }
      i = j
      inArg = true
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i]
      inArg = true
    } else if (/\s/.test(c)) {
      if (inArg) args.push(cur)
      cur = ''
      inArg = false
    } else {
      cur += c
      inArg = true
    }
  }
  if (inArg) args.push(cur)
  return args
}

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'])
const IGNORED_WITH_VALUE = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '-e', '--referer', '--cacert', '--cert', '--key'])

export function parseCurl(command: string): ApiRequest {
  const argv = shellSplit(command.trim())
  if (argv[0] !== 'curl') throw new Error('Not a cURL command (must start with "curl")')

  let method: HttpMethod | undefined
  let url = ''
  const headers = []
  const data: string[] = []
  const form: FormField[] = []
  let user: string | undefined
  let useGet = false
  let insecure = false
  let follow = false

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => argv[++i] ?? ''
    if (a === '-X' || a === '--request') method = next().toUpperCase() as HttpMethod
    else if (a === '-H' || a === '--header') {
      const h = next()
      const idx = h.indexOf(':')
      if (idx > 0) headers.push(newKeyValue(h.slice(0, idx).trim(), h.slice(idx + 1).trim()))
    } else if (DATA_FLAGS.has(a)) data.push(next())
    else if (a === '--json') {
      data.push(next())
      headers.push(newKeyValue('Content-Type', 'application/json'), newKeyValue('Accept', 'application/json'))
    } else if (a === '-F' || a === '--form') {
      const f = next()
      const eq = f.indexOf('=')
      const key = f.slice(0, eq)
      const value = f.slice(eq + 1)
      form.push(
        value.startsWith('@')
          ? { ...newKeyValue(key, ''), type: 'file', filePath: value.slice(1) }
          : { ...newKeyValue(key, value), type: 'text' }
      )
    } else if (a === '-u' || a === '--user') user = next()
    else if (a === '-b' || a === '--cookie') headers.push(newKeyValue('Cookie', next()))
    else if (a === '-A' || a === '--user-agent') headers.push(newKeyValue('User-Agent', next()))
    else if (a === '-G' || a === '--get') useGet = true
    else if (a === '-k' || a === '--insecure') insecure = true
    else if (a === '-L' || a === '--location') follow = true
    else if (a === '-I' || a === '--head') method = 'HEAD'
    else if (a === '--url') url = next()
    else if (IGNORED_WITH_VALUE.has(a)) next()
    else if (!a.startsWith('-') && !url) url = a
  }

  if (useGet && data.length) {
    url += (url.includes('?') ? '&' : '?') + data.join('&')
    data.length = 0
  }

  const req = newRequest({ url, headers, params: paramsFromUrl(url) })
  req.name = url.replace(/^https?:\/\//, '').split('?')[0] || 'Imported cURL'
  req.settings = { ...req.settings, verifySsl: !insecure, followRedirects: follow || req.settings.followRedirects }

  if (form.length) req.body = { mode: 'formdata', formdata: form }
  else if (data.length) {
    const raw = data.join('&')
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
    if (/json/i.test(ct) || /^\s*[[{]/.test(raw)) {
      req.body = { mode: 'raw', raw, language: 'json' }
    } else if (!ct || /x-www-form-urlencoded/i.test(ct)) {
      req.body = { mode: 'urlencoded', urlencoded: paramsFromUrl(`?${raw}`) }
      req.headers = headers.filter((h) => h.key.toLowerCase() !== 'content-type')
    } else req.body = { mode: 'raw', raw, language: /xml/i.test(ct) ? 'xml' : 'text' }
  }

  if (user !== undefined) {
    const idx = user.indexOf(':')
    req.auth = { type: 'basic', username: idx >= 0 ? user.slice(0, idx) : user, password: idx >= 0 ? user.slice(idx + 1) : '' }
  }

  req.method = method && HTTP_METHODS.includes(method) ? method : data.length || form.length ? 'POST' : 'GET'
  return req
}

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export function toCurl(req: PreparedRequest): string {
  const lines = [`curl --location --request ${req.method} ${shq(req.url)}`]
  for (const [k, v] of req.headers) lines.push(`--header ${shq(`${k}: ${v}`)}`)
  const b = req.body
  if (b.kind === 'text') lines.push(`--data-raw ${shq(b.text)}`)
  else if (b.kind === 'file') lines.push(`--data-binary ${shq(`@${b.filePath}`)}`)
  else if (b.kind === 'multipart')
    for (const f of b.fields) lines.push(`--form ${shq(f.filePath ? `${f.name}=@${f.filePath}` : `${f.name}=${f.value ?? ''}`)}`)
  if (!req.settings.verifySsl) lines.push('--insecure')
  return lines.join(' \\\n  ')
}
