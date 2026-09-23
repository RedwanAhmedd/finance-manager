import { describe, expect, it } from 'vitest'
import { buildBenchmarkLab, type BenchmarkSource, type ExactBenchmarkInput, type ProvisionalBenchmarkInput } from '../src/radar/benchmark'

// Entirely fictional values; these are not historical XEQT prices or user positions.
const open = '2026-01-02T21:00:00Z'
const middle = '2026-02-02T21:00:00Z'
const close = '2026-03-02T21:00:00Z'
const now = '2026-03-03T12:00:00Z'
const evidence = (reference = 'Fictional broker audit'): BenchmarkSource => ({ reference, observedAt: now, verified: true })
function exact(): ExactBenchmarkInput {
  const checkpoint = {
    currency: 'CAD' as const, securitiesValueCad: 100, retainedCashCad: 0,
    scope: 'individual-stock-sleeve' as const, complete: true, unlevered: true,
    netOfFees: true, beforePersonalTax: true, source: evidence(),
  }
  return {
    mode: 'exact', evaluatedAt: now,
    opening: { ...checkpoint, at: open },
    closing: { ...checkpoint, at: close, securitiesValueCad: 125 },
    history: { from: open, through: close, externalFlowsComplete: true, salesAndDistributionsIncludedInNav: true, source: evidence() },
    externalFlows: [],
    xeqt: {
      symbol: 'XEQT', exchange: 'TSX', currency: 'CAD', seriesId: 'fictional-coherent-total-return',
      basis: 'official-close-total-return', distributions: 'reinvested', fundExpenses: 'included', personalTax: 'excluded',
      points: [
        { at: open, totalReturnValue: 100, source: evidence('Fictional adjusted-series provider') },
        { at: middle, totalReturnValue: 110, source: evidence('Fictional adjusted-series provider') },
        { at: close, totalReturnValue: 120, source: evidence('Fictional adjusted-series provider') },
      ],
      executionCosts: { openingCad: 0, flows: [], source: evidence('Fictional commission/spread cost record') },
    },
  }
}
function addFlow(input: ExactBenchmarkInput, kind: 'contribution' | 'withdrawal', amountCad: number, at = middle, id = 'flow-1', fee = 0) {
  input.externalFlows.push({ id, at, kind, amountCad, currency: 'CAD', source: evidence() })
  input.xeqt.executionCosts.flows.push({ flowId: id, costCad: fee })
}
function provisional(): ProvisionalBenchmarkInput {
  return {
    mode: 'provisional', evaluatedAt: now, asOf: close, currency: 'CAD',
    positions: [{ instrumentId: 'EXAMPLE.NE@CBOE-CA:CAD', quantity: 5, valueCad: 150, costBasisCad: 100, costBasis: 'reconstructed', asOf: close, source: evidence() }],
  }
}

