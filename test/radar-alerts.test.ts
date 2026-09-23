import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownedPositionAlerts, severityFor } from '../src/radar/alerts'
import { createRadarAlerts, ntfySender, type PushMessage } from '../server/radar-alerts'
import type { StockSnapshot } from '../src/live/models'

const now = new Date('2026-09-24T21:00:00Z')
const stock = (close: number, previousClose = 100, date = '2026-09-24'): StockSnapshot => ({
  fetchedAt: now.toISOString(), portfolioCad: null, investedCad: null, cashCad: null, cashAsOf: null, corePct: null, contributedYtdCad: null, issues: [],
  holdings: [
    { symbol: 'MSFT.NE', role: 'satellite', shares: 5, valueCad: null, priceSource: 'quote', asOf: date },
    { symbol: 'XEQT.TO', role: 'core', shares: 10, valueCad: null, priceSource: 'quote', asOf: date },
    { symbol: 'CAD', role: 'cash', shares: 100, valueCad: 100, priceSource: 'cash record', asOf: date },
  ],
  closes: [
    { symbol: 'MSFT.NE', currency: 'CAD', date, close, previousDate: '2026-09-23', previousClose },
    { symbol: 'XEQT.TO', currency: 'CAD', date, close: 30.1, previousDate: '2026-09-23', previousClose: 30 },
  ],
})

describe('Owned-position warnings', () => {
  it('uses the highest matching severity for gains and losses', () => {
    expect([2.9, 3, -5, 7.9, -8].map(severityFor)).toEqual([null, 'WARNING', 'HIGH ALERT', 'HIGH ALERT', 'CRITICAL REVIEW'])
  })
  it('warns only on owned instruments that moved, and always says WAIT', () => {
    const { alerts, covered } = ownedPositionAlerts(stock(94.5), now)
    expect(covered).toEqual(['MSFT.NE', 'XEQT.TO'])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ id: 'move|MSFT.NE|2026-09-24', severity: 'HIGH ALERT', movePct: -5.5, title: 'MSFT ▼5.5% · HIGH ALERT' })
    expect(alerts[0].body).toContain('Action: WAIT')
    expect(alerts[0].body.split(/\s+/).length).toBeLessThanOrEqual(60)
    expect(alerts[0].body).not.toMatch(/shares|value/i)
  })
  it('sends one monitoring-degraded alert when no owned close is recent', () => {
    const { alerts, stale } = ownedPositionAlerts(stock(94.5, 100, '2026-09-15'), now)
    expect(stale).toEqual(['MSFT.NE', 'XEQT.TO'])
    expect(alerts.map(a => a.severity)).toEqual(['MONITORING DEGRADED'])
  })
  it('never measures a CDR by its underlying', () => {
    const s = stock(94.5)
    s.closes = s.closes!.filter(c => c.symbol !== 'MSFT.NE')
    expect(ownedPositionAlerts(s, now).uncovered).toEqual(['MSFT.NE'])
  })
})

