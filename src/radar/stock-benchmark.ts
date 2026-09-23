import type { StockSnapshot } from '../live/models'
import { buildBenchmarkLab, type BenchmarkLabResult } from './benchmark'

/** A recorded-mark cost-basis estimate, never an exact historical performance claim. */
export function benchmarkFromStock(stock: StockSnapshot | null, now: string): BenchmarkLabResult {
  const empty = (reason: string) => ({ ...buildBenchmarkLab({ mode: 'provisional', evaluatedAt: now, asOf: now, currency: 'CAD', positions: [] }), reason })
  if (!stock?.books || !Number.isFinite(Date.parse(stock.fetchedAt)) || Date.parse(stock.fetchedAt) > Date.parse(now) || Date.parse(now) - Date.parse(stock.fetchedAt) > 3600000) return empty('Current holdings and cost basis are needed.')
  const positions = stock.books.holdings.filter(h => h.role === 'satellite' && h.shares > 0)
  const owned = stock.holdings.filter(h => h.role === 'satellite' && h.shares > 0)
  if (!positions.length || positions.length !== owned.length || positions.some(p => !owned.some(h => h.symbol === p.symbol && h.shares === p.shares))) return empty('Reconcile the individual-stock sleeve before comparing it.')
  if (positions.some(p => !p.historyComplete || p.bookCost == null || p.value == null || p.priceBasis !== 'quote' || !p.priceDate || !Number.isFinite(Date.parse(p.priceDate)) || Date.parse(p.priceDate) > Date.parse(now) || Date.parse(now) - Date.parse(p.priceDate) > 3 * 86400000)) return empty('Complete cost basis and recent recorded CAD quotes are needed; partial holdings are not ranked.')
  const result = buildBenchmarkLab({ mode: 'provisional', evaluatedAt: now, asOf: stock.fetchedAt, currency: 'CAD', positions: positions.map(p => ({
    instrumentId: p.symbol, quantity: p.shares, valueCad: p.value!, costBasisCad: p.bookCost!, costBasis: 'reconstructed', asOf: stock.fetchedAt,
    source: { verified: true, observedAt: stock.fetchedAt, reference: `StockStream recorded mark dated ${p.priceDate}; reconstructed trade cost basis for ${p.symbol}` },
  })) })
  return { ...result, reason: result.reason + ' Prices are recorded marks, not live executable quotes.' }
}
