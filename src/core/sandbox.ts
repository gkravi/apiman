// Node-only: runs user scripts inside a QuickJS (WASM) interpreter. Scripts get the `pm` API
// from the prelude and nothing else — no require, no process, no filesystem, no network except
// pm.sendRequest, which is proxied back to the host executor. Each script gets a fresh runtime
// with memory, stack and CPU-time limits.

import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'
import { PRELUDE } from './sandbox-prelude'
import type { ConsoleEntry, LogLevel, RunVariables, TestResult } from './types'

export interface SandboxRequest {
  url: string
  method: string
  headers: [string, string][]
  /** Raw body text; null when the request has no editable raw body. */
  body: string | null
}

export interface SandboxResponse {
  code: number
  status: string
  headers: [string, string][]
  body: string
  responseTime: number
  responseSize: number
}

export interface ScriptContext {
  event: 'prerequest' | 'test'
  variables: RunVariables
  request: SandboxRequest
  response?: SandboxResponse
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number }
}

export interface ScriptOutcome {
  variables: RunVariables
  request: SandboxRequest
  tests: TestResult[]
  console: ConsoleEntry[]
  error?: string
  nextRequest?: string | null
  skipRequest: boolean
}

export type SendRequestFn = (spec: unknown) => Promise<{ response: SandboxResponse } | { error: string }>

export interface SandboxOptions {
  /** CPU budget per evaluation step (main body, each callback round). */
  timeoutMs?: number
  memoryLimitBytes?: number
  /** Max pm.sendRequest calls per script, to stop runaway loops. */
  maxSendRequests?: number
  sendRequest?: SendRequestFn
}

const DEFAULTS = { timeoutMs: 5000, memoryLimitBytes: 64 * 1024 * 1024, maxSendRequests: 25 }
const LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error']

let quickjs: ReturnType<typeof getQuickJS> | undefined
const loadQuickJS = (): ReturnType<typeof getQuickJS> => (quickjs ??= getQuickJS())

function errorMessage(ctx: QuickJSContext, handle: QuickJSHandle): string {
  const e = ctx.dump(handle) as { name?: string; message?: string; stack?: string } | string
  handle.dispose()
  if (typeof e === 'string') return e
  if (e?.message === 'interrupted') return 'Script timed out (possible infinite loop)'
  // User code sits one line below the `(function () {` wrapper.
  const line = Number(e?.stack?.match(/<script>:(\d+)/)?.[1]) - 1
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}${line > 0 ? ` (line ${line})` : ''}`
}

export async function runScript(code: string, sc: ScriptContext, options: SandboxOptions = {}): Promise<ScriptOutcome> {
  const opts = { ...DEFAULTS, ...options }
  const QuickJS = await loadQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(opts.memoryLimitBytes)
  runtime.setMaxStackSize(1024 * 1024)
  const ctx = runtime.newContext()

  const logs: ConsoleEntry[] = []
  const sends: { id: number; spec: string }[] = []
  let sendCount = 0

  const withDeadline = <T>(fn: () => T): T => {
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + opts.timeoutMs))
    return fn()
  }
  const evalOrThrow = (src: string, filename: string): void => {
    const r = withDeadline(() => ctx.evalCode(src, filename))
    if (r.error) throw new Error(errorMessage(ctx, r.error))
    r.value.dispose()
  }
  const drainJobs = (): void => {
    const r = withDeadline(() => runtime.executePendingJobs())
    if (r.error) throw new Error(errorMessage(ctx, r.error))
  }

  const outcome: ScriptOutcome = {
    variables: sc.variables,
    request: sc.request,
    tests: [],
    console: logs,
    skipRequest: false
  }

  try {
    const logFn = ctx.newFunction('__host_log', (levelH, msgH) => {
      const level = ctx.getString(levelH) as LogLevel
      if (logs.length < 1000) logs.push({ level: LEVELS.includes(level) ? level : 'log', message: ctx.getString(msgH), timestamp: Date.now() })
    })
    ctx.setProp(ctx.global, '__host_log', logFn)
    logFn.dispose()

    const sendFn = ctx.newFunction('__host_send', (specH, idH) => {
      const id = ctx.getNumber(idH)
      if (++sendCount > opts.maxSendRequests) {
        sends.push({ id, spec: '' })
        return
      }
      sends.push({ id, spec: ctx.getString(specH) })
    })
    ctx.setProp(ctx.global, '__host_send', sendFn)
    sendFn.dispose()

    const state = {
      event: sc.event,
      vars: sc.variables,
      request: sc.request,
      response: sc.response ?? null,
      info: { ...sc.info, eventName: sc.event }
    }
    evalOrThrow(`globalThis.__state = ${JSON.stringify(state)};`, 'state.js')
    evalOrThrow(PRELUDE, 'prelude.js')

    try {
      // Wrapped in a function like Postman, so a top-level `return` is allowed.
      evalOrThrow(`(function () {\n${code}\n})();`, '<script>')
      drainJobs()

      // Serve pm.sendRequest calls; callbacks may issue more, so loop until quiet.
      for (let round = 0; sends.length && round < opts.maxSendRequests + 1; round++) {
        const batch = sends.splice(0)
        for (const { id, spec } of batch) {
          let err: string | null = null
          let res: string | null = null
          if (!spec) err = `pm.sendRequest limit of ${opts.maxSendRequests} reached`
          else if (!opts.sendRequest) err = 'pm.sendRequest is not available here'
          else {
            const out = await opts.sendRequest(JSON.parse(spec))
            if ('error' in out) err = out.error
            else res = JSON.stringify(out.response)
          }
          evalOrThrow(`__deliver(${id}, ${JSON.stringify(err)}, ${JSON.stringify(res)});`, '<callback>')
          drainJobs()
        }
      }
    } catch (e) {
      outcome.error = (e as Error).message
    }

    // Collect state even after an error: tests and variables set before the throw still count.
    const exp = withDeadline(() => ctx.evalCode('__export()'))
    if (exp.error) throw new Error(errorMessage(ctx, exp.error))
    const data = JSON.parse(ctx.getString(exp.value)) as {
      vars: RunVariables
      request: SandboxRequest
      tests: TestResult[]
      control: { nextRequestSet: boolean; nextRequest: string | null; skip: boolean }
    }
    exp.value.dispose()
    outcome.variables = data.vars
    outcome.request = data.request
    outcome.tests = data.tests
    outcome.skipRequest = data.control.skip
    if (data.control.nextRequestSet) outcome.nextRequest = data.control.nextRequest
  } catch (e) {
    outcome.error ??= (e as Error).message
  } finally {
    ctx.dispose()
    runtime.dispose()
  }
  return outcome
}
