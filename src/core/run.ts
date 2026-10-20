// Node-only: the full request lifecycle (pre-request scripts → prepare → send → test scripts)
// and the collection runner built on it. Shared by the Electron main process and a future CLI.

import { newKeyValue } from './factory'
import { CookieJar } from './cookies'
import { findRequestByRef, scriptChain } from './tree'
import { renderTemplates, TemplateError, type SendPolicy, type TemplateEnv } from './templates'
import { lastResponse, rememberResponse } from './responseStore'
import { execute, type ExecuteOptions } from './executor'
import { prepareRequest } from './prepare'
import { normalizeUrl } from './url'
import { activePolicy, SCRIPTS_DISABLED, SEND_REQUEST_DISABLED } from './policy'
import { runScript, type SandboxRequest, type SandboxResponse, type ScriptContext, type SendRequestFn } from './sandbox'
import type { Scope } from './variables'
import {
  DEFAULT_SETTINGS,
  type ApiRequest,
  type ApiResponse,
  type Collection,
  type ConsoleEntry,
  type Cookie,
  type NetworkSettings,
  type PreparedRequest,
  type RunnerOptions,
  type RunnerRequestResult,
  type RunnerSummary,
  type RunRequestInput,
  type RunRequestResult,
  type RunStep,
  type RunVariables,
  type TestResult,
  type VarMap
} from './types'

const toScope = (m: VarMap): Scope => Object.entries(m).map(([key, value]) => ({ key, value, enabled: true }))

export const scopesFromVariables = (v: RunVariables): Scope[] => [v.local, v.data, v.environment, v.collection, v.globals].map(toScope)

function toSandboxRequest(r: ApiRequest): SandboxRequest {
  return {
    url: r.url,
    method: r.method,
    headers: r.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key, h.value]),
    body: r.body.mode === 'raw' ? r.body.raw : null
  }
}

/** Fold a script's edits to pm.request back into the editor-shaped request. */
function applySandboxRequest(r: ApiRequest, s: SandboxRequest): ApiRequest {
  const method = s.method.toUpperCase() as ApiRequest['method']
  return {
    ...r,
    url: s.url,
    method,
    headers: s.headers.map(([k, v]) => newKeyValue(k, v)),
    body: r.body.mode === 'raw' && s.body !== null ? { ...r.body, raw: s.body } : r.body
  }
}

export function toSandboxResponse(res: ApiResponse): SandboxResponse {
  return {
    code: res.status,
    status: res.statusText,
    headers: res.headers,
    body: res.bodyEncoding === 'utf8' ? res.body : '',
    responseTime: Math.round(res.timings.total),
    responseSize: res.size
  }
}

/** pm.sendRequest: accepts a URL string or a Postman-style request object. */
function makeSendRequest(signal: AbortSignal, execOpts: ExecuteOptions): SendRequestFn {
  return async (raw) => {
    const spec = raw as {
      url?: string
      method?: string
      header?: { key: string; value: string }[] | Record<string, string>
      body?: { mode?: string; raw?: string; urlencoded?: { key: string; value: string }[] }
    }
    if (activePolicy().disableSendRequest) return { error: SEND_REQUEST_DISABLED }
    if (!spec?.url) return { error: 'pm.sendRequest: url is required' }
    const headers: [string, string][] = Array.isArray(spec.header)
      ? spec.header.map((h) => [String(h.key), String(h.value)])
      : Object.entries(spec.header ?? {}).map(([k, v]) => [k, String(v)])
    let body: PreparedRequest['body'] = { kind: 'none' }
    if (spec.body?.mode === 'raw' && spec.body.raw !== undefined) body = { kind: 'text', text: String(spec.body.raw) }
    else if (spec.body?.mode === 'urlencoded') {
      body = {
        kind: 'text',
        text: new URLSearchParams((spec.body.urlencoded ?? []).map((p) => [p.key, p.value])).toString(),
        contentType: 'application/x-www-form-urlencoded'
      }
    }
    const result = await execute(
      { method: (spec.method ?? 'GET').toUpperCase() as PreparedRequest['method'], url: normalizeUrl(spec.url), headers, body, settings: DEFAULT_SETTINGS },
      signal,
      execOpts
    )
    return result.ok ? { response: toSandboxResponse(result.response) } : { error: result.error }
  }
}