describe('Alert delivery', () => {
  const dirs: string[] = []
  afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
  const setup = (send: (m: PushMessage) => Promise<void>) => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-alerts-')); dirs.push(directory)
    let current: StockSnapshot | null = stock(94.5)
    const alerts = createRadarAlerts({ directory, getStock: async () => current, send, now: () => now })
    return { alerts, directory, setStock: (s: StockSnapshot | null) => { current = s }, getStock: async () => current }
  }

  it('persists an episode before delivering it, and never resends it', async () => {
    const seen: string[] = []
    const { alerts, directory } = setup(async m => { seen.push(JSON.parse(readFileSync(join(directory, 'alerts.json'), 'utf8')).episodes[0].delivery.status); seen.push(m.title) })
    expect(await alerts.check()).toMatchObject({ created: 1 })
    expect(seen).toEqual(['pending', 'MSFT ▼5.5% · HIGH ALERT'])
    expect(await alerts.check()).toMatchObject({ created: 0, escalated: 0 })
    expect(seen).toHaveLength(2)
    expect(alerts.status().recent[0]).toMatchObject({ delivery: 'delivered' })
  })
  it('re-alerts only when the same episode escalates', async () => {
    const send = vi.fn(async () => {})
    const { alerts, setStock } = setup(send)
    await alerts.check()
    setStock(stock(91))
    expect(await alerts.check()).toMatchObject({ escalated: 1 })
    expect(send).toHaveBeenCalledTimes(2)
    expect((send.mock.calls[1] as unknown as [PushMessage])[0]).toMatchObject({ title: 'MSFT ▼9.0% · CRITICAL REVIEW', priority: 5 })
    setStock(stock(94.5))
    await alerts.check()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('records a failed delivery and retries it on the next scan', async () => {
    let fail = true
    const send = vi.fn(async () => { if (fail) throw new Error('offline') })
    const { alerts } = setup(send)
    await alerts.check()
    expect(alerts.status()).toMatchObject({ failing: true, recent: [{ delivery: 'failed' }] })
    fail = false
    await alerts.check()
    expect(send).toHaveBeenCalledTimes(2)
    expect(alerts.status()).toMatchObject({ failing: false, recent: [{ delivery: 'delivered' }] })
  })
  it('alerts once after two unreadable checks, survives a restart, and rearms after recovery', async () => {
    const send = vi.fn(async () => {})
    const { alerts, directory, setStock, getStock } = setup(send)
    await alerts.check()
    expect(send).toHaveBeenCalledTimes(1) // The owned-position move.
    setStock(null)
    expect(await alerts.check()).toMatchObject({ sourceRead: false, created: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(await alerts.check()).toMatchObject({ sourceRead: false, created: 1 })
    expect(send).toHaveBeenCalledTimes(2)
    expect((send.mock.calls[1] as unknown as [PushMessage])[0]).toMatchObject({
      title: 'Radar · StockStream unavailable',
      body: expect.stringContaining('Last reliable check: 2026-09-24T21:00:00.000Z'),
    })
    const restarted = createRadarAlerts({ directory, getStock, send, now: () => now })
    await restarted.check()
    expect(send).toHaveBeenCalledTimes(2)
    setStock(stock(94.5))
    await restarted.check()
    expect(send).toHaveBeenCalledTimes(2) // Recovery is quiet.
    setStock(null)
    await restarted.check()
    await restarted.check()
    expect(send).toHaveBeenCalledTimes(3)
    expect(JSON.parse(readFileSync(join(directory, 'alerts.json'), 'utf8')).episodes
      .filter((e: { id: string }) => e.id.startsWith('degraded|source|'))).toHaveLength(2)
  })
  it('does not send an outage warning for one transient failed check', async () => {
    const send = vi.fn(async () => {})
    const { alerts, setStock } = setup(send)
    setStock(null)
    await alerts.check()
    setStock(stock(100))
    await alerts.check()
    expect(send).not.toHaveBeenCalled()
    expect(alerts.status().recent).toEqual([])
  })
  it('labels manual delivery tests clearly without claiming a market signal', async () => {
    const send = vi.fn(async () => {})
    const { alerts } = setup(send)
    await alerts.sendTest()
    expect((send.mock.calls[0] as unknown as [PushMessage])[0]).toMatchObject({
      title: 'Radar test · connection only', priority: 2,
      body: expect.stringContaining('not a market signal'),
    })
  })
  it('refuses a tampered store instead of resending', async () => {
    const { alerts, directory } = setup(async () => {})
    await alerts.check()
    const path = join(directory, 'alerts.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, readFileSync(path, 'utf8').replace('HIGH ALERT', 'WARNING'))
    await expect(alerts.check()).rejects.toThrow('integrity')
  })
  it('reads an existing alert store without the new last-reliable field', async () => {
    const send = vi.fn(async () => {})
    const { alerts, directory } = setup(send)
    await alerts.check()
    const path = join(directory, 'alerts.json')
    const { episodes } = JSON.parse(readFileSync(path, 'utf8'))
    const digest = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, episodes })).digest('hex')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, episodes, digest }))
    await alerts.check()
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(path, 'utf8')).lastReliableAt).toBe(now.toISOString())
  })
})

describe('ntfy delivery', () => {
  it('publishes JSON so symbols in the title survive, and requires a long random topic', async () => {
    const transport = vi.fn(async () => new Response('{}'))
    await ntfySender({ topic: 'fm-radar-3f9c2a7b1d4e8f60' }, transport as unknown as typeof fetch)({ title: 'MSFT ▼5.5% · HIGH ALERT', body: 'Action: WAIT', priority: 4, tags: ['warning'] })
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ntfy.sh')
    expect(JSON.parse(init.body as string)).toEqual({ topic: 'fm-radar-3f9c2a7b1d4e8f60', title: 'MSFT ▼5.5% · HIGH ALERT', message: 'Action: WAIT', priority: 4, tags: ['warning'] })
    expect(() => ntfySender({ topic: 'alerts' })).toThrow('20–64')
    expect(() => ntfySender({ server: 'http://ntfy.sh', topic: 'fm-radar-3f9c2a7b1d4e8f60' })).toThrow('https')
  })
})
