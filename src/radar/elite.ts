import { evaluateRadar, parseRadarInput, validSourceUrl, type Evidence, type RadarEvaluation, type RadarInput } from './engine'
import type { StockSnapshot } from '../live/models'

export const ELITE_MODULE_IDS = ['owned-safety', 'exit', 'money-flow', 'underwriting-3m-plus', 'strike-score-v2', 'tournament', 'regime', 'bottleneck', 'value-chain', 'catalyst', 'falsification', 'calibration'] as const
export type EliteModuleId = typeof ELITE_MODULE_IDS[number]
export type EliteAction = 'BUY' | 'BUY MORE' | 'HOLD' | 'TRIM' | 'SELL' | 'WAIT'
export interface EliteModuleReview {
  status: 'pass' | 'fail' | 'unknown'
  definitionVersion: string | null
  note: string
  evidence: Evidence[]
}
export interface EliteReview {
  version: '5.2'
  symbol: string
  researchRevision: string
  evidenceEpisode: string
  reviewedAt: string
  expiresAt: string
  modules: Record<EliteModuleId, EliteModuleReview>
  capital: { deployableCad: number | null; confirmedAt: string | null; source: string; settled: boolean }
  exitAction: 'HOLD' | 'TRIM' | 'SELL' | null
  reason: string
}
export interface EliteEvaluation {
  symbol: string
  action: EliteAction
  amountCad: number | null
  reason: string
  blockers: string[]
  thesis: RadarEvaluation['thesis']
  opportunity: RadarEvaluation['opportunity']
  allocation: RadarEvaluation['allocation']
}

const HOUR = 3_600_000, DAY = 24 * HOUR
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 20_000
const nonempty = (v: unknown): v is string => text(v) && v.trim().length > 0
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(v)
const date = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const parsed = Date.parse(v + 'T00:00:00Z')
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v
}
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && date(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
const fresh = (v: unknown, now: number, age: number): boolean => timestamp(v) && Date.parse(v) <= now && now - Date.parse(v) <= age
const knownDefinition = (v: unknown): v is string => nonempty(v) && !/^(unknown|unavailable|undefined|not[ -]defined|tbd|n\/a)$/i.test(v.trim())
const cadSymbol = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9][A-Z0-9.-]*\.(TO|NE)$/.test(v)
const exchange = (v: unknown): boolean => typeof v === 'string' && ['TSX', 'TSXV', 'CBOE CANADA', 'NEO', 'CSE'].includes(v.toUpperCase())
const centEqual = (a: unknown, b: unknown): boolean => finite(a) && finite(b) && Math.round(a * 100) === Math.round(b * 100)

/** A blank review never supplies a definition, ownership claim, cash amount, or passing module. */
export function emptyEliteReview(input: RadarInput, now: string): EliteReview {
  if (!timestamp(now)) throw new Error('A timezone-qualified review timestamp is required.')
  return {
    version: '5.2', symbol: input.instrument.symbol, researchRevision: input.researchRevision, evidenceEpisode: input.evidenceEpisode,
    reviewedAt: now, expiresAt: new Date(Date.parse(now) + DAY).toISOString(),
    modules: Object.fromEntries(ELITE_MODULE_IDS.map(id => [id, { status: 'unknown', definitionVersion: null, note: '', evidence: [] }])) as unknown as EliteReview['modules'],
    capital: { deployableCad: null, confirmedAt: null, source: '', settled: false }, exitAction: null, reason: '',
  }
}

