import { describe, expect, it, vi } from 'vitest'
import { tmxDailyClose, tmxSymbol, withTmxCloses } from '../server/tmx'
import type { StockSnapshot } from '../src/live/models'

const now = new Date('2026-09-23T23:00:00Z')
const reply = (name: string, days: { datetime: string; closePrice: number; volume: number }[], symbol = 'MSFT:AQL') =>
  vi.fn(async () => new Response(JSON.stringify({ data: { getQuoteBySymbol: { symbol, name }, getCompanyPriceHistory: days } })))

describe('TMX CDR closes', () => {
  it('maps only Cboe Canada listings', () => {
    expect([tmxSymbol('MSFT.NE'), tmxSymbol('XEQT.TO'), tmxSymbol('MSFT')]).toEqual(['MSFT:AQL', null, null])
  })
  it('takes the two latest traded closes and skips days with no trades', async () => {
    const transport = reply('Microsoft CDR (CAD Hedged)', [
      { datetime: '2026-09-23', closePrice: 34.79, volume: 0 },
      { datetime: '2026-09-22', closePrice: 34.79, volume: 53060 },
      { datetime: '2026-09-21', closePrice: 35.03, volume: 68867 },
    ])
    expect(await tmxDailyClose('MSFT.NE', now, transport as unknown as typeof fetch)).toEqual({
      symbol: 'MSFT.NE', currency: 'CAD', date: '2026-09-22', close: 34.79, previousDate: '2026-09-21', previousClose: 35.03, source: 'TMX Money',
    })
    const body = JSON.parse(((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string)
    expect(body.variables).toEqual({ symbol: 'MSFT:AQL', start: '2026-09-09', end: '2026-09-23' })
  })
  it('refuses a listing TMX does not identify as the CDR', async () => {
    await expect(tmxDailyClose('MSFT.NE', now, reply('Microsoft Corp', [{ datetime: '2026-09-22', closePrice: 400, volume: 10 }]) as unknown as typeof fetch)).rejects.toThrow('CDR')
    await expect(tmxDailyClose('MSFT.NE', now, reply('Microsoft CDR (CAD Hedged)', [], 'MSFT:TSX') as unknown as typeof fetch)).rejects.toThrow('CDR')
  })
  it('adds closes only for owned CDRs StockStream lacks, and reports failures', async () => {
    const stock = {
      holdings: [
        { symbol: 'MSFT.NE', role: 'satellite', shares: 5 }, { symbol: 'NVDA.NE', role: 'satellite', shares: 2 },
        { symbol: 'META.NE', role: 'memento', shares: 0 }, { symbol: 'XEQT.TO', role: 'core', shares: 10 },
      ],
      closes: [{ symbol: 'XEQT.TO', currency: 'CAD', date: '2026-09-22', close: 46.28, previousDate: '2026-09-21', previousClose: 46.05 }],
    } as unknown as StockSnapshot
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const symbol = JSON.parse(init.body as string).variables.symbol
      if (symbol === 'NVDA:AQL') return new Response('busy', { status: 503 })
      return new Response(JSON.stringify({ data: { getQuoteBySymbol: { symbol, name: 'Microsoft CDR (CAD Hedged)' }, getCompanyPriceHistory: [{ datetime: '2026-09-22', closePrice: 34.79, volume: 1 }, { datetime: '2026-09-21', closePrice: 35.03, volume: 1 }] } }))
    })
    const { stock: result, failed } = await withTmxCloses(stock, now, transport as unknown as typeof fetch)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(failed).toEqual(['NVDA.NE'])
    expect(result!.closes!.map(c => [c.symbol, c.source ?? 'StockStream'])).toEqual([['XEQT.TO', 'StockStream'], ['MSFT.NE', 'TMX Money']])
  })
})