describe('XEQT benchmark lab', () => {
  it('compares the same initial capital and includes distribution-adjusted total return', () => {
    const result = buildBenchmarkLab(exact())
    expect(result).toMatchObject({ status: 'EXACT', method: 'CASH_FLOW_MATCHED', periodStart: open, asOf: close, sleeveValueCad: 125, xeqtValueCad: 120, alphaCad: 5, profitLossCad: 25 })
    expect(result.sleeveReturnPct).toBeCloseTo(25)
    expect(result.xeqtReturnPct).toBeCloseTo(20)
    expect(result.returnDifferencePct).toBeCloseTo(5)
  })

  it('does not call a late large contribution investment performance', () => {
    const input = exact()
    addFlow(input, 'contribution', 1000)
    input.closing.securitiesValueCad = 1210
    const result = buildBenchmarkLab(input)
    // One opening unit plus 1000/110 units at the actual contribution time.
    expect(result.status).toBe('EXACT')
    expect(result.xeqtValueCad).toBeCloseTo((1 + 1000 / 110) * 120)
    expect(result.alphaCad).toBeCloseTo(1210 - (1 + 1000 / 110) * 120)
    expect(result.profitLossCad).toBe(110)
    expect(result.sleeveReturnPct).toBeNull()
    expect(result.xeqtReturnPct).toBeNull()
    expect(result.returnDifferencePct).toBeNull()
  })

  it('keeps internal sales/realized proceeds and distributions in terminal retained cash', () => {
    const input = exact()
    // Stock sold for 130 and a 5 dividend was retained: no external contribution.
    input.closing.securitiesValueCad = 0
    input.closing.retainedCashCad = 135
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'EXACT', sleeveValueCad: 135, xeqtValueCad: 120, alphaCad: 15, profitLossCad: 35 })
  })

  it('rejects an internal sale supplied as an external flow', () => {
    const input = exact()
    addFlow(input, 'contribution', 130)
    Object.assign(input.externalFlows[0], { kind: 'sale' })
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it('compares retained cash drag from the opening checkpoint', () => {
    const input = exact()
    input.opening.retainedCashCad = 100
    input.closing.retainedCashCad = 100
    expect(buildBenchmarkLab(input)).toMatchObject({ sleeveValueCad: 225, xeqtValueCad: 240, alphaCad: -15 })
  })

  it('mirrors withdrawals at their actual timestamp instead of assuming negative performance', () => {
    const input = exact()
    addFlow(input, 'withdrawal', 55)
    input.closing.securitiesValueCad = 65
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'EXACT', xeqtValueCad: 60, alphaCad: 5, profitLossCad: 20, returnDifferencePct: null })
  })

  it('refuses an insolvent counterfactual even when a later contribution could conceal it', () => {
    const input = exact()
    addFlow(input, 'withdrawal', 111)
    addFlow(input, 'contribution', 500, close, 'later')
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', xeqtValueCad: null, alphaCad: null })
  })

  it('applies verified benchmark execution costs and fund-cost-adjusted values consistently', () => {
    const input = exact()
    input.xeqt.executionCosts.openingCad = 1
    addFlow(input, 'contribution', 110, middle, 'add', 2)
    expect(buildBenchmarkLab(input).xeqtValueCad).toBeCloseTo((99 / 100 + 108 / 110) * 120)
  })

  it('accounts for withdrawal execution costs without inventing additional capital', () => {
    const input = exact()
    addFlow(input, 'withdrawal', 54, middle, 'withdraw', 1)
    expect(buildBenchmarkLab(input).xeqtValueCad).toBeCloseTo(60)
  })

  it('rejects missing execution costs instead of assuming a commission-free broker', () => {
    const input = exact()
    addFlow(input, 'contribution', 100)
    input.xeqt.executionCosts.flows = []
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
  })

  it.each(['externalFlowsComplete', 'salesAndDistributionsIncludedInNav'] as const)('requires %s', flag => {
    const input = exact()
    input.history[flag] = false
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it('does not shift a flow to the nearest available daily price', () => {
    const input = exact()
    addFlow(input, 'contribution', 100, '2026-02-02T20:59:00Z')
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it.each([open, close])('requires a benchmark point at endpoint %s', missing => {
    const input = exact()
    input.xeqt.points = input.xeqt.points.filter(point => point.at !== missing)
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
  })

  it('requires history to cover exactly the opening-to-closing interval', () => {
    const input = exact()
    input.history.from = middle
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
  })

  it('rejects unverified, missing, predated and future source evidence', () => {
    for (const patch of [{ verified: false }, { reference: '' }, { observedAt: '2026-01-01T12:00:00Z' }, { observedAt: '2026-03-04T12:00:00Z' }]) {
      const input = exact()
      Object.assign(input.closing.source, patch)
      expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
    }
  })

  it('rejects future market points and future valuations', () => {
    const input = exact()
    input.xeqt.points.push({ at: '2026-03-04T12:00:00Z', totalReturnValue: 121, source: evidence() })
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    const future = exact()
    future.evaluatedAt = middle
    expect(buildBenchmarkLab(future).status).toBe('UNAVAILABLE')
  })

  it('rejects date-only, timezone-free and nonexistent calendar dates', () => {
    for (const badDate of ['2026-02-02', '2026-02-02T21:00:00', '2026-02-30T21:00:00Z']) {
      const input = exact()
      input.opening.at = badDate
      expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    }
  })

  it('rejects duplicate flows, duplicate timestamps and duplicate benchmark points', () => {
    const input = exact()
    addFlow(input, 'contribution', 100)
    addFlow(input, 'withdrawal', 50, middle, 'flow-2')
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    const duplicate = exact()
    duplicate.xeqt.points.push({ ...duplicate.xeqt.points[0] })
    expect(buildBenchmarkLab(duplicate).status).toBe('UNAVAILABLE')
    const ids = exact()
    addFlow(ids, 'contribution', 100)
    addFlow(ids, 'withdrawal', 50, close)
    expect(buildBenchmarkLab(ids).status).toBe('UNAVAILABLE')
  })

  it('rejects an opening-date flow that could double count the opening checkpoint', () => {
    const input = exact()
    addFlow(input, 'contribution', 100, open)
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
  })

  it('uses explicit zero opening NAV with later contributions without a fabricated prehistory', () => {
    const input = exact()
    input.opening.securitiesValueCad = 0
    addFlow(input, 'contribution', 110)
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'EXACT', xeqtValueCad: 120, periodStart: open, returnDifferencePct: null })
  })

  it('rejects wrong instruments, currencies, price-only series and inconsistent tax/distribution treatment', () => {
    for (const patch of [{ symbol: 'VEQT' }, { exchange: 'NYSE' }, { currency: 'USD' }, { basis: 'price-only' }, { distributions: 'excluded' }, { fundExpenses: 'excluded' }, { personalTax: 'included' }]) {
      const input = exact()
      Object.assign(input.xeqt, patch)
      expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    }
  })

  it('provides an honest provisional cost-basis scoreboard without fabricated XEQT alpha', () => {
    expect(buildBenchmarkLab(provisional())).toMatchObject({
      status: 'ESTIMATE', method: 'CURRENT_HOLDINGS_COST_BASIS', sleeveValueCad: 150,
      costBasisCad: 100, profitLossCad: 50, costBasisReturnPct: 50,
      xeqtValueCad: null, alphaCad: null, returnDifferencePct: null,
    })
  })

  it('labels verified cost basis as an estimate when cash-flow history is still unavailable', () => {
    const input = provisional()
    input.positions[0].costBasis = 'verified'
    expect(buildBenchmarkLab(input).status).toBe('ESTIMATE')
  })

  it('rejects mismatched provisional valuation times and zero-quantity mementos', () => {
    const input = provisional()
    input.positions[0].asOf = middle
    expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    const memento = provisional()
    memento.positions[0].quantity = 0
    expect(buildBenchmarkLab(memento).status).toBe('UNAVAILABLE')
  })

  it('withholds cost-basis return when cost basis is zero', () => {
    const input = provisional()
    input.positions[0].costBasisCad = 0
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'ESTIMATE', costBasisReturnPct: null, alphaCad: null })
  })

  it('rejects non-finite and negative amounts and malformed research JSON without throwing', () => {
    for (const value of [NaN, Infinity, -1]) {
      const input = exact()
      input.closing.retainedCashCad = value
      expect(buildBenchmarkLab(input).status).toBe('UNAVAILABLE')
    }
    expect(buildBenchmarkLab(null as unknown as ExactBenchmarkInput).status).toBe('UNAVAILABLE')
    expect(buildBenchmarkLab({} as ExactBenchmarkInput).status).toBe('UNAVAILABLE')
  })

  it('does not finance withdrawals through a fixed epsilon in arbitrary benchmark units', () => {
    const input = exact()
    input.xeqt.points.forEach(point => { point.totalReturnValue *= 1e100 })
    addFlow(input, 'withdrawal', 111)
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', xeqtValueCad: null, alphaCad: null })
  })

  it('preserves the comparison under a coherent change in total-return normalization', () => {
    const input = exact()
    input.xeqt.points.forEach(point => { point.totalReturnValue *= 1e100 })
    addFlow(input, 'contribution', 1000)
    const result = buildBenchmarkLab(input)
    expect(result.status).toBe('EXACT')
    expect(result.xeqtValueCad).toBeCloseTo((1 + 1000 / 110) * 120)
  })

  it('allows a fully funded withdrawal to zero without fictitious borrowing', () => {
    const input = exact()
    addFlow(input, 'withdrawal', 110)
    input.closing.securitiesValueCad = 0
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'EXACT', xeqtValueCad: 0, alphaCad: 0 })
  })

  it('fails closed when individually finite inputs overflow derived returns', () => {
    const input = exact()
    input.opening.securitiesValueCad = Number.MIN_VALUE
    input.xeqt.points.forEach(point => { point.totalReturnValue = 1 })
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null, sleeveReturnPct: null })
    const estimated = provisional()
    estimated.positions[0].costBasisCad = Number.MIN_VALUE
    expect(buildBenchmarkLab(estimated)).toMatchObject({ status: 'UNAVAILABLE', costBasisReturnPct: null })
  })

  it('fails closed when a total-return normalization cannot represent funded units', () => {
    const input = exact()
    input.opening.securitiesValueCad = Number.MIN_VALUE
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
    const flow = exact()
    flow.opening.securitiesValueCad = 0
    addFlow(flow, 'contribution', Number.MIN_VALUE)
    expect(buildBenchmarkLab(flow)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it('rejects future provisional positions and unknown cost basis without manufacturing alpha', () => {
    const input = provisional()
    input.asOf = '2026-03-04T12:00:00Z'
    input.positions[0].asOf = input.asOf
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
    const unknownBasis = provisional()
    Object.assign(unknownBasis.positions[0], { costBasis: 'unknown' })
    expect(buildBenchmarkLab(unknownBasis)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it('rejects incomplete nested records and malformed ledger rows without throwing', () => {
    const variants = [
      { opening: null }, { history: null }, { xeqt: null },
      { externalFlows: [null] },
    ]
    for (const patch of variants) {
      expect(buildBenchmarkLab(Object.assign(exact(), patch))).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
    }
    const badCosts = exact()
    Object.assign(badCosts.xeqt, { executionCosts: null })
    expect(buildBenchmarkLab(badCosts)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
    const badPosition = provisional()
    Object.assign(badPosition, { positions: [null] })
    expect(buildBenchmarkLab(badPosition)).toMatchObject({ status: 'UNAVAILABLE', alphaCad: null })
  })

  it('rejects duplicate provisional positions instead of double-counting owned capital', () => {
    const input = provisional()
    input.positions.push(structuredClone(input.positions[0]))
    expect(buildBenchmarkLab(input)).toMatchObject({ status: 'UNAVAILABLE', sleeveValueCad: null, alphaCad: null })
  })

  it('does not mutate input arrays when ordering external flows', () => {
    const input = exact()
    addFlow(input, 'contribution', 100, close, 'late')
    addFlow(input, 'contribution', 100, middle, 'early')
    const copy = structuredClone(input)
    expect(buildBenchmarkLab(input).status).toBe('EXACT')
    expect(input).toEqual(copy)
  })
})
