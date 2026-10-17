// Node-only: AWS Signature Version 4 request signing.
// https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html

import { createHash, createHmac } from 'node:crypto'
import type { AwsCredentials } from './types'

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding as AWS wants it (encodeURIComponent leaves !'()* alone). */
const awsEncode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

function canonicalPath(pathname: string, service: string): string {
  if (service === 's3') return pathname || '/' // S3 paths are encoded once, as sent
  const segments = (pathname || '/').split('/').map((seg) => awsEncode(decodeURIComponentSafe(seg)))
  // Other services double-encode: the path is normalised and each segment encoded again.
  return segments.map((seg) => awsEncode(seg)).join('/') || '/'
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function canonicalQuery(search: string): string {
  if (!search || search === '?') return ''
  return search
    .slice(1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      const k = decodeURIComponentSafe((i >= 0 ? pair.slice(0, i) : pair).replace(/\+/g, ' '))
      const v = i >= 0 ? decodeURIComponentSafe(pair.slice(i + 1).replace(/\+/g, ' ')) : ''
      return [awsEncode(k), awsEncode(v)] as const
    })
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

const AWS_HEADERS = /^(authorization|x-amz-date|x-amz-security-token|x-amz-content-sha256)$/i

/**
 * Return `headers` plus the SigV4 headers for this request. Any previous signature headers are
 * replaced, so it can be called again for each redirect hop.
 */
export function signAwsV4(
  method: string,
  url: URL,
  headers: [string, string][],
  body: Buffer | undefined,
  creds: AwsCredentials,
  now = new Date()
): [string, string][] {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const service = creds.service || 'execute-api'
  const region = creds.region || 'us-east-1'
  const payloadHash = sha256(body ?? '')

  const out = headers.filter(([k]) => !AWS_HEADERS.test(k))
  out.push(['X-Amz-Date', amzDate])
  if (creds.sessionToken) out.push(['X-Amz-Security-Token', creds.sessionToken])
  if (service === 's3') out.push(['X-Amz-Content-Sha256', payloadHash])

  // Host is set by Node from the URL; it must be signed too.
  const toSign = new Map<string, string[]>()
  toSign.set('host', [url.host])
  for (const [k, v] of out) {
    const key = k.toLowerCase()
    if (key === 'host' || key === 'user-agent' || key === 'content-length') continue
    toSign.set(key, [...(toSign.get(key) ?? []), v.trim().replace(/\s+/g, ' ')])
  }
  const names = [...toSign.keys()].sort()
  const canonicalHeaders = names.map((n) => `${n}:${toSign.get(n)!.join(',')}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [method.toUpperCase(), canonicalPath(url.pathname, service), canonicalQuery(url.search), canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${creds.secretKey}`, date), region), service), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  out.push(['Authorization', `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`])
  return out
}
