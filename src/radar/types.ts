import type { RadarEvaluation } from './engine'
import type { EliteEvaluation } from './elite'
import type { BenchmarkLabResult } from './benchmark'
import type { PredictiveEvaluation, PredictiveForecast } from './predictive'

export interface RadarSnapshot {
  version: '5.2+3.7'
  fetchedAt: string
  status: 'empty' | 'ready' | 'degraded'
  action: 'WAIT'
  reason: string
  journalExists: boolean
  runCount: number
  candidates: {
    savedAt: string
    decision: EliteEvaluation
    evaluation: RadarEvaluation
    forecast: PredictiveForecast | null
    prediction: PredictiveEvaluation | null
    entryPriceCad: number | null
    priceSide: 'bid' | 'ask'
    priceEvidence: { asOf: string; sourceUrl: string }[]
  }[]
  owned: { symbol: string; shares: number; priceDate: string | null }[]
  coverage: { portfolio: boolean; liveMarket: boolean; news: boolean; notifications: boolean }
  alerts?: { configured: boolean; failing: boolean; recent: { title: string; createdAt: string; delivery: 'pending' | 'delivered' | 'failed' }[] }
  issues: string[]
  benchmark: BenchmarkLabResult | null
}
