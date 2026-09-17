import type { RentSnapshot, StockSnapshot } from '../live/models'
import {
  buildChatGptFinanceContext,
  type ChatGptFinanceContext,
  type SourceFailure,
  type SourceFailureCode,
} from './chatgptFacade'

export interface SnapshotReader<T> {
  getSnapshot(now?: Date): Promise<T>
}

export interface FinanceContextReaders {
  rent: SnapshotReader<RentSnapshot>
  stock: SnapshotReader<StockSnapshot>
}

function publicFailure(source: 'RentStream' | 'StockStream', code: SourceFailureCode): SourceFailure {
  const messages: Record<SourceFailureCode, string> = {
    AUTH_REQUIRED: source + ' authentication is required.',
    PERMISSION_DENIED: source + ' access was denied.',
    NETWORK_ERROR: source + ' could not be reached.',
    SOURCE_ERROR: source + ' read failed.',
  }
  return { code, message: messages[code] }
}

/**
 * Classifies adapter failures into a stable, non-sensitive public error.
 *
 * Raw Supabase/network messages are deliberately not passed to a future remote
 * model or connector. The original error remains available to local logging.
 */
export function classifySourceFailure(
  source: 'RentStream' | 'StockStream',
  reason: unknown,
): SourceFailure {
  const detail = reason instanceof Error ? reason.message.toLowerCase() : String(reason ?? '').toLowerCase()

  if (/(auth|jwt|session|token|sign[ -]?in|unauthenticated)/.test(detail)) {
    return publicFailure(source, 'AUTH_REQUIRED')
  }
  if (/(permission|forbidden|rls|not allowed|access denied)/.test(detail)) {
    return publicFailure(source, 'PERMISSION_DENIED')
  }
  if (reason instanceof TypeError || /(network|fetch|timeout|offline|reach)/.test(detail)) {
    return publicFailure(source, 'NETWORK_ERROR')
  }
  return publicFailure(source, 'SOURCE_ERROR')
}

async function readOne<T>(
  source: 'RentStream' | 'StockStream',
  reader: SnapshotReader<T>,
  now: Date,
): Promise<{ snapshot: T | null; failure: SourceFailure | null }> {
  try {
    const snapshot = await reader.getSnapshot(now)
    return { snapshot, failure: null }
  } catch (reason) {
    return { snapshot: null, failure: classifySourceFailure(source, reason) }
  }
}

/**
 * Reads both live sources and builds one read-only ChatGPT context.
 *
 * The source reads are independent: a failed RentStream read does not erase a
 * successful StockStream snapshot, and vice versa. This function has no write,
 * persistence, authentication, or model capabilities.
 */
export async function getFinanceContext(
  readers: FinanceContextReaders,
  now = new Date(),
): Promise<ChatGptFinanceContext> {
  const [rent, stock] = await Promise.all([
    readOne('RentStream', readers.rent, now),
    readOne('StockStream', readers.stock, now),
  ])

  return buildChatGptFinanceContext({
    rent: rent.snapshot,
    stock: stock.snapshot,
    rentFailure: rent.failure,
    stockFailure: stock.failure,
  }, now)
}