/** Validate explicit research attestations. Undefined methodology must remain unknown. */
export function parseEliteReview(value: unknown): { ok: true; review: EliteReview } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const shape = (v: unknown, keys: readonly string[], path: string): v is Record<string, unknown> => {
    if (!record(v)) { errors.push(`${path}: expected an object`); return false }
    if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(v, k))) errors.push(`${path}: unexpected or missing fields`)
    return true
  }
  if (!shape(value, ['version', 'symbol', 'researchRevision', 'evidenceEpisode', 'reviewedAt', 'expiresAt', 'modules', 'capital', 'exitAction', 'reason'], 'review')) return { ok: false, errors }
  if (value.version !== '5.2') errors.push('version: expected 5.2')
  if (!cadSymbol(value.symbol)) errors.push('symbol: expected an exact Canadian instrument')
  for (const key of ['researchRevision', 'evidenceEpisode']) if (!identifier(value[key])) errors.push(`${key}: expected a stable identifier`)
  if (!timestamp(value.reviewedAt) || !timestamp(value.expiresAt)) errors.push('Review times require ISO timestamps with timezone')
  else if (Date.parse(value.expiresAt) <= Date.parse(value.reviewedAt) || Date.parse(value.expiresAt) - Date.parse(value.reviewedAt) > DAY) errors.push('Review expiry must be after review and within 24 hours')
  if (!text(value.reason)) errors.push('reason: expected text')
  if (value.exitAction !== null && (typeof value.exitAction !== 'string' || !['HOLD', 'TRIM', 'SELL'].includes(value.exitAction))) errors.push('exitAction: invalid action')
  if (shape(value.capital, ['deployableCad', 'confirmedAt', 'source', 'settled'], 'capital')) {
    const c = value.capital
    if (c.deployableCad !== null && (!finite(c.deployableCad) || c.deployableCad < 0)) errors.push('capital.deployableCad: expected a nonnegative amount or null')
    if (c.confirmedAt !== null && !timestamp(c.confirmedAt)) errors.push('capital.confirmedAt: expected a timezone-qualified timestamp or null')
    if (!text(c.source) || typeof c.settled !== 'boolean') errors.push('capital: invalid source or settlement flag')
  }
  if (shape(value.modules, ELITE_MODULE_IDS, 'modules')) for (const id of ELITE_MODULE_IDS) {
    const m = value.modules[id]
    if (!shape(m, ['status', 'definitionVersion', 'note', 'evidence'], `modules.${id}`)) continue
    if (typeof m.status !== 'string' || !['pass', 'fail', 'unknown'].includes(m.status)) errors.push(`${id}: invalid status`)
    if (m.definitionVersion !== null && !text(m.definitionVersion)) errors.push(`${id}: invalid definition version`)
    if (m.status !== 'unknown' && !knownDefinition(m.definitionVersion)) errors.push(`${id}: an undefined methodology must remain unknown`)
    if (!text(m.note) || (m.status !== 'unknown' && !nonempty(m.note))) errors.push(`${id}: reviewed modules need a reason`)
    if (!Array.isArray(m.evidence) || m.evidence.length > 200) { errors.push(`${id}: expected at most 200 evidence sources`); continue }
    if (m.status !== 'unknown' && !m.evidence.length) errors.push(`${id}: reviewed modules need source evidence`)
    for (const source of m.evidence) {
      if (!shape(source, ['sourceUrl', 'asOf'], `${id}.evidence`)) continue
      if (typeof source.sourceUrl !== 'string' || !validSourceUrl(source.sourceUrl) || !timestamp(source.asOf)) errors.push(`${id}: use HTTPS evidence with a timezone-qualified timestamp`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, review: value as unknown as EliteReview }
}

/** Fresh data and review gates supplement the preserved v4 engine; this function never places an order. */
export function evaluateElite(input: RadarInput, v4: RadarEvaluation, review: EliteReview | null, stock: StockSnapshot | null, now: string): EliteEvaluation {
  const parsedInput = parseRadarInput(input), clock = Date.parse(now)
  const current = evaluateRadar(input, now)
  const result: EliteEvaluation = { symbol: current.symbol, action: 'WAIT', amountCad: null, reason: 'Review required.', blockers: [], thesis: current.thesis, opportunity: current.opportunity, allocation: current.allocation }
  const stop = (...blockers: string[]) => ({ ...result, reason: blockers[0] ?? 'Review required.', blockers: [...new Set(blockers)] })
  if (!parsedInput.ok || !timestamp(now)) return stop('Invalid dossier or evaluation time.')
  if (!v4 || v4.symbol !== input.instrument.symbol || v4.researchRevision !== input.researchRevision || v4.evidenceEpisode !== input.evidenceEpisode || !fresh(v4.evaluatedAt, clock, HOUR)) return stop('The core evaluation does not match this current dossier.')
  if (review === null) return stop('ELITE review is missing.')
  const parsed = parseEliteReview(review)
  if (!parsed.ok) return stop('ELITE review is malformed.', ...parsed.errors)
  if (review.symbol !== input.instrument.symbol || review.researchRevision !== input.researchRevision || review.evidenceEpisode !== input.evidenceEpisode) return stop('ELITE review belongs to a different instrument or research revision.')
  if (!fresh(review.reviewedAt, clock, DAY) || Date.parse(review.expiresAt) <= clock) return stop('ELITE review has expired or is future-dated.')
  if (!stock || !fresh(stock.fetchedAt, clock, HOUR) || !Array.isArray(stock.holdings) || stock.holdings.some(h => !nonempty(h.symbol) || !nonempty(h.role) || !finite(h.shares) || h.shares < 0)) return stop('Refresh the source portfolio to verify ownership.')
  if (!Array.isArray(stock.issues) || stock.issues.some(issue => /sale exceeds shares|negative position|ownership.*(unknown|unverified)|incomplete.*(trade|transaction|holding).*history/i.test(issue))) return stop('Resolve the portfolio ownership history first.')
  // A watchlist or cash record is never ownership, even if supplied with positive units.
  const held = stock.holdings.filter(h => h.symbol === input.instrument.symbol && h.role !== 'cash' && h.role !== 'watchlist' && h.shares > 0)
  const owned = held.length > 0
  const moduleBlockers = (ids: readonly EliteModuleId[]) => ids.flatMap(id => {
    const m = review.modules[id]
    if (m.status !== 'pass') return [`${id}: ${m.status}.`]
    if (!knownDefinition(m.definitionVersion) || !m.evidence.length || m.evidence.some(e => !fresh(e.asOf, clock, 7 * DAY))) return [`${id}: source evidence is stale, missing, or future-dated.`]
    return []
  })
  const safetyBlockers = moduleBlockers(['owned-safety', 'exit'])
  // Exits use actual owned size for liquidity; BUY cash and valuation gates do not govern risk reduction.
  const exitInput = structuredClone(input)
  exitInput.portfolio.proposedAmountCad = owned && positive(input.execution.bid) ? held.reduce((n, h) => n + h.shares, 0) * input.execution.bid : null
  const exitCore = evaluateRadar(exitInput, now)
  const exitIds = ['identity', 'mapping', 'quote', 'execution']
  const exitBlockers = exitCore.gates.filter(g => exitIds.includes(g.id) && g.status !== 'pass').map(g => `Exit ${g.id}: ${g.reason}`)
  // Enforce v4 execution-policy bounds without requiring unrelated BUY-policy fields.
  const p = input.policy
  if (!positive(p.maxQuoteAgeMinutes) || p.maxQuoteAgeMinutes > 60 || !positive(p.maxQuoteSkewSeconds) || p.maxQuoteSkewSeconds > 300 ||
    !positive(p.maxMappingAgeDays) || p.maxMappingAgeDays > 7 || !positive(p.maxResearchAgeDays) || p.maxResearchAgeDays > 366 ||
    !positive(p.maxSpreadBps) || p.maxSpreadBps > 500 || !positive(p.maxDislocationPct) || p.maxDislocationPct > 100 || !positive(p.maxParticipationPct) || p.maxParticipationPct > 100) exitBlockers.push('Exit execution policy is incomplete or outside the reviewed limits.')
  if (review.exitAction === 'TRIM' || review.exitAction === 'SELL') {
    const blockers = [...(!owned ? ['No verified owned position to reduce.'] : []), ...safetyBlockers, ...exitBlockers, ...(!nonempty(review.reason) ? ['An exit needs a reviewed cause, not a price move alone.'] : [])]
    return blockers.length ? stop(...blockers) : { ...result, action: review.exitAction, reason: review.reason, blockers: [] }
  }
  if (review.exitAction === 'HOLD') {
    const blockers = [...(!owned ? ['No verified owned position to hold.'] : []), ...safetyBlockers, ...exitBlockers, ...(current.thesis !== 'INTACT' ? ['HOLD requires a reviewed intact thesis.'] : []), ...(!nonempty(review.reason) ? ['Add a concise reason for HOLD.'] : [])]
    return blockers.length ? stop(...blockers) : { ...result, action: 'HOLD', reason: review.reason, blockers: [] }
  }
  const blockers = moduleBlockers(ELITE_MODULE_IDS)
  const marks = stock.holdings.filter(h => h.role !== 'cash' && h.role !== 'watchlist' && h.shares > 0)
  const markAge = input.policy.maxPortfolioAgeMinutes
  if (!positive(markAge) || markAge > 1440 || marks.some(h => h.priceSource !== 'quote' || !positive(h.valueCad) || !fresh(h.asOf, clock, markAge * 60_000))) blockers.push('Portfolio marks need current verified quotes; a fresh fetch does not renew old or estimated values.')
  if (stock.issues.some(issue => /stale|undated|estimated|currency conversion|USD\/CAD|\bFX\b|valuation|portfolio total withheld/i.test(issue))) blockers.push('Resolve portfolio valuation and currency-conversion issues before sizing a buy.')
  if (!['BUY', 'STRIKE'].includes(current.label) || !['BUY', 'STRIKE'].includes(v4.label)) blockers.push('The current core evidence and sizing gates do not support a buy.')
  if (!positive(stock.portfolioCad) || !centEqual(input.portfolio.totalValueCad, stock.portfolioCad)) blockers.push('Dossier portfolio value does not reconcile to the source portfolio.')
  if (!fresh(stock.cashAsOf, clock, DAY)) blockers.push('Source cash is stale or undated; a fresh fetch does not confirm settlement.')
  if (!finite(stock.cashCad) || stock.cashCad < 0 || !centEqual(input.portfolio.settledCashCad, stock.cashCad)) blockers.push('Dossier settled cash does not reconcile to the source portfolio.')
  if (held.some(h => !finite(h.valueCad) || h.valueCad < 0) || (owned && (!finite(input.portfolio.companyExposureCad) || input.portfolio.companyExposureCad < held.reduce((n, h) => n + (h.valueCad ?? 0), 0)))) blockers.push('Company exposure omits or cannot verify existing holdings.')
  const c = review.capital, amount = current.proposedAmountCad, fees = input.execution.estimatedFeesCad
  if (!finite(c.deployableCad) || !fresh(c.confirmedAt, clock, DAY) || !nonempty(c.source) || !c.settled) blockers.push('Confirm current settled deployable capital; planned additions are not available cash.')
  else {
    if (!positive(amount) || !finite(fees) || amount + fees > c.deployableCad) blockers.push('The proposed amount plus fees exceeds confirmed deployable capital.')
    const f = input.portfolio
    if (!finite(stock.cashCad) || !finite(f.reservedOrdersCad) || !finite(f.cashBufferCad) || c.deployableCad > stock.cashCad - f.reservedOrdersCad - f.cashBufferCad) blockers.push('Confirmed capital exceeds source cash after reserves and pending orders.')
  }
  if (!nonempty(review.reason)) blockers.push('Add a concise reason for the money action.')
  if (!blockers.length) return { ...result, action: owned ? 'BUY MORE' : 'BUY', amountCad: amount, reason: review.reason, blockers: [], allocation: 'READY' }
  return stop(...blockers)
}

export interface OwnedObservation {
  symbol: string
  currency: 'CAD'
  exchange: string
  identityVerified: boolean
  price: number
  observedAt: string
  sourceUrl: string
  currentSession: string
  previousSession: string
  sessionsVerified: boolean
  regularSession: boolean
  previousClose: { price: number; asOf: string; sourceUrl: string; session: string; official: boolean; comparable: boolean }
}
export interface OwnedWarning {
  symbol: string
  severity: 'WARNING' | 'HIGH ALERT' | 'CRITICAL REVIEW'
  direction: 'gain' | 'loss'
  movePct: number
  price: number
  observedAt: string
  sourceUrl: string
  action: 'WAIT'
  cause: 'UNRESOLVED'
  thesis: 'REVIEW REQUIRED'
}
const torontoDate = (v: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v))

