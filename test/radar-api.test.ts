import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRadarHandler, createRadarService } from '../server/radar'
import { readJournal } from '../server/radar-journal'
import type { StockSnapshot } from '../src/live/models'
import { radarFixture } from './radar-fixture'

const roots: string[] = []
const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'radar-api-test-'))
  roots.push(root)
  return join(root, 'radar')
}
function stock(): StockSnapshot {
  const now = new Date().toISOString()
  return { fetchedAt: now, holdings: [], portfolioCad: 100000, investedCad: 95000, cashCad: 5000,
    cashAsOf: now, corePct: 50, contributedYtdCad: null, issues: [] }
}
function contents(root: string): Record<string, string> {
  if (!existsSync(root)) return {}
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name), 'utf8')]))
}
async function serve(root: string, getStock: () => Promise<StockSnapshot | null> = async () => stock()) {
  const service = createRadarService(root, getStock)
  const handler = createRadarHandler(service)
  const server = http.createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end('next') }))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/radar`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  return { base, post, service }
}

describe('Radar journal API', () => {
  it('reads an absent journal as empty without creating any files', async () => {
    const root = temporaryRoot(), { base } = await serve(root)
    const response = await fetch(`${base}/api/radar`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ status: 'empty', action: 'WAIT', runCount: 0, candidates: [] })
    expect(existsSync(root)).toBe(false)
  })

  it('requires intentional initialization, verifies saves, and keeps GET read-only', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    const input = radarFixture(new Date().toISOString())
    expect((await post({ input })).status).toBe(400)
    expect(existsSync(join(root, 'journal.json'))).toBe(false)
    const saved = await post({ input, createState: true })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ runId: 1, persisted: true, readbackVerified: true, notificationDelivery: 'NOT CONNECTED' })
    const before = contents(root)
    const response = await fetch(`${base}/api/radar`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ runCount: 1, action: 'WAIT' })
    expect(contents(root)).toEqual(before)
    expect((await post({ input, createState: true })).status).toBe(400)
    expect(contents(root)).toEqual(before)
    expect((await post({ input })).status).toBe(200)
    expect(readJournal(join(root, 'journal.json'))?.runs).toHaveLength(2)
  })

  it('does not journal a v4 BUY/STRIKE as an ELITE-qualified signal', async () => {
    const root = temporaryRoot(), { post } = await serve(root)
    expect((await post({ input: radarFixture(new Date().toISOString()), createState: true })).status).toBe(200)
    const state = readJournal(join(root, 'journal.json'))!
    expect(state.runs).toHaveLength(1)
    expect(state.signals).toHaveLength(0)
  })

  it('fails closed on corrupt state and never overwrites it or exposes old candidates', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    const input = radarFixture(new Date().toISOString())
    expect((await post({ input, createState: true })).status).toBe(200)
    writeFileSync(join(root, 'journal.json'), '{"corrupt":true}')
    const before = contents(root)
    const failed = await fetch(`${base}/api/radar`)
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: expect.stringContaining('WAIT') })
    expect((await post({ input })).status).toBe(400)
    expect(contents(root)).toEqual(before)
  })

  it('fails closed when receipt integrity fails', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    expect((await post({ input: radarFixture(new Date().toISOString()), createState: true })).status).toBe(200)
    const receipt = join(root, 'receipts', readdirSync(join(root, 'receipts'))[0])
    const record = JSON.parse(readFileSync(receipt, 'utf8'))
    record.digest = 'invalid'
    writeFileSync(receipt, JSON.stringify(record))
    const before = contents(root), response = await fetch(`${base}/api/radar`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: expect.stringContaining('WAIT') })
    expect(contents(root)).toEqual(before)
  })

  it('never promotes a legacy run when its ELITE receipt is missing', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    expect((await post({ input: radarFixture(new Date().toISOString()), createState: true })).status).toBe(200)
    unlinkSync(join(root, 'receipts', readdirSync(join(root, 'receipts'))[0]))
    const before = contents(root), response = await fetch(`${base}/api/radar`)
    const body = await response.json()
    if (response.status === 200) {
      expect(body.action).toBe('WAIT')
      expect(body.candidates).toHaveLength(1)
      expect(body.candidates[0].decision.action).toBe('WAIT')
    } else {
      expect(response.status).toBe(503)
      expect(body).toEqual({ error: expect.stringContaining('WAIT') })
    }
    expect(contents(root)).toEqual(before)
  })

  it('checks source freshness after the asynchronous read completes', async () => {
    const root = temporaryRoot(), { base } = await serve(root, async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return stock()
    })
    const response = await fetch(`${base}/api/radar`)
    expect(await response.json()).toMatchObject({ status: 'empty', coverage: { portfolio: true } })
  })

  it('never includes positive watchlist units in owned-position coverage', async () => {
    const root = temporaryRoot(), { base } = await serve(root, async () => ({ ...stock(), holdings: [
      { symbol: 'WATCH.TO', role: 'watchlist', shares: 1, valueCad: 50, priceSource: 'quote', asOf: new Date().toISOString() },
      { symbol: 'OWNED.TO', role: 'satellite', shares: 2, valueCad: 100, priceSource: 'quote', asOf: new Date().toISOString() },
    ] }))
    const body = await (await fetch(`${base}/api/radar`)).json()
    expect(body.owned.map((h: {symbol: string}) => h.symbol)).toEqual(['OWNED.TO'])
  })
  it('returns original execution timestamps rather than refreshing their age on GET', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    const input = radarFixture(new Date(Date.now() - 60_000).toISOString())
    expect((await post({ input, createState: true })).status).toBe(200)
    const body = await (await fetch(`${base}/api/radar`)).json()
    expect(body.candidates[0].priceEvidence).toEqual(input.execution.evidence)
    expect(body.candidates[0].priceEvidence[0].asOf).not.toBe(body.candidates[0].evaluation.evaluatedAt)
  })
  it('shows source failure as degraded and clears owned positions', async () => {
    const root = temporaryRoot(), { base } = await serve(root, async () => { throw new Error('offline') })
    const response = await fetch(`${base}/api/radar`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'degraded', action: 'WAIT', owned: [], coverage: { portfolio: false } })
    expect(existsSync(root)).toBe(false)
  })

  it('rejects foreign Host and Origin, bad bodies and unsupported methods before writing', async () => {
    const root = temporaryRoot(), { base, post } = await serve(root)
    // Node fetch controls Host itself; exercise the wire header with http.get.
    const wrongHost = await new Promise<number | undefined>((done, fail) => {
      http.get(`${base}/api/radar`, { headers: { host: 'evil.example' } }, res => { res.resume(); done(res.statusCode) }).on('error', fail)
    })
    expect(wrongHost).toBe(403)
    expect((await post({}, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({}, { origin: 'null' })).status).toBe(403)
    expect((await fetch(`${base}/api/radar`, { method: 'DELETE' })).status).toBe(405)
    expect((await post({}, { 'content-type': 'text/plain' })).status).toBe(415)
    for (const body of [null, [], {}, { input: {} }, { input: radarFixture(), review: {} }, { input: radarFixture(), createState: 'true' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect((await fetch(`${base}/api/radar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400)
    expect(await (await fetch(`${base}/api/unrelated`)).text()).toBe('next')
    expect(existsSync(root)).toBe(false)
  })
})
