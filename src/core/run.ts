// Node-only: the full request lifecycle (pre-request scripts → prepare → send → test scripts)
// and the collection runner built on it. Shared by the Electron main process and a future CLI.

import { newKeyValue } from './factory'
import { execute } from './executor'
import { prepareRequest } from './prepare'
import { normalizeUrl } from './url'
import { runScript, type SandboxRequest, type SandboxResponse, type ScriptContext, type SendRequestFn } from './sandbox'
import type { Scope } from './variables'
import {
  DEFAULT_SETTINGS,
  type ApiRequest,
  type ApiResponse,
  type ConsoleEntry,
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
function makeSendRequest(signal: AbortSignal): SendRequestFn {
  return async (raw) => {
    const spec = raw as {
      url?: string
      method?: string
      header?: { key: string; value: string }[] | Record<string, string>
      body?: { mode?: string; raw?: string; urlencoded?: { key: string; value: string }[] }
    }
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
      signal
    )
    return result.ok ? { response: toSandboxResponse(result.response) } : { error: result.error }
  }
}

export async function runRequest(input: RunRequestInput, signal: AbortSignal = new AbortController().signal): Promise<RunRequestResult> {
  let variables = structuredClone(input.variables)
  let request = input.request
  const tests: TestResult[] = []
  const consoleLog: ConsoleEntry[] = []
  let nextRequest: string | null | undefined
  const sendRequest = makeSendRequest(signal)
  const tag = (entries: ConsoleEntry[]): ConsoleEntry[] => entries.map((e) => ({ ...e, source: input.info.requestName }))

  const run = async (event: ScriptContext['event'], code: string, response?: SandboxResponse): Promise<string | undefined> => {
    const out = await runScript(code, { event, variables, request: toSandboxRequest(request), response, info: input.info }, { sendRequest })
    variables = out.variables
    if (event === 'prerequest') request = applySandboxRequest(request, out.request)
    tests.push(...out.tests)
    consoleLog.push(...tag(out.console))
    if (out.nextRequest !== undefined) nextRequest = out.nextRequest
    if (out.skipRequest) return 'skip'
    return out.error
  }

  const done = (extra: Partial<RunRequestResult>): RunRequestResult => ({ tests, console: consoleLog, variables, nextRequest, ...extra })

  for (const code of input.preRequestScripts) {
    const err = await run('prerequest', code)
    if (err === 'skip') return done({ scriptError: 'Request skipped by pm.execution.skipRequest()' })
    if (err) {
      consoleLog.push({ level: 'error', message: `Pre-request script error: ${err}`, timestamp: Date.now(), source: input.info.requestName })
      return done({ scriptError: `Pre-request script: ${err}` })
    }
  }

  let prepared: PreparedRequest
  try {
    prepared = prepareRequest(request, scopesFromVariables(variables), input.parentAuths)
  } catch (e) {
    return done({ result: { ok: false, error: (e as Error).message } })
  }

  const result = await execute(prepared, signal)
  const sent = { method: prepared.method, url: prepared.url, headers: prepared.headers }
  if (!result.ok) return done({ result, sent })

  let scriptError: string | undefined
  const response = toSandboxResponse(result.response)
  for (const code of input.testScripts) {
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
): Promise<{ summary: RunnerSummary; variables: Pick<RunVariables, 'environment' | 'collection' | 'globals'> }> {
  const signal = hooks.signal ?? new AbortController().signal
  const started = performance.now()
  let vars = structuredClone(initial)
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
          info: { requestName: step.request.name, requestId: step.request.id, iteration: it, iterationCount: iterations }
        },
        signal
      )
      vars = { environment: r.variables.environment, collection: r.variables.collection, globals: r.variables.globals }

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
  return { summary, variables: vars }
}
