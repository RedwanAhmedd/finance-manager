import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { readOnlyFetch, type Source } from '../src/live/transport.ts'
import { ReadOnlyRentStreamAdapter } from '../src/live/rentstream.ts'
import { ReadOnlyStockStreamAdapter } from '../src/live/stockstream.ts'

// Permanent connection: the local server reads each source with that project's
// secret key, so the page needs no sign-in. The key stays in this Node process,
// and the same GET-only allowlist as the browser clients applies to every call.
export interface SnapshotSource { getSnapshot(): Promise<unknown> }
export type Sources = Partial<Record<'rentstream' | 'stockstream', SnapshotSource>>

function isSecretKey(key: string) {
  return key.startsWith('sb_secret_') || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)
}

function client(source: Source, url: string | undefined, key: string | undefined) {
  if (!url || !key?.trim()) return null
  if (!isSecretKey(key.trim())) throw new Error(`${source} permanent connection needs the project's secret key (sb_secret_…)`)
  return createClient(url, key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readOnlyFetch(source, url) },
  })
}

export function sourcesFromEnv(env: Record<string, string | undefined>): Sources {
  const rent = client('RentStream', env.VITE_RENTSTREAM_URL, env.RENTSTREAM_SECRET_KEY)
  const stock = client('StockStream', env.VITE_STOCKSTREAM_URL, env.STOCKSTREAM_SECRET_KEY)
  return {
    ...(rent ? { rentstream: new ReadOnlyRentStreamAdapter(rent) } : {}),
    ...(stock ? { stockstream: new ReadOnlyStockStreamAdapter(stock) } : {}),
  }
}

export function createSourcesHandler(sources: Sources) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/sources' && !path?.startsWith('/api/sources/')) return next()
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed' })
    if (req.method !== 'GET') return json(405, { error: 'GET only' })
    if (path === '/api/sources') return json(200, { rentstream: !!sources.rentstream, stockstream: !!sources.stockstream })
    const name = path.slice('/api/sources/'.length)
    const source = name === 'rentstream' || name === 'stockstream' ? sources[name] : undefined
    if (!source) return json(404, { error: `${name} is not permanently connected` })
    try { return json(200, await source.getSnapshot()) } catch (error) { return json(502, { error: error instanceof Error ? error.message : 'Source read failed' }) }
  }
}
