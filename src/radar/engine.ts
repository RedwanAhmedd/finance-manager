/** Strike Radar v4. Pure, deterministic evidence gates; never a trading client.
 * Inputs are reviewed research assertions, not independently verified facts.
 * USD fundamentals, CAD action prices and allocation readiness stay separate.
 */
export interface Evidence { sourceUrl: string; asOf: string }
export interface RadarInput {
  schemaVersion: 4
  researchRevision: string
  evidenceEpisode: string
  instrument: {
    symbol: string; underlying: string; kind: 'cdr' | 'equity' | 'etf' | null
    exchange: string | null; currency: 'CAD' | 'USD' | null
    identityVerified: boolean | null; evidence: Evidence[]
    cdr: { ratio: number | null; fxForwardCadPerUsd: number | null; cadHedged: boolean | null; evidence: Evidence[] }
  }
  thesis: {
    status: 'intact' | 'uncertain' | 'broken' | null
    quality: 'strong' | 'adequate' | 'weak' | null
    whyNow: string; killConditions: string[]; evidence: Evidence[]
  }
  valuation: {
    modelVersion: string; referenceSymbol: string; currency: 'USD' | 'CAD' | null
    normalized: boolean | null; ownerCashReconciled: boolean | null
    normalizationNote: string
    bearFairValue: number | null; baseFairValue: number | null; bullFairValue: number | null
    evidence: Evidence[]
  }
  zones: {
    symbol: string; currency: 'CAD' | 'USD' | null
    watchBelow: number | null; buyBelow: number | null; strikeBelow: number | null; fairValueCad: number | null
    mappingReviewed: boolean | null; mappingMethod: string; evidence: Evidence[]
  }
  quote: {
    symbol: string; currency: 'CAD' | 'USD' | null; price: number | null
    basis: 'fetched' | 'measured' | 'derived' | 'estimated' | null
    marketOpen: boolean | null; evidence: Evidence[]
  }
  underlyingQuote: { symbol: string; currency: 'USD' | 'CAD' | null; price: number | null; evidence: Evidence[] }
  benchmark: {
    symbol: string; currency: 'CAD' | 'USD' | null; horizonYears: number | null
    totalReturnBasis: boolean | null
    candidateBearPct: number | null; candidateBasePct: number | null; candidateBullPct: number | null
    xeqtAnnualReturnPct: number | null; waitingAnnualReturnPct: number | null
    concentrationPremiumPct: number | null; modelRiskPremiumPct: number | null; executionDragPct: number | null
    whyBetterThanXeqt: string; whyBetterThanWaiting: string; evidence: Evidence[]
  }
  redTeam: {
    strongestBearCase: string; marketCounterargument: string; upsideDriver: string
    growthShockPct: number | null; marginShockPp: number | null; multipleShockPct: number | null
    jointStressAnnualReturnPct: number | null
    valueTrapRisk: 'addressed' | 'unresolved' | null
    falsifier: string; survived: boolean | null; evidence: Evidence[]
  }
  execution: {
    symbol: string; currency: 'CAD' | 'USD' | null
    bid: number | null; ask: number | null; averageDailyUnits: number | null
    estimatedFeesCad: number | null; evidence: Evidence[]
  }
  portfolio: {
    totalValueCad: number | null; settledCashCad: number | null; reservedOrdersCad: number | null; cashBufferCad: number | null
    proposedAmountCad: number | null; pendingOrdersConfirmed: boolean | null; overlapKnown: boolean | null
    companyExposureCad: number | null; sectorExposureCad: number | null
    pendingCompanyBuysCad: number | null; pendingSectorBuysCad: number | null
    evidence: Evidence[]
  }
  policy: {
    maxResearchAgeDays: number | null; maxQuoteAgeMinutes: number | null; maxQuoteSkewSeconds: number | null
    maxMappingAgeDays: number | null; maxPortfolioAgeMinutes: number | null
    maxSpreadBps: number | null; maxDislocationPct: number | null; maxParticipationPct: number | null
    minMosBuyPct: number | null; minMosStrikePct: number | null
    minExcessBuyPct: number | null; minExcessStrikePct: number | null; minJointStressReturnPct: number | null
    maxCompanyPct: number | null; maxSectorPct: number | null
    strikeWindowDays: number | null; maxStrikesPerWindow: number | null
  }
}

