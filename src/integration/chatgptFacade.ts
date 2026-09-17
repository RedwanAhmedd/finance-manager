import type { RentSnapshot, StockSnapshot } from '../live/models'

export type FinanceSource = 'RentStream' | 'StockStream'
export type SourceHealthStatus = 'healthy' | 'attention' | 'unavailable'

export interface SourceHealth {
  source: FinanceSource
  status: SourceHealthStatus
  fetchedAt: string | null
  stale: boolean
  issueCount: number
  error: string | null
}

export interface ChatGptFinanceContext {
  schemaVersion: 'finance-manager.chatgpt.v1'
  generatedAt: string
  access: 'read-only'
  permissions: {
    moveMoney: false
    executeTrades: false
    writeSourceSystems: false
    approveRecommendations: false
  }
  sourceHealth: {
    rentStream: SourceHealth
    stockStream: SourceHealth
  }
  rent: RentSnapshot | null
  stock: StockSnapshot | null
  attention: string[]
}

export interface BuildChatGptFinanceContextInput {
  rent?: RentSnapshot | null
  stock?: StockSnapshot | null
  rentError?: string | null
  stockError?: string | null
}

const SOURCE_STALE_MS = 60 * 60 * 1000
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function isFetchStale(fetchedAt: string | null, now: Date): boolean {
  if (!fetchedAt) return true
  const fetchedMs = new Date(fetchedAt).getTime()
  if (!Number.isFinite(fetchedMs)) return true
  const age = now.getTime() - fetchedMs
  return age > SOURCE_STALE_MS || age < -FUTURE_TOLERANCE_MS
}

function buildSourceHealth(
  source: FinanceSource,
  snapshot: RentSnapshot | StockSnapshot | null,
  error: string | null,
  now: Date,
): SourceHealth {
  const fetchedAt = snapshot?.fetchedAt ?? null
  const stale = isFetchStale(fetchedAt, now)
  const issueCount = snapshot?.issues.length ?? 0

  return {
    source,
    status: !snapshot || error ? 'unavailable' : stale || issueCount > 0 ? 'attention' : 'healthy',
    fetchedAt,
    stale,
    issueCount,
    error,
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

/**
 * Builds the narrow, read-only context that a ChatGPT-facing transport may expose.
 *
 * This function does not fetch data, persist a snapshot, move money, place trades,
 * or mutate either source system. The caller must supply snapshots produced by the
 * existing read-only Finance Manager adapters.
 */
export function buildChatGptFinanceContext(
  input: BuildChatGptFinanceContextInput,
  now = new Date(),
): ChatGptFinanceContext {
  const rent = input.rent ?? null
  const stock = input.stock ?? null
  const rentError = input.rentError ?? null
  const stockError = input.stockError ?? null

  const rentHealth = buildSourceHealth('RentStream', rent, rentError, now)
  const stockHealth = buildSourceHealth('StockStream', stock, stockError, now)

  const attention = unique([
    ...(rentError ? [`RentStream unavailable: ${rentError}`] : []),
    ...(stockError ? [`StockStream unavailable: ${stockError}`] : []),
    ...(!rent && !rentError ? ['RentStream snapshot unavailable.'] : []),
    ...(!stock && !stockError ? ['StockStream snapshot unavailable.'] : []),
    ...(rentHealth.stale && rent ? [`RentStream read is stale (last fetch ${rent.fetchedAt}).`] : []),
    ...(stockHealth.stale && stock ? [`StockStream read is stale (last fetch ${stock.fetchedAt}).`] : []),
    ...(rent?.issues.map(issue => `RentStream: ${issue}`) ?? []),
    ...(stock?.issues.map(issue => `StockStream: ${issue}`) ?? []),
  ])

  return {
    schemaVersion: 'finance-manager.chatgpt.v1',
    generatedAt: now.toISOString(),
    access: 'read-only',
    permissions: {
      moveMoney: false,
      executeTrades: false,
      writeSourceSystems: false,
      approveRecommendations: false,
    },
    sourceHealth: {
      rentStream: rentHealth,
      stockStream: stockHealth,
    },
    rent,
    stock,
    attention,
  }
}
