import { describe, expect, it } from 'vitest'
import { ELITE_MODULE_IDS, emptyEliteReview, evaluateElite, ownedWarning, parseEliteReview, type EliteReview, type OwnedObservation } from '../src/radar/elite'
import { evaluateRadar, type RadarInput } from '../src/radar/engine'
import type { StockSnapshot } from '../src/live/models'
import { radarFixture } from './radar-fixture'

const now = '2026-09-22T15:00:00.000Z'
const prior = (ms: number) => new Date(Date.parse(now) - ms).toISOString()
const HOUR = 3_600_000, DAY = 24 * HOUR
function fixture() {
  const input = radarFixture(now)
  const review = emptyEliteReview(input, now)
  for (const id of ELITE_MODULE_IDS) review.modules[id] = { status: 'pass', definitionVersion: 'fictional-reviewed-v1', note: 'Fictional review only, not live research.', evidence: [{ sourceUrl: 'https://example.com/research', asOf: now }] }
  review.capital = { deployableCad: 1000, confirmedAt: now, source: 'Fictional verified cash', settled: true }
  review.reason = 'Fictional risk-adjusted opportunity beats XEQT and the owned alternatives.'
  const stock: StockSnapshot = { fetchedAt: now, holdings: [{ symbol: 'OTHER.TO', shares: 9500, role: 'core', valueCad: 95000, priceSource: 'quote', asOf: now }, { symbol: 'CAD', shares: 5000, role: 'cash', valueCad: 5000, priceSource: 'cash record', asOf: now }], portfolioCad: 100000, investedCad: 95000, cashCad: 5000, cashAsOf: now, corePct: 95, contributedYtdCad: null, issues: [] }
  return { input, review, stock }
}
function own(stock: StockSnapshot) {
  stock.holdings[0].valueCad = 90000
  stock.holdings.push({ symbol: 'TEST.NE', shares: 250, role: 'satellite', valueCad: 5000, priceSource: 'quote', asOf: now })
}
function evaluate(input: RadarInput, review: EliteReview | null, stock: StockSnapshot | null, at = now) { return evaluateElite(input, evaluateRadar(input, at), review, stock, at) }

describe('ELITE review parsing', () => {
  it('creates unknown methodology and capital with a 24h expiry', () => {
    const blank = emptyEliteReview(radarFixture(now), now)
    expect(parseEliteReview(blank).ok).toBe(true)
    expect(Object.values(blank.modules).every(m => m.status === 'unknown' && m.definitionVersion === null)).toBe(true)
    expect(blank.capital.deployableCad).toBeNull()
    expect(Date.parse(blank.expiresAt) - Date.parse(now)).toBe(DAY)
  })
  it.each([null, [], {}, { version: '5.1' }])('rejects malformed shapes (%s)', raw => expect(parseEliteReview(raw).ok).toBe(false))
  it('rejects unknown fields and malformed nested modules', () => {
    const { review } = fixture()
    expect(parseEliteReview({ ...review, invented: 3 }).ok).toBe(false)
    expect(parseEliteReview({ ...review, modules: { ...review.modules, tournament: null } }).ok).toBe(false)
    expect(parseEliteReview({ ...review, modules: {} }).ok).toBe(false)
    expect(parseEliteReview({ ...review, exitAction: ['HOLD'] }).ok).toBe(false)
    expect(parseEliteReview({ ...review, modules: { ...review.modules, tournament: { ...review.modules.tournament, status: ['pass'] } } }).ok).toBe(false)
  })
  it.each([null, '', 'UNKNOWN', 'TBD'])('undefined methodology cannot be marked pass (%s)', definitionVersion => {
    const { review } = fixture(); review.modules['strike-score-v2'].definitionVersion = definitionVersion
    expect(parseEliteReview(review).ok).toBe(false)
  })
  it('requires HTTPS, timezone-qualified evidence and valid calendar dates', () => {
    const { review } = fixture()
    review.modules.tournament.evidence[0].sourceUrl = 'http://example.com'
    expect(parseEliteReview(review).ok).toBe(false)
    review.modules.tournament.evidence[0].sourceUrl = 'https://example.com'
    review.modules.tournament.evidence[0].asOf = '2026-02-30T10:00:00Z'
    expect(parseEliteReview(review).ok).toBe(false)
    review.modules.tournament.evidence[0].asOf = '2026-09-22T10:00:00'
    expect(parseEliteReview(review).ok).toBe(false)
  })
  it('rejects an expiry longer than 24h and invalid capital values', () => {
    const { review } = fixture()
    expect(parseEliteReview({ ...review, expiresAt: new Date(Date.parse(now) + DAY + 1).toISOString() }).ok).toBe(false)
    for (const deployableCad of [NaN, Infinity, -1, '1000']) expect(parseEliteReview({ ...review, capital: { ...review.capital, deployableCad } }).ok).toBe(false)
  })
})

