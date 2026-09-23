import type { SupabaseClient } from '@supabase/supabase-js'

// RLS scopes the result to the signed-in source user. Stable ordering and paging
// prevent the Data API's default row limit silently truncating the finance data.
export let retryDelayMs = 1_000
export const setRetryDelay = (ms: number) => { retryDelayMs = ms }

export async function readAll<T>(client: SupabaseClient, table: string, columns: string, orders = ['id'], filters: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < 100_000; offset += 500) {
    let query = client.from(table).select(columns)
    for (const key of orders) query = query.order(key)
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value)
    let { data, error } = await query.range(offset, offset + 499)
    // Supabase's gateway briefly rejects a fresh token when its clocks disagree by
    // a moment ("JWT issued at future"). The same read succeeds a second later.
    if (error && /issued at future/i.test(error.message)) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      ;({ data, error } = await query.range(offset, offset + 499))
    }
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data) throw new Error(`${table}: no response`)
    rows.push(...data as T[])
    if (data.length < 500) return rows
  }
  throw new Error(`${table}: snapshot exceeds the supported size`)
}
