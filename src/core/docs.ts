// Generate a self-contained HTML documentation page for a collection: navigation by folder,
// each request's method, URL, description, auth, params, headers, body and saved examples.
// Pure and dependency-free so both the app and the CLI can produce it.

import { escapeHtml as esc, renderMarkdown } from './markdown'
import { effectiveAuth } from './prepare'
import type { Auth, Collection, CollectionItem, Folder, KeyValue, RequestBody, RequestItem } from './types'

export interface DocsOptions {
  /** Shown under the title, e.g. the environment the examples were recorded against. */
  subtitle?: string
  generatedAt?: Date
}

const slug = (id: string): string => `r-${id.replace(/[^\w-]/g, '')}`

function authText(a: Auth): string {
  switch (a.type) {
    case 'none':
    case 'inherit':
      return 'None'
    case 'basic':
      return 'Basic auth'
    case 'bearer':
      return `Bearer token <code>${esc(a.token)}</code>`
    case 'apikey':
      return `API key <code>${esc(a.key)}</code> in ${a.in === 'query' ? 'query string' : 'header'}`
    case 'digest':
      return 'Digest auth'
    case 'awsv4':
      return `AWS Signature V4 (${esc(a.service || 'service')}, ${esc(a.region || 'region')})`
    case 'oauth2':
      return `OAuth 2.0 — ${a.grantType.replace('_', ' ')}${a.accessTokenUrl ? ` · token URL <code>${esc(a.accessTokenUrl)}</code>` : ''}${a.scope ? ` · scope <code>${esc(a.scope)}</code>` : ''}`
  }
}

function kvTable(title: string, rows: KeyValue[]): string {
  const live = rows.filter((r) => r.key)
  if (!live.length) return ''
  return `<h4>${title}</h4><table><thead><tr><th>Name</th><th>Value</th><th>Description</th></tr></thead><tbody>${live
    .map(
      (r) =>
        `<tr${r.enabled ? '' : ' class="optional"'}><td><code>${esc(r.key)}</code>${r.enabled ? '' : ' <span class="tag">optional</span>'}</td><td><code>${esc(r.value)}</code></td><td>${r.description ? renderMarkdown(r.description) : ''}</td></tr>`
    )
    .join('')}</tbody></table>`
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function bodySection(b: RequestBody): string {
  switch (b.mode) {
    case 'none':
      return ''
    case 'raw':
      return b.raw.trim() ? `<h4>Body <span class="tag">${b.language}</span></h4><pre><code>${esc(b.language === 'json' ? prettyJson(b.raw) : b.raw)}</code></pre>` : ''
    case 'urlencoded':
      return kvTable('Body <span class="tag">x-www-form-urlencoded</span>', b.urlencoded)
    case 'formdata':
      return kvTable(
        'Body <span class="tag">form-data</span>',
        b.formdata.map((f) => ({ ...f, value: f.type === 'file' ? `<file> ${f.filePath?.split(/[\\/]/).pop() ?? ''}` : f.value }))
      )
    case 'binary':
      return `<h4>Body <span class="tag">binary</span></h4><p>File: <code>${esc(b.filePath.split(/[\\/]/).pop() ?? '')}</code></p>`
    case 'graphql':
      return `<h4>Body <span class="tag">GraphQL</span></h4><pre><code>${esc(b.query)}</code></pre>${b.variables.trim() ? `<h5>Variables</h5><pre><code>${esc(prettyJson(b.variables))}</code></pre>` : ''}`
  }
}

function requestSection(item: RequestItem, ancestors: (Auth | undefined)[]): string {
  const r = item.request
  const protocol = r.protocol ?? 'http'
  const badge = protocol === 'http' ? r.method : { websocket: 'WS', sse: 'SSE', grpc: 'gRPC' }[protocol]
  const auth = effectiveAuth(r.auth, ancestors)
  const examples = (r.examples ?? [])
    .map((e) => {
      const ct = e.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
      return `<details><summary><span class="status s${Math.floor(e.status / 100)}">${e.status}</span> ${esc(e.name)}</summary>${
        ct ? `<p class="muted">Content-Type: <code>${esc(ct)}</code></p>` : ''
      }<pre><code>${esc(/json/i.test(ct) ? prettyJson(e.body) : e.body)}</code></pre></details>`
    })
    .join('')
  return `<section class="request" id="${slug(r.id)}">
  <h3><span class="method m-${esc(badge.toLowerCase())}">${esc(badge)}</span> ${esc(r.name)}</h3>
  <pre class="url"><code>${esc(r.url)}</code></pre>
  ${r.description ? `<div class="desc">${renderMarkdown(r.description)}</div>` : ''}
  ${protocol === 'grpc' && r.grpc?.service ? `<p>Method <code>${esc(r.grpc.service)}/${esc(r.grpc.method)}</code></p>` : ''}
  ${auth.type !== 'none' ? `<p class="auth"><strong>Auth:</strong> ${authText(auth)}${r.auth.type === 'inherit' ? ' <span class="tag">inherited</span>' : ''}</p>` : ''}
  ${kvTable('Query parameters', r.params)}
  ${kvTable(protocol === 'grpc' ? 'Metadata' : 'Headers', r.headers)}
  ${protocol === 'http' || protocol === 'sse' ? bodySection(r.body) : ''}
  ${protocol !== 'http' && r.message?.trim() ? `<h4>Message</h4><pre><code>${esc(prettyJson(r.message))}</code></pre>` : ''}
  ${examples ? `<h4>Examples</h4>${examples}` : ''}
</section>`
}

function walk(items: CollectionItem[], ancestors: (Auth | undefined)[], depth: number, nav: string[], body: string[]): void {
  for (const item of items) {
    if (item.type === 'request') {
      const badge = (item.request.protocol ?? 'http') === 'http' ? item.request.method : (item.request.protocol ?? '').toUpperCase().replace('WEBSOCKET', 'WS')
      nav.push(`<li><a href="#${slug(item.id)}"><span class="method m-${esc(badge.toLowerCase())}">${esc(badge)}</span>${esc(item.request.name)}</a></li>`)
      body.push(requestSection(item, ancestors))
    } else {
      const f: Folder = item
      nav.push(`<li class="folder"><a href="#${slug(f.id)}">${esc(f.name)}</a><ul>`)
      body.push(`<section class="folder" id="${slug(f.id)}"><h${Math.min(2 + depth, 6)}>${esc(f.name)}</h${Math.min(2 + depth, 6)}>${f.description ? `<div class="desc">${renderMarkdown(f.description)}</div>` : ''}</section>`)
      walk(f.items, [f.auth, ...ancestors], depth + 1, nav, body)
      nav.push('</ul></li>')
    }
  }
}

export function generateDocsHtml(c: Collection, opts: DocsOptions = {}): string {
  const nav: string[] = []
  const body: string[] = []
  walk(c.items, [c.auth], 0, nav, body)
  const vars = c.variables.filter((v) => v.key)
  const when = (opts.generatedAt ?? new Date()).toISOString().slice(0, 10)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.name)} — API documentation</title>
