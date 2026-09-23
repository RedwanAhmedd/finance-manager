import type { DailyClose, StockSnapshot } from '../src/live/models.ts'

// Daily closes for Cboe Canada CDRs (MSFT.NE…) from TMX Money, which lists them
// as MSFT:AQL. StockStream stores no CDR quotes, only estimates from the US
// underlying, and an underlying's move is not the CDR's move. This is the data
// behind TMX's public website, not a documented API: it can change without
// notice, and any failure leaves the position unwatched rather than guessed.

const ENDPOINT = 'https://app-money.tmx.com/graphql'
const QUERY = `query closes($symbol: String!, $start: String, $end: String) {
  getQuoteBySymbol(symbol: $symbol, locale: "en") { symbol name }
  getCompanyPriceHistory(symbol: $symbol, start: $start, end: $end, adjusted: false, unadjusted: true) { datetime closePrice volume }
}`

export const tmxSymbol = (symbol: string) => /^[A-Z][A-Z0-9]{0,9}\.NE$/.test(symbol) ? `${symbol.slice(0, -3)}:AQL` : null

export async function tmxDailyClose(symbol: string, now = new Date(), transport: typeof fetch = fetch): Promise<DailyClose> {
  const tmx = tmxSymbol(symbol)
  if (!tmx) throw new Error(`${symbol} is not a Cboe Canada listing`)
  const start = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
  const res = await transport(ENDPOINT, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', origin: 'https://money.tmx.com', referer: 'https://money.tmx.com/' },
    body: JSON.stringify({ query: QUERY, variables: { symbol: tmx, start, end: now.toISOString().slice(0, 10) } }),
  })
  if (!res.ok) throw new Error(`TMX returned ${res.status} for ${tmx}`)
  const body = await res.json() as { data?: { getQuoteBySymbol?: { symbol?: string; name?: string } | null; getCompanyPriceHistory?: { datetime?: string; closePrice?: number; volume?: number }[] | null } }
  const quote = body.data?.getQuoteBySymbol
  // Exact-instrument check: TMX must return this listing, and it must be a CDR.
  if (quote?.symbol !== tmx || !/\bCDR\b/.test(quote.name ?? '')) throw new Error(`TMX did not identify ${tmx} as a CDR`)
  // A day with no trades repeats the previous price; it is not a close.
  const days = (body.data?.getCompanyPriceHistory ?? [])
    .filter(d => typeof d.datetime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.datetime) && typeof d.closePrice === 'number' && d.closePrice > 0 && typeof d.volume === 'number' && d.volume > 0 && d.datetime <= now.toISOString().slice(0, 10))
    .sort((a, b) => b.datetime!.localeCompare(a.datetime!))
  if (!days.length) throw new Error(`TMX has no traded close for ${tmx} in the last two weeks`)
  return { symbol, currency: 'CAD', date: days[0].datetime!, close: days[0].closePrice!, previousDate: days[1]?.datetime ?? null, previousClose: days[1]?.closePrice ?? null, source: 'TMX Money' }
}

// Adds TMX closes for owned CDRs that StockStream has no closes for. Returns the
// snapshot with those closes and the listings TMX could not provide.
export async function withTmxCloses(stock: StockSnapshot | null, now = new Date(), transport: typeof fetch = fetch): Promise<{ stock: StockSnapshot | null; failed: string[] }> {
  if (!stock) return { stock, failed: [] }
  const have = new Set((stock.closes ?? []).filter(c => c.previousClose !== null).map(c => c.symbol))
  const wanted = stock.holdings.filter(h => h.shares > 0 && h.role !== 'cash' && h.role !== 'watchlist' && tmxSymbol(h.symbol) && !have.has(h.symbol)).map(h => h.symbol)
  const results = await Promise.allSettled(wanted.map(s => tmxDailyClose(s, now, transport)))
  const added = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
  const failed = wanted.filter((_, i) => results[i].status === 'rejected')
  return { stock: { ...stock, closes: [...(stock.closes ?? []).filter(c => !added.some(a => a.symbol === c.symbol)), ...added] }, failed }
}


/** Daily-close discovery for exact Canadian CDRs on the StockStream watchlist.
 * This is a research trigger, never a BUY signal. It deliberately refuses to
 * infer fundamentals, catalysts, or an ELITE pass from price movement alone.
 */
export async function tmxWatchlistMoves(symbols: readonly string[], now = new Date(), transport: typeof fetch = fetch) {
  const exact = [...new Set(symbols.filter(s => tmxSymbol(s)))]
  const settled = await Promise.allSettled(exact.map(s => tmxDailyClose(s, now, transport)))
  return settled.flatMap((r, i) => {
    if (r.status !== 'fulfilled' || r.value.previousClose == null || !(r.value.previousClose > 0)) return []
    const movePct = (r.value.close - r.value.previousClose) / r.value.previousClose * 100
    return [{ symbol: exact[i], close: r.value.close, date: r.value.date, previousClose: r.value.previousClose, previousDate: r.value.previousDate!, movePct }]
  })
}
