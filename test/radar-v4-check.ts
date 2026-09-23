import assert from 'node:assert/strict'
import { emptyRadarInput, evaluateRadar, parseRadarInput, type RadarInput } from '../src/radar/engine.ts'
import { radarFixture } from './radar-fixture.ts'

const now = '2026-09-14T14:00:00.000Z'
let checks = 0
function check(name: string, fn: () => void) { fn(); checks++; console.log('ok  radar: ' + name) }
function blocked(name: string, gate: string, change: (i: RadarInput) => void) {
  check(name, () => {
    const i = structuredClone(radarFixture()); change(i)
    const e = evaluateRadar(i, now, { recentStrikeCount: 0 })
    assert.equal(e.label, 'NO ACTION')
    const actualGate = e.gates.find(g => g.id === gate)
    assert.ok(actualGate, `Missing gate: ${gate}`)
    assert.notEqual(actualGate.status, 'pass')
  })
}
check('blank worksheet stays unscored and has no size', () => {
  const i = emptyRadarInput('MSFT.NE', 'MSFT')
  assert.equal(parseRadarInput(i).ok, true)
  const e = evaluateRadar(i, now)
  assert.equal(e.label, 'NO ACTION'); assert.equal(e.opportunity, 'UNSCORED'); assert.equal(e.proposedAmountCad, null)
})
check('all reviewed fictional gates can qualify for STRIKE', () => {
  const e = evaluateRadar(radarFixture(), now, { recentStrikeCount: 0 })
  assert.equal(e.label, 'STRIKE'); assert.equal(e.allocation, 'READY'); assert.equal(e.proposedAmountCad, 500)
  assert.ok(Math.abs(e.marginOfSafetyPct! - 33.3333333333) < 1e-6)
  assert.ok(Math.abs(e.excessReturnPct! - 7.8) < 1e-6)
  assert.ok(Math.abs(e.companyPctAfter! - 5500 / 99999 * 100) < 1e-9, 'cash-funded purchase cannot increase NAV; fees reduce it')
  assert.ok(Math.abs(e.sectorPctAfter! - 20500 / 99999 * 100) < 1e-9)
})
for (const section of ['instrument', 'thesis', 'valuation', 'zones', 'quote', 'underlyingQuote', 'benchmark', 'redTeam', 'execution', 'portfolio'] as const) {
  const gate = { instrument: 'identity', underlyingQuote: 'execution', redTeam: 'red-team', portfolio: 'cash' }[section as string] ?? section
  blocked(`${section}: absent source prevents action`, gate, i => { i[section].evidence = [] })
}
blocked('bare US ticker cannot be a CAD receipt', 'identity', i => { i.instrument.symbol = 'TEST' })
blocked('unverified identity', 'identity', i => { i.instrument.identityVerified = null })
blocked('USD instrument is not a CAD action', 'identity', i => { i.instrument.currency = 'USD' })
blocked('US exchange cannot verify a CAD listing', 'identity', i => { i.instrument.exchange = 'NASDAQ' })
blocked('missing hedge confirmation', 'mapping', i => { i.instrument.cdr.cadHedged = null })
blocked('missing ratio', 'mapping', i => { i.instrument.cdr.ratio = null })
blocked('stale mapping', 'mapping', i => { i.instrument.cdr.evidence = [{ sourceUrl: 'https://example.com/issuer', asOf: '2026-09-10T14:00:00Z' }] })
blocked('owner-cash bridge unfinished', 'valuation', i => { i.valuation.ownerCashReconciled = false })
blocked('wrong fundamental reference', 'valuation', i => { i.valuation.referenceSymbol = 'OTHER' })
blocked('US model is mislabelled CAD', 'valuation', i => { i.valuation.currency = 'CAD' })
blocked('negative valuation', 'valuation', i => { i.valuation.bearFairValue = -1 })
blocked('inverted fundamental scenarios', 'valuation', i => { i.valuation.baseFairValue = 200 })
blocked('USD zones cannot govern CAD units', 'zones', i => { i.zones.currency = 'USD' })
blocked('inverted price tiers', 'zones', i => { i.zones.strikeBelow = 25 })
blocked('mapping explanation missing', 'zones', i => { i.zones.mappingMethod = '' })
blocked('estimated quote', 'quote', i => { i.quote.basis = 'estimated' })
blocked('derived receipt mark is not an observed executable quote', 'quote', i => { i.quote.basis = 'derived' })
blocked('market closed', 'quote', i => { i.quote.marketOpen = false })
blocked('wrong quote currency', 'quote', i => { i.quote.currency = 'USD' })
blocked('wrong receipt quote', 'quote', i => { i.quote.symbol = 'OTHER.NE' })
blocked('stale quote', 'quote', i => { i.quote.evidence = [{ sourceUrl: 'https://example.com/quote', asOf: '2026-09-14T13:44:59Z' }] })
blocked('future quote', 'quote', i => { i.quote.evidence = [{ sourceUrl: 'https://example.com/quote', asOf: '2026-09-14T14:00:01Z' }] })
blocked('stale source cannot hide behind a fresh source', 'quote', i => { i.quote.evidence.push({ sourceUrl: 'https://example.com/old', asOf: '2026-09-01T00:00:00Z' }) })
blocked('XEQT wins after risk premiums', 'benchmark', i => { i.benchmark.candidateBasePct = 12 })
blocked('waiting hurdle wins', 'benchmark', i => { i.benchmark.waitingAnnualReturnPct = 20 })
blocked('unlike currencies for benchmark', 'benchmark', i => { i.benchmark.currency = 'USD' })
blocked('price returns are not total returns', 'benchmark', i => { i.benchmark.totalReturnBasis = false })
blocked('risk premium cannot be zeroed away', 'benchmark', i => { i.benchmark.modelRiskPremiumPct = 0 })
blocked('candidate return scenarios inverted', 'benchmark', i => { i.benchmark.candidateBearPct = 25 })
blocked('joint stress fails risk policy', 'red-team', i => { i.redTeam.jointStressAnnualReturnPct = -20 })
blocked('positive shock cannot masquerade as stress', 'red-team', i => { i.redTeam.growthShockPct = 20 })
blocked('value trap unresolved', 'red-team', i => { i.redTeam.valueTrapRisk = 'unresolved' })
blocked('no market counterargument', 'red-team', i => { i.redTeam.marketCounterargument = '' })
blocked('red team did not survive', 'red-team', i => { i.redTeam.survived = false })
blocked('crossed bid ask', 'execution', i => { i.execution.bid = 21 })
blocked('wide spread', 'execution', i => { i.execution.bid = 18 })
blocked('no liquidity evidence', 'execution', i => { i.execution.averageDailyUnits = null })
blocked('size overwhelms liquidity', 'execution', i => { i.execution.averageDailyUnits = 1 })
blocked('CDR dislocation from underlying', 'execution', i => { i.underlyingQuote.price = 200 })
blocked('wrong underlying quote', 'execution', i => { i.underlyingQuote.symbol = 'OTHER' })
blocked('fresh but asynchronous quotes cannot establish dislocation', 'execution', i => { i.underlyingQuote.evidence = [{ sourceUrl: 'https://example.com/quote', asOf: '2026-09-14T13:58:59Z' }] })
blocked('negative execution fees', 'execution', i => { i.execution.estimatedFeesCad = -1 })
blocked('cash unknown', 'cash', i => { i.portfolio.settledCashCad = null })
blocked('pending orders unconfirmed', 'cash', i => { i.portfolio.pendingOrdersConfirmed = null })
blocked('reserved orders leave insufficient cash', 'cash', i => { i.portfolio.reservedOrdersCad = 3999.5 })
blocked('fees included in spend limit', 'cash', i => { i.portfolio.settledCashCad = 1600 })
blocked('negative cash buffer', 'cash', i => { i.portfolio.cashBufferCad = -1 })
blocked('stale portfolio evidence', 'cash', i => { i.portfolio.evidence = [{ sourceUrl: 'https://example.com/broker', asOf: '2026-09-13T14:00:00Z' }] })
blocked('unknown core overlap', 'concentration', i => { i.portfolio.overlapKnown = null })
blocked('company cap breached', 'concentration', i => { i.portfolio.companyExposureCad = 9800 })
blocked('fees cannot hide a concentration breach at the cap', 'concentration', i => { i.portfolio.companyExposureCad = 9500 })
blocked('sector cap breached', 'concentration', i => { i.portfolio.sectorExposureCad = 29900 })
blocked('pending company buys count against concentration', 'concentration', i => { i.portfolio.companyExposureCad = 9400; i.portfolio.pendingCompanyBuysCad = 200; i.portfolio.pendingSectorBuysCad = 200; i.portfolio.reservedOrdersCad = 200 })
blocked('missing policy is not a default approval', 'policy', i => { i.policy.minMosBuyPct = null })
blocked('STRIKE cannot use weaker thresholds', 'policy', i => { i.policy.minExcessStrikePct = 2 })
blocked('unbounded quote freshness is rejected', 'policy', i => { i.policy.maxQuoteAgeMinutes = 99999 })
blocked('price above buy zone must wait', 'entry', i => { i.zones.strikeBelow = 17; i.zones.buyBelow = 19 })
check('broken thesis is PASS separately from no action', () => {
  const i = radarFixture(); i.thesis.status = 'broken'
  const e = evaluateRadar(i, now, { recentStrikeCount: 0 })
  assert.equal(e.label, 'NO ACTION'); assert.equal(e.opportunity, 'PASS'); assert.equal(e.thesis, 'BROKEN')
})
check('complete valuation can coexist with missing cash', () => {
  const i = radarFixture(); i.portfolio.settledCashCad = null
  const e = evaluateRadar(i, now, { recentStrikeCount: 0 })
  assert.equal(e.gates.find(g => g.id === 'valuation')?.status, 'pass'); assert.equal(e.opportunity, 'STRIKE'); assert.equal(e.allocation, 'CHECK CASH')
})
check('STRIKE requires trusted journal context', () => {
  assert.equal(evaluateRadar(radarFixture(), now).label, 'BUY')
  assert.equal(evaluateRadar(radarFixture(), now, { recentStrikeCount: 3 }).label, 'BUY')
  assert.equal(evaluateRadar(radarFixture(), now, { recentStrikeCount: -1 }).label, 'BUY')
})
check('BUY does not automatically become STRIKE', () => {
  const i = radarFixture(); i.thesis.quality = 'adequate'
  assert.equal(evaluateRadar(i, now, { recentStrikeCount: 0 }).label, 'BUY')
  i.thesis.quality = 'strong'; i.policy.minMosStrikePct = 40
  assert.equal(evaluateRadar(i, now, { recentStrikeCount: 0 }).label, 'BUY')
})
for (const bad of [NaN, Infinity, '20', undefined]) check(`parser rejects numeric corruption: ${String(bad)}`, () => {
  const i = radarFixture() as unknown as { execution: { ask: unknown } }; i.execution.ask = bad
  assert.equal(parseRadarInput(i).ok, false)
})
check('malformed shapes and unknown fields fail closed', () => {
  for (const value of [null, [], {}, { ...radarFixture(), bypass: true }, { ...radarFixture(), quote: null }]) assert.equal(parseRadarInput(value).ok, false)
})
check('unsafe URLs and ambiguous timestamps are rejected', () => {
  const i = radarFixture(); i.quote.evidence = [{ sourceUrl: 'javascript:alert(1)', asOf: now }]
  assert.equal(parseRadarInput(i).ok, false)
  i.quote.evidence = [{ sourceUrl: 'https://example.com/source', asOf: '2026-09-14' }]
  assert.equal(parseRadarInput(i).ok, false)
  i.quote.evidence = [{ sourceUrl: 'https://example.com/source', asOf: '2026-02-30T14:00:00Z' }]
  assert.equal(parseRadarInput(i).ok, false)
})
check('evaluation also validates direct callers', () => {
  const e = evaluateRadar({} as RadarInput, now)
  assert.equal(e.label, 'NO ACTION'); assert.equal(e.gates[0].id, 'input')
  assert.equal(evaluateRadar(radarFixture(), 'bad-time').label, 'NO ACTION')
})
check('native CAD equity can qualify; XEQT cannot outperform itself', () => {
  const i = radarFixture()
  i.instrument.symbol = 'TEST.TO'; i.instrument.underlying = 'TEST.TO'; i.instrument.kind = 'equity'
  i.instrument.cdr = { ratio: null, fxForwardCadPerUsd: null, cadHedged: null, evidence: [] }
  i.valuation.referenceSymbol = 'TEST.TO'; i.valuation.currency = 'CAD'
  i.quote.symbol = 'TEST.TO'; i.zones.symbol = 'TEST.TO'; i.execution.symbol = 'TEST.TO'
  assert.equal(evaluateRadar(i, now, { recentStrikeCount: 0 }).label, 'STRIKE')
  i.instrument.symbol = 'XEQT.TO'; i.instrument.underlying = 'XEQT.TO'; i.instrument.kind = 'etf'
  i.valuation.referenceSymbol = 'XEQT.TO'; i.quote.symbol = 'XEQT.TO'; i.zones.symbol = 'XEQT.TO'; i.execution.symbol = 'XEQT.TO'
  const e = evaluateRadar(i, now, { recentStrikeCount: 0 })
  assert.equal(e.label, 'NO ACTION'); assert.equal(e.gates.find(g => g.id === 'benchmark')?.status, 'fail')
})
console.log(`\n${checks} Radar v4 checks passed (fictional inputs only).`)
