// apiman — run collections from the command line (CI-friendly, Newman-style).
// Uses the exact same core as the desktop app: executor, sandbox, runner, cookie jar.

import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { importPostmanCollection, importPostmanEnvironment, exportPostmanEnvironment, isPostmanCollection } from '@core/postman'
import { importOpenApi, isOpenApi, parseSpecText } from '@core/openapi'
import { locate, runnableRequests, scriptChain } from '@core/tree'
import { runCollection } from '@core/run'
import { applyVarChanges, parseDataFile, toVarMap } from '@core/varsync'
import { DEFAULT_NETWORK, type Collection, type Environment, type NetworkSettings, type RunnerRequestResult, type RunStep, type Variable } from '@core/types'
import { createCliReporter, jsonReport, junitReport, type RunReport } from './reporters'

const VERSION = '0.4.0'

const HELP = `apiman ${VERSION} — run API collections from the command line

Usage:
  apiman run <collection> [options]

  <collection>  Postman collection (v2.0/v2.1) or OpenAPI/Swagger spec (JSON or YAML)

Options:
  -e, --environment <file>        Postman environment file
  -g, --globals <file>            Postman globals file
  -d, --iteration-data <file>     CSV or JSON data file (one iteration per row)
  -n, --iteration-count <n>       Number of iterations (default: data rows, or 1)
      --folder <name>             Run only this folder
      --env-var <key=value>       Set an environment variable (repeatable)
      --global-var <key=value>    Set a global variable (repeatable)
      --delay-request <ms>        Wait between requests
      --timeout-request <ms>      Per-request timeout
  -k, --insecure                  Don't verify TLS certificates
      --ignore-redirects          Don't follow redirects
      --bail                      Stop on the first failed test or error
  -x, --suppress-exit-code        Exit 0 even when tests fail
      --proxy <url>               Send requests through this HTTP proxy
      --ca-cert <file>            Extra CA certificates (PEM)
      --ssl-client-cert <file>    Client certificate (PEM) …
      --ssl-client-key <file>     … and its key
      --ssl-client-pfx <file>     Client certificate as PKCS#12
      --ssl-client-passphrase <p> Passphrase for the key / PFX
  -r, --reporters <list>          Comma-separated: cli, json, junit (default: cli)
      --reporter-json-export <f>  Where to write the JSON report (default: apiman-report.json)
      --reporter-junit-export <f> Where to write the JUnit XML (default: apiman-report.xml)
      --export-environment <file> Save the environment (with script changes) after the run
      --export-globals <file>     Save globals after the run
  -h, --help                      Show this help
  -v, --version                   Show the version

Exit codes: 0 all passed · 1 failed tests or request errors · 2 usage or input error
`

class UsageError extends Error {}

function keyValues(list: string[] | undefined, flag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of list ?? []) {
    const i = item.indexOf('=')
    if (i <= 0) throw new UsageError(`${flag} expects key=value, got "${item}"`)
    out[item.slice(0, i)] = item.slice(i + 1)
  }
  return out
}

async function readJsonFile(path: string, what: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new UsageError(`Cannot read ${what} file: ${path}`)
  }
  try {
    return parseSpecText(text)
  } catch (e) {
    throw new UsageError(`${what} file is not valid JSON/YAML: ${(e as Error).message}`)
  }
}

async function loadCollection(path: string): Promise<Collection> {
  const doc = await readJsonFile(path, 'collection')
  if (isPostmanCollection(doc)) return importPostmanCollection(doc)
  if (isOpenApi(doc)) return importOpenApi(doc)
  throw new UsageError(`${path} is neither a Postman collection nor an OpenAPI/Swagger spec`)
}

