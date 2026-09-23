/**
 * XEQT opportunity-cost lab. No quotes, history, ownership or cash flows are inferred.
 *
 * Methodology: mirror verified EXTERNAL cash flows from an explicit opening NAV in
 * one coherent XEQT total-return series. Stock purchases/sales are internal; their
 * proceeds, distributions and execution costs are already in the sleeve's NAV.
 * Retained cash therefore participates in the strategy's actual result.
 *
 * GIPS explains why external cash flows invalidate raw profit-% comparisons and
 * why a true TWR needs valuations at flow boundaries:
 * https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/
 * BlackRock's XEQT performance includes reinvested distributions and fund expenses:
 * https://www.blackrock.com/ca/investors/en/products/309480/ishares-core-equity-etf-portfolio-fund
 *
 * EXACT describes the cash-flow-matched counterfactual over the supplied interval,
 * not an executable trade, lifetime result, or a claim of GIPS compliance. Fractional
 * benchmark units are a mathematical counterfactual. No interpolation, borrowed
 * benchmark cash, personal-tax assumptions, or unseen pre-checkpoint path is used.
 */
export interface BenchmarkSource {
  reference: string
  observedAt: string // Canonical UTC timestamp; not a date-only or local-time guess.
  verified: boolean
}

export interface BenchmarkNavCheckpoint {
  at: string
  currency: 'CAD'
  securitiesValueCad: number
  retainedCashCad: number // Includes retained sale proceeds and cash distributions.
  scope: 'individual-stock-sleeve'
  complete: boolean
  unlevered: boolean
  netOfFees: boolean
  beforePersonalTax: boolean
  source: BenchmarkSource
}

export interface BenchmarkExternalFlow {
  id: string
  at: string
  kind: 'contribution' | 'withdrawal'
  amountCad: number // Positive amount; kind supplies direction.
  currency: 'CAD'
  source: BenchmarkSource
}

export interface ExactBenchmarkInput {
  mode: 'exact'
  evaluatedAt: string
  opening: BenchmarkNavCheckpoint
  closing: BenchmarkNavCheckpoint
  history: {
    from: string
    through: string
    externalFlowsComplete: boolean
    salesAndDistributionsIncludedInNav: boolean
    source: BenchmarkSource
  }
  externalFlows: BenchmarkExternalFlow[]
  xeqt: {
    symbol: 'XEQT'
    exchange: 'TSX'
    currency: 'CAD'
    seriesId: string // All values must share this normalization and methodology.
    basis: 'official-close-total-return'
    distributions: 'reinvested'
    fundExpenses: 'included'
    personalTax: 'excluded'
    points: { at: string; totalReturnValue: number; source: BenchmarkSource }[]
    executionCosts: {
      openingCad: number
      flows: { flowId: string; costCad: number }[] // Explicit zero is allowed; omission is not.
      source: BenchmarkSource
    }
  }
}

export interface ProvisionalBenchmarkInput {
  mode: 'provisional'
  evaluatedAt: string
  asOf: string
  currency: 'CAD'
  positions: {
    instrumentId: string // Exact owned instrument, not its underlying or a watchlist entry.
    quantity: number
    valueCad: number
    costBasisCad: number
    costBasis: 'verified' | 'reconstructed'
    asOf: string
    source: BenchmarkSource
  }[]
}

export type BenchmarkLabInput = ExactBenchmarkInput | ProvisionalBenchmarkInput
export interface BenchmarkLabResult {
  status: 'UNAVAILABLE' | 'ESTIMATE' | 'EXACT'
  reason: string
  method: 'CASH_FLOW_MATCHED' | 'CURRENT_HOLDINGS_COST_BASIS' | null
  periodStart: string | null
  asOf: string | null
  sleeveValueCad: number | null
  xeqtValueCad: number | null
  alphaCad: number | null
  sleeveReturnPct: number | null
  xeqtReturnPct: number | null
  returnDifferencePct: number | null
  costBasisCad: number | null
  profitLossCad: number | null
  costBasisReturnPct: number | null
  sources: string[]
}

