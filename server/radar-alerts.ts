import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ownedPositionAlerts, RANK, type AlertCandidate, type Severity } from '../src/radar/alerts.ts'
import type { StockSnapshot } from '../src/live/models.ts'

// Radar's alert delivery: each alert episode is persisted and read back before
// any delivery attempt, and delivery status is recorded separately from the
// decision. Replays never resend; only a higher severity in the same episode does.

export type Delivery = { status: 'pending' | 'delivered' | 'failed'; attempts: number; lastAttemptAt: string | null; error: string | null }
export interface Episode extends AlertCandidate {
  createdAt: string; updatedAt: string; delivery: Delivery
  // Source outages are recorded on the first failed scan, but sent only after
  // a second failed scan. Resolving one lets a later outage start a new episode.
  failureCount?: number; lastReliableAt?: string | null; resolvedAt?: string
}
interface Store { schemaVersion: 1; episodes: Episode[]; lastReliableAt?: string | null; digest: string }
export interface PushMessage { title: string; body: string; priority: 1 | 2 | 3 | 4 | 5; tags: string[] }
export type Send = (message: PushMessage) => Promise<void>

const MAX_ATTEMPTS = 5
const PRIORITY: Record<Severity, PushMessage['priority']> = { 'MONITORING DEGRADED': 3, WARNING: 3, 'HIGH ALERT': 4, 'CRITICAL REVIEW': 5 }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

// ntfy delivers to the ntfy iPhone app. Anyone who knows the topic can read it,
// so the topic must be long and random, and messages carry no share counts or
// position values.
export function ntfySender({ server = 'https://ntfy.sh', topic, token }: { server?: string; topic: string; token?: string }, transport: typeof fetch = fetch): Send {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(topic)) throw new Error('NTFY_TOPIC must be 20–64 random letters, digits, - or _ (anyone who knows it can read the alerts).')
  const base = server.replace(/\/$/, '')
  if (!base.startsWith('https://')) throw new Error('NTFY_SERVER must use https.')
  // JSON publishing: titles such as "MSFT ▼5.4%" cannot travel in HTTP headers.
  return async ({ title, body, priority, tags }) => {
    const res = await transport(base, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ topic, title, message: body, priority, tags }),
    })
    if (!res.ok) throw new Error(`ntfy returned ${res.status}`)
  }
}

