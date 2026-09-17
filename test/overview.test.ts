import { describe, expect, it } from 'vitest'
import { buildOverview, renderOverview } from '../src/books/overview'
import { createFxSource } from '../server/fx'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'

const rate = { rate: 88, asOf: '2026-09-17', source: 'test rates' }
const rent = {
  bankCashBdt: 4_400_000, refundableDepositsBdt: 4_140_000, cardDebtBdt: 30_000, familyRestrictedCashBdt: 730_000, operatingReserveTargetBdt: 1_900_000, strategicDeployableBdt: 1_700_000,
  books: { opportunities: { latestCompleteSurplus: { month: '2026-08', surplus: 704_000 } } },
} as unknown as RentSnapshot
const stock = { portfolioCad: 3600, cashCad: 0, books: { goal: { averageMonthlyInvested: 1430 } } } as unknown as StockSnapshot

describe('Two-country overview', () => {
  it('compares both sides in one currency at the dated rate', () => {
    const o = buildOverview(rent, stock, rate)
    expect(o.bangladesh?.cashAfterDebt).toBe(4_370_000)
    expect(o.ownersTotalCad).toBeCloseTo(4_370_000 / 88 + 3600, 1)
    expect(o.canadaInvestingShareOfBangladeshSurplus).toBe(17.9)
    const text = renderOverview(o)
    expect(text).toContain('1 CAD = ৳88.00')
    expect(text).toContain('dated 2026-09-17, from test rates')
    expect(text).toContain('Cash after card debt: ৳4,370,000 (≈ C$49,659.09)')
    expect(text).toContain('revolving, normally used as departing tenants\' final two months of rent')
    expect(text).not.toContain('Planned contribution')
    expect(text).not.toContain('wife')
    expect(text).toContain('Family-restricted cash (kept for family use, not deployable): ৳730,000')
    expect(text).toContain('three-month operating reserve (৳1,900,000 (≈ C$21,590.91))')
    expect(text).toContain('money actually transferred between countries gets a different rate')
  })
  it('says what is missing when a side is not read', () => {
    const text = renderOverview(buildOverview(null, stock, rate))
    expect(text).toContain('Bangladesh: RentStream not read.')
    expect(buildOverview(null, stock, rate).ownersTotalCad).toBeNull()
  })
})

describe('CAD/BDT rate source', () => {
  const erApi = (bdt: number) => new Response(JSON.stringify({ result: 'success', rates: { BDT: bdt }, time_last_update_utc: 'Thu, 17 Sep 2026 00:02:31 +0000', time_next_update_utc: 'Fri, 18 Sep 2026 00:19:41 +0000' }))
  it('uses ExchangeRate-API and caches until its next update', async () => {
    let calls = 0
    const source = createFxSource(async () => { calls++; return erApi(88.33) }, () => new Date('2026-09-17T12:00:00Z').getTime())
    expect(await source()).toMatchObject({ rate: 88.33, asOf: '2026-09-17', base: 'CAD', quote: 'BDT' })
    await source()
    expect(calls).toBe(1)
  })
  it('falls back to the second service, then to the last good rate', async () => {
    let clock = new Date('2026-09-17T12:00:00Z').getTime(), fail = false
    const source = createFxSource(async input => {
      if (fail) throw new Error('offline')
      return String(input).includes('open.er-api') ? new Response('{}') : new Response(JSON.stringify({ date: '2026-09-17', cad: { bdt: 88.43 } }))
    }, () => clock)
    expect(await source()).toMatchObject({ rate: 88.43, source: 'fawazahmed0 currency-api (jsDelivr)' })
    clock += 7 * 3_600_000; fail = true
    expect((await source()).rate).toBe(88.43)
  })
})
