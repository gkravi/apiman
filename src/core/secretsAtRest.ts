// Encrypt credentials inside the workspace before it's written to disk, and decrypt on load.
// Pure: the cipher is passed in (Electron's safeStorage in the app, a fake in tests).
//
// What counts as a secret: auth fields (passwords, tokens, client secrets, AWS keys, API-key
// values), certificate passphrases, cookie values, and variables marked secret. Everything else
// stays readable so the file remains diff-able and recoverable.

export interface Cipher {
  encrypt(plain: string): string
  /** Throws when the value can't be decrypted (e.g. the OS keychain entry was reset). */
  decrypt(sealed: string): string
}

export const SEALED_PREFIX = 'apiman-enc:v1:'

const SECRET_KEYS = new Set(['password', 'token', 'secretKey', 'sessionToken', 'clientSecret', 'accessToken', 'refreshToken', 'passphrase'])

type Json = unknown

/** Which string fields of this object are secrets, given its shape. */
function secretFields(obj: Record<string, Json>, parentKey: string | undefined): (k: string) => boolean {
  const variable = obj.secret === true && typeof obj.value === 'string'
  const apiKey = obj.type === 'apikey'
  const cookie = parentKey === 'cookies'
  return (k) => SECRET_KEYS.has(k) || (k === 'value' && (variable || apiKey || cookie))
}

function walk(node: Json, fn: (s: string) => string, parentKey?: string): Json {
  if (Array.isArray(node)) return node.map((x) => walk(x, fn, parentKey))
  if (!node || typeof node !== 'object') return node
  const obj = node as Record<string, Json>
  const isSecret = secretFields(obj, parentKey)
  const out: Record<string, Json> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? (v && isSecret(k) ? fn(v) : v) : walk(v, fn, k)
  return out
}

export function sealSecrets<T>(workspace: T, cipher: Cipher): T {
  return walk(workspace, (v) => (v.startsWith(SEALED_PREFIX) ? v : SEALED_PREFIX + cipher.encrypt(v))) as T
}

/** Decrypt sealed values. Ones that can't be decrypted become empty, and are counted. */
export function openSecrets<T>(workspace: T, cipher: Cipher): { workspace: T; failed: number } {
  let failed = 0
  const open = (v: string): string => {
    if (!v.startsWith(SEALED_PREFIX)) return v // written before encryption was turned on
    try {
      return cipher.decrypt(v.slice(SEALED_PREFIX.length))
    } catch {
      failed++
      return ''
    }
  }
  return { workspace: walk(workspace, open) as T, failed }
}

/** True when anything in the workspace is still sealed (used when no cipher is available). */
export const hasSealedSecrets = (workspace: Json): boolean => JSON.stringify(workspace).includes(SEALED_PREFIX)
