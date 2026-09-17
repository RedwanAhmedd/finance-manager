import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readOnlyFetch, type Source } from './transport'

export type { Source }
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