describe('ELITE action gates', () => {
  it('buys only a fully reviewed new candidate and translates actual ownership to BUY MORE', () => {
    const { input, review, stock } = fixture()
    expect(evaluate(input, review, stock)).toMatchObject({ action: 'BUY', amountCad: 500, blockers: [], thesis: 'INTACT', opportunity: 'STRIKE', allocation: 'READY' })
    own(stock)
    expect(evaluate(input, review, stock).action).toBe('BUY MORE')
  })
  it.each(ELITE_MODULE_IDS)('requires the %s module', id => {
    const { input, review, stock } = fixture(); review.modules[id].status = 'unknown'
    expect(evaluate(input, review, stock)).toMatchObject({ action: 'WAIT', amountCad: null })
  })
  it('requires a current matching review without inventing cash', () => {
    const { input, review, stock } = fixture()
    expect(evaluate(input, null, stock).action).toBe('WAIT')
    review.capital.deployableCad = null
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    review.capital.deployableCad = 1000; review.researchRevision = 'other-revision'
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it('rejects expired, future and stale evidence even when the review is new', () => {
    const { input, review, stock } = fixture()
    review.reviewedAt = prior(DAY); review.expiresAt = now
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    review.reviewedAt = new Date(Date.parse(now) + 1).toISOString(); review.expiresAt = new Date(Date.parse(now) + DAY).toISOString()
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    review.reviewedAt = now
    review.modules.tournament.evidence[0].asOf = prior(7 * DAY + 1)
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    review.modules.tournament.evidence[0].asOf = new Date(Date.parse(now) + 1).toISOString()
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it('does not trust an earlier positive core verdict after the quote expires', () => {
    const { input, review, stock } = fixture(), old = evaluateRadar(input, now)
    const later = new Date(Date.parse(now) + 16 * 60_000).toISOString()
    expect(evaluateElite(input, old, review, stock, later).action).toBe('WAIT')
  })
  it.each(['unknown', 'unsettled', 'stale', 'future', 'missing-source', 'fees', 'guessed-top-up'] as const)('blocks %s capital', condition => {
    const { input, review, stock } = fixture()
    if (condition === 'unknown') review.capital.deployableCad = null
    if (condition === 'unsettled') review.capital.settled = false
    if (condition === 'stale') review.capital.confirmedAt = prior(DAY + 1)
    if (condition === 'future') review.capital.confirmedAt = new Date(Date.parse(now) + 1).toISOString()
    if (condition === 'missing-source') review.capital.source = ''
    if (condition === 'fees') review.capital.deployableCad = 500
    if (condition === 'guessed-top-up') review.capital.deployableCad = 6000
    expect(evaluate(input, review, stock)).toMatchObject({ action: 'WAIT', amountCad: null })
  })
  it('fresh source reads do not renew an old or undated cash record', () => {
    const { input, review, stock } = fixture()
    for (const cashAsOf of [null, '2026-09-22', prior(DAY + 1), new Date(Date.parse(now) + 1).toISOString()]) {
      stock.cashAsOf = cashAsOf
      expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/Source cash/)
    }
  })
  it('fresh reads do not renew stale, undated, future, or estimated portfolio marks', () => {
    const { input, review, stock } = fixture()
    for (const asOf of [null, '2026-09-22', prior(31 * 60_000), new Date(Date.parse(now) + 1).toISOString()]) {
      stock.holdings[0].asOf = asOf
      expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/Portfolio marks/)
    }
    stock.holdings[0].asOf = now
    for (const priceSource of ['manual', 'issuer derived', 'estimated', 'unavailable'] as const) {
      stock.holdings[0].priceSource = priceSource
      expect(evaluate(input, review, stock).action).toBe('WAIT')
    }
  })
  it('unresolved FX valuation blocks buys but does not block an independently verified exit', () => {
    const { input, review, stock } = fixture(); own(stock)
    stock.issues = ['OTHER: USD/CAD rate needs verification.']
    expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/currency-conversion/)
    stock.holdings[0].asOf = prior(DAY)
    review.exitAction = 'SELL'
    expect(evaluate(input, review, stock).action).toBe('SELL')
  })
  it('rejects mismatched NAV, cash, and an oversized proposal', () => {
    const { input, review, stock } = fixture()
    stock.portfolioCad = 200000
    expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/portfolio value/)
    stock.portfolioCad = 100000; stock.cashCad = 4000
    expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/settled cash/)
    stock.cashCad = 5000; input.portfolio.proposedAmountCad = 50000
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it('does not treat positive watchlist units, cash units, or closed mementos as owned', () => {
    const { input, review, stock } = fixture(); own(stock)
    stock.holdings[2].role = 'watchlist'
    expect(evaluate(input, review, stock).action).toBe('BUY')
    stock.holdings[2].role = 'cash'
    expect(evaluate(input, review, stock).action).toBe('BUY')
    stock.holdings[2].role = 'memento'; stock.holdings[2].shares = 0
    expect(evaluate(input, review, stock).action).toBe('BUY')
  })
  it('requires fresh portfolio provenance and includes existing exposure', () => {
    const { input, review, stock } = fixture(); own(stock)
    expect(evaluate(input, review, null).action).toBe('WAIT')
    stock.fetchedAt = prior(HOUR + 1)
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    stock.fetchedAt = new Date(Date.parse(now) + 1).toISOString()
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    stock.fetchedAt = now; input.portfolio.companyExposureCad = 0
    expect(evaluate(input, review, stock).blockers.join(' ')).toMatch(/exposure/)
    input.portfolio.companyExposureCad = 5000; stock.issues = ['TEST.NE: sale exceeds shares in the imported history.']
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it.each(['SELL', 'TRIM'] as const)('permits a reviewed %s despite failed BUY cash, valuation, or tournament gates', exitAction => {
    const { input, review, stock } = fixture(); own(stock)
    review.exitAction = exitAction
    review.modules.tournament.status = 'unknown'; review.capital.deployableCad = null
    input.thesis.status = 'broken'; input.portfolio.proposedAmountCad = null; input.portfolio.settledCashCad = null; input.valuation.baseFairValue = null
    const result = evaluate(input, review, stock)
    expect(result).toMatchObject({ action: exitAction, amountCad: null, blockers: [], thesis: 'BROKEN' })
  })
  it('will not sell a watchlist, an unreviewed price shock, or unknown exit evidence', () => {
    const { input, review, stock } = fixture()
    review.exitAction = 'SELL'
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    own(stock); review.modules.exit.status = 'unknown'
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    review.modules.exit.status = 'pass'; review.reason = ''
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it('retains exact-instrument, current quote and liquidity checks for exits', () => {
    const { input, review, stock } = fixture(); own(stock); review.exitAction = 'SELL'
    input.instrument.identityVerified = false
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    input.instrument.identityVerified = true; input.quote.evidence[0].asOf = prior(HOUR)
    expect(evaluate(input, review, stock).action).toBe('WAIT')
    input.quote.evidence[0].asOf = now; input.execution.averageDailyUnits = 1
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
  it('honors explicit HOLD even when all BUY MORE gates pass', () => {
    const { input, review, stock } = fixture(); own(stock); review.exitAction = 'HOLD'
    expect(evaluate(input, review, stock)).toMatchObject({ action: 'HOLD', amountCad: null })
  })
  it('allows a reviewed HOLD while new buying remains blocked', () => {
    const { input, review, stock } = fixture(); own(stock); review.exitAction = 'HOLD'; review.capital.deployableCad = null
    expect(evaluate(input, review, stock)).toMatchObject({ action: 'HOLD', amountCad: null })
    review.modules['owned-safety'].status = 'unknown'
    expect(evaluate(input, review, stock).action).toBe('WAIT')
  })
})

const observation = (): OwnedObservation => ({ symbol: 'TEST.NE', currency: 'CAD', exchange: 'CBOE CANADA', identityVerified: true, price: 95, observedAt: now, sourceUrl: 'https://example.com/current', currentSession: '2026-09-22', previousSession: '2026-09-21', sessionsVerified: true, regularSession: true, previousClose: { price: 100, asOf: '2026-09-21T20:00:00Z', sourceUrl: 'https://example.com/official-close', session: '2026-09-21', official: true, comparable: true } })
describe('owned-position warnings', () => {
  it.each([[3, 'WARNING'], [5, 'HIGH ALERT'], [8, 'CRITICAL REVIEW']] as const)('uses the same %s%% threshold for gains and losses', (move, severity) => {
    for (const sign of [1, -1]) {
      const o = observation(); o.price = 100 + sign * move
      expect(ownedWarning(o, new Set(['TEST.NE']), now)).toMatchObject({ severity, action: 'WAIT', cause: 'UNRESOLVED', thesis: 'REVIEW REQUIRED', direction: sign > 0 ? 'gain' : 'loss' })
    }
  })
  it('stays quiet below threshold and never infers ownership from an underlying or watchlist', () => {
    const o = observation(); o.price = 97.01
    expect(ownedWarning(o, ['TEST.NE'], now)).toBeNull()
    o.price = 80
    expect(ownedWarning(o, [], now)).toBeNull()
    expect(ownedWarning(o, ['TEST'], now)).toBeNull()
  })
  it.each(['identity', 'currency', 'future', 'stale', 'source', 'sessions', 'regular-session', 'comparable', 'official', 'close-date', 'session-date'] as const)('rejects unverified %s context', condition => {
    const o = observation()
    if (condition === 'identity') o.identityVerified = false
    if (condition === 'currency') o.currency = 'USD' as 'CAD'
    if (condition === 'future') o.observedAt = new Date(Date.parse(now) + 1).toISOString()
    if (condition === 'stale') o.observedAt = prior(HOUR + 1)
    if (condition === 'source') o.previousClose.sourceUrl = 'http://example.com'
    if (condition === 'sessions') o.sessionsVerified = false
    if (condition === 'regular-session') o.regularSession = false
    if (condition === 'comparable') o.previousClose.comparable = false
    if (condition === 'official') o.previousClose.official = false
    if (condition === 'close-date') o.previousClose.asOf = '2026-09-20T20:00:00Z'
    if (condition === 'session-date') o.currentSession = '2026-09-21'
    expect(ownedWarning(o, ['TEST.NE'], now)).toBeNull()
  })
})