export type GateStatus = 'pass' | 'fail' | 'unknown'
export interface RadarGate { id: string; label: string; status: GateStatus; reason: string }
export interface RadarEvaluation {
  schemaVersion: 4; evaluatedAt: string; researchRevision: string; evidenceEpisode: string
  symbol: string; underlying: string
  label: 'NO ACTION' | 'BUY' | 'STRIKE'
  thesis: 'INTACT' | 'UNCERTAIN' | 'BROKEN' | 'UNKNOWN'
  opportunity: 'UNSCORED' | 'PASS' | 'WATCH' | 'BUY' | 'STRIKE'
  allocation: 'CHECK CASH' | 'BLOCKED' | 'READY'
  proposedAmountCad: number | null
  marginOfSafetyPct: number | null; excessReturnPct: number | null
  spreadBps: number | null; dislocationPct: number | null
  companyPctAfter: number | null; sectorPctAfter: number | null
  gates: RadarGate[]; reasons: string[]
}

/** A blank research worksheet. Metadata copied from a holding is unverified. */
export function emptyRadarInput(symbol = '', underlying = symbol): RadarInput {
  return {
    schemaVersion: 4, researchRevision: 'draft-v1', evidenceEpisode: 'draft-evidence-v1',
    instrument: { symbol, underlying, kind: null, exchange: null, currency: null, identityVerified: null, evidence: [],
      cdr: { ratio: null, fxForwardCadPerUsd: null, cadHedged: null, evidence: [] } },
    thesis: { status: null, quality: null, whyNow: '', killConditions: [], evidence: [] },
    valuation: { modelVersion: '', referenceSymbol: underlying, currency: null, normalized: null, ownerCashReconciled: null,
      normalizationNote: '', bearFairValue: null, baseFairValue: null, bullFairValue: null, evidence: [] },
    zones: { symbol, currency: null, watchBelow: null, buyBelow: null, strikeBelow: null, fairValueCad: null,
      mappingReviewed: null, mappingMethod: '', evidence: [] },
    quote: { symbol, currency: null, price: null, basis: null, marketOpen: null, evidence: [] },
    underlyingQuote: { symbol: underlying, currency: null, price: null, evidence: [] },
    benchmark: { symbol: 'XEQT.TO', currency: null, horizonYears: null, totalReturnBasis: null,
      candidateBearPct: null, candidateBasePct: null, candidateBullPct: null, xeqtAnnualReturnPct: null, waitingAnnualReturnPct: null,
      concentrationPremiumPct: null, modelRiskPremiumPct: null, executionDragPct: null,
      whyBetterThanXeqt: '', whyBetterThanWaiting: '', evidence: [] },
    redTeam: { strongestBearCase: '', marketCounterargument: '', upsideDriver: '', growthShockPct: null, marginShockPp: null,
      multipleShockPct: null, jointStressAnnualReturnPct: null, valueTrapRisk: null, falsifier: '', survived: null, evidence: [] },
    execution: { symbol, currency: null, bid: null, ask: null, averageDailyUnits: null, estimatedFeesCad: null, evidence: [] },
    portfolio: { totalValueCad: null, settledCashCad: null, reservedOrdersCad: null, cashBufferCad: null, proposedAmountCad: null,
      pendingOrdersConfirmed: null, overlapKnown: null, companyExposureCad: null, sectorExposureCad: null,
      pendingCompanyBuysCad: null, pendingSectorBuysCad: null, evidence: [] },
    policy: { maxResearchAgeDays: null, maxQuoteAgeMinutes: null, maxQuoteSkewSeconds: null, maxMappingAgeDays: null, maxPortfolioAgeMinutes: null,
      maxSpreadBps: null, maxDislocationPct: null, maxParticipationPct: null, minMosBuyPct: null, minMosStrikePct: null,
      minExcessBuyPct: null, minExcessStrikePct: null, minJointStressReturnPct: null, maxCompanyPct: null, maxSectorPct: null,
      strikeWindowDays: null, maxStrikesPerWindow: null },
  }
}

