import type { RunnerRequestResult, RunnerSummary } from '@core/types'

export interface RunReport {
  collection: string
  environment: string | null
  startedAt: string
  summary: RunnerSummary
  results: RunnerRequestResult[]
}

const xml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** JUnit XML: one <testsuite> per request execution, one <testcase> per pm.test. */
export function junitReport(report: RunReport): string {
  const suites = report.results.map((r) => {
    const failures = r.tests.filter((t) => !t.passed).length
    const errored = r.error || r.scriptError
    const cases = r.tests.map((t) =>
      t.passed
        ? `      <testcase name="${xml(t.name)}" classname="${xml(r.name)}" />`
        : `      <testcase name="${xml(t.name)}" classname="${xml(r.name)}">\n        <failure type="AssertionFailure" message="${xml(t.error ?? 'failed')}">${xml(t.error ?? '')}</failure>\n      </testcase>`
    )
    if (errored) {
      cases.push(`      <testcase name="${xml(r.scriptError ? 'Script' : 'Request')}" classname="${xml(r.name)}">\n        <error message="${xml(errored)}">${xml(errored)}</error>\n      </testcase>`)
    }
    const time = ((r.durationMs ?? 0) / 1000).toFixed(3)
    return [
      `  <testsuite name="${xml(`${r.name}${report.summary.iterations > 1 ? ` [iteration ${r.iteration + 1}]` : ''}`)}" tests="${cases.length}" failures="${failures}" errors="${errored ? 1 : 0}" time="${time}">`,
      `    <properties><property name="url" value="${xml(`${r.method} ${r.url}`)}" /></properties>`,
      ...cases,
      '  </testsuite>'
    ].join('\n')
  })
  const s = report.summary
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(report.collection)}" tests="${s.testsPassed + s.testsFailed + s.errors}" failures="${s.testsFailed}" errors="${s.errors}" time="${(s.durationMs / 1000).toFixed(3)}">`,
    ...suites,
    '</testsuites>',
    ''
  ].join('\n')
}

export const jsonReport = (report: RunReport): string => `${JSON.stringify(report, null, 2)}\n`

// ---------- terminal reporter ----------

const useColor = (stream: NodeJS.WriteStream): boolean => Boolean(stream.isTTY) && !process.env.NO_COLOR
const paint = (on: boolean) => (code: number, s: string): string => (on ? `\x1b[${code}m${s}\x1b[0m` : s)

export function createCliReporter(out: NodeJS.WriteStream = process.stdout): {
  start(collection: string, environment: string | null): void
  result(r: RunnerRequestResult, iterations: number): void
  finish(s: RunnerSummary): void
} {
  const c = paint(useColor(out))
  const green = (s: string): string => c(32, s)
  const red = (s: string): string => c(31, s)
  const dim = (s: string): string => c(2, s)
  const bold = (s: string): string => c(1, s)
  let lastIteration = -1
  return {
    start(collection, environment) {
      out.write(`\n${bold(collection)}${environment ? dim(`  (environment: ${environment})`) : ''}\n`)
    },
    result(r, iterations) {
      if (iterations > 1 && r.iteration !== lastIteration) {
        lastIteration = r.iteration
        out.write(`\n${dim(`Iteration ${r.iteration + 1}/${iterations}`)}\n`)
      }
      const status = r.status !== undefined ? `${r.status} ${r.statusText ?? ''}`.trim() : 'no response'
      const meta = [status, r.durationMs !== undefined ? `${Math.round(r.durationMs)}ms` : '', r.size !== undefined ? `${r.size}B` : ''].filter(Boolean).join(', ')
      out.write(`\n→ ${bold(r.name)}\n  ${r.method} ${r.url} ${dim(`[${meta}]`)}\n`)
      for (const log of r.console.filter((l) => l.level !== 'info' || !/→/.test(l.message))) {
        out.write(dim(`  │ ${log.message.split('\n').join('\n  │ ')}\n`))
      }
      if (r.error) out.write(red(`  ✗ ${r.error}\n`))
      else if (r.scriptError) out.write(red(`  ✗ ${r.scriptError}\n`))
      for (const t of r.tests) out.write(t.passed ? `  ${green('✓')} ${t.name}\n` : `  ${red(`✗ ${t.name}`)}\n    ${red(t.error ?? '')}\n`)
    },
    finish(s) {
      const row = (label: string, total: number, failed: number): string =>
        `  ${label.padEnd(12)}${String(total).padStart(8)}${(failed ? red : (x: string) => x)(String(failed).padStart(8))}\n`
      out.write(`\n  ${''.padEnd(12)}${'executed'.padStart(8)}${'failed'.padStart(8)}\n`)
      out.write(row('iterations', s.iterations, 0))
      out.write(row('requests', s.requests, s.errors))
      out.write(row('assertions', s.testsPassed + s.testsFailed, s.testsFailed))
      out.write(`\n  total run duration: ${(s.durationMs / 1000).toFixed(2)}s${s.aborted ? red('  (run stopped early)') : ''}\n`)
      const ok = s.testsFailed === 0 && s.errors === 0
      out.write(`\n${ok ? green(bold('  All tests passed')) : red(bold(`  ${s.testsFailed} failed assertion(s), ${s.errors} error(s)`))}\n\n`)
    }
  }
}
