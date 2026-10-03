import type { Evidence } from './engine'

export type ForecastDirection = 'BULLISH' | 'NEUTRAL' | 'BEARISH'
export type ForecastHorizon = 'INTRADAY' | '1-5 SESSIONS' | '1-4 WEEKS' | '3M+'
export type PredictiveState = 'NORMAL' | 'WATCH' | 'SETUP' | 'STRIKE CANDIDATE' | 'ELITE STRIKE' | 'INVALIDATED'
export type ConfirmationStatus = 'NOT REQUIRED' | 'PENDING' | 'CONFIRMED' | 'FAILED'
export type ProbabilityStatus = 'UNKNOWN' | 'EXPERIMENTAL' | 'CALIBRATED'
export type FeatureAvailability = 'KNOWN' | 'UNKNOWN' | 'STALE'

export interface ProbabilityEstimate {
  status: ProbabilityStatus
  positive5Session: number | null
  outperformBenchmark5Session: number | null
  expectedExcessReturnPct: number | null
  sampleSize: number | null
  effectiveSampleSize: number | null
  method: string | null
  asOf: string | null
}

export interface DataQuality {
  score: number
  unknownFeatures: string[]
  staleFeatures: string[]
  decisionCriticalUnknowns: string[]
}

export interface FeatureObservation {
  group: string
  name: string
  availability: FeatureAvailability
  value: string | number | boolean | null
  observedAt: string | null
  availableAt: string | null
  sourceUrl: string | null
}

export interface PredictiveForecast {
  version: '3.7'
  symbol: string
  underlying: string
  asOf: string
  modelVersion: string
  direction: ForecastDirection
  horizon: ForecastHorizon
  setupScore: number
  benchmark: string
  probability: ProbabilityEstimate
  dataQuality: DataQuality
  featureSnapshot: FeatureObservation[]
  expectedPath: string
  assumptions: string[]
  baseCase: string
  contraryCase: string
  invalidation: string
  relativeToXeqt: string
  canadianConfirmation: {
    required: boolean
    status: ConfirmationStatus
    reason: string
  }
  evidence: Evidence[]
}

export interface PredictiveEvaluation {
  version: '3.7'
  symbol: string
  underlying: string
  evaluatedAt: string
  direction: ForecastDirection
  horizon: ForecastHorizon
  setupScore: number
  probability: ProbabilityEstimate
  dataQualityScore: number
  rawState: Exclude<PredictiveState, 'INVALIDATED'>
  state: PredictiveState
  actionable: boolean
  blockers: string[]
}

export interface ForecastOutcome {
  measuredAt: string
  absoluteReturnPct: number
  relativeReturnVsXeqtPct: number | null
  maxAdverseExcursionPct: number | null
  maxFavorableExcursionPct: number | null
  invalidationOccurred: boolean
}

export interface ForecastScore {
  bucket: '65-79' | '80-89' | '90+'
  setupScore: number
  hit: boolean
  invalidated: boolean
  absoluteReturnPct: number
  relativeReturnVsXeqtPct: number | null
}

export interface SetupBucket {
  bucket: ForecastScore['bucket']
  count: number
  meanSetupScore: number | null
  hitRate: number | null
}

export interface ProbabilityScore {
  pPositive: number | null
  actualPositive: 0 | 1
  pOutperform: number | null
  actualOutperformed: 0 | 1 | null
}

export interface ProbabilityMetrics {
  countPositive: number
  brierPositive: number | null
  logLossPositive: number | null
  countRelative: number
  brierRelative: number | null
  logLossRelative: number | null
}

const timestamp = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
const written = (value: string) => value.trim().length >= 12
const probability = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const distinctEvidenceHosts = (evidence: Evidence[]) => new Set(evidence.flatMap(item => {
  try { return [new URL(item.sourceUrl).hostname.toLowerCase()] } catch { return [] }
})).size

