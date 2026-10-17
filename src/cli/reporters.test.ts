import { describe, expect, it } from 'vitest'
import { junitReport } from './reporters'

describe('junit reporter', () => {
  it('escapes XML and reports failures and request errors', () => {
    const xml = junitReport({
      collection: 'A & B',
      environment: null,
      startedAt: '',
      summary: { iterations: 1, requests: 2, testsPassed: 1, testsFailed: 1, errors: 1, durationMs: 1500, aborted: false },
      results: [
        {
          iteration: 0,
          requestId: '1',
          name: 'Get <x>',
          method: 'GET',
          url: 'http://h/?a=1&b=2',
          status: 200,
          durationMs: 12,
          tests: [
            { name: 'ok', passed: true },
            { name: 'quote "q"', passed: false, error: "expected 'a' to equal 'b'" }
          ],
          console: []
        },
        { iteration: 0, requestId: '2', name: 'Down', method: 'GET', url: 'http://down', error: 'Connection refused', tests: [], console: [] }
      ]
    })
    expect(xml).toContain('<testsuites name="A &amp; B" tests="3" failures="1" errors="1" time="1.500">')
    expect(xml).toContain('<property name="url" value="GET http://h/?a=1&amp;b=2" />')
    expect(xml).toContain('<testcase name="quote &quot;q&quot;" classname="Get &lt;x&gt;">')
    expect(xml).toContain('<failure type="AssertionFailure" message="expected &apos;a&apos; to equal &apos;b&apos;">')
    expect(xml).toContain('<error message="Connection refused">Connection refused</error>')
  })
})
