import { toCurl } from './curl'
import type { PreparedRequest } from './types'

export type SnippetLanguage = 'curl' | 'fetch' | 'python' | 'node-axios'

export const SNIPPET_LANGUAGES: { id: SnippetLanguage; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'fetch', label: 'JavaScript — fetch' },
  { id: 'node-axios', label: 'NodeJS — axios' },
  { id: 'python', label: 'Python — requests' }
]

const js = (v: unknown): string => JSON.stringify(v, null, 2)
const py = (s: string): string => JSON.stringify(s) // JSON strings are valid Python literals

function headerObject(req: PreparedRequest, skipContentType = false): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of req.headers) if (!(skipContentType && k.toLowerCase() === 'content-type')) out[k] = v
  return out
}

function fetchSnippet(req: PreparedRequest): string {
  const b = req.body
  const pre: string[] = []
  let bodyExpr: string | undefined
  if (b.kind === 'text') bodyExpr = js(b.text)
  else if (b.kind === 'multipart') {
    pre.push('const form = new FormData();')
    for (const f of b.fields)
      pre.push(f.filePath ? `form.append(${js(f.name)}, fileInput.files[0], ${js(f.filePath.split(/[\\/]/).pop())});` : `form.append(${js(f.name)}, ${js(f.value ?? '')});`)
    bodyExpr = 'form'
  } else if (b.kind === 'file') bodyExpr = 'fileInput.files[0]'
  const opts = [`  method: ${js(req.method)}`, `  headers: ${js(headerObject(req, b.kind === 'multipart')).replace(/\n/g, '\n  ')}`]
  if (bodyExpr) opts.push(`  body: ${bodyExpr}`)
  if (req.settings.followRedirects) opts.push(`  redirect: "follow"`)
  return [
    ...pre,
    `const response = await fetch(${js(req.url)}, {\n${opts.join(',\n')}\n});`,
    'console.log(response.status, await response.text());'
  ].join('\n')
}

function axiosSnippet(req: PreparedRequest): string {
  const b = req.body
  const lines = ["const axios = require('axios');"]
  let data: string | undefined
  if (b.kind === 'text') data = js(b.text)
  else if (b.kind === 'multipart') {
    lines.push("const FormData = require('form-data');", "const fs = require('fs');", 'const form = new FormData();')
    for (const f of b.fields)
      lines.push(f.filePath ? `form.append(${js(f.name)}, fs.createReadStream(${js(f.filePath)}));` : `form.append(${js(f.name)}, ${js(f.value ?? '')});`)
    data = 'form'
  } else if (b.kind === 'file') {
    lines.push("const fs = require('fs');")
    data = `fs.readFileSync(${js(b.filePath)})`
  }
  const headers = js(headerObject(req, b.kind === 'multipart')).replace(/\n/g, '\n  ')
  const cfg = [`  method: ${js(req.method.toLowerCase())}`, `  url: ${js(req.url)}`, `  headers: ${b.kind === 'multipart' ? `{ ...form.getHeaders(), ...${headers} }` : headers}`]
  if (data) cfg.push(`  data: ${data}`)
  if (!req.settings.followRedirects) cfg.push('  maxRedirects: 0')
  lines.push('', `axios({\n${cfg.join(',\n')}\n})`, '  .then((res) => console.log(res.status, res.data))', '  .catch((err) => console.error(err));')
  return lines.join('\n')
}

function pythonSnippet(req: PreparedRequest): string {
  const b = req.body
  const lines = ['import requests', '', `url = ${py(req.url)}`]
  const hdrs = Object.entries(headerObject(req, b.kind === 'multipart'))
  lines.push(hdrs.length ? `headers = {\n${hdrs.map(([k, v]) => `    ${py(k)}: ${py(v)},`).join('\n')}\n}` : 'headers = {}')
  const args = ['url', 'headers=headers']
  if (b.kind === 'text') {
    lines.push(`payload = ${py(b.text)}`)
    args.push('data=payload')
  } else if (b.kind === 'multipart') {
    const text = b.fields.filter((f) => !f.filePath)
    const files = b.fields.filter((f) => f.filePath)
    if (text.length) {
      lines.push(`data = {\n${text.map((f) => `    ${py(f.name)}: ${py(f.value ?? '')},`).join('\n')}\n}`)
      args.push('data=data')
    }
    if (files.length) {
      lines.push(`files = {\n${files.map((f) => `    ${py(f.name)}: open(${py(f.filePath!)}, "rb"),`).join('\n')}\n}`)
      args.push('files=files')
    }
  } else if (b.kind === 'file') {
    lines.push(`payload = open(${py(b.filePath)}, "rb")`)
    args.push('data=payload')
  }
  if (!req.settings.verifySsl) args.push('verify=False')
  if (!req.settings.followRedirects) args.push('allow_redirects=False')
  lines.push('', `response = requests.request(${py(req.method)}, ${args.join(', ')})`, 'print(response.status_code, response.text)')
  return lines.join('\n')
}

export function generateSnippet(lang: SnippetLanguage, req: PreparedRequest): string {
  switch (lang) {
    case 'curl':
      return toCurl(req)
    case 'fetch':
      return fetchSnippet(req)
    case 'node-axios':
      return axiosSnippet(req)
    case 'python':
      return pythonSnippet(req)
  }
}