export function createRadarAlerts({ directory, getStock, send, now = () => new Date() }: { directory: string; getStock: () => Promise<StockSnapshot | null>; send: Send | null; now?: () => Date }) {
  const root = resolve(directory), path = resolve(root, 'alerts.json'), lockPath = path + '.lock'

  function read(): Store {
    try { lstatSync(path) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, episodes: [], lastReliableAt: null, digest: '' }; throw e }
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5_000_000) throw new Error('Radar alert store is not a regular file within the size limit.')
    const s = JSON.parse(readFileSync(path, 'utf8')) as Store
    if (s.schemaVersion !== 1 || !Array.isArray(s.episodes) ||
      (s.lastReliableAt !== undefined && s.lastReliableAt !== null && (typeof s.lastReliableAt !== 'string' || !Number.isFinite(Date.parse(s.lastReliableAt)))) ||
      s.digest !== hash({ schemaVersion: 1, episodes: s.episodes, ...(s.lastReliableAt === undefined ? {} : { lastReliableAt: s.lastReliableAt }) }))
      throw new Error('Radar alert store failed its integrity check; restore it before alerts resume.')
    return s
  }
  // Lock, change, write atomically, read back. Fails closed if another run holds the lock.
  function update(change: (episodes: Episode[], lastReliableAt: string | null) => Episode[], reliableAt?: string): Episode[] {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    let lock: number
    try { lock = openSync(lockPath, 'wx', 0o600) } catch { throw new Error('Radar alert store is locked by another run.') }
    let temp: string | null = null
    try {
      const previous = read()
      const episodes = change(previous.episodes, previous.lastReliableAt ?? null)
      const lastReliableAt = reliableAt ?? previous.lastReliableAt ?? null
      const encoded = JSON.stringify({ schemaVersion: 1, episodes, lastReliableAt,
        digest: hash({ schemaVersion: 1, episodes, lastReliableAt }) }, null, 2) + '\n'
      temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, encoded); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, path); temp = null
      if (readFileSync(path, 'utf8') !== encoded) throw new Error('Radar alert store readback failed.')
      return episodes
    } finally {
      if (temp && existsSync(temp)) unlinkSync(temp)
      closeSync(lock); unlinkSync(lockPath)
    }
  }

  async function deliver(episodes: Episode[]) {
    if (!send) return
    for (const e of episodes.filter(e => !e.resolvedAt && (e.kind !== 'degraded' || e.failureCount === undefined || e.failureCount >= 2) &&
      (e.delivery.status === 'pending' || (e.delivery.status === 'failed' && e.delivery.attempts < MAX_ATTEMPTS)))) {
      let error: string | null = null
      try { await send({ title: e.title, body: e.body, priority: PRIORITY[e.severity], tags: [e.kind === 'degraded' ? 'warning' : e.movePct! < 0 ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend'] }) }
      catch (err) { error = err instanceof Error ? err.message : 'Delivery failed' }
      const at = now().toISOString()
      update(list => list.map(x => x.id === e.id && x.updatedAt === e.updatedAt
        ? { ...x, delivery: { status: error ? 'failed' : 'delivered', attempts: x.delivery.attempts + 1, lastAttemptAt: at, error } } : x))
    }
  }

  let running: Promise<Awaited<ReturnType<typeof scan>>> | null = null
  /** One scan at a time: overlapping scans could deliver the same pending episode twice. */
  function check() {
    running ??= scan().finally(() => { running = null })
    return running
  }

  /** Record new or escalated episodes first, then deliver what is owed. */
  async function scan() {
    const stock = await getStock().catch(() => null)
    const at = now()
    const { alerts, covered, uncovered, stale } = ownedPositionAlerts(stock, at)
    const stamp = at.toISOString()
    let created = 0, escalated = 0
    const episodes = update((list, lastReliableAt) => {
      const next = [...list]
      const outage = next.findIndex(e => e.kind === 'degraded' && e.symbol === null && e.id.startsWith('degraded|source|') && !e.resolvedAt)
      if (!stock) {
        if (outage < 0) {
          next.push({
            id: `degraded|source|${stamp}|${next.length}`, kind: 'degraded', symbol: null, date: null,
            severity: 'MONITORING DEGRADED', movePct: null,
            title: 'Radar · StockStream unavailable',
            body: `Finance Manager cannot read StockStream. Owned-position monitoring is paused. Last reliable check: ${lastReliableAt ?? 'unknown'}. Check the StockStream connection; warnings resume after a successful read. Action: WAIT.`,
            createdAt: stamp, updatedAt: stamp, failureCount: 1, lastReliableAt,
            delivery: { status: 'pending', attempts: 0, lastAttemptAt: null, error: null },
          })
        } else {
          const e = next[outage]
          if ((e.failureCount ?? 0) < 2) {
            next[outage] = { ...e, failureCount: 2, updatedAt: stamp }
            created++
          }
        }
      } else if (outage >= 0) {
        next[outage] = { ...next[outage], resolvedAt: stamp }
      }
      for (const a of alerts) {
        const i = next.findIndex(e => e.id === a.id)
        if (i < 0) { next.push({ ...a, createdAt: stamp, updatedAt: stamp, delivery: { status: 'pending', attempts: 0, lastAttemptAt: null, error: null } }); created++ }
        else if (RANK[a.severity] > RANK[next[i].severity]) { next[i] = { ...next[i], ...a, updatedAt: stamp, delivery: { status: 'pending', attempts: 0, lastAttemptAt: null, error: null } }; escalated++ }
      }
      return next.slice(-2000)
    }, stock ? stamp : undefined)
    await deliver(episodes)
    return { checkedAt: stamp, sourceRead: !!stock, covered, uncovered, stale, created, escalated }
  }

  function status() {
    const episodes = read().episodes
    return {
      configured: !!send,
      failing: episodes.some(e => !e.resolvedAt && e.delivery.status === 'failed'),
      recent: episodes.filter(e => e.failureCount === undefined || e.failureCount >= 2).slice(-5).reverse()
        .map(e => ({ title: e.title, createdAt: e.createdAt, delivery: e.delivery.status })),
    }
  }

  async function sendTest() {
    if (!send) throw new Error('Phone alerts are not set up. Add NTFY_TOPIC to .env.local and restart.')
    await send({ title: 'Radar test · connection only', body: 'Finance Manager reached this phone. This is a manual delivery test, not a market signal. Live alerts will name the instrument, the observed change and the reason to review.', priority: 2, tags: ['white_check_mark'] })
  }

  return { check, status, sendTest }
}

// Runs a scan shortly after start and then hourly. Daily closes change once a
// day, and a replayed scan never resends an episode.
export function scheduleRadarAlerts(alerts: ReturnType<typeof createRadarAlerts>, log: (line: string) => void, everyMs = 3_600_000) {
  const run = () => alerts.check()
    .then(r => { if (r.created || r.escalated || !r.sourceRead) log(`Radar alerts: ${r.created} new, ${r.escalated} escalated${r.sourceRead ? '' : ', portfolio unreadable'}`) })
    .catch(e => log(`Radar alerts failed: ${e instanceof Error ? e.message : e}`))
  const first = setTimeout(run, 30_000)
  const timer = setInterval(run, everyMs)
  first.unref?.(); timer.unref?.()
  return () => { clearTimeout(first); clearInterval(timer) }
}