export function emptyPredictiveForecast(symbol = '', underlying = symbol, asOf = new Date().toISOString()): PredictiveForecast {
  return {
    version: '3.7',
    symbol,
    underlying,
    asOf,
    modelVersion: 'predictive-v3.7-calibrated',
    direction: 'NEUTRAL',
    horizon: '1-5 SESSIONS',
    setupScore: 0,
    benchmark: 'XEQT',
    probability: {
      status: 'UNKNOWN',
      positive5Session: null,
      outperformBenchmark5Session: null,
      expectedExcessReturnPct: null,
      sampleSize: null,
      effectiveSampleSize: null,
      method: null,
      asOf: null,
    },
    dataQuality: {
      score: 0,
      unknownFeatures: [],
      staleFeatures: [],
      decisionCriticalUnknowns: [],
    },
    featureSnapshot: [],
    expectedPath: '',
    assumptions: [],
    baseCase: '',
    contraryCase: '',
    invalidation: '',
    relativeToXeqt: '',
    canadianConfirmation: { required: true, status: 'PENDING', reason: '' },
    evidence: [],
  }
}

export function stateForSetupScore(setupScore: number): Exclude<PredictiveState, 'INVALIDATED'> {
  if (setupScore >= 90) return 'ELITE STRIKE'
  if (setupScore >= 80) return 'STRIKE CANDIDATE'
  if (setupScore >= 65) return 'SETUP'
  if (setupScore >= 50) return 'WATCH'
  return 'NORMAL'
}

/** @deprecated v3.7 separates setup score from calibrated probability. */
export const stateForConfidence = stateForSetupScore

function parseProbability(raw: unknown, forecastAsOf: string, errors: string[]): ProbabilityEstimate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('probability: expected an object')
    return null
  }
  const p = raw as Record<string, unknown>
  const keys = ['status','positive5Session','outperformBenchmark5Session','expectedExcessReturnPct','sampleSize','effectiveSampleSize','method','asOf']
  if (Object.keys(p).some(k => !keys.includes(k)) || keys.some(k => !(k in p))) errors.push('probability: unexpected or missing fields')
  if (!['UNKNOWN','EXPERIMENTAL','CALIBRATED'].includes(String(p.status))) errors.push('probability.status: invalid')
  for (const key of ['positive5Session','outperformBenchmark5Session'] as const) {
    if (p[key] !== null && !probability(p[key])) errors.push(`probability.${key}: expected null or 0-1`)
  }
  if (p.expectedExcessReturnPct !== null && (typeof p.expectedExcessReturnPct !== 'number' || !Number.isFinite(p.expectedExcessReturnPct))) errors.push('probability.expectedExcessReturnPct: expected number or null')
  for (const key of ['sampleSize','effectiveSampleSize'] as const) {
    if (p[key] !== null && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0)) errors.push(`probability.${key}: expected positive number or null`)
  }
  if (p.method !== null && (typeof p.method !== 'string' || !p.method.trim())) errors.push('probability.method: expected non-empty text or null')
  if (p.asOf !== null && (typeof p.asOf !== 'string' || !timestamp(p.asOf))) errors.push('probability.asOf: expected ISO timestamp or null')
  if (p.status === 'UNKNOWN' && (p.positive5Session !== null || p.outperformBenchmark5Session !== null)) errors.push('probability: UNKNOWN cannot carry numeric probabilities')
  if (p.status !== 'UNKNOWN') {
    if (p.positive5Session === null && p.outperformBenchmark5Session === null) errors.push('probability: non-UNKNOWN status needs at least one probability')
    if (typeof p.asOf !== 'string' || !timestamp(p.asOf)) errors.push('probability: non-UNKNOWN status needs asOf')
    if (typeof p.method !== 'string' || !p.method.trim()) errors.push('probability: non-UNKNOWN status needs method')
  }
  if (typeof p.asOf === 'string' && timestamp(p.asOf) && timestamp(forecastAsOf) && Date.parse(p.asOf) > Date.parse(forecastAsOf)) errors.push('probability.asOf: cannot be later than the forecast cutoff')
  return raw as ProbabilityEstimate
}

