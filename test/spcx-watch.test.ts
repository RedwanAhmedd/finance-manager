import { describe, expect, it, vi } from 'vitest'
import { spcxDailyClose } from '../server/tmx'

describe('SPCX exact CDR quote', () => {
  const now = new Date('2026-09-25T21:00:00Z')
  it('requires exact listing identity and SpaceX CDR name', async () => {
    const transport = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { getQuoteBySymbol: { symbol: 'SPCX:TSX', name: 'SpaceX CDR (CAD Hedged)' },
        getCompanyPriceHistory: [
          { datetime: '2026-09-24', closePrice: 24.10, volume: 1200 },
          { datetime: '2026-09-23', closePrice: 24.70, volume: 1400 },
        ] } }),
    })) as unknown as typeof fetch
    expect(await spcxDailyClose(now, transport)).toMatchObject({ symbol: 'SPCX', currency: 'CAD', close: 24.10, previousClose: 24.70, date: '2026-09-24' })
  })
  it('rejects an underlying or misidentified listing', async () => {
    const transport = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { getQuoteBySymbol: { symbol: 'SPCX:TSX', name: 'Space exploration ETF' },
        getCompanyPriceHistory: [{ datetime: '2026-09-24', closePrice: 24.10, volume: 1200 }] } }),
    })) as unknown as typeof fetch
    await expect(spcxDailyClose(now, transport)).rejects.toThrow('No verified traded SPCX')
  })
})
