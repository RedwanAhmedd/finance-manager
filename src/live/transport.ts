// The read allowlist, shared by browser sign-in clients and the local server's
// permanent connection. No writes or arbitrary RPCs either way.
export type Source = 'RentStream' | 'StockStream'
const tables: Record<Source, Set<string>> = {
  RentStream: new Set(['bank_accounts', 'bank_transactions', 'bank_balance_statements', 'payments', 'payment_entries', 'expenses', 'tenants', 'security_deposit_transactions', 'reconciliation_locks', 'rpc/reconciliation_cash_source_balances', 'properties', 'manual_income', 'rent_history']),
  StockStream: new Set(['positions', 'trades', 'quotes', 'symbols', 'settings', 'fx_rates', 'watchlist']),
}

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