const empty = (reason: string): BenchmarkLabResult => ({
  status: 'UNAVAILABLE', reason, method: null, periodStart: null, asOf: null,
  sleeveValueCad: null, xeqtValueCad: null, alphaCad: null,
  sleeveReturnPct: null, xeqtReturnPct: null, returnDifferencePct: null,
  costBasisCad: null, profitLossCad: null, costBasisReturnPct: null, sources: [],
})
function requireValue(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason)
}
function timestamp(value: unknown, label: string): number {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `${label} needs an exact UTC timestamp.`)
  const time = Date.parse(value)
  requireValue(Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), `${label} is not a valid timestamp.`)
  return time
}
function amount(value: unknown, label: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${label} must be a finite non-negative CAD amount.`)
}
function finiteResult(value: number, label: string): number {
  requireValue(Number.isFinite(value), `${label} exceeds numerical limits.`)
  return value
}
function source(value: BenchmarkSource, eventAt: number, now: number, references: Set<string>) {
  requireValue(value && value.verified === true && typeof value.reference === 'string' && value.reference.trim().length > 0, 'Verified source evidence is missing.')
  const observedAt = timestamp(value.observedAt, 'Source observation')
  requireValue(observedAt >= eventAt && observedAt <= now, 'Source observation predates the evidence or is in the future.')
  references.add(value.reference)
}
function nav(value: BenchmarkNavCheckpoint, now: number, references: Set<string>): { time: number; value: number } {
  const time = timestamp(value.at, 'NAV checkpoint')
  requireValue(time <= now, 'NAV checkpoint is in the future.')
  requireValue(value.currency === 'CAD' && value.scope === 'individual-stock-sleeve', 'NAV must cover the CAD individual-stock sleeve.')
  requireValue(value.complete === true && value.unlevered === true && value.netOfFees === true && value.beforePersonalTax === true, 'NAV scope, retained cash, fees, tax basis, or leverage is unverified.')
  amount(value.securitiesValueCad, 'Securities value')
  amount(value.retainedCashCad, 'Retained cash')
  source(value.source, time, now, references)
  const total = value.securitiesValueCad + value.retainedCashCad
  amount(total, 'Total NAV')
  return { time, value: total }
}

/** Fail closed for incomplete research JSON. No input is mutated and no data is fetched. */
export function buildBenchmarkLab(input: BenchmarkLabInput): BenchmarkLabResult {
  try {
    const now = timestamp(input.evaluatedAt, 'Evaluation time')
    const references = new Set<string>()
    if (input.mode === 'provisional') {
      const asOf = timestamp(input.asOf, 'Scoreboard time')
      requireValue(asOf <= now && input.currency === 'CAD', 'Scoreboard must use non-future CAD values.')
      requireValue(Array.isArray(input.positions) && input.positions.length > 0, 'Verified current holdings and cost basis are missing.')
      let valueCad = 0
      let costCad = 0
      const ids = new Set<string>()
      for (const p of input.positions) {
        requireValue(typeof p.instrumentId === 'string' && p.instrumentId.trim().length > 0 && !ids.has(p.instrumentId), 'Position identity is missing or duplicated.')
        ids.add(p.instrumentId)
        requireValue(typeof p.quantity === 'number' && Number.isFinite(p.quantity) && p.quantity > 0, 'Scoreboard requires verified positive owned quantities.')
        requireValue(timestamp(p.asOf, 'Position value time') === asOf, 'Position values do not share the scoreboard timestamp.')
        requireValue(p.costBasis === 'verified' || p.costBasis === 'reconstructed', 'Position cost basis is not verified or reconstructed.')
        amount(p.valueCad, 'Position value')
        amount(p.costBasisCad, 'Position cost basis')
        source(p.source, asOf, now, references)
        valueCad += p.valueCad
        costCad += p.costBasisCad
      }
      amount(valueCad, 'Scoreboard total')
      amount(costCad, 'Scoreboard cost basis')
      return {
        ...empty(''), status: 'ESTIMATE', method: 'CURRENT_HOLDINGS_COST_BASIS', asOf: input.asOf,
        reason: 'ESTIMATE: current holdings versus cost basis only. Cash, closed trades and distributions are not a complete performance history; XEQT alpha is unavailable without a matched baseline.',
        sleeveValueCad: valueCad, costBasisCad: costCad, profitLossCad: valueCad - costCad,
        costBasisReturnPct: costCad > 0 ? finiteResult((valueCad / costCad - 1) * 100, 'Cost-basis return') : null,
        sources: [...references],
      }
    }
    requireValue(input.mode === 'exact', 'Unknown benchmark mode.')
    const opening = nav(input.opening, now, references)
    const closing = nav(input.closing, now, references)
    requireValue(opening.time < closing.time, 'Opening NAV must precede closing NAV.')
    requireValue(timestamp(input.history.from, 'History start') === opening.time && timestamp(input.history.through, 'History end') === closing.time, 'History coverage does not match the NAV interval.')
    requireValue(input.history.externalFlowsComplete === true && input.history.salesAndDistributionsIncludedInNav === true, 'Complete external flows and retained sales/distributions are required.')
    source(input.history.source, closing.time, now, references)
    const benchmark = input.xeqt
    requireValue(benchmark.symbol === 'XEQT' && benchmark.exchange === 'TSX' && benchmark.currency === 'CAD', 'Benchmark must be the exact TSX-listed CAD XEQT instrument.')
    requireValue(typeof benchmark.seriesId === 'string' && benchmark.seriesId.trim().length > 0 && benchmark.basis === 'official-close-total-return' && benchmark.distributions === 'reinvested' && benchmark.fundExpenses === 'included' && benchmark.personalTax === 'excluded', 'XEQT needs one verified total-return series with reinvested distributions and consistent fee/tax treatment.')
    requireValue(Array.isArray(benchmark.points), 'XEQT total-return points are missing.')
    const points = new Map<number, number>()
    for (const p of benchmark.points) {
      const time = timestamp(p.at, 'XEQT point')
      requireValue(time <= now && !points.has(time), 'XEQT point is in the future or duplicated.')
      requireValue(typeof p.totalReturnValue === 'number' && Number.isFinite(p.totalReturnValue) && p.totalReturnValue > 0, 'XEQT total-return value must be finite and positive.')
      source(p.source, time, now, references)
      points.set(time, p.totalReturnValue)
    }
    const pointAt = (time: number): number => {
      const value = points.get(time)
      requireValue(value !== undefined, 'A matched XEQT point is missing; dates are never shifted or interpolated.')
      return value
    }
    const startPoint = pointAt(opening.time)
    const endPoint = pointAt(closing.time)
    requireValue(Array.isArray(input.externalFlows) && Array.isArray(benchmark.executionCosts.flows), 'External flow ledger or XEQT execution costs are missing.')
    amount(benchmark.executionCosts.openingCad, 'XEQT opening execution cost')
    source(benchmark.executionCosts.source, closing.time, now, references)
    const costs = new Map<string, number>()
    for (const fee of benchmark.executionCosts.flows) {
      requireValue(typeof fee.flowId === 'string' && fee.flowId.trim().length > 0 && !costs.has(fee.flowId), 'XEQT flow execution costs are duplicated or lack identity.')
      amount(fee.costCad, 'XEQT flow execution cost')
      costs.set(fee.flowId, fee.costCad)
    }
    requireValue(costs.size === input.externalFlows.length, 'Each external flow needs one explicit XEQT execution cost, including zero.')
    requireValue(benchmark.executionCosts.openingCad <= opening.value, 'XEQT opening costs exceed available starting capital.')
    const openingCapital = opening.value - benchmark.executionCosts.openingCad
    let units = finiteResult(openingCapital / startPoint, 'XEQT opening units')
    requireValue(openingCapital === 0 || units > 0, 'XEQT opening units are below numerical precision.')
    let netExternalCad = 0
    const ids = new Set<string>()
    const flows = input.externalFlows.map(flow => ({ flow, time: timestamp(flow.at, 'External flow') })).sort((a, b) => a.time - b.time)
    let previousTime = opening.time
    for (const { flow, time } of flows) {
      requireValue(typeof flow.id === 'string' && flow.id.trim().length > 0 && !ids.has(flow.id), 'External flow identity is missing or duplicated.')
      ids.add(flow.id)
      requireValue(time > previousTime && time <= closing.time, 'External flows must have distinct times after opening and at or before closing; ordering cannot be assumed.')
      previousTime = time
      requireValue(flow.currency === 'CAD' && (flow.kind === 'contribution' || flow.kind === 'withdrawal'), 'Only verified external CAD contributions/withdrawals are flows; stock buys, sales and retained dividends are internal.')
      amount(flow.amountCad, 'External flow amount')
      requireValue(flow.amountCad > 0, 'External flow amount must be positive.')
      source(flow.source, time, now, references)
      const fee = costs.get(flow.id)
      requireValue(fee !== undefined, 'External flow execution cost is missing.')
      if (flow.kind === 'contribution') requireValue(fee <= flow.amountCad, 'XEQT contribution costs exceed the contribution.')
      const signed = flow.kind === 'contribution' ? flow.amountCad : -flow.amountCad
      const unitsChanged = finiteResult((signed - fee) / pointAt(time), 'XEQT flow units')
      requireValue(signed === fee || unitsChanged !== 0, 'XEQT flow units are below numerical precision.')
      units = finiteResult(units + unitsChanged, 'XEQT units')
      // No fixed unit epsilon: its CAD value depends on arbitrary series normalization.
      // Even a tiny negative unit balance would invent borrowing.
      requireValue(units >= 0, 'XEQT cannot fund a withdrawal at that time; a borrowing or altered-withdrawal path would be hypothetical.')
      netExternalCad = finiteResult(netExternalCad + signed, 'External flow total')
    }
    const xeqtValueCad = units * endPoint
    amount(xeqtValueCad, 'XEQT terminal value')
    requireValue(Number.isFinite(netExternalCad), 'External flow total exceeds numerical limits.')
    const noFlows = flows.length === 0 && opening.value > 0
    const sleeveReturnPct = noFlows ? finiteResult((closing.value / opening.value - 1) * 100, 'Sleeve return') : null
    const xeqtReturnPct = noFlows ? finiteResult((xeqtValueCad / opening.value - 1) * 100, 'XEQT return') : null
    return {
      ...empty(''), status: 'EXACT', method: 'CASH_FLOW_MATCHED', periodStart: input.opening.at, asOf: input.closing.at,
      reason: `Same external cash flows and dates from the verified opening checkpoint; terminal NAV includes retained cash, sold positions and distributions, net of strategy costs and before personal tax.${noFlows ? '' : ' Return percentages are withheld without sleeve valuations at every flow.'}`,
      sleeveValueCad: closing.value, xeqtValueCad, alphaCad: closing.value - xeqtValueCad,
      profitLossCad: finiteResult(closing.value - opening.value - netExternalCad, 'Sleeve profit/loss'),
      sleeveReturnPct, xeqtReturnPct,
      returnDifferencePct: sleeveReturnPct === null || xeqtReturnPct === null ? null : sleeveReturnPct - xeqtReturnPct,
      sources: [...references],
    }
  } catch (error) {
    return empty(error instanceof Error ? error.message : 'Benchmark evidence is malformed or incomplete.')
  }
}
