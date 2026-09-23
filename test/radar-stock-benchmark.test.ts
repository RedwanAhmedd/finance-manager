import { describe, expect, it } from 'vitest'
import { benchmarkFromStock } from '../src/radar/stock-benchmark'
import type { StockSnapshot } from '../src/live/models'
import type { StockBooks } from '../src/books/stock'
const now = '2026-09-23T14:00:00.000Z'
function stock(): StockSnapshot {
  return { fetchedAt: now, holdings: [{ symbol: 'TEST.NE', role: 'satellite', shares: 5, valueCad: 100, priceSource: 'quote', asOf: now }], portfolioCad: 100, investedCad: 100, cashCad: null, cashAsOf: null, corePct: 0, contributedYtdCad: 0, issues: [], books: { holdings: [{ symbol: 'TEST.NE', role: 'satellite', shares: 5, value: 100, bookCost: 80, historyComplete: true, priceBasis: 'quote', priceDate: '2026-09-22' }] } as StockBooks }
}
describe('StockStream benchmark provenance', () => {
  it('reports recorded holdings P/L as ESTIMATE, never XEQT alpha', () => {
    expect(benchmarkFromStock(stock(), now)).toMatchObject({status: 'ESTIMATE', profitLossCad: 20, alphaCad: null, xeqtValueCad: null})
  })
  it('does not hide unmatched owned positions to improve coverage', () => {
    const s = stock(); s.holdings.push({...s.holdings[0], symbol: 'OTHER.NE'})
    expect(benchmarkFromStock(s, now).status).toBe('UNAVAILABLE')
  })
  it('withholds partial cost history and estimated CDR quotes', () => {
    for (const change of [{ historyComplete: false }, { priceBasis: 'estimated' }, { bookCost: null }, { priceDate: '2026-01-01' }, { priceDate: '2026-09-24' }]) {
      const s = stock(); Object.assign(s.books!.holdings[0],change)
      expect(benchmarkFromStock(s, now).status).toBe('UNAVAILABLE')
    }
  })
  it('does not assume ownership or fresh snapshots', () => {
    expect(benchmarkFromStock(null, now).status).toBe('UNAVAILABLE')
    const s = stock(); s.fetchedAt = '2026-09-24T14:00:00.000Z'
    expect(benchmarkFromStock(s, now).status).toBe('UNAVAILABLE')
  })
})
