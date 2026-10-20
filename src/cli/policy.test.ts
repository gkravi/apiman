import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_POLICY, setActivePolicy } from '@core/policy'

process.env.APIMAN_CLI_NO_AUTORUN = '1'
const { main } = await import('./index')

describe('apiman run --policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apiman-cli-policy-'))
  const f = (n: string): string => join(dir, n)
  let server: http.Server
  let hits = 0

  beforeAll(async () => {
    server = http.createServer((_req, res) => (hits++, res.end('{}')))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    writeFileSync(
      f('c.json'),
      JSON.stringify({
        info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [{ name: 'Ping', request: { method: 'GET', url }, event: [{ listen: 'test', script: { exec: ['pm.test("ran", () => {})'] } }] }]
      })
    )
  })
  afterAll(() => server.close())
  afterEach(() => setActivePolicy(NO_POLICY))

  const run = async (policy: unknown): Promise<{ code: number; report: { results: { error?: string; tests: unknown[] }[] } }> => {
    writeFileSync(f('policy.json'), JSON.stringify(policy))
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = await main(['run', f('c.json'), '--policy', f('policy.json'), '-r', 'json', '--reporter-json-export', f('r.json')])
      return { code, report: JSON.parse(readFileSync(f('r.json'), 'utf8')) }
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
  }

  it('refuses hosts the policy blocks, without contacting them', async () => {
    const { code, report } = await run({ blockedHosts: ['127.0.0.1'] })
    expect(code).toBe(1)
    expect(report.results[0].error).toMatch(/blocked by your organisation's policy/)
    expect(hits).toBe(0)
  })

  it('skips scripts when the policy turns them off', async () => {
    const { code, report } = await run({ disableScripts: true })
    expect(code).toBe(0)
    expect(report.results[0].tests).toEqual([])
    expect(hits).toBe(1)
  })

  it('rejects an invalid policy as a usage error', async () => {
    writeFileSync(f('bad.json'), JSON.stringify({ disableScripts: 'yes' }))
    await expect(main(['run', f('c.json'), '--policy', f('bad.json')])).rejects.toThrow(/"disableScripts" must be true or false/)
  })
})