interface ChainingContext {
  input: Pick<RunRequestInput, 'request' | 'collection' | 'prompts' | 'chain' | 'network' | 'info'>
  signal: AbortSignal
  jar: CookieJar
  getVariables(): RunVariables
  setVariables(v: RunVariables): void
  log(entries: ConsoleEntry[]): void
}

/**
 * The environment template functions run in: variable scopes, $prompt answers, and $response(),
 * which sends a referenced request first when needed (with its own auth and scripts), carrying its
 * variable and cookie changes back — so a login referenced by a token header just works.
 */
export function chainingEnv(ctx: ChainingContext): TemplateEnv {
  const { input, signal, jar } = ctx
  return {
    get scopes() {
      return scopesFromVariables(ctx.getVariables())
    },
    prompts: input.prompts ?? {},
    response: async (ref: string, policy: SendPolicy) => {
      const collection = input.collection
      if (!collection) throw new TemplateError(`$response('${ref}') only works for requests saved in a collection`)
      const target = findRequestByRef(collection, ref)
      if (!target) throw new TemplateError(`No request named "${ref}" in collection "${collection.name}"`)
      const id = target.item.id
      const name = target.item.request.name
      const cached = lastResponse(id)
      if (policy.kind === 'never') {
        if (!cached) throw new TemplateError(`"${ref}" hasn't been sent yet (the reference is set to 'never' send it)`)
        return cached.response
      }
      if (cached && (policy.kind === 'if-missing' || (policy.kind === 'max-age' && Date.now() - cached.at <= policy.seconds * 1000))) return cached.response

      const chain = input.chain ?? [{ id: input.request.id, name: input.request.name }]
      if (chain.some((c) => c.id === id)) throw new TemplateError(`Circular reference: ${[...chain.map((c) => c.name), name].join(' → ')}`)
      if (chain.length > 5) throw new TemplateError('Too many nested $response() references (more than 5)')

      const variables = ctx.getVariables()
      const scripts = scriptChain(collection, target.folders, target.item.request)
      const dep = await runRequest(
        {
          request: { ...target.item.request, id },
          parentAuths: [...target.folders.map((f) => f.auth), collection.auth],
          preRequestScripts: scripts.pre,
          testScripts: scripts.test,
          variables: { ...variables, local: {} },
          cookies: jar.toJSON(),
          network: input.network,
          collection,
          prompts: input.prompts,
          chain: [...chain, { id, name }],
          info: { ...input.info, requestName: name, requestId: id }
        },
        signal
      )
      // The dependency's variable and cookie changes (e.g. a login storing a token) carry over.
      ctx.setVariables({ ...ctx.getVariables(), environment: dep.variables.environment, collection: dep.variables.collection, globals: dep.variables.globals })
      jar.cookies = dep.cookies
      const status = dep.result?.ok ? `${dep.result.response.status} ${dep.result.response.statusText}` : 'failed'
      ctx.log([{ level: 'info', message: `↳ sent "${name}" for a $response() reference → ${status}`, timestamp: Date.now(), source: input.info.requestName }, ...dep.console])
      if (!dep.result?.ok) throw new TemplateError(`Sending "${ref}" failed: ${dep.result?.error ?? dep.scriptError ?? 'not sent'}`)
      return dep.result.response
    }
  }
}

/** Render template functions in every text field of a request (URL, params, headers, body, auth, message). */
export async function renderRequestTemplates(req: ApiRequest, env: TemplateEnv): Promise<ApiRequest> {
  const r = (t: string): Promise<string> => renderTemplates(t, env)
  const kv = <T extends { key: string; value: string }>(rows: T[]): Promise<T[]> => Promise.all(rows.map(async (x) => ({ ...x, key: await r(x.key), value: await r(x.value) })))
  const body = req.body
  let newBody = body
  if (body.mode === 'raw') newBody = { ...body, raw: await r(body.raw) }
  else if (body.mode === 'urlencoded') newBody = { ...body, urlencoded: await kv(body.urlencoded) }
  else if (body.mode === 'formdata') newBody = { ...body, formdata: await kv(body.formdata) }
  else if (body.mode === 'graphql') newBody = { ...body, query: await r(body.query), variables: await r(body.variables) }
  const auth = { ...req.auth } as Record<string, unknown>
  for (const [k, v] of Object.entries(auth)) if (typeof v === 'string' && k !== 'type') auth[k] = await r(v)
  return {
    ...req,
    url: await r(req.url),
    params: await kv(req.params),
    headers: await kv(req.headers),
    body: newBody,
    auth: auth as ApiRequest['auth'],
    message: req.message === undefined ? undefined : await r(req.message)
  }
}

