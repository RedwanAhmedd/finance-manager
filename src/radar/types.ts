import type { RadarEvaluation } from './engine'
import type { EliteEvaluation } from './elite'
import type { BenchmarkLabResult } from './benchmark'
export interface RadarSnapshot {
  version: '5.2'
  fetchedAt: string
  status: 'empty' | 'ready' | 'degraded'
  action: 'WAIT'
  reason: string
  journalExists: boolean
  runCount: number
  candidates: { savedAt: string; decision: EliteEvaluation; evaluation: RadarEvaluation; entryPriceCad: number | null; priceSide: 'bid' | 'ask'; priceEvidence: { asOf: string; sourceUrl: string }[] }[]
  owned: { symbol: string; shares: number; priceDate: string | null }[]
  coverage: { portfolio: boolean; liveMarket: false; news: false; notifications: false }
  issues: string[]
  benchmark: BenchmarkLabResult | null
}