function parseDataQuality(raw: unknown, errors: string[]): DataQuality | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('dataQuality: expected an object')
    return null
  }
  const q = raw as Record<string, unknown>
  const keys = ['score','unknownFeatures','staleFeatures','decisionCriticalUnknowns']
  if (Object.keys(q).some(k => !keys.includes(k)) || keys.some(k => !(k in q))) errors.push('dataQuality: unexpected or missing fields')
  if (!percent(q.score)) errors.push('dataQuality.score: expected 0-100')
  for (const key of ['unknownFeatures','staleFeatures','decisionCriticalUnknowns'] as const) {
    if (!Array.isArray(q[key]) || (q[key] as unknown[]).some(x => typeof x !== 'string')) errors.push(`dataQuality.${key}: expected text array`)
  }
  return raw as DataQuality
}

function parseFeatures(raw: unknown, forecastAsOf: string, errors: string[]): FeatureObservation[] | null {
  if (!Array.isArray(raw)) {
    errors.push('featureSnapshot: expected an array')
    return null
  }
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`featureSnapshot[${i}]: expected an object`)
      return
    }
    const f = item as Record<string, unknown>
    const keys = ['group','name','availability','value','observedAt','availableAt','sourceUrl']
    if (Object.keys(f).some(k => !keys.includes(k)) || keys.some(k => !(k in f))) errors.push(`featureSnapshot[${i}]: unexpected or missing fields`)
    if (typeof f.group !== 'string' || !f.group.trim() || typeof f.name !== 'string' || !f.name.trim()) errors.push(`featureSnapshot[${i}]: group/name required`)
    if (!['KNOWN','UNKNOWN','STALE'].includes(String(f.availability))) errors.push(`featureSnapshot[${i}].availability: invalid`)
    if (f.observedAt !== null && (typeof f.observedAt !== 'string' || !timestamp(f.observedAt))) errors.push(`featureSnapshot[${i}].observedAt: invalid`)
    if (f.availableAt !== null && (typeof f.availableAt !== 'string' || !timestamp(f.availableAt))) errors.push(`featureSnapshot[${i}].availableAt: invalid`)
    if (f.sourceUrl !== null && typeof f.sourceUrl !== 'string') errors.push(`featureSnapshot[${i}].sourceUrl: invalid`)
    if (f.availability !== 'UNKNOWN') {
      if (typeof f.availableAt !== 'string' || !timestamp(f.availableAt)) errors.push(`featureSnapshot[${i}]: KNOWN/STALE feature needs availableAt`)
      else if (timestamp(forecastAsOf) && Date.parse(f.availableAt) > Date.parse(forecastAsOf)) errors.push(`featureSnapshot[${i}]: look-ahead leak; availableAt is after forecast cutoff`)
    }
  })
  return raw as FeatureObservation[]
}

