import { describe, expect, it } from 'vitest'
import { buildFinanceReport, buildLiquidity, recommendAllocation, toCad } from '../src/engine/financeEngine'
import { demoPolicy, demoRentStream, demoStockStream } from '../src/fixtures/demoData'

const now = new Date()

describe('Finance Engine', () => {
  it('converts BDT to CAD only at the display/normalization layer', () => {
    expect(toCad({ amount: 89_000, currency: 'BDT' }, demoPolicy)).toBeCloseTo(1000)
  })

  it('does not count the same cash twice', () => {
    const liquidity = buildLiquidity(demoRentStream, demoStockStream, demoPolicy, now)
    const rentCash = liquidity.accounts.reduce((sum, x) => sum + x.balanceCad, 0)
    expect(liquidity.totalCashCad).toBeCloseTo(rentCash + demoStockStream.brokerageCashCad)
  })

  it('protects reserves and obligations before strike allocations', () => {
    const liquidity = buildLiquidity(demoRentStream, demoStockStream, demoPolicy, now)
    const recommendation = recommendAllocation(liquidity, demoStockStream, demoPolicy)
    const buckets = recommendation.actions.map((x) => x.bucket)
    expect(buckets.indexOf('reserve')).toBeGreaterThanOrEqual(0)
    expect(buckets.indexOf('obligation')).toBeGreaterThanOrEqual(0)
    if (buckets.includes('strike')) {
      expect(buckets.indexOf('strike')).toBeGreaterThan(buckets.indexOf('reserve'))
      expect(buckets.indexOf('strike')).toBeGreaterThan(buckets.indexOf('obligation'))
    }
  })

  it('marks every recommendation as approval-required', () => {
    const report = buildFinanceReport(demoRentStream, demoStockStream, demoPolicy, now)
    expect(report.recommendation.actions.every((x) => x.approvalRequired)).toBe(true)
  })
})
