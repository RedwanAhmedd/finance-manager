import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourcesHandler, sourcesFromEnv, type Sources } from '../server/sources'

const servers: http.Server[] = []
afterEach(() => servers.splice(0).forEach(s => s.close()))
function serve(sources: Sources) {
  const handler = createSourcesHandler(sources)
  const server = http.createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end('next') }))
  servers.push(server)
  return new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
}

describe('Permanent source connection', () => {
  it('connects only sources that have a URL and a secret key', () => {
    expect(sourcesFromEnv({})).toEqual({})
    const s = sourcesFromEnv({ VITE_RENTSTREAM_URL: 'https://r.supabase.co', RENTSTREAM_SECRET_KEY: 'sb_secret_abc' })
    expect(Object.keys(s)).toEqual(['rentstream'])
    expect(() => sourcesFromEnv({ VITE_STOCKSTREAM_URL: 'https://s.supabase.co', STOCKSTREAM_SECRET_KEY: 'sb_publishable_abc' })).toThrow('secret key')
  })
  it('reports connections and serves snapshots to this page only', async () => {
    const base = await serve({ rentstream: { getSnapshot: async () => ({ bankCashBdt: 5 }) }, stockstream: { getSnapshot: async () => { throw new Error('permission denied') } } })
    expect(await (await fetch(`${base}/api/sources`)).json()).toEqual({ rentstream: true, stockstream: true })
    expect(await (await fetch(`${base}/api/sources/rentstream`)).json()).toEqual({ bankCashBdt: 5 })
    const failed = await fetch(`${base}/api/sources/stockstream`)
    expect([failed.status, await failed.json()]).toEqual([502, { error: 'permission denied' }])
    expect((await fetch(`${base}/api/sources/rentstream`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await fetch(`${base}/api/sources/rentstream`, { method: 'POST' })).status).toBe(405)
    expect(await (await fetch(`${base}/api/other`)).text()).toBe('next')
  })
  it('says when a source is not permanently connected', async () => {
    const base = await serve({})
    expect((await fetch(`${base}/api/sources/rentstream`)).status).toBe(404)
  })
})
