import { benchmarkFromStock } from '../src/radar/stock-benchmark.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateRadar, parseRadarInput } from '../src/radar/engine.ts'
import { evaluateElite, parseEliteReview, type EliteReview, type EliteEvaluation } from '../src/radar/elite.ts'
import { evaluatePredictiveForecast, parsePredictiveForecast, type PredictiveForecast, type PredictiveEvaluation } from '../src/radar/predictive.ts'
import { buildBenchmarkLab, type BenchmarkLabInput } from '../src/radar/benchmark.ts'
import type { RadarSnapshot } from '../src/radar/types.ts'
import type { StockSnapshot } from '../src/live/models.ts'
import { readJournal, saveRadarRun, type Run } from './radar-journal.ts'

class RadarCommitError extends Error {
  constructor(readonly runId: number) { super('Research run saved, but ELITE receipt could not be verified. WAIT; inspect this run before retrying.') }
}
type Receipt = { runHash: string; savedAt: string; review: EliteReview | null; stock: StockSnapshot | null; decision: EliteEvaluation; forecast?: PredictiveForecast | null; prediction?: PredictiveEvaluation | null; digest: string }
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function readJson(path: string): unknown | null {
  let stat
  try { stat = lstatSync(path) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5_000_000) throw new Error('Invalid Radar record')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function writeNew(path: string, value: unknown) {
  const fd = openSync(path, 'wx', 0o600)
  const encoded = JSON.stringify(value) + '\n'
  try { writeFileSync(fd, encoded); fsyncSync(fd) } finally { closeSync(fd) }
  if (readFileSync(path, 'utf8') !== encoded) throw new Error('Radar record readback failed')
}
function receiptFor(path: string, run: Run): Receipt | null {
  const r = readJson(path) as Receipt | null
  if (!r) return null
  const { digest: checksum, ...body } = r
  const forecast = r.forecast ?? null
  const prediction = forecast ? evaluatePredictiveForecast(forecast, run.savedAt) : null
  if (checksum !== digest(body) || r.runHash !== run.hash || r.savedAt !== run.savedAt ||
    (r.review && !parseEliteReview(r.review).ok) ||
    (forecast && !parsePredictiveForecast(forecast).ok) ||
    JSON.stringify(r.prediction ?? null) !== JSON.stringify(prediction) ||
    JSON.stringify(r.decision) !== JSON.stringify(evaluateElite(run.input, run.evaluation, r.review, r.stock, run.savedAt))) throw new Error('ELITE receipt integrity failed')
  return r
}
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw new Error('Radar import exceeds 1 MB'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}
type AlertStatus = NonNullable<RadarSnapshot['alerts']>
export function createRadarService(directory: string, getStock: () => Promise<StockSnapshot | null>, alerts?: { status(): AlertStatus; sendTest(): Promise<void> }, liveResearch = false) {
  const root = resolve(directory), journal = resolve(root, 'journal.json')
  const receipts = resolve(root, 'receipts')
  async function source() { try { return await getStock() } catch { return null } }
  async function snapshot(): Promise<RadarSnapshot> {
    const stock = await source(), now = new Date().toISOString(), state = readJournal(journal)
    const sourceFresh = !!stock && Date.parse(stock.fetchedAt) <= Date.parse(now) && Date.parse(now) - Date.parse(stock.fetchedAt) <= 3600000
    const issues = sourceFresh ? [] : ['Portfolio source unavailable or stale.']
    const latest = new Map<string, Run>()
    for (const run of state?.runs ?? []) latest.set(run.input.instrument.symbol, run)
    const candidates = [...latest.values()].map(run => {
      const days = run.input.policy.strikeWindowDays
      const context = { recentStrikeCount: days == null ? null : state!.signals.filter(s => s.cohort === 'qualified' && s.decision === 'STRIKE' && Date.parse(now) - Date.parse(s.recordedAt) <= days * 86400000 && !(s.symbol === run.input.instrument.symbol && s.evidenceEpisode === run.input.evidenceEpisode)).length }
      const evaluation = evaluateRadar(run.input, now, context)
      const receipt = receiptFor(resolve(receipts, `${run.hash}.json`), run)
      const review = receipt?.review ?? null
      const forecast = receipt?.forecast ?? null
      const prediction = forecast ? evaluatePredictiveForecast(forecast, now) : null
      const decision = evaluateElite(run.input, evaluation, review, stock, now)
      const priceSide = decision.action === 'SELL' || decision.action === 'TRIM' ? 'bid' as const : 'ask' as const
      return { savedAt: run.savedAt, decision, evaluation, forecast, prediction, entryPriceCad: run.input.execution[priceSide], priceSide, priceEvidence: run.input.execution.evidence }
    })
    // No price/news provider is silently inferred from daily portfolio marks.
    let alertStatus: AlertStatus | undefined
    try { alertStatus = alerts?.status() } catch { issues.push('Radar alert store could not be verified; phone alerts are paused.') }
    if (!liveResearch) issues.push(alertStatus?.configured
      ? 'Live news/fundamentals research is not configured; exact-instrument close monitoring remains active.'
      : 'Live research and push delivery are not configured.')
    if (alertStatus?.failing) issues.push('A phone alert could not be delivered; it will be retried.')
    let benchmark: RadarSnapshot['benchmark'] = benchmarkFromStock(stock, now)
    const benchmarkInput = readJson(resolve(root, 'benchmark.json'))
    if (benchmarkInput) benchmark = buildBenchmarkLab({ ...(benchmarkInput as BenchmarkLabInput), evaluatedAt: now })
    return {
      version: '5.2+3.6', fetchedAt: now, status: !sourceFresh ? 'degraded' : state ? 'ready' : 'empty', action: 'WAIT',
      reason: candidates.length ? 'Review the latest entries below.' : 'No reviewed entry yet.', journalExists: state !== null, runCount: state?.runs.length ?? 0, candidates,
      owned: sourceFresh ? stock!.holdings.filter(h => h.role !== 'cash' && h.role !== 'watchlist' && h.shares > 0).map(h => ({ symbol: h.symbol, shares: h.shares, priceDate: h.asOf })) : [],
      coverage: { portfolio: sourceFresh, liveMarket: liveResearch, news: liveResearch, notifications: !!alertStatus?.configured && !alertStatus.failing }, alerts: alertStatus, issues, benchmark,
    }
  }
  async function save(body: Record<string, unknown>) {
    const parsed = parseRadarInput(body.input)
    if (!parsed.ok) throw new Error(parsed.errors.slice(0, 4).join('; '))
    let review: EliteReview | null = null
    if (body.review != null) { const parsedReview = parseEliteReview(body.review); if (!parsedReview.ok) throw new Error(parsedReview.errors.join('; ')); review = parsedReview.review }
    let forecast: PredictiveForecast | null = null
    if (body.forecast != null) {
      const parsedForecast = parsePredictiveForecast(body.forecast)
      if (!parsedForecast.ok) throw new Error(parsedForecast.errors.join('; '))
      forecast = parsedForecast.forecast
      if (forecast.symbol !== parsed.input.instrument.symbol || forecast.underlying !== parsed.input.instrument.underlying) throw new Error('Forecast belongs to a different instrument or underlying.')
    }
    if (body.createState !== undefined && typeof body.createState !== 'boolean') throw new Error('createState must be explicit true or false')
    const stock = await source()
    mkdirSync(root, { recursive: true, mode: 0o700 }); mkdirSync(receipts, { recursive: true, mode: 0o700 })
    const summary = saveRadarRun(parsed.input, journal, body.createState === true, { recordSignals: false })
    const run = readJournal(journal)!.runs[summary.runId - 1]
    const decision = evaluateElite(run.input, run.evaluation, review, stock, run.savedAt)
    const prediction = forecast ? evaluatePredictiveForecast(forecast, run.savedAt) : null
    const record = { runHash: run.hash, savedAt: run.savedAt, review, stock, decision, forecast, prediction }
    try {
      writeNew(resolve(receipts, `${run.hash}.json`), { ...record, digest: digest(record) })
      receiptFor(resolve(receipts, `${run.hash}.json`), run)
    } catch { throw new RadarCommitError(run.id) }
    return { runId: summary.runId, decision, persisted: true, readbackVerified: true, notificationDelivery: 'NOT CONNECTED' }
  }
  async function sendTestAlert() {
    if (!alerts) throw new Error('Phone alerts are not set up. Add NTFY_TOPIC to .env.local and restart.')
    await alerts.sendTest()
  }
  return { snapshot, save, sendTestAlert }
}
export function createRadarHandler(service: ReturnType<typeof createRadarService>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/radar' && path !== '/api/radar/test-alert') return next()
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }
    // Local private research; reject DNS rebinding as well as foreign origins.
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return json(403, { error: 'Local same-origin requests only' })
    if (path === '/api/radar/test-alert') {
      if (req.method !== 'POST') return json(405, { error: 'POST only' })
      try { await service.sendTestAlert(); return json(200, { sent: true }) } catch (e) { return json(502, { error: e instanceof Error ? e.message : 'Test alert failed' }) }
    }
    if (req.method === 'GET') {
      try { return json(200, await service.snapshot()) } catch { return json(503, { error: 'Radar records could not be verified. WAIT; inspect the journal.' }) }
    }
    if (req.method !== 'POST') return json(405, { error: 'GET or POST only' })
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Send application/json' })
    try { return json(200, await service.save(await readBody(req))) }
    catch (e) {
      if (e instanceof RadarCommitError) return json(503, { error: e.message, persisted: true, runId: e.runId, readbackVerified: false, action: 'WAIT' })
      return json(400, { error: e instanceof Error ? e.message : 'Radar save failed; verify the journal before retrying.' })
    }
  }
}
