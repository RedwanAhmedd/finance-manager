import type { StockSnapshot } from '../live/models'

// Owned-position early warning from StockStream's recorded daily closes, per the
// ELITE mandate: the exact instrument's close against its previous close, highest
// matching severity only, gains and losses alike. A threshold starts a review; it
// never means BUY MORE, TRIM or SELL, so every alert says WAIT.

export type Severity = 'WARNING' | 'HIGH ALERT' | 'CRITICAL REVIEW' | 'MONITORING DEGRADED' | 'BUY OPPORTUNITY' | 'RESEARCH CANDIDATE'
export interface AlertCandidate {
  id: string
  kind: 'move' | 'degraded' | 'opportunity' | 'discovery' | 'research'
  symbol: string | null
  date: string | null
  severity: Severity
  movePct: number | null
  title: string
  body: string
}

export const RANK: Record<Severity, number> = { 'MONITORING DEGRADED': 0, WARNING: 1, 'HIGH ALERT': 2, 'CRITICAL REVIEW': 3, 'BUY OPPORTUNITY': 4, 'RESEARCH CANDIDATE': 2 }
// Daily closes: a weekend plus a holiday is four calendar days.
const MAX_CLOSE_AGE_DAYS = 4

export function severityFor(movePct: number): Severity | null {
  const size = Math.abs(movePct)
  return size >= 8 ? 'CRITICAL REVIEW' : size >= 5 ? 'HIGH ALERT' : size >= 3 ? 'WARNING' : null
}

const price = (n: number, currency: string | null) => `${currency === 'USD' ? 'US$' : currency === 'CAD' || !currency ? 'C$' : `${currency} `}${n.toFixed(2)}`
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const daysBetween = (from: string, to: Date) => (to.getTime() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

export function ownedPositionAlerts(stock: StockSnapshot | null, now = new Date()): { alerts: AlertCandidate[]; covered: string[]; uncovered: string[]; stale: string[] } {
  const owned = (stock?.holdings ?? []).filter(h => h.role !== 'cash' && h.role !== 'watchlist' && h.shares > 0).map(h => h.symbol)
  const closes = new Map((stock?.closes ?? []).map(c => [c.symbol, c]))
  const alerts: AlertCandidate[] = [], covered: string[] = [], uncovered: string[] = [], stale: string[] = []
  for (const symbol of owned) {
    const c = closes.get(symbol)
    if (!c || c.previousClose === null || c.previousDate === null || !(c.previousClose > 0)) { uncovered.push(symbol); continue }
    if (daysBetween(c.date, now) > MAX_CLOSE_AGE_DAYS) { stale.push(symbol); continue }
    covered.push(symbol)
    const movePct = (c.close - c.previousClose) / c.previousClose * 100
    const severity = severityFor(movePct)
    if (!severity) continue
    const ticker = symbol.replace(/\.(NE|TO)$/, '')
    const arrow = movePct < 0 ? '▼' : '▲'
    alerts.push({
      id: `move|${symbol}|${c.date}`, kind: 'move', symbol, date: c.date, severity, movePct: Math.round(movePct * 10) / 10,
      title: `${ticker} ${arrow}${Math.abs(movePct).toFixed(1)}% · ${severity}`,
      body: `${symbol} closed ${price(c.close, c.currency)} on ${shortDate(c.date)}, ${movePct < 0 ? 'down' : 'up'} from ${price(c.previousClose, c.currency)} on ${shortDate(c.previousDate)} (${c.source ?? 'StockStream'} daily close). Cause: UNRESOLVED. Action: WAIT. Review the thesis; this is not a buy or sell signal.`,
    })
  }
  // One deduplicated episode while owned positions cannot be watched; a new one
  // only when the set of unwatched positions changes.
  const blind = [...stale, ...uncovered].sort()
  if (owned.length && blind.length === owned.length) {
    alerts.push({
      id: `degraded|${blind.join(',')}`, kind: 'degraded', symbol: null, date: null, severity: 'MONITORING DEGRADED', movePct: null,
      title: 'Radar · MONITORING DEGRADED',
      body: `No recent daily close for ${blind.map(s => s.replace(/\.(NE|TO)$/, '')).join(', ')}, so owned-position warnings are paused. Check that StockStream is updating quotes. Action: WAIT.`,
    })
  }
  return { alerts, covered, uncovered, stale }
}
