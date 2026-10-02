import type { Evidence } from './engine'

export type ForecastDirection = 'BULLISH' | 'NEUTRAL' | 'BEARISH'
export type ForecastHorizon = 'INTRADAY' | '1-5 SESSIONS' | '1-4 WEEKS' | '3M+'
export type PredictiveState = 'NORMAL' | 'WATCH' | 'SETUP' | 'STRIKE CANDIDATE' | 'ELITE STRIKE' | 'INVALIDATED'
export type ConfirmationStatus = 'NOT REQUIRED' | 'PENDING' | 'CONFIRMED' | 'FAILED'

export interface PredictiveForecast {
  version: '3.6'
  symbol: string
  underlying: string
  asOf: string
  modelVersion: string
  direction: ForecastDirection
  horizon: ForecastHorizon
  confidence: number
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
  version: '3.6'
  symbol: string
  underlying: string
  evaluatedAt: string
  direction: ForecastDirection
  horizon: ForecastHorizon
  confidence: number
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
  confidence: number
  hit: boolean
  invalidated: boolean
  absoluteReturnPct: number
  relativeReturnVsXeqtPct: number | null
}

export interface CalibrationBucket {
  bucket: ForecastScore['bucket']
  count: number
  meanConfidence: number | null
  hitRate: number | null
  calibrationGap: number | null
}

const timestamp = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
const written = (value: string) => value.trim().length >= 12
const distinctEvidenceHosts = (evidence: Evidence[]) => new Set(evidence.flatMap(item => {
  try { return [new URL(item.sourceUrl).hostname.toLowerCase()] } catch { return [] }
})).size

export function emptyPredictiveForecast(symbol = '', underlying = symbol, asOf = new Date().toISOString()): PredictiveForecast {
  return {
    version: '3.6',
    symbol,
    underlying,
    asOf,
    modelVersion: 'predictive-v3.6',
    direction: 'NEUTRAL',
    horizon: '1-5 SESSIONS',
    confidence: 0,
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

export function stateForConfidence(confidence: number): Exclude<PredictiveState, 'INVALIDATED'> {
  if (confidence >= 90) return 'ELITE STRIKE'
  if (confidence >= 80) return 'STRIKE CANDIDATE'
  if (confidence >= 65) return 'SETUP'
  if (confidence >= 50) return 'WATCH'
  return 'NORMAL'
}

export function parsePredictiveForecast(value: unknown): { ok: true; forecast: PredictiveForecast } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['forecast: expected an object'] }
  const f = value as Record<string, unknown>
  const keys = ['version','symbol','underlying','asOf','modelVersion','direction','horizon','confidence','expectedPath','assumptions','baseCase','contraryCase','invalidation','relativeToXeqt','canadianConfirmation','evidence']
  if (Object.keys(f).some(k => !keys.includes(k)) || keys.some(k => !(k in f))) errors.push('forecast: unexpected or missing fields')
  if (f.version !== '3.6') errors.push('version: expected 3.6')
  if (typeof f.symbol !== 'string' || !f.symbol.trim()) errors.push('symbol: required')
  if (typeof f.underlying !== 'string' || !f.underlying.trim()) errors.push('underlying: required')
  if (typeof f.asOf !== 'string' || !timestamp(f.asOf)) errors.push('asOf: use an ISO timestamp with timezone')
  if (typeof f.modelVersion !== 'string' || !f.modelVersion.trim()) errors.push('modelVersion: required')
  if (!['BULLISH','NEUTRAL','BEARISH'].includes(String(f.direction))) errors.push('direction: invalid')
  if (!['INTRADAY','1-5 SESSIONS','1-4 WEEKS','3M+'].includes(String(f.horizon))) errors.push('horizon: invalid')
  if (typeof f.confidence !== 'number' || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 100) errors.push('confidence: expected 0-100')
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
    version: '3.6', symbol: '', underlying: '', evaluatedAt: nowIso, direction: 'NEUTRAL', horizon: '1-5 SESSIONS',
    confidence: 0, rawState: 'NORMAL', state: 'NORMAL', actionable: false, blockers,
  }
  if (!parsed.ok || !timestamp(nowIso)) return { ...fallback, blockers: parsed.ok ? ['Evaluation time is invalid.'] : parsed.errors }
  const f = parsed.forecast
  const now = Date.parse(nowIso)
  if (Date.parse(f.asOf) > now) blockers.push('Forecast is future-dated.')
  const rawState = stateForConfidence(f.confidence)
  const requiredText = [f.expectedPath, f.baseCase, f.contraryCase, f.invalidation, f.relativeToXeqt]
  if (f.confidence >= 65 && (requiredText.some(x => !written(x)) || !f.assumptions.some(written))) blockers.push('A 65%+ forecast needs explicit path, assumptions, base/contrary cases, invalidation and XEQT view.')
  const hosts = distinctEvidenceHosts(f.evidence)
  if (f.confidence >= 80 && hosts < 2) blockers.push('A strike candidate needs at least two distinct evidence sources.')
  if (f.confidence >= 90 && hosts < 3) blockers.push('An ELITE STRIKE needs at least three distinct evidence sources.')
  if (f.canadianConfirmation.required && f.confidence >= 80 && f.canadianConfirmation.status !== 'CONFIRMED') blockers.push('Canadian execution confirmation is still pending or failed.')
  if (f.canadianConfirmation.status === 'FAILED') blockers.push('Canadian confirmation failed.')
  const hardInvalidated = f.canadianConfirmation.status === 'FAILED'
  let state: PredictiveState = hardInvalidated ? 'INVALIDATED' : rawState
  if (!hardInvalidated && blockers.length && f.confidence >= 80) state = 'SETUP'
  return {
    version: '3.6', symbol: f.symbol, underlying: f.underlying, evaluatedAt: nowIso, direction: f.direction, horizon: f.horizon,
    confidence: f.confidence, rawState, state, actionable: state === 'STRIKE CANDIDATE' || state === 'ELITE STRIKE', blockers,
  }
}