export function parsePredictiveForecast(value: unknown): { ok: true; forecast: PredictiveForecast } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['forecast: expected an object'] }
  const f = value as Record<string, unknown>
  const keys = ['version','symbol','underlying','asOf','modelVersion','direction','horizon','setupScore','benchmark','probability','dataQuality','featureSnapshot','expectedPath','assumptions','baseCase','contraryCase','invalidation','relativeToXeqt','canadianConfirmation','evidence']
  if (Object.keys(f).some(k => !keys.includes(k)) || keys.some(k => !(k in f))) errors.push('forecast: unexpected or missing fields')
  if (f.version !== '3.7') errors.push('version: expected 3.7')
  if (typeof f.symbol !== 'string' || !f.symbol.trim()) errors.push('symbol: required')
  if (typeof f.underlying !== 'string' || !f.underlying.trim()) errors.push('underlying: required')
  if (typeof f.asOf !== 'string' || !timestamp(f.asOf)) errors.push('asOf: use an ISO timestamp with timezone')
  if (typeof f.modelVersion !== 'string' || !f.modelVersion.trim()) errors.push('modelVersion: required')
  if (!['BULLISH','NEUTRAL','BEARISH'].includes(String(f.direction))) errors.push('direction: invalid')
  if (!['INTRADAY','1-5 SESSIONS','1-4 WEEKS','3M+'].includes(String(f.horizon))) errors.push('horizon: invalid')
  if (!percent(f.setupScore)) errors.push('setupScore: expected 0-100')
  if (typeof f.benchmark !== 'string' || !f.benchmark.trim()) errors.push('benchmark: required')
  parseProbability(f.probability, typeof f.asOf === 'string' ? f.asOf : '', errors)
  parseDataQuality(f.dataQuality, errors)
  parseFeatures(f.featureSnapshot, typeof f.asOf === 'string' ? f.asOf : '', errors)
  for (const key of ['expectedPath','baseCase','contraryCase','invalidation','relativeToXeqt'] as const) if (typeof f[key] !== 'string') errors.push(`${key}: expected text`)
  if (!Array.isArray(f.assumptions) || f.assumptions.some(x => typeof x !== 'string')) errors.push('assumptions: expected text array')
  if (!Array.isArray(f.evidence) || f.evidence.some(x => !x || typeof x !== 'object' || typeof (x as Evidence).sourceUrl !== 'string' || typeof (x as Evidence).asOf !== 'string')) errors.push('evidence: expected source records')
  const c = f.canadianConfirmation
  if (!c || typeof c !== 'object' || Array.isArray(c)) errors.push('canadianConfirmation: expected an object')
  else {
    const cc = c as Record<string, unknown>
    if (typeof cc.required !== 'boolean' || !['NOT REQUIRED','PENDING','CONFIRMED','FAILED'].includes(String(cc.status)) || typeof cc.reason !== 'string') errors.push('canadianConfirmation: invalid')
    if (cc.required === false && cc.status !== 'NOT REQUIRED' && cc.status !== 'CONFIRMED') errors.push('canadianConfirmation: non-required checks must be NOT REQUIRED or CONFIRMED')
  }
  return errors.length ? { ok: false, errors } : { ok: true, forecast: value as PredictiveForecast }
}

export function evaluatePredictiveForecast(raw: PredictiveForecast, nowIso: string): PredictiveEvaluation {
  const parsed = parsePredictiveForecast(raw)
  const blockers: string[] = []
  const fallback: PredictiveEvaluation = {
    version: '3.7', symbol: '', underlying: '', evaluatedAt: nowIso, direction: 'NEUTRAL', horizon: '1-5 SESSIONS',
    setupScore: 0, probability: emptyPredictiveForecast().probability, dataQualityScore: 0,
    rawState: 'NORMAL', state: 'NORMAL', actionable: false, blockers,
  }
  if (!parsed.ok || !timestamp(nowIso)) return { ...fallback, blockers: parsed.ok ? ['Evaluation time is invalid.'] : parsed.errors }
  const f = parsed.forecast
  const now = Date.parse(nowIso)
  if (Date.parse(f.asOf) > now) blockers.push('Forecast is future-dated.')
  const rawState = stateForSetupScore(f.setupScore)
  const requiredText = [f.expectedPath, f.baseCase, f.contraryCase, f.invalidation, f.relativeToXeqt]
  if (f.setupScore >= 65 && (requiredText.some(x => !written(x)) || !f.assumptions.some(written))) blockers.push('A 65+ setup needs explicit path, assumptions, base/contrary cases, invalidation and XEQT view.')
  const hosts = distinctEvidenceHosts(f.evidence)
  if (f.setupScore >= 80 && hosts < 2) blockers.push('A strike candidate needs at least two distinct evidence sources.')
  if (f.setupScore >= 90 && hosts < 3) blockers.push('An ELITE STRIKE needs at least three distinct evidence sources.')
  if (f.setupScore >= 80 && f.dataQuality.decisionCriticalUnknowns.length) blockers.push('Decision-critical evidence is UNKNOWN.')
  if (f.setupScore >= 90 && f.probability.status === 'UNKNOWN') blockers.push('ELITE STRIKE requires at least an experimental probability estimate; setup score alone is not a probability.')
  if (f.canadianConfirmation.required && f.setupScore >= 80 && f.canadianConfirmation.status !== 'CONFIRMED') blockers.push('Canadian execution confirmation is still pending or failed.')
  if (f.canadianConfirmation.status === 'FAILED') blockers.push('Canadian confirmation failed.')
  const hardInvalidated = f.canadianConfirmation.status === 'FAILED'
  let state: PredictiveState = hardInvalidated ? 'INVALIDATED' : rawState
  if (!hardInvalidated && blockers.length && f.setupScore >= 80) state = 'SETUP'
  return {
    version: '3.7', symbol: f.symbol, underlying: f.underlying, evaluatedAt: nowIso, direction: f.direction, horizon: f.horizon,
    setupScore: f.setupScore, probability: f.probability, dataQualityScore: f.dataQuality.score,
    rawState, state, actionable: state === 'STRIKE CANDIDATE' || state === 'ELITE STRIKE', blockers,
  }
}