export async function runRequest(input: RunRequestInput, signal: AbortSignal = new AbortController().signal): Promise<RunRequestResult> {
  let variables = structuredClone(input.variables)
  let request = input.request
  const tests: TestResult[] = []
  const consoleLog: ConsoleEntry[] = []
  let nextRequest: string | null | undefined
  const jar = new CookieJar(input.cookies ?? [])
  const execOpts: ExecuteOptions = { jar, network: input.network }
  const sendRequest = makeSendRequest(signal, execOpts)
  const cookiesFor = (url: string): { name: string; value: string }[] => {
    try {
      return jar.matching(new URL(url)).map((c) => ({ name: c.name, value: c.value }))
    } catch {
      return []
    }
  }
  let responseUrl = ''
  const tag = (entries: ConsoleEntry[]): ConsoleEntry[] => entries.map((e) => ({ ...e, source: input.info.requestName }))

  const run = async (event: ScriptContext['event'], code: string, response?: SandboxResponse): Promise<string | undefined> => {
    const cookies = cookiesFor(responseUrl || request.url)
    const out = await runScript(code, { event, variables, request: toSandboxRequest(request), response, cookies, info: input.info }, { sendRequest })
    variables = out.variables
    if (event === 'prerequest') request = applySandboxRequest(request, out.request)
    tests.push(...out.tests)
    consoleLog.push(...tag(out.console))
    if (out.nextRequest !== undefined) nextRequest = out.nextRequest
    if (out.skipRequest) return 'skip'
    return out.error
  }

  const done = (extra: Partial<RunRequestResult>): RunRequestResult => ({ tests, console: consoleLog, variables, nextRequest, cookies: jar.toJSON(), ...extra })

  // Managed policy: scripts are skipped (and the console says so) rather than failing the request.
  const scriptsOff = activePolicy().disableScripts
  const hasScripts = [...input.preRequestScripts, ...input.testScripts].some((c) => c.trim())
  if (scriptsOff && hasScripts) consoleLog.push({ level: 'warn', message: `${SCRIPTS_DISABLED}; this request's scripts were skipped`, timestamp: Date.now(), source: input.info.requestName })
  const preRequestScripts = scriptsOff ? [] : input.preRequestScripts
  const testScripts = scriptsOff ? [] : input.testScripts

  for (const code of preRequestScripts) {
    const err = await run('prerequest', code)
    if (err === 'skip') return done({ scriptError: 'Request skipped by pm.execution.skipRequest()' })
    if (err) {
      consoleLog.push({ level: 'error', message: `Pre-request script error: ${err}`, timestamp: Date.now(), source: input.info.requestName })
      return done({ scriptError: `Pre-request script: ${err}` })
    }
  }

  // Template functions ({{ $response(...) }}, {{ $hmac(...) }}…) run after pre-request scripts, so
  // variables those scripts set are visible, and before variables are substituted.
  const env = chainingEnv({
    input,
    signal,
    jar,
    getVariables: () => variables,
    setVariables: (v) => (variables = v),
    log: (entries) => consoleLog.push(...entries)
  })
  try {
    request = await renderRequestTemplates(request, env)
  } catch (e) {
    const error = `Template: ${(e as Error).message}`
    consoleLog.push({ level: 'error', message: error, timestamp: Date.now(), source: input.info.requestName })
    return done({ result: { ok: false, error } })
  }

  let prepared: PreparedRequest
  try {
    prepared = prepareRequest(request, scopesFromVariables(variables), input.parentAuths)
  } catch (e) {
    return done({ result: { ok: false, error: (e as Error).message } })
  }

  const result = await execute(prepared, signal, execOpts)
  const sent = { method: prepared.method, url: prepared.url, headers: prepared.headers }
  if (!result.ok) return done({ result, sent })

  rememberResponse(input.request.id, result.response)
  let scriptError: string | undefined
  responseUrl = result.response.url
  const response = toSandboxResponse(result.response)
  for (const code of testScripts) {
    const err = await run('test', code, response)
    if (err && err !== 'skip') {
      consoleLog.push({ level: 'error', message: `Test script error: ${err}`, timestamp: Date.now(), source: input.info.requestName })
      scriptError = `Test script: ${err}`
      break
    }
  }
  return done({ result, sent, scriptError })
}

