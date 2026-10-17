// RFC 6265 cookie jar. Pure — used by the executor (main process) to send/store cookies and by
// the renderer's cookie manager to list and edit them. Persisted as plain Cookie[] in the workspace.

export interface Cookie {
  name: string
  value: string
  /** Lower-case, without a leading dot. */
  domain: string
  path: string
  /** Epoch ms; undefined = session cookie (kept until cleared). */
  expires?: number
  secure: boolean
  httpOnly: boolean
  /** True when the server sent no Domain attribute: only sent to this exact host. */
  hostOnly: boolean
  sameSite?: string
}

const isIp = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')

export function domainMatches(host: string, domain: string): boolean {
  host = host.toLowerCase()
  return host === domain || (!isIp(host) && host.endsWith(`.${domain}`))
}

export function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true
  if (!reqPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/'
}

/** Default-path per RFC 6265 §5.1.4. */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/'
  const i = pathname.lastIndexOf('/')
  return i <= 0 ? '/' : pathname.slice(0, i)
}

/** Parse one Set-Cookie header value. Returns null for cookies the jar must reject. */
export function parseSetCookie(header: string, url: URL, now = Date.now()): Cookie | null {
  const [pair, ...attrs] = header.split(';')
  const eq = pair.indexOf('=')
  if (eq < 0) return null
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
  if (!name) return null

  const host = url.hostname.toLowerCase()
  const cookie: Cookie = { name, value, domain: host, path: defaultPath(url.pathname), secure: false, httpOnly: false, hostOnly: true }
  let maxAge: number | undefined
  let expires: number | undefined

  for (const raw of attrs) {
    const i = raw.indexOf('=')
    const key = (i >= 0 ? raw.slice(0, i) : raw).trim().toLowerCase()
    const val = i >= 0 ? raw.slice(i + 1).trim() : ''
    switch (key) {
      case 'domain': {
        const d = val.replace(/^\./, '').toLowerCase()
        if (!d) break
        if (!domainMatches(host, d)) return null // a server may not set cookies for other domains
        cookie.domain = d
        cookie.hostOnly = false
        break
      }
      case 'path':
        if (val.startsWith('/')) cookie.path = val
        break
      case 'max-age':
        if (/^-?\d+$/.test(val)) maxAge = Number(val)
        break
      case 'expires': {
        const t = Date.parse(val)
        if (!Number.isNaN(t)) expires = t
        break
      }
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'samesite':
        cookie.sameSite = val
        break
    }
  }
  // Max-Age wins over Expires.
  if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : now + maxAge * 1000
  else if (expires !== undefined) cookie.expires = expires
  return cookie
}

const sameCookie = (a: Cookie, b: Cookie): boolean => a.name === b.name && a.domain === b.domain && a.path === b.path

export class CookieJar {
  cookies: Cookie[]

  constructor(cookies: Cookie[] = []) {
    this.cookies = cookies.map((c) => ({ ...c }))
  }

  /** Store a cookie, replacing any with the same name/domain/path. Expired cookies delete. */
  set(cookie: Cookie, now = Date.now()): void {
    this.cookies = this.cookies.filter((c) => !sameCookie(c, cookie))
    if (cookie.expires === undefined || cookie.expires > now) this.cookies.push(cookie)
  }

  setFromHeaders(setCookieHeaders: string[], url: URL, now = Date.now()): void {
    for (const h of setCookieHeaders) {
      const c = parseSetCookie(h, url, now)
      if (c) this.set(c, now)
    }
  }

  /** Cookies to send to `url`, longest path first (RFC 6265 §5.4). */
  matching(url: URL, now = Date.now()): Cookie[] {
    this.purge(now)
    const host = url.hostname.toLowerCase()
    const secure = url.protocol === 'https:'
    return this.cookies
      .filter((c) => (c.hostOnly ? host === c.domain : domainMatches(host, c.domain)))
      .filter((c) => pathMatches(url.pathname || '/', c.path))
      .filter((c) => !c.secure || secure || host === 'localhost' || host === '127.0.0.1')
      .sort((a, b) => b.path.length - a.path.length)
  }

  cookieHeader(url: URL, now = Date.now()): string {
    return this.matching(url, now)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
  }

  remove(domain: string, name?: string, path?: string): void {
    this.cookies = this.cookies.filter((c) => !(c.domain === domain && (name === undefined || c.name === name) && (path === undefined || c.path === path)))
  }

  purge(now = Date.now()): void {
    this.cookies = this.cookies.filter((c) => c.expires === undefined || c.expires > now)
  }

  toJSON(): Cookie[] {
    return this.cookies
  }
}

/** Render a cookie the way a Set-Cookie header would describe it (for the manager UI). */
export function formatCookie(c: Cookie): string {
  const parts = [`${c.name}=${c.value}`, `Path=${c.path}`]
  if (!c.hostOnly) parts.push(`Domain=${c.domain}`)
  if (c.expires !== undefined) parts.push(`Expires=${new Date(c.expires).toUTCString()}`)
  if (c.secure) parts.push('Secure')
  if (c.httpOnly) parts.push('HttpOnly')
  if (c.sameSite) parts.push(`SameSite=${c.sameSite}`)
  return parts.join('; ')
}
