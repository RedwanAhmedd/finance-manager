import { describe, expect, it } from 'vitest'
import {
  emptyPredictiveForecast,
  evaluatePredictiveForecast,
  parsePredictiveForecast,
  scoreForecast,
  scoreProbabilityForecast,
  stateForSetupScore,
  summarizeCalibration,
  summarizeProbabilityMetrics,
} from '../src/radar/predictive'

const now = '2026-10-02T15:00:00.000Z'
function forecast(setupScore: number) {
  const f = emptyPredictiveForecast('TEST.NE', 'TEST', now)
  f.direction = 'BULLISH'
  f.setupScore = setupScore
  f.dataQuality = { score: 92, unknownFeatures: [], staleFeatures: [], decisionCriticalUnknowns: [] }
  f.expectedPath = 'Relative strength persists over the selected horizon.'
  f.assumptions = ['Rates remain contained and the company thesis remains intact.']
  f.baseCase = 'The exact Canadian instrument follows the constructive underlying trend.'
  f.contraryCase = 'Rates reaccelerate or company-specific evidence deteriorates.'
  f.invalidation = 'A thesis break or failed Canadian confirmation invalidates the setup.'
  f.relativeToXeqt = 'Expected to outperform XEQT if the assumptions and confirmation hold.'
  f.canadianConfirmation = { required: true, status: 'CONFIRMED', reason: 'Price, liquidity and underlying alignment confirmed.' }
  f.evidence = [
    { sourceUrl: 'https://example.com/a', asOf: now },
    { sourceUrl: 'https://example.org/b', asOf: now },
    { sourceUrl: 'https://example.net/c', asOf: now },
  ]
  f.featureSnapshot = [{
    group: 'market',
    name: 'qqq_20d_trend',
    availability: 'KNOWN',
    value: 1,
    observedAt: now,
    availableAt: now,
    sourceUrl: 'https://example.com/a',
  }]
  return f
}

describe('Strike Radar Predictive v3.7 CALIBRATED', () => {
  it.each([[64,'NORMAL'],[65,'SETUP'],[79,'SETUP'],[80,'STRIKE CANDIDATE'],[89,'STRIKE CANDIDATE'],[90,'ELITE STRIKE']] as const)(
    'maps setup score %s to %s', (score, state) => expect(stateForSetupScore(score)).toBe(state),
  )

  it('keeps setup score separate from probability and never uses cash or size', () => {
    const result = evaluatePredictiveForecast(forecast(84), now)
    expect(result).toMatchObject({
      state: 'STRIKE CANDIDATE',
      actionable: true,
      setupScore: 84,
      probability: { status: 'UNKNOWN', positive5Session: null },
    })
    expect(result.blockers.join(' ')).not.toMatch(/cash|capital|ammo|size/i)
  })

  it('rejects look-ahead feature timestamps', () => {
    const f = forecast(84)
    f.featureSnapshot[0].availableAt = '2026-10-02T16:00:00.000Z'
    const parsed = parsePredictiveForecast(f)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join(' ')).toMatch(/look-ahead/i)
  })

  it('caps an 80+ setup when decision-critical evidence is unknown', () => {
    const f = forecast(86)
    f.dataQuality.decisionCriticalUnknowns = ['exact_cdr_spread']
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'STRIKE CANDIDATE', state: 'SETUP', actionable: false })
  })

  it('caps an 80+ pre-open setup until Canadian confirmation', () => {
    const f = forecast(86)
    f.canadianConfirmation = { required: true, status: 'PENDING', reason: 'Canadian market not open yet.' }
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'STRIKE CANDIDATE', state: 'SETUP', actionable: false })
  })

  it('does not allow an ELITE STRIKE to pretend a setup score is a probability', () => {
    const f = forecast(92)
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'ELITE STRIKE', state: 'SETUP', actionable: false })
    f.probability = {
      status: 'EXPERIMENTAL',
      positive5Session: 0.71,
      outperformBenchmark5Session: 0.63,
      expectedExcessReturnPct: 1.2,
      sampleSize: 120,
      effectiveSampleSize: 86,
      method: 'walk-forward-logistic-v1',
      asOf: now,
    }
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ state: 'ELITE STRIKE', actionable: true, setupScore: 92 })
  })

  it('requires stronger source independence for ELITE STRIKE', () => {
    const f = forecast(92)
    f.probability = {
      status: 'EXPERIMENTAL',
      positive5Session: 0.71,
      outperformBenchmark5Session: null,
      expectedExcessReturnPct: null,
      sampleSize: 120,
      effectiveSampleSize: 86,
      method: 'walk-forward-logistic-v1',
      asOf: now,
    }
    f.evidence = f.evidence.slice(0, 2)
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'ELITE STRIKE', state: 'SETUP', actionable: false })
  })

  it('scores setup buckets without treating setup score as probability', () => {
    const scored = [
      scoreForecast(forecast(75), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: 2, relativeReturnVsXeqtPct: 1, maxAdverseExcursionPct: -1, maxFavorableExcursionPct: 3, invalidationOccurred: false }),
      scoreForecast(forecast(85), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: 3, relativeReturnVsXeqtPct: 2, maxAdverseExcursionPct: -1, maxFavorableExcursionPct: 4, invalidationOccurred: false }),
      scoreForecast(forecast(92), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: -2, relativeReturnVsXeqtPct: -3, maxAdverseExcursionPct: -3, maxFavorableExcursionPct: 1, invalidationOccurred: true }),
    ].filter((x): x is NonNullable<typeof x> => x !== null)
    const summary = summarizeCalibration(scored)
    expect(summary.map(x => x.count)).toEqual([1,1,1])
    expect(summary[1].hitRate).toBe(100)
    expect(summary[2].hitRate).toBe(0)
    expect('calibrationGap' in summary[1]).toBe(false)
  })

  it('computes proper probability scores only when an explicit probability exists', () => {
    const f = forecast(84)
    f.probability = {
      status: 'EXPERIMENTAL',
      positive5Session: 0.7,
      outperformBenchmark5Session: 0.6,
      expectedExcessReturnPct: 1,
      sampleSize: 100,
      effectiveSampleSize: 80,
      method: 'walk-forward-logistic-v1',
      asOf: now,
    }
    const row = scoreProbabilityForecast(f, {
      measuredAt: '2026-10-07T15:00:00Z',
      absoluteReturnPct: 2,
      relativeReturnVsXeqtPct: 1,
      maxAdverseExcursionPct: -1,
      maxFavorableExcursionPct: 3,
      invalidationOccurred: false,
    })
    const metrics = summarizeProbabilityMetrics([row])
    expect(metrics.countPositive).toBe(1)
    expect(metrics.brierPositive).toBeCloseTo(0.09)
    expect(metrics.countRelative).toBe(1)
    expect(metrics.brierRelative).toBeCloseTo(0.16)
  })
})
