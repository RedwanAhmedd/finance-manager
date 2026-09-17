import type { IncomingMessage, ServerResponse } from 'node:http'

// Daily CAD→BDT reference rate from free public sources, fetched by the local
// server and kept in memory until the provider's next update. It is a market
// reference; money actually sent between countries gets a different rate.
export interface FxRate { base: 'CAD'; quote: 'BDT'; rate: number; asOf: string; source: string; fetchedAt: string }

type Fetch = typeof fetch
const PRIMARY = 'https://open.er-api.com/v6/latest/CAD'
const FALLBACK = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cad.json'

async function fromExchangeRateApi(transport: Fetch): Promise<{ rate: FxRate; nextUpdate: number }> {
  const res = await transport(PRIMARY, { signal: AbortSignal.timeout(8_000) })
  const body = await res.json() as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string; time_next_update_utc?: string }
  const rate = body.rates?.BDT
  if (body.result !== 'success' || typeof rate !== 'number' || !(rate > 0) || !body.time_last_update_utc) throw new Error('ExchangeRate-API returned no CAD/BDT rate')
  return {
    rate: { base: 'CAD', quote: 'BDT', rate, asOf: new Date(body.time_last_update_utc).toISOString().slice(0, 10), source: 'ExchangeRate-API (open access, exchangerate-api.com)', fetchedAt: new Date().toISOString() },
    nextUpdate: body.time_next_update_utc ? new Date(body.time_next_update_utc).getTime() : Date.now() + 12 * 3_600_000,
  }
}

async function fromCurrencyApi(transport: Fetch): Promise<{ rate: FxRate; nextUpdate: number }> {
  const res = await transport(FALLBACK, { signal: AbortSignal.timeout(8_000) })
  const body = await res.json() as { date?: string; cad?: Record<string, number> }
  const rate = body.cad?.bdt
  if (typeof rate !== 'number' || !(rate > 0) || !body.date) throw new Error('currency-api returned no CAD/BDT rate')
  return { rate: { base: 'CAD', quote: 'BDT', rate, asOf: body.date, source: 'fawazahmed0 currency-api (jsDelivr)', fetchedAt: new Date().toISOString() }, nextUpdate: Date.now() + 6 * 3_600_000 }
}

export function createFxSource(transport: Fetch = fetch, now: () => number = Date.now) {
  let cached: { rate: FxRate; nextUpdate: number } | null = null
  return async (): Promise<FxRate> => {
    if (cached && now() < cached.nextUpdate) return cached.rate
    try { cached = await fromExchangeRateApi(transport) }
    catch {
      try { cached = await fromCurrencyApi(transport) }
      // Keep serving the last good rate (its date shows its age) rather than none.
      catch (error) { if (cached) return cached.rate; throw error }
    }
    return cached.rate
  }
}

export function createFxHandler(getRate: () => Promise<FxRate>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/fx') return next()
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed' })
    if (req.method !== 'GET') return json(405, { error: 'GET only' })
    try { return json(200, await getRate()) } catch { return json(502, { error: 'No CAD/BDT rate available from the exchange-rate services' }) }
  }
}
