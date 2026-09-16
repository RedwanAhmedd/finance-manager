import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Source = 'RentStream' | 'StockStream'
const tables: Record<Source, Set<string>> = {
  RentStream: new Set(['bank_accounts', 'bank_transactions', 'bank_balance_statements', 'payments', 'payment_entries', 'expenses', 'tenants', 'security_deposit_transactions', 'reconciliation_locks', 'rpc/reconciliation_cash_source_balances']),
  StockStream: new Set(['positions', 'trades', 'quotes', 'symbols', 'settings', 'fx_rates']),
}

// Restrict the app's data transport as well as its UI. No writes or arbitrary RPCs.
export function readOnlyFetch(source: Source, baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin !== new URL(baseUrl).origin) throw new Error('Unexpected source origin')
    if (url.pathname.startsWith('/rest/v1/')) {
      const resource = url.pathname.slice('/rest/v1/'.length)
      if (method !== 'GET' || !tables[source].has(resource)) throw new Error('Finance Manager allows approved reads only')
    } else if (url.pathname.startsWith('/auth/v1/')) {
      const permitted = (method === 'GET' && url.pathname === '/auth/v1/user') ||
        (method === 'POST' && ['/auth/v1/token', '/auth/v1/logout'].includes(url.pathname))
      if (!permitted) throw new Error('Unsupported authentication operation')
    } else throw new Error('Unsupported source endpoint')
    return transport(input, init)
  }
}

const env = import.meta.env
function sourceClient(source: Source, url?: string, key?: string): SupabaseClient | null {
  if (!url || !key) return null
  if (!key.startsWith('sb_publishable_')) throw new Error(`${source} needs a publishable key`)
  return createClient(url, key, {
    auth: { storageKey: `finance-manager-${source.toLowerCase()}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: readOnlyFetch(source, url) },
  })
}
export const clients: Record<Source, SupabaseClient | null> = {
  RentStream: sourceClient('RentStream', env.VITE_RENTSTREAM_URL, env.VITE_RENTSTREAM_PUBLISHABLE_KEY),
  StockStream: sourceClient('StockStream', env.VITE_STOCKSTREAM_URL, env.VITE_STOCKSTREAM_PUBLISHABLE_KEY),
}