/** Exact-instrument price shocks request review, never infer a sale or a watchlist position. */
export function ownedWarning(observation: OwnedObservation, ownedSymbols: readonly string[] | ReadonlySet<string>, now: string): OwnedWarning | null {
  const o = observation, clock = Date.parse(now)
  if (!record(o) || !timestamp(now) || !cadSymbol(o.symbol) || !new Set(ownedSymbols).has(o.symbol) || o.currency !== 'CAD' || !exchange(o.exchange) || o.identityVerified !== true ||
    !positive(o.price) || !fresh(o.observedAt, clock, HOUR) || !validSourceUrl(o.sourceUrl) || o.sessionsVerified !== true || o.regularSession !== true || !date(o.currentSession) || !date(o.previousSession) ||
    o.currentSession !== torontoDate(o.observedAt) || o.currentSession !== torontoDate(now) || o.previousSession >= o.currentSession || !record(o.previousClose)) return null
  const close = o.previousClose
  if (!positive(close.price) || close.official !== true || close.comparable !== true || !timestamp(close.asOf) || Date.parse(close.asOf) >= Date.parse(o.observedAt) || !validSourceUrl(close.sourceUrl) ||
    close.session !== o.previousSession || torontoDate(close.asOf) !== o.previousSession) return null
  // Previous comparable session is an explicit source-backed assertion; calendar-day guesses are not accepted.
  const movePct = (o.price - close.price) / close.price * 100
  const magnitude = Math.abs(movePct)
  if (magnitude < 3) return null
  return { symbol: o.symbol, severity: magnitude >= 8 ? 'CRITICAL REVIEW' : magnitude >= 5 ? 'HIGH ALERT' : 'WARNING', direction: movePct > 0 ? 'gain' : 'loss', movePct,
    price: o.price, observedAt: o.observedAt, sourceUrl: o.sourceUrl, action: 'WAIT', cause: 'UNRESOLVED', thesis: 'REVIEW REQUIRED' }
}