// ---------- collection runner ----------

export interface RunnerHooks {
  onResult?(r: RunnerRequestResult): void
  signal?: AbortSignal
  /** Starting cookie jar (the final jar is returned) and proxy/certificate settings. */
  cookies?: Cookie[]
  network?: NetworkSettings
  /** The collection being run, so {{ $response('Other request') }} can find (and send) siblings. */
  collection?: Collection
}

/** Per-iteration guard against pm.execution.setNextRequest loops that never end. */
const MAX_STEPS_PER_ITERATION = 1000

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

export async function runCollection(
  steps: RunStep[],
  initial: Pick<RunVariables, 'environment' | 'collection' | 'globals'>,
  options: RunnerOptions,
  hooks: RunnerHooks = {}
): Promise<{ summary: RunnerSummary; variables: Pick<RunVariables, 'environment' | 'collection' | 'globals'>; cookies: Cookie[] }> {
  const signal = hooks.signal ?? new AbortController().signal
  const started = performance.now()
  let vars = structuredClone(initial)
  let cookies = hooks.cookies ?? []
  const iterations = Math.max(1, options.iterations || options.data.length || 1)
  const summary: RunnerSummary = { iterations: 0, requests: 0, testsPassed: 0, testsFailed: 0, errors: 0, durationMs: 0, aborted: false }
  let stopRun = false

  for (let it = 0; it < iterations && !stopRun; it++) {
    const data = options.data.length ? options.data[Math.min(it, options.data.length - 1)] : {}
    summary.iterations++
    let i = 0
    let count = 0
    while (i < steps.length && !stopRun) {
      if (signal.aborted) {
        summary.aborted = true
        stopRun = true
        break
      }
      if (++count > MAX_STEPS_PER_ITERATION) {
        summary.errors++
        break
      }
      const step = steps[i]
      const r = await runRequest(
        {
          ...step,
          variables: { ...vars, local: {}, data },
          cookies,
          network: hooks.network,
          collection: hooks.collection,
          info: { requestName: step.request.name, requestId: step.request.id, iteration: it, iterationCount: iterations }
        },
        signal
      )
      vars = { environment: r.variables.environment, collection: r.variables.collection, globals: r.variables.globals }
      cookies = r.cookies

      const res = r.result?.ok ? r.result.response : undefined
      const error = r.result && !r.result.ok ? r.result.error : r.result ? undefined : r.scriptError
      const passed = r.tests.filter((t) => t.passed).length
      summary.requests++
      summary.testsPassed += passed
      summary.testsFailed += r.tests.length - passed
      if (error || r.scriptError) summary.errors++

      hooks.onResult?.({
        iteration: it,
        requestId: step.request.id,
        name: step.request.name,
        method: (r.sent?.method ?? step.request.method) as RunnerRequestResult['method'],
        url: r.sent?.url ?? step.request.url,
        status: res?.status,
        statusText: res?.statusText,
        durationMs: res?.timings.total,
        size: res?.size,
        error,
        scriptError: r.scriptError,
        tests: r.tests,
        console: r.console
      })

      if (options.stopOnError && (error || r.scriptError || passed < r.tests.length)) {
        summary.aborted = true
        stopRun = true
        break
      }

      if (r.nextRequest === null) stopRun = true
      else if (r.nextRequest !== undefined) {
        const target = steps.findIndex((s) => s.request.name === r.nextRequest)
        if (target < 0) break // unknown name ends this iteration, like Postman
        i = target
      } else i++

      if (!stopRun && i < steps.length) await sleep(options.delayMs, signal)
    }
  }

  summary.durationMs = Math.round(performance.now() - started)
  return { summary, variables: vars, cookies }
}
