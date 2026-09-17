import { describe, expect, it } from 'vitest'
import { buildStockBooks } from '../src/books/stock'
import { renderStockBooks } from '../src/books/renderStock'
import { normalizeStock, type StockRaw } from '../src/live/stockstream'
import type { StockDetail } from '../src/books/stock'

const now = new Date('2026-09-17T06:00:00Z')
const pos = (symbol: string, role: string) => ({ id: symbol, symbol, role, shares: 0, manual_price: null, anchor_price: null, anchor_underlying: null, updated_at: '2026-09-16' })
const trade = (id: string, symbol: string, trade_date: string, shares: number, price: number) => ({ id, symbol, trade_date, shares, price, created_at: '2026-09-04T00:00:00Z' })
function raw(): StockRaw & StockDetail {
  return {
    positions: [pos('CORE.TO', 'core'), pos('ACME.NE', 'satellite'), pos('OLD', 'memento'), { ...pos('CAD', 'cash'), shares: 25 }],
    trades: [
      trade('c1', 'CORE.TO', '2026-07-13', 10, 40), trade('c2', 'CORE.TO', '2026-08-10', 10, 44),
      trade('a1', 'ACME.NE', '2026-07-20', 20, 10), trade('a2', 'ACME.NE', '2026-08-20', -5, 14),
      // Same-day round trip imported sale-first, as the broker export does.
      trade('d2', 'DIV.TO', '2026-08-04', -5, 78), trade('d1', 'DIV.TO', '2026-08-04', 5, 80),
      trade('o1', 'OLD', '2026-07-13', -1, 90),
    ],
    quotes: [{ symbol: 'CORE.TO', trade_date: '2026-08-28', close: 45 }, { symbol: 'CORE.TO', trade_date: '2026-09-16', close: 46 }, { symbol: 'ACME', trade_date: '2026-09-16', close: 100 }],
    symbols: [
      { symbol: 'CORE.TO', currency: 'CAD', underlying_symbol: null, cdr_ratio: null, cdr_fx_rate: null, cdr_as_of: null, display_name: 'Core ETF' },
      { symbol: 'ACME.NE', currency: 'CAD', underlying_symbol: 'ACME', cdr_ratio: 0.1, cdr_fx_rate: 1.2, cdr_as_of: '2026-09-16', display_name: 'Acme CDR' },
      { symbol: 'DIV.TO', currency: 'CAD', underlying_symbol: null, cdr_ratio: null, cdr_fx_rate: null, cdr_as_of: null, display_name: 'Dividend ETF' },
      { symbol: 'OLD', currency: 'CAD', underlying_symbol: null, cdr_ratio: null, cdr_fx_rate: null, cdr_as_of: null, display_name: 'Old fund' },
    ],
    settings: [{ user_id: 'u', base_currency: 'CAD', contributed_ytd: 900, goal_amount: 30000, goal_date: '2031-08-01' }],
    fx: [], watchlist: [{ symbol: 'LLY' }],
  }
}

describe('StockStream books', () => {
  const r = raw()
  const books = buildStockBooks(r, normalizeStock(r, now), now)
  it('computes average cost, gains and portfolio shares from the trade history', () => {
    // Core 20 @ avg 42 = 840, worth 920. Acme 15 left @ avg 10 = 150, worth 15 × 100 × 0.1 × 1.2 = 180.
    expect(books.holdings.map(h => [h.symbol, h.bookCost, h.value, h.gain, h.gainPercent])).toEqual([['CORE.TO', 840, 920, 80, 9.5], ['ACME.NE', 150, 180, 30, 20]])
    expect(books.totals).toMatchObject({ value: 1100, bookCost: 990, gain: 110, coreValue: 920, satelliteValue: 180, corePercent: 81.8, cash: 25 })
  })
  it('handles same-day round trips and leaves pre-history positions out of cost', () => {
    expect(books.realized).toEqual([{ symbol: 'DIV.TO', name: 'Dividend ETF', realized: -10, closed: true }, { symbol: 'ACME.NE', name: 'Acme CDR', realized: 20, closed: false }])
    expect(books.excludedFromCost).toEqual(['OLD'])
    expect(books.activity).toMatchObject({ trades: 7, openedAndClosed: ['DIV.TO'], sameDayRoundTrips: ['DIV.TO'] })
    expect(books.months).toEqual([
      // The pre-history sale still funded July's buys.
      { month: '2026-07', trades: 3, bought: 600, sold: 90, netInvested: 510 },
      { month: '2026-08', trades: 4, bought: 840, sold: 460, netInvested: 380 },
    ])
  })
  it('reports goal progress from recorded facts without projecting', () => {
    // Jul +510 and Aug +380 net invested. Recorded facts only: no plan, no projection.
    expect(books.goal).toEqual({ amount: 30000, date: '2031-08-01', monthsLeft: 58, averageMonthlyInvested: 445, completeMonthsMeasured: 2, progressPercent: 3.8, stillToReach: 28875 })
  })
  it('renders amounts in C$ with the guide and short-history caveats', () => {
    const text = renderStockBooks(books)
    expect(text).toContain('CDRs (Canadian Depositary Receipts)')
    expect(text).toContain('CORE.TO | Core ETF | core | 20 | C$42.00 | C$840.00 | C$920.00 | +C$80.00 | +9.5% | 81.8%')
    expect(text).toContain('C$28,875.00 still to reach it')
    expect(text).not.toMatch(/450|by the goal date|needed per month/i)
    expect(text).toContain('CORE.TO +2.2% (2026-08-28 to 2026-09-16)')
    expect(text).not.toContain('৳')
  })
})