function bucket(setupScore: number): ForecastScore['bucket'] {
  return setupScore >= 90 ? '90+' : setupScore >= 80 ? '80-89' : '65-79'
}

export function scoreForecast(forecast: PredictiveForecast, outcome: ForecastOutcome): ForecastScore | null {
  if (forecast.setupScore < 65 || !timestamp(outcome.measuredAt) || Date.parse(outcome.measuredAt) < Date.parse(forecast.asOf) || !Number.isFinite(outcome.absoluteReturnPct)) return null
  const hit = forecast.direction === 'BULLISH'
    ? outcome.absoluteReturnPct > 0
    : forecast.direction === 'BEARISH'
      ? outcome.absoluteReturnPct < 0
      : Math.abs(outcome.absoluteReturnPct) <= 1
  return {
    bucket: bucket(forecast.setupScore),
    setupScore: forecast.setupScore,
    hit,
    invalidated: outcome.invalidationOccurred,
    absoluteReturnPct: outcome.absoluteReturnPct,
    relativeReturnVsXeqtPct: outcome.relativeReturnVsXeqtPct,
  }
}

export function summarizeCalibration(scores: ForecastScore[]): SetupBucket[] {
  return (['65-79','80-89','90+'] as const).map(name => {
    const rows = scores.filter(x => x.bucket === name)
    if (!rows.length) return { bucket: name, count: 0, meanSetupScore: null, hitRate: null }
    const meanSetupScore = rows.reduce((n, x) => n + x.setupScore, 0) / rows.length
    const hitRate = rows.filter(x => x.hit).length / rows.length * 100
    return { bucket: name, count: rows.length, meanSetupScore, hitRate }
  })
}

export function scoreProbabilityForecast(forecast: PredictiveForecast, outcome: ForecastOutcome): ProbabilityScore {
  return {
    pPositive: forecast.probability.positive5Session,
    actualPositive: outcome.absoluteReturnPct > 0 ? 1 : 0,
    pOutperform: forecast.probability.outperformBenchmark5Session,
    actualOutperformed: outcome.relativeReturnVsXeqtPct == null ? null : outcome.relativeReturnVsXeqtPct > 0 ? 1 : 0,
  }
}

const clamp = (p: number) => Math.min(0.999999, Math.max(0.000001, p))
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null

export function summarizeProbabilityMetrics(rows: ProbabilityScore[]): ProbabilityMetrics {
  const positive = rows.filter((r): r is ProbabilityScore & { pPositive: number } => r.pPositive != null)
  const relative = rows.filter((r): r is ProbabilityScore & { pOutperform: number; actualOutperformed: 0 | 1 } => r.pOutperform != null && r.actualOutperformed != null)
  const brierPositive = average(positive.map(r => (r.pPositive - r.actualPositive) ** 2))
  const logLossPositive = average(positive.map(r => -(r.actualPositive * Math.log(clamp(r.pPositive)) + (1 - r.actualPositive) * Math.log(1 - clamp(r.pPositive)))))
  const brierRelative = average(relative.map(r => (r.pOutperform - r.actualOutperformed) ** 2))
  const logLossRelative = average(relative.map(r => -(r.actualOutperformed * Math.log(clamp(r.pOutperform)) + (1 - r.actualOutperformed) * Math.log(1 - clamp(r.pOutperform)))))
  return {
    countPositive: positive.length,
    brierPositive,
    logLossPositive,
    countRelative: relative.length,
    brierRelative,
    logLossRelative,
  }
}
