import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withRadar } from '../server/assistant'
import { providerFromEnv, type Provider } from '../server/providers'
import { createRadarService } from '../server/radar'
import { sourcesFromEnv } from '../server/sources'
import { moneyStoreFromEnv } from '../server/money'
import { createFxSource } from '../server/fx'
import { assistantContext } from '../src/assistant/context'
import { buildPersonalBooks } from '../src/books/personal'
import { suggestBills } from '../src/money/lines'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'
import type { MoneyState } from '../src/money/EverydayMoney'
import { CASES, type Facts } from './cases'
import type { Check } from './checks'

// Asks the local assistant real questions about the live figures and scores the
// answers against those same figures. Run with `npm run eval`, or
// `EVAL_MODEL=qwen3:14b npm run eval` to compare another Ollama model.
// Answers contain private figures, so results go to .eval/ (ignored by Git).

const env = loadEnv('development', process.cwd(), '')
const provider: Provider = providerFromEnv({ ...env, ...(process.env.EVAL_MODEL ? { OLLAMA_MODEL: process.env.EVAL_MODEL } : {}) })
let facts: Facts
let context = ''
const results: { id: string; question: string; answer: string; seconds: number; checks: Check[] }[] = []

beforeAll(async () => {
  const setup = await provider.check()
  if (setup) throw new Error(setup)
  const sources = sourcesFromEnv(env)
  const store = moneyStoreFromEnv(env)
  const [rent, stock, money, fx] = await Promise.all([
    sources.rentstream?.getSnapshot() as Promise<RentSnapshot> | undefined ?? null,
    sources.stockstream?.getSnapshot() as Promise<StockSnapshot> | undefined ?? null,
    store ? store.load().then(d => ({ ...d, suggestions: suggestBills(d.transactions, d.bills.map(b => b.name)) })) : null,
    createFxSource()().catch(() => null),
  ]) as [RentSnapshot | null, StockSnapshot | null, MoneyState, Facts['fx']]
  if (!rent && !stock && !money) throw new Error('No source is connected. Add the secret keys to .env.local.')
  // The same Radar section the server appends to every request. Reading a
  // snapshot never writes the journal.
  const radar = createRadarService(resolve(env.RADAR_DIRECTORY || '.radar'), async () => stock)
  const verified = await radar.snapshot().then(s => s.candidates.filter(c => c.decision.action !== 'WAIT').map(c => c.decision.symbol.split('.')[0]), () => [])
  facts = { rent, stock, fx, personal: money ? buildPersonalBooks(money, new Date(), rent?.treasury ?? []) : null, radarActions: new Set(verified) }
  context = await withRadar(assistantContext(rent, stock, fx, money), radar.snapshot)
  console.log(`Evaluating ${provider.name} ${provider.model} on ${CASES.length} questions (${Math.round(context.length / 1000)}k characters of figures).`)
}, 120_000)

for (const c of CASES) {
  it(c.id, async ctx => {
    const question = c.question(facts)
    const mode = c.mode ?? 'chat'
    const started = Date.now()
    let answer = ''
    const stream = provider.stream({ mode, context, messages: mode === 'chat' ? [{ role: 'user', content: question }] : [] }, AbortSignal.timeout(600_000))
    for (;;) {
      const step = await stream.next()
      if (step.done) break
      answer += step.value
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10
    const checks = c.checks(answer, facts)
    if (!checks) return ctx.skip()
    results.push({ id: c.id, question, answer, seconds, checks })
    expect(checks.filter(ch => !ch.pass).map(ch => `${ch.name}${ch.detail ? ` (${ch.detail})` : ''}`), answer).toEqual([])
  })
}

afterAll(async () => {
  if (!results.length) return
  const passed = results.flatMap(r => r.checks).filter(ch => ch.pass).length
  const total = results.flatMap(r => r.checks).length
  const seconds = results.reduce((s, r) => s + r.seconds, 0)
  console.log(`\n${provider.model}: ${passed}/${total} checks passed · ${results.filter(r => r.checks.every(ch => ch.pass)).length}/${results.length} questions fully right · ${Math.round(seconds)}s total, ${Math.round(seconds / results.length)}s per answer`)
  for (const r of results) console.log(`  ${r.checks.every(ch => ch.pass) ? 'PASS' : 'FAIL'}  ${r.id.padEnd(24)} ${String(r.seconds).padStart(6)}s  ${r.checks.filter(ch => !ch.pass).map(ch => ch.name).join('; ')}`)
  await mkdir('.eval', { recursive: true })
  const file = `.eval/${new Date().toISOString().replace(/[:.]/g, '-')}-${provider.model.replace(/[^\w.-]/g, '_')}.json`
  await writeFile(file, JSON.stringify({ model: provider.model, provider: provider.name, passed, total, seconds, results }, null, 2))
  console.log(`Answers saved to ${file}`)
})
