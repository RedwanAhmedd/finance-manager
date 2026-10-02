import { describe, expect, it } from 'vitest'
import {
  emptyPredictiveForecast,
  evaluatePredictiveForecast,
  scoreForecast,
  stateForConfidence,
  summarizeCalibration,
} from '../src/radar/predictive'

const now = '2026-10-02T15:00:00.000Z'
function forecast(confidence: number) {
  const f = emptyPredictiveForecast('TEST.NE', 'TEST', now)
  f.direction = 'BULLISH'
  f.confidence = confidence
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
  return f
}

describe('Strike Radar Predictive v3.6', () => {
  it.each([[64,'NORMAL'],[65,'SETUP'],[79,'SETUP'],[80,'STRIKE CANDIDATE'],[89,'STRIKE CANDIDATE'],[90,'ELITE STRIKE']] as const)(
    'maps %s%% to %s', (confidence, state) => expect(stateForConfidence(confidence)).toBe(state),
  )

  it('does not use cash or position size as a prediction input', () => {
    const result = evaluatePredictiveForecast(forecast(84), now)
    expect(result).toMatchObject({ state: 'STRIKE CANDIDATE', actionable: true, confidence: 84 })
    expect(result.blockers.join(' ')).not.toMatch(/cash|capital|ammo|size/i)
  })

  it('caps an 80%+ pre-open forecast at SETUP until Canadian confirmation', () => {
    const f = forecast(86)
    f.canadianConfirmation = { required: true, status: 'PENDING', reason: 'Canadian market not open yet.' }
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'STRIKE CANDIDATE', state: 'SETUP', actionable: false })
  })

  it('requires stronger source independence for ELITE STRIKE', () => {
    const f = forecast(92)
    f.evidence = f.evidence.slice(0, 2)
    expect(evaluatePredictiveForecast(f, now)).toMatchObject({ rawState: 'ELITE STRIKE', state: 'SETUP', actionable: false })
  })

  it('marks failed Canadian confirmation as invalidated', () => {
    const f = forecast(88)
    f.canadianConfirmation = { required: true, status: 'FAILED', reason: 'Underlying/CDR divergence.' }
    expect(evaluatePredictiveForecast(f, now).state).toBe('INVALIDATED')
  })

  it('scores frozen forecasts and summarizes calibration buckets', () => {
    const scored = [
      scoreForecast(forecast(75), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: 2, relativeReturnVsXeqtPct: 1, maxAdverseExcursionPct: -1, maxFavorableExcursionPct: 3, invalidationOccurred: false }),
      scoreForecast(forecast(85), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: 3, relativeReturnVsXeqtPct: 2, maxAdverseExcursionPct: -1, maxFavorableExcursionPct: 4, invalidationOccurred: false }),
      scoreForecast(forecast(92), { measuredAt: '2026-10-07T15:00:00Z', absoluteReturnPct: -2, relativeReturnVsXeqtPct: -3, maxAdverseExcursionPct: -3, maxFavorableExcursionPct: 1, invalidationOccurred: true }),
    ].filter((x): x is NonNullable<typeof x> => x !== null)
    const summary = summarizeCalibration(scored)
    expect(summary.map(x => x.count)).toEqual([1,1,1])
    expect(summary[1].hitRate).toBe(100)
    expect(summary[2].hitRate).toBe(0)
  })
})
