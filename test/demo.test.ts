import { describe, expect, it } from 'vitest'
import { assistantContext } from '../src/assistant/context'
import { buildPersonalBooks } from '../src/books/personal'
import { sampleFx, sampleMoney, sampleRent, sampleStock } from '../src/demo/sample'

// The demo is the live app with sample numbers: it must build through the same
// normalisers and books on any date, with no warnings from bad sample data.
describe('Demo sample data', () => {
  for (const when of ['2026-09-17T15:00:00Z', '2027-01-03T15:00:00Z', '2026-12-30T15:00:00Z']) {
    it(`builds every book on ${when.slice(0, 10)}`, () => {
      const now = new Date(when)
      const rent = sampleRent(now), stock = sampleStock(now), money = sampleMoney(now)
      expect(rent.books?.collections.length).toBeGreaterThan(6)
      expect(rent.overdueBdt).toBeGreaterThan(0)
      expect(rent.familyRestrictedCashBdt).toBeGreaterThan(0)
      expect(rent.strategicDeployableBdt).not.toBeNull()
      expect(rent.treasuryCashCad).toBeCloseTo(4340.5)
      expect(stock.portfolioCad).not.toBeNull()
      expect(stock.books?.holdings.map(h => h.symbol).sort()).toEqual(['ACME.NE', 'CORE.TO', 'GLOBEX.NE'])
      const personal = buildPersonalBooks(money, now, rent.treasury)
      expect(personal.months.filter(m => m.complete).length).toBeGreaterThanOrEqual(3)
      expect(personal.bills.subscriptionsCount).toBe(2)
      expect(personal.balances.map(b => b.account)).toContain('Sample Savings (Canada)')
      expect(money.suggestions.map(s => s.name)).toEqual(['TRANSIT PASS'])
      const text = assistantContext(rent, stock, sampleFx(now), money, now)
      for (const heading of ['# Overview across both countries', '# Bangladesh: RentStream books', '# Canada: personal money', '# Canada: StockStream books']) expect(text).toContain(heading)
      expect(text).not.toMatch(/unknown tenant|NaN|undefined/)
    })
  }
  it('uses no real names or accounts', () => {
    const text = assistantContext(sampleRent(), sampleStock(), sampleFx(), sampleMoney())
    for (const real of ['Agamasilane', 'Delwar', 'Fatema', 'Shompurna', 'Dhaka Bank', 'TD Unlimited', 'MSFT', 'XEQT', 'Virgin Plus', 'ChatGPT']) expect(text).not.toContain(real)
  })
})