const nullableText = new Set(['exchange'])
const nullableBoolean = new Set(['identityVerified', 'cadHedged', 'normalized', 'ownerCashReconciled', 'mappingReviewed',
  'marketOpen', 'totalReturnBasis', 'survived', 'pendingOrdersConfirmed', 'overlapKnown'])
const enums: Record<string, string[]> = {
  kind: ['cdr', 'equity', 'etf'], currency: ['CAD', 'USD'], status: ['intact', 'uncertain', 'broken'],
  quality: ['strong', 'adequate', 'weak'], basis: ['fetched', 'measured', 'derived', 'estimated'], valueTrapRisk: ['addressed', 'unresolved'],
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0
const written = (v: string) => v.trim().length >= 20
const record = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)
const validTime = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) return false
  const [year, month, day] = s.slice(0, 10).split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}
export function validSourceUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password } catch { return false }
}

/** Reject misspellings, malformed JSON, strings-as-numbers, NaN and incomplete shapes.
 * Explicit nulls remain valid missing evidence and are handled by the gates.
 */
export function parseRadarInput(value: unknown): { ok: true; input: RadarInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  function check(v: unknown, shape: unknown, path: string, key = '') {
    if (errors.length >= 40) return
    if (Array.isArray(shape)) {
      if (!Array.isArray(v) || v.length > 200) { errors.push(`${path}: expected an array of at most 200 items`); return }
      if (key === 'evidence') v.forEach((e, i) => {
        check(e, { sourceUrl: '', asOf: '' }, `${path}[${i}]`)
        if (record(e) && (typeof e.sourceUrl !== 'string' || !validSourceUrl(e.sourceUrl))) errors.push(`${path}[${i}]: use an HTTPS source URL`)
        if (record(e) && (typeof e.asOf !== 'string' || !validTime(e.asOf))) errors.push(`${path}[${i}]: asOf must be an ISO timestamp with timezone`)
      })
      else v.forEach((e, i) => { if (typeof e !== 'string' || e.length > 20000) errors.push(`${path}[${i}]: expected text`) })
      return
    }
    if (record(shape)) {
      if (!record(v)) { errors.push(`${path}: expected an object`); return }
      for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(shape, k)) errors.push(`${path}.${k}: unknown field`)
      for (const [k, s] of Object.entries(shape)) check(v[k], s, path ? `${path}.${k}` : k, k)
      return
    }
    if (shape === null) {
      if (v === null) return
      if (enums[key] ? typeof v === 'string' && enums[key].includes(v)
        : nullableBoolean.has(key) ? typeof v === 'boolean'
          : nullableText.has(key) ? typeof v === 'string' && v.length <= 200 : finite(v)) return
      errors.push(`${path}: invalid value; use null for unavailable evidence`)
    } else if (typeof shape === 'string') {
      if (typeof v !== 'string' || v.length > 20000) errors.push(`${path}: expected text`)
    } else if (v !== shape) errors.push(`${path}: expected ${shape}`)
  }
  check(value, emptyRadarInput(), '')
  if (record(value)) for (const k of ['researchRevision', 'evidenceEpisode']) {
    if (typeof value[k] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value[k] as string)) errors.push(`${k}: use a stable identifier, up to 120 characters`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, input: value as RadarInput }
}

