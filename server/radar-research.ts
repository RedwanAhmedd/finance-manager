import type { StockSnapshot } from '../src/live/models.ts'

export interface LiveResearch {
  symbol: string
  underlying: string
  observedAt: string
  quote: { price: number; previousClose: number; movePct: number } | null
  metrics: { peTtm: number | null; peForward: number | null; revenueGrowthTtm: number | null; operatingMarginTtm: number | null } | null
  news: { headline: string; source: string; url: string; publishedAt: string }[]
}
export interface ResearchProvider {
  configured: boolean
  research(stock: StockSnapshot, symbols: readonly string[], now?: Date): Promise<{ rows: LiveResearch[]; errors: string[] }>
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const safeUrl = (v: unknown) => typeof v === 'string' && /^https:\/\//.test(v) ? v : null

/** Finnhub supplies underlying-market quote/news/fundamentals. Exact CDR execution
 * prices still come from TMX; an underlying quote is never substituted for a CDR.
 */
export function finnhubResearchProvider(token?: string, transport: typeof fetch = fetch): ResearchProvider {
  const key = token?.trim()
  const configured = !!key
  const get = async (path: string) => {
    if (!key) throw new Error('FINNHUB_API_KEY is not configured')
    const join = path.includes('?') ? '&' : '?'
    const res = await transport(`https://finnhub.io/api/v1/${path}${join}token=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) throw new Error(`Finnhub returned ${res.status}`)
    return res.json() as Promise<any>
  }
  return {
    configured,
    async research(stock, symbols, now = new Date()) {
      if (!configured) return { rows: [], errors: ['Live research provider is not configured.'] }
      const map = new Map((stock.researchInstruments ?? []).map(i => [i.symbol, i]))
      const errors: string[] = [], rows: LiveResearch[] = []
      const from = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10)
      for (const symbol of [...new Set(symbols)]) {
        const instrument = map.get(symbol), underlying = instrument?.underlyingSymbol
        if (!underlying || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(underlying)) { errors.push(`${symbol}: verified underlying mapping unavailable`); continue }
        try {
          const [q, m, n] = await Promise.all([get(`quote?symbol=${encodeURIComponent(underlying)}`), get(`stock/metric?symbol=${encodeURIComponent(underlying)}&metric=all`), get(`company-news?symbol=${encodeURIComponent(underlying)}&from=${from}&to=${to}`)])
          const price = finite(q.c) && q.c > 0 ? q.c : null, prev = finite(q.pc) && q.pc > 0 ? q.pc : null
          const metric = m?.metric ?? {}
          rows.push({
            symbol, underlying, observedAt: now.toISOString(),
            quote: price && prev ? { price, previousClose: prev, movePct: (price - prev) / prev * 100 } : null,
            metrics: { peTtm: finite(metric.peTTM) ? metric.peTTM : null, peForward: finite(metric.forwardPE) ? metric.forwardPE : null, revenueGrowthTtm: finite(metric.revenueGrowthTTMYoy) ? metric.revenueGrowthTTMYoy : null, operatingMarginTtm: finite(metric.operatingMarginTTM) ? metric.operatingMarginTTM : null },
            news: Array.isArray(n) ? n.slice(0, 5).flatMap((x: any) => { const url = safeUrl(x.url); return url && typeof x.headline === 'string' && finite(x.datetime) ? [{ headline: x.headline.slice(0, 240), source: typeof x.source === 'string' ? x.source.slice(0, 80) : 'Finnhub', url, publishedAt: new Date(x.datetime * 1000).toISOString() }] : [] }) : [],
          })
        } catch (e) { errors.push(`${symbol}: ${e instanceof Error ? e.message : 'research failed'}`) }
      }
      return { rows, errors }
    },
  }
}