async function loadVariables(path: string | undefined, what: string): Promise<Environment | undefined> {
  if (!path) return undefined
  const doc = (await readJsonFile(path, what)) as { values?: unknown; name?: string }
  if (!doc || !Array.isArray(doc.values)) throw new UsageError(`${path} is not a Postman ${what} file`)
  return importPostmanEnvironment({ ...doc, name: doc.name ?? basename(path) })
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      environment: { type: 'string', short: 'e' },
      globals: { type: 'string', short: 'g' },
      'iteration-data': { type: 'string', short: 'd' },
      'iteration-count': { type: 'string', short: 'n' },
      folder: { type: 'string' },
      'env-var': { type: 'string', multiple: true },
      'global-var': { type: 'string', multiple: true },
      'delay-request': { type: 'string' },
      'timeout-request': { type: 'string' },
      insecure: { type: 'boolean', short: 'k' },
      'ignore-redirects': { type: 'boolean' },
      bail: { type: 'boolean' },
      'suppress-exit-code': { type: 'boolean', short: 'x' },
      proxy: { type: 'string' },
      'ca-cert': { type: 'string' },
      'ssl-client-cert': { type: 'string' },
      'ssl-client-key': { type: 'string' },
      'ssl-client-pfx': { type: 'string' },
      'ssl-client-passphrase': { type: 'string' },
      reporters: { type: 'string', short: 'r', default: 'cli' },
      'reporter-json-export': { type: 'string', default: 'apiman-report.json' },
      'reporter-junit-export': { type: 'string', default: 'apiman-report.xml' },
      'export-environment': { type: 'string' },
      'export-globals': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  })

  if (values.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP)
    return positionals.length === 0 && !values.help ? 2 : 0
  }
  const [command, file] = positionals
  if (command !== 'run' || !file) throw new UsageError(`Unknown command "${positionals.join(' ')}". Try: apiman run <collection>`)

  const num = (v: string | undefined, flag: string): number | undefined => {
    if (v === undefined) return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new UsageError(`${flag} must be a non-negative number`)
    return n
  }

  const collection = await loadCollection(file)
  const env = (await loadVariables(values.environment, 'environment')) ?? { id: 'cli', name: 'cli', variables: [] }
  const globalsEnv = await loadVariables(values.globals, 'globals')
  const reporters = new Set(values.reporters.split(',').map((r) => r.trim()).filter(Boolean))
  for (const r of reporters) if (!['cli', 'json', 'junit'].includes(r)) throw new UsageError(`Unknown reporter "${r}" (use cli, json, junit)`)

  let data: Record<string, string>[] = []
  if (values['iteration-data']) {
    try {
      data = parseDataFile(await readFile(values['iteration-data'], 'utf8'), values['iteration-data'])
    } catch (e) {
      throw new UsageError(`Cannot use data file: ${(e as Error).message}`)
    }
  }

  let folderId: string | null = null
  if (values.folder) {
    const find = (items: Collection['items']): string | null => {
      for (const i of items) {
        if (i.type === 'folder') {
          if (i.name === values.folder) return i.id
          const inner = find(i.items)
          if (inner) return inner
        }
      }
      return null
    }
    folderId = find(collection.items)
    if (!folderId) throw new UsageError(`Folder "${values.folder}" not found in the collection`)
  }

  const timeout = num(values['timeout-request'], '--timeout-request')
  const steps: RunStep[] = runnableRequests(collection, folderId).map(({ item, folders }) => {
    const scripts = scriptChain(collection, folders, item.request)
    return {
      request: {
        ...item.request,
        settings: {
          ...item.request.settings,
          ...(values.insecure ? { verifySsl: false } : {}),
          ...(values['ignore-redirects'] ? { followRedirects: false } : {}),
          ...(timeout !== undefined ? { timeoutMs: timeout } : {})
        }
      },
      parentAuths: [...folders.map((f) => f.auth), collection.auth],
      preRequestScripts: scripts.pre,
      testScripts: scripts.test
    }
  })
  if (steps.length === 0) throw new UsageError('Nothing to run: the collection (or folder) has no requests')

  const network: NetworkSettings = {
    ...DEFAULT_NETWORK,
    proxy: { enabled: !!values.proxy, url: values.proxy ?? '', bypass: '' },
    caPath: values['ca-cert'],
    certificates:
      values['ssl-client-cert'] || values['ssl-client-pfx']
        ? [{ id: 'cli', host: '*', certPath: values['ssl-client-cert'], keyPath: values['ssl-client-key'], pfxPath: values['ssl-client-pfx'], passphrase: values['ssl-client-passphrase'] }]
        : []
  }

  const before = {
    environment: { ...toVarMap(env.variables), ...keyValues(values['env-var'], '--env-var') },
    collection: toVarMap(collection.variables),
    globals: { ...toVarMap(globalsEnv?.variables ?? []), ...keyValues(values['global-var'], '--global-var') }
  }

  const cli = reporters.has('cli') ? createCliReporter() : undefined
  const envName = values.environment ? env.name : null
  cli?.start(collection.name, envName)
  const results: RunnerRequestResult[] = []
  const iterations = num(values['iteration-count'], '--iteration-count') ?? 0
  const effectiveIterations = Math.max(1, iterations || data.length || 1)
  const startedAt = new Date().toISOString()

  const ctrl = new AbortController()
  process.once('SIGINT', () => ctrl.abort())
  const { summary, variables } = await runCollection(
    steps,
    before,
    { iterations, delayMs: num(values['delay-request'], '--delay-request') ?? 0, data, stopOnError: !!values.bail },
    {
      signal: ctrl.signal,
      network,
      onResult: (r) => {
        results.push(r)
        cli?.result(r, effectiveIterations)
      }
    }
  )
  cli?.finish(summary)

  const report: RunReport = { collection: collection.name, environment: envName, startedAt, summary, results }
  if (reporters.has('json')) await writeFile(values['reporter-json-export'], jsonReport(report))
  if (reporters.has('junit')) await writeFile(values['reporter-junit-export'], junitReport(report))

  const save = async (path: string | undefined, name: string, rows: Variable[], beforeMap: Record<string, string>, afterMap: Record<string, string>): Promise<void> => {
    if (!path) return
    const updated = { id: 'cli', name, variables: applyVarChanges(rows, beforeMap, afterMap) }
    await writeFile(path, `${JSON.stringify(exportPostmanEnvironment(updated), null, 2)}\n`)
  }
  await save(values['export-environment'], env.name, env.variables, before.environment, variables.environment)
  await save(values['export-globals'], 'globals', globalsEnv?.variables ?? [], before.globals, variables.globals)

  const failed = summary.testsFailed > 0 || summary.errors > 0 || summary.aborted
  return failed && !values['suppress-exit-code'] ? 1 : 0
}

// Only auto-run when executed as the CLI entry (not when imported by tests).
if (process.env.APIMAN_CLI_NO_AUTORUN !== '1') {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`apiman: ${err instanceof UsageError ? err.message : (err as Error).stack}\n`)
      process.exit(2)
    }
  )
}
