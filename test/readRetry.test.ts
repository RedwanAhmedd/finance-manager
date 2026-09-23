import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll, setRetryDelay } from '../src/live/read'

// A query builder whose range() returns the given responses in turn.
function client(responses: { data: unknown[] | null; error: { message: string } | null }[]) {
  const range = vi.fn(async () => responses.shift()!)
  const query = { order: () => query, eq: () => query, range }
  return { client: { from: () => ({ select: () => query }) } as unknown as SupabaseClient, range }
}

describe('readAll retry', () => {
  beforeAll(() => setRetryDelay(0))
  it('retries once when the gateway says the token was issued in the future', async () => {
    const { client: c, range } = client([{ data: null, error: { message: 'JWT issued at future' } }, { data: [{ id: 1 }], error: null }])
    await expect(readAll(c, 'payments', 'id')).resolves.toEqual([{ id: 1 }])
    expect(range).toHaveBeenCalledTimes(2)
  })
  it('gives up after one retry', async () => {
    const { client: c, range } = client([{ data: null, error: { message: 'JWT issued at future' } }, { data: null, error: { message: 'JWT issued at future' } }])
    await expect(readAll(c, 'payments', 'id')).rejects.toThrow('payments: JWT issued at future')
    expect(range).toHaveBeenCalledTimes(2)
  })
  it('does not retry other errors', async () => {
    const { client: c, range } = client([{ data: null, error: { message: 'permission denied' } }])
    await expect(readAll(c, 'payments', 'id')).rejects.toThrow('payments: permission denied')
    expect(range).toHaveBeenCalledTimes(1)
  })
})