function bucket(confidence: number): ForecastScore['bucket'] {
  return confidence >= 90 ? '90+' : confidence >= 80 ? '80-89' : '65-79'
}

export function scoreForecast(forecast: PredictiveForecast, outcome: ForecastOutcome): ForecastScore | null {
  if (forecast.confidence < 65 || !timestamp(outcome.measuredAt) || Date.parse(outcome.measuredAt) < Date.parse(forecast.asOf) || !Number.isFinite(outcome.absoluteReturnPct)) return null
  const hit = forecast.direction === 'BULLISH'
    ? outcome.absoluteReturnPct > 0
    : forecast.direction === 'BEARISH'
      ? outcome.absoluteReturnPct < 0
      : Math.abs(outcome.absoluteReturnPct) <= 1
  return {
    bucket: bucket(forecast.confidence),
    confidence: forecast.confidence,
    hit,
    invalidated: outcome.invalidationOccurred,
    absoluteReturnPct: outcome.absoluteReturnPct,
    relativeReturnVsXeqtPct: outcome.relativeReturnVsXeqtPct,
  }
}

export function summarizeCalibration(scores: ForecastScore[]): CalibrationBucket[] {
  return (['65-79','80-89','90+'] as const).map(name => {
    const rows = scores.filter(x => x.bucket === name)
    if (!rows.length) return { bucket: name, count: 0, meanConfidence: null, hitRate: null, calibrationGap: null }
    const meanConfidence = rows.reduce((n, x) => n + x.confidence, 0) / rows.length
    const hitRate = rows.filter(x => x.hit).length / rows.length * 100
    return { bucket: name, count: rows.length, meanConfidence, hitRate, calibrationGap: hitRate - meanConfidence }
  })
}