<style>
:root { --bg:#ffffff; --fg:#1f2328; --muted:#656d76; --border:#d0d7de; --code:#f6f8fa; --accent:#e8492a; --get:#1a7f37; --post:#9a6700; --put:#0969da; --patch:#8250df; --delete:#cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8d96a0; --border:#30363d; --code:#161b22; --get:#3fb950; --post:#d29922; --put:#4c9aff; --patch:#b48ead; --delete:#f85149; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
nav { position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid var(--border); padding: 20px 14px; font-size: 13px; }
nav ul { list-style: none; margin: 0; padding-left: 12px; }
nav > ul { padding-left: 0; }
nav a { color: var(--fg); text-decoration: none; display: flex; gap: 8px; padding: 3px 4px; border-radius: 4px; }
nav a:hover { background: var(--code); }
nav .folder > a { font-weight: 600; margin-top: 6px; }
main { padding: 32px 48px 80px; max-width: 980px; }
h1 { margin: 0 0 4px; font-size: 28px; }
.muted { color: var(--muted); }
section.request { border-top: 1px solid var(--border); padding: 24px 0 8px; }
section.folder h2, section.folder h3 { margin-top: 40px; }
h3 { display: flex; gap: 10px; align-items: center; margin: 0 0 8px; }
h4 { margin: 18px 0 6px; font-size: 14px; }
.method { font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; min-width: 42px; display: inline-block; }
.m-get { color: var(--get); } .m-post { color: var(--post); } .m-put { color: var(--put); } .m-patch { color: var(--patch); } .m-delete, .m-del { color: var(--delete); }
.m-ws, .m-websocket, .m-sse, .m-grpc { color: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
:not(pre) > code { background: var(--code); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; }
pre.url { padding: 8px 12px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; border-bottom: 1px solid var(--border); padding: 6px 8px; vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
td p { margin: 0; }
tr.optional td { color: var(--muted); }
.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--border); border-radius: 10px; padding: 0 6px; font-weight: 500; }
details { border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; margin: 6px 0; }
summary { cursor: pointer; }
.status { font: 600 12px ui-monospace, monospace; }
.s2 { color: var(--get); } .s3 { color: var(--put); } .s4 { color: var(--post); } .s5 { color: var(--delete); }
blockquote { margin: 0; padding-left: 14px; border-left: 3px solid var(--border); color: var(--muted); }
a { color: var(--put); }
footer { margin-top: 48px; color: var(--muted); font-size: 12px; }
@media (max-width: 800px) { .layout { grid-template-columns: 1fr; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); } main { padding: 20px 16px 60px; } }
</style>
</head>
<body>
<div class="layout">
<nav><strong>${esc(c.name)}</strong><ul>${nav.join('')}</ul></nav>
<main>
<h1>${esc(c.name)}</h1>
${opts.subtitle ? `<p class="muted">${esc(opts.subtitle)}</p>` : ''}
${c.description ? `<div class="desc">${renderMarkdown(c.description)}</div>` : ''}
${c.auth.type !== 'none' && c.auth.type !== 'inherit' ? `<p><strong>Authentication:</strong> ${authText(c.auth)}</p>` : ''}
${vars.length ? `<h4>Collection variables</h4><table><thead><tr><th>Name</th><th>Default</th></tr></thead><tbody>${vars.map((v) => `<tr><td><code>{{${esc(v.key)}}}</code></td><td><code>${esc(v.value)}</code></td></tr>`).join('')}</tbody></table>` : ''}
${body.join('\n')}
<footer>Generated by ApiMan on ${when}</footer>
</main>
</div>
</body>
</html>
`
}