function evidenceStatus(e: Evidence[], now: number, maxAgeMs: number | null): GateStatus {
  if (!e.length || maxAgeMs == null) return 'unknown'
  if (e.some(x => !validSourceUrl(x.sourceUrl) || !validTime(x.asOf))) return 'fail'
  return e.every(x => now >= Date.parse(x.asOf) && now - Date.parse(x.asOf) <= maxAgeMs) ? 'pass' : 'fail'
}
function combine(...s: GateStatus[]): GateStatus { return s.includes('fail') ? 'fail' : s.includes('unknown') ? 'unknown' : 'pass' }
function assertion(v: boolean | null): GateStatus { return v == null ? 'unknown' : v ? 'pass' : 'fail' }
function condition(known: boolean, valid: boolean): GateStatus { return !known ? 'unknown' : valid ? 'pass' : 'fail' }

/** Context comes from a verified local journal, never from a dossier's self-report. */
export function evaluateRadar(raw: RadarInput, nowIso: string, context: { recentStrikeCount: number | null } = { recentStrikeCount: null }): RadarEvaluation {
  const parsed = parseRadarInput(raw)
  const now = Date.parse(nowIso)
  const blank: RadarEvaluation = {
    schemaVersion: 4, evaluatedAt: nowIso, researchRevision: '', evidenceEpisode: '', symbol: '', underlying: '',
    label: 'NO ACTION', thesis: 'UNKNOWN', opportunity: 'UNSCORED', allocation: 'BLOCKED', proposedAmountCad: null,
    marginOfSafetyPct: null, excessReturnPct: null, spreadBps: null, dislocationPct: null,
    companyPctAfter: null, sectorPctAfter: null, gates: [], reasons: [],
  }
  if (!parsed.ok || !validTime(nowIso)) {
    const reason = !parsed.ok ? parsed.errors.join('; ') : 'Evaluation requires a valid ISO timestamp with timezone.'
    return { ...blank, gates: [{ id: 'input', label: 'Input validation', status: 'fail', reason }], reasons: [reason] }
  }
  const i = parsed.input, p = i.policy, inst = i.instrument, v = i.valuation, z = i.zones, q = i.quote
  const b = i.benchmark, r = i.redTeam, x = i.execution, f = i.portfolio
  const gates: RadarGate[] = []
  const add = (id: string, label: string, status: GateStatus, reason: string) => gates.push({ id, label, status, reason })
  const researchAge = positive(p.maxResearchAgeDays) ? p.maxResearchAgeDays * 86400000 : null
  const quoteAge = positive(p.maxQuoteAgeMinutes) ? p.maxQuoteAgeMinutes * 60000 : null
  const mappingAge = positive(p.maxMappingAgeDays) ? p.maxMappingAgeDays * 86400000 : null
  const portfolioAge = positive(p.maxPortfolioAgeMinutes) ? p.maxPortfolioAgeMinutes * 60000 : null
  const ev = (e: Evidence[], age = researchAge) => evidenceStatus(e, now, age)
  const policyKnown = Object.values(p).every(finite)
  const pct = (n: number | null) => positive(n) && n <= 100
  const policyValid = policyKnown && Object.entries(p).every(([k, n]) => k === 'minJointStressReturnPct' ? finite(n) && n > -100 && n <= 0 : positive(n)) &&
    p.maxResearchAgeDays! <= 366 && p.maxQuoteAgeMinutes! <= 60 && p.maxQuoteSkewSeconds! <= 300 && p.maxMappingAgeDays! <= 7 && p.maxPortfolioAgeMinutes! <= 1440 &&
    p.maxSpreadBps! <= 500 && pct(p.maxDislocationPct) && pct(p.maxParticipationPct) &&
    pct(p.minMosBuyPct) && pct(p.minMosStrikePct) && p.minMosBuyPct! < p.minMosStrikePct! &&
    p.minExcessBuyPct! < p.minExcessStrikePct! && pct(p.minExcessStrikePct) &&
    pct(p.maxCompanyPct) && pct(p.maxSectorPct) && p.maxCompanyPct! <= p.maxSectorPct! &&
    Number.isInteger(p.maxStrikesPerWindow) && Number.isInteger(p.strikeWindowDays) && p.strikeWindowDays! <= 366
  add('policy', 'Explicit risk policy', condition(policyKnown, policyValid), 'Set reviewed thresholds; STRIKE must require more margin of safety and excess return than BUY. Freshness limits cannot exceed 366 research days, 60 quote minutes, 5 minutes between quote observations, 7 mapping days or 24 portfolio hours.')

  const cadSymbol = /\.(TO|NE)$/.test(inst.symbol)
  const nativeCad = inst.kind !== 'cdr' && inst.symbol === inst.underlying
  const identity = combine(assertion(inst.identityVerified), ev(inst.evidence), condition(!!inst.kind && !!inst.exchange && !!inst.currency && !!inst.symbol && !!inst.underlying,
    cadSymbol && inst.currency === 'CAD' && ['TSX', 'TSXV', 'CBOE CANADA', 'NEO', 'CSE'].includes(inst.exchange!.toUpperCase()) &&
    (inst.kind === 'cdr' ? !inst.underlying.includes('.') && inst.symbol !== inst.underlying : nativeCad)))
  add('identity', 'Exact decision instrument', identity, 'Verify the Canadian listing, exchange and CAD currency. A CDR uses a suffixed symbol and a separate US underlying; copied portfolio metadata is not issuer verification.')

  const thesis = combine(ev(i.thesis.evidence), condition(i.thesis.status != null && i.thesis.quality != null,
    i.thesis.status === 'intact' && i.thesis.quality !== 'weak'), condition(written(i.thesis.whyNow) && i.thesis.killConditions.some(written), true))
  add('thesis', 'Business quality and thesis', thesis, 'Require an intact thesis, reviewed quality, why now and a falsifiable kill condition with current supporting evidence.')

  const valuation = combine(ev(v.evidence), assertion(v.normalized), assertion(v.ownerCashReconciled),
    condition(!!v.modelVersion && written(v.normalizationNote) && v.currency != null && v.referenceSymbol !== '' && [v.bearFairValue, v.baseFairValue, v.bullFairValue].every(n => n != null),
      v.referenceSymbol === inst.underlying && v.currency === (inst.kind === 'cdr' ? 'USD' : 'CAD') &&
      [v.bearFairValue, v.baseFairValue, v.bullFairValue].every(positive) && v.bearFairValue! <= v.baseFairValue! && v.baseFairValue! <= v.bullFairValue!))
  add('valuation', 'Normalized fundamental valuation', valuation, 'Use a versioned bear/base/bull valuation of the underlying, reconciling owner cash and reporting-period distortions. A sensitivity alone is incomplete.')

  const mapping = inst.kind === 'cdr' ? combine(ev(inst.cdr.evidence, mappingAge), assertion(inst.cdr.cadHedged),
    condition(inst.cdr.ratio != null && inst.cdr.fxForwardCadPerUsd != null, positive(inst.cdr.ratio) && positive(inst.cdr.fxForwardCadPerUsd))) : condition(!!inst.kind, nativeCad)
  add('mapping', 'CDR mapping and hedge', mapping, inst.kind === 'cdr' ? 'Require fresh issuer ratio, CAD-per-USD forward rate and verified hedge status. These price the current receipt, not future action zones.' : 'A native CAD security needs no CDR conversion; its fundamental and decision identity must match.')

  const zones = combine(ev(z.evidence), assertion(z.mappingReviewed), condition(written(z.mappingMethod) && [z.watchBelow, z.buyBelow, z.strikeBelow, z.fairValueCad].every(n => n != null),
    z.symbol === inst.symbol && z.currency === 'CAD' && [z.watchBelow, z.buyBelow, z.strikeBelow, z.fairValueCad].every(positive) &&
    z.strikeBelow! < z.buyBelow! && z.buyBelow! <= z.watchBelow! && z.buyBelow! < z.fairValueCad!))
  add('zones', 'CAD action zones', zones, 'Commit ordered CAD zones for the exact listing and document the valuation-to-instrument mapping, including hedge and tracking limits. Never copy USD targets into CAD units.')

  const quote = combine(ev(q.evidence, quoteAge), assertion(q.marketOpen), condition(q.price != null && q.basis != null,
    q.symbol === inst.symbol && q.currency === 'CAD' && positive(q.price) && (q.basis === 'fetched' || q.basis === 'measured')))
  add('quote', 'Fresh executable-market quote', quote, 'Require a current observed CAD quote for the exact instrument during an open market. Estimated or derived portfolio marks cannot authorize action.')

  const mid = positive(x.bid) && positive(x.ask) ? (x.bid + x.ask) / 2 : null
  const spreadBps = mid ? (x.ask! - x.bid!) / mid * 10000 : null
  const underlying = i.underlyingQuote
  const indicative = inst.kind === 'cdr' && positive(underlying.price) && positive(inst.cdr.ratio) && positive(inst.cdr.fxForwardCadPerUsd)
    ? underlying.price * inst.cdr.ratio * inst.cdr.fxForwardCadPerUsd : null
  const dislocationPct = inst.kind === 'cdr' ? indicative && mid ? Math.abs(mid / indicative - 1) * 100 : null : mid && positive(q.price) ? Math.abs(mid / q.price - 1) * 100 : null
  const underlyingGate = inst.kind === 'cdr' ? combine(ev(underlying.evidence, quoteAge), condition(underlying.price != null,
    underlying.symbol === inst.underlying && underlying.currency === 'USD' && positive(underlying.price))) : 'pass'
  const quoteTimes = [...q.evidence, ...x.evidence, ...(inst.kind === 'cdr' ? underlying.evidence : [])].map(e => Date.parse(e.asOf))
  const synchronized = condition(quoteTimes.length > 0 && p.maxQuoteSkewSeconds != null,
    Math.max(...quoteTimes) - Math.min(...quoteTimes) <= p.maxQuoteSkewSeconds! * 1000)
  const execution = combine(ev(x.evidence, quoteAge), underlyingGate, synchronized, condition([x.bid, x.ask, x.averageDailyUnits, x.estimatedFeesCad, f.proposedAmountCad, p.maxSpreadBps, p.maxDislocationPct, p.maxParticipationPct].every(n => n != null),
    x.symbol === inst.symbol && x.currency === 'CAD' && positive(x.bid) && positive(x.ask) && x.bid <= x.ask && positive(x.averageDailyUnits) &&
    nonnegative(x.estimatedFeesCad) && positive(f.proposedAmountCad) && spreadBps != null && spreadBps <= p.maxSpreadBps! &&
    dislocationPct != null && dislocationPct <= p.maxDislocationPct! && f.proposedAmountCad / (x.averageDailyUnits * mid!) * 100 <= p.maxParticipationPct!))
  add('execution', 'Spread, liquidity and dislocation', execution, 'Check observed bid/ask, average traded units, proposed participation, fees and dislocation against a synchronized underlying/issuer mark. Poor or unknown execution blocks action.')

  const mos = positive(z.fairValueCad) && positive(x.ask) ? (1 - x.ask / z.fairValueCad) * 100 : null
  const margin = condition(mos != null && p.minMosBuyPct != null, mos! >= p.minMosBuyPct!)
  add('margin', 'Margin of safety at the ask', margin, 'Calculate the discount to reviewed CAD fair value using the ask you would pay, not the last print or a US share price.')

  const excess = [b.candidateBasePct, b.executionDragPct, b.xeqtAnnualReturnPct, b.waitingAnnualReturnPct, b.concentrationPremiumPct, b.modelRiskPremiumPct].every(finite)
    ? b.candidateBasePct! - b.executionDragPct! - Math.max(b.xeqtAnnualReturnPct!, b.waitingAnnualReturnPct!) - b.concentrationPremiumPct! - b.modelRiskPremiumPct! : null
  const returns = [b.candidateBearPct, b.candidateBasePct, b.candidateBullPct, b.xeqtAnnualReturnPct, b.waitingAnnualReturnPct]
  const benchmark = combine(ev(b.evidence), assertion(b.totalReturnBasis), condition(returns.every(n => n != null) && positive(b.horizonYears) && written(b.whyBetterThanXeqt) && written(b.whyBetterThanWaiting) && excess != null && p.minExcessBuyPct != null,
    b.symbol === 'XEQT.TO' && inst.symbol !== b.symbol && b.currency === 'CAD' && b.horizonYears! <= 30 && returns.every(n => finite(n) && n > -100 && n <= 1000) &&
    b.candidateBearPct! <= b.candidateBasePct! && b.candidateBasePct! <= b.candidateBullPct! &&
    [b.concentrationPremiumPct, b.modelRiskPremiumPct].every(positive) && nonnegative(b.executionDragPct) && excess! >= p.minExcessBuyPct!))
  add('benchmark', 'XEQT and waiting hurdle', benchmark, 'Compare annualized CAD total returns over the same horizon. XEQT is the benchmark, not a candidate that can outperform itself. Deduct execution drag, concentration and model-risk premiums before testing the excess-return hurdle against both XEQT and waiting.')

  const redTeam = combine(ev(r.evidence), assertion(r.survived), condition([r.strongestBearCase, r.marketCounterargument, r.upsideDriver, r.falsifier].every(written) &&
    [r.growthShockPct, r.marginShockPp, r.multipleShockPct, r.jointStressAnnualReturnPct, p.minJointStressReturnPct].every(n => n != null) && r.valueTrapRisk != null,
    [r.growthShockPct, r.marginShockPp, r.multipleShockPct].every(n => finite(n) && n < 0 && n > -100) &&
    finite(r.jointStressAnnualReturnPct) && r.jointStressAnnualReturnPct > -100 && r.jointStressAnnualReturnPct <= b.candidateBasePct! &&
    r.jointStressAnnualReturnPct >= p.minJointStressReturnPct! && r.valueTrapRisk === 'addressed'))
  add('red-team', 'Red-team challenge', redTeam, 'Write the bear case, market counterargument, dominant upside assumption and falsifier. Stress growth, margin and multiple together; an unresolved value trap or unacceptable combined downside blocks action.')

  const cashKnown = [f.totalValueCad, f.settledCashCad, f.reservedOrdersCad, f.cashBufferCad, f.proposedAmountCad, x.estimatedFeesCad].every(n => n != null)
  const cash = combine(ev(f.evidence, portfolioAge), assertion(f.pendingOrdersConfirmed), condition(cashKnown,
    positive(f.totalValueCad) && positive(f.proposedAmountCad) && [f.settledCashCad, f.reservedOrdersCad, f.cashBufferCad, x.estimatedFeesCad].every(nonnegative) &&
    f.settledCashCad! <= f.totalValueCad! && f.proposedAmountCad! + x.estimatedFeesCad! <= f.settledCashCad! - f.reservedOrdersCad! - f.cashBufferCad!))
  add('cash', 'Settled cash and pending orders', cash, 'Use fresh confirmed cash, reserved orders and the cash buffer. No assumed deposits, sales or missing-order zeros; include estimated fees in the spending limit.')

  const navAfterFees = positive(f.totalValueCad) && nonnegative(x.estimatedFeesCad) ? f.totalValueCad - x.estimatedFeesCad : null
  const companyPctAfter = positive(navAfterFees) && [f.companyExposureCad, f.pendingCompanyBuysCad, f.proposedAmountCad].every(nonnegative)
    ? (f.companyExposureCad! + f.pendingCompanyBuysCad! + f.proposedAmountCad!) / navAfterFees * 100 : null
  const sectorPctAfter = positive(navAfterFees) && [f.sectorExposureCad, f.pendingSectorBuysCad, f.proposedAmountCad].every(nonnegative)
    ? (f.sectorExposureCad! + f.pendingSectorBuysCad! + f.proposedAmountCad!) / navAfterFees * 100 : null
  const concentration = combine(ev(f.evidence, portfolioAge), assertion(f.overlapKnown), condition(companyPctAfter != null && sectorPctAfter != null && p.maxCompanyPct != null && p.maxSectorPct != null,
    f.companyExposureCad! <= f.sectorExposureCad! && f.sectorExposureCad! <= f.totalValueCad! - f.settledCashCad! &&
    f.pendingCompanyBuysCad! <= f.pendingSectorBuysCad! && f.pendingSectorBuysCad! <= f.reservedOrdersCad! &&
    companyPctAfter! <= p.maxCompanyPct! && sectorPctAfter! <= p.maxSectorPct!))
  add('concentration', 'Portfolio fit and size', concentration, 'Include direct and XEQT look-through exposure plus pending buys. Spending existing cash does not increase NAV; estimated fees reduce it. The entire proposed amount must fit company and sector limits.')

  const rare = condition(context.recentStrikeCount != null && p.maxStrikesPerWindow != null,
    nonnegative(context.recentStrikeCount) && Number.isInteger(context.recentStrikeCount) && context.recentStrikeCount < p.maxStrikesPerWindow!)
  add('strike-frequency', 'STRIKE frequency audit', rare, 'STRIKE needs a verified local journal and must remain below the declared frequency limit. Repeated STRIKE episodes require policy review; browser imports cannot attest to journal history.')

  const researchIds = ['policy', 'identity', 'thesis', 'valuation', 'mapping', 'zones', 'quote', 'margin', 'benchmark', 'red-team', 'execution']
  const researchReady = gates.filter(g => researchIds.includes(g.id)).every(g => g.status === 'pass')
  const canBuy = researchReady && positive(x.ask) && positive(z.buyBelow) && x.ask <= z.buyBelow
  const canStrike = canBuy && positive(z.strikeBelow) && x.ask! <= z.strikeBelow && mos! >= p.minMosStrikePct! && excess! >= p.minExcessStrikePct! && i.thesis.quality === 'strong'
  const opportunity = i.thesis.status === 'broken' || i.thesis.quality === 'weak' ? 'PASS'
    : canStrike ? 'STRIKE' : canBuy ? 'BUY' : valuation === 'pass' && thesis === 'pass' ? 'WATCH' : 'UNSCORED'
  const allocation = cash !== 'pass' ? 'CHECK CASH' : concentration !== 'pass' ? 'BLOCKED' : 'READY'
  const label = allocation === 'READY' && canBuy ? canStrike && rare === 'pass' ? 'STRIKE' : 'BUY' : 'NO ACTION'
  if (researchReady && !canBuy) add('entry', 'Price within the BUY zone', 'fail', 'The executable ask is outside the precommitted BUY zone. Wait for a qualified entry; a falling price alone is not a trigger.')
  return {
    ...blank, researchRevision: i.researchRevision, evidenceEpisode: i.evidenceEpisode, symbol: inst.symbol, underlying: inst.underlying,
    label, thesis: i.thesis.status?.toUpperCase() as RadarEvaluation['thesis'] ?? 'UNKNOWN', opportunity, allocation,
    proposedAmountCad: label === 'NO ACTION' ? null : f.proposedAmountCad, marginOfSafetyPct: mos, excessReturnPct: excess,
    spreadBps, dislocationPct, companyPctAfter, sectorPctAfter, gates,
    reasons: gates.filter(g => g.status !== 'pass' && (g.id !== 'strike-frequency' || canStrike)).map(g => g.reason),
  }
}
