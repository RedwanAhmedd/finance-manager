import { useCallback, useEffect, useMemo, useState } from 'react'
import { clients } from './client'
import Connection from './Connections'
import AssistantPanel from '../assistant/AssistantPanel'
import RadarPanel from '../radar/RadarPanel'
import type { FxReference } from '../books/overview'
import EverydayMoney, { type MoneyState } from '../money/EverydayMoney'
import { buildPersonalBooks, type PersonalBooks } from '../books/personal'
import { MetricCard } from '../components/MetricCard'
import { ReadOnlyRentStreamAdapter } from './rentstream'
import { ReadOnlyStockStreamAdapter } from './stockstream'
import { useSnapshot } from './useSnapshot'
import { isStale, type RentSnapshot, type StockSnapshot } from './models'
import { ago, bdt, cad, dateTime, pct } from '../format'

const rentAdapter = clients.RentStream ? new ReadOnlyRentStreamAdapter(clients.RentStream) : null
const stockAdapter = clients.StockStream ? new ReadOnlyStockStreamAdapter(clients.StockStream) : null

// Sources the local server reads with its own key: no sign-in on this page.
type Permanent = { rentstream: boolean; stockstream: boolean }
function serverAdapter<T>(name: 'rentstream' | 'stockstream') {
  return { getSnapshot: async (): Promise<T> => {
    const res = await fetch(`/api/sources/${name}`)
    const body = await res.json().catch(() => ({ error: `Source read failed (${res.status})` }))
    if (!res.ok) throw new Error(body.error ?? `Source read failed (${res.status})`)
    return body as T
  } }
}
const permanentRent = serverAdapter<RentSnapshot>('rentstream')
const permanentStock = serverAdapter<StockSnapshot>('stockstream')
const PERMANENT_USER = 'permanent connection'
const HOUR = 3_600_000

function PermanentConnection({ source }: { source: string }) {
  return <article className="panel connection">
    <div className="panel-heading"><h2>{source}</h2><span className="chip chip-good">Connected</span></div>
    <p className="muted small">Connected permanently through this Mac's local server. No sign-in needed; figures refresh every hour or when you press Refresh.</p>
  </article>
}

function Portfolio({ stock, loading }: { stock: StockSnapshot | null; loading: boolean }) {
  const total = stock?.portfolioCad ?? null
  const holdings = (stock?.holdings ?? [])
    .filter(h => h.role !== 'cash' && (h.shares !== 0 || (h.valueCad ?? 0) !== 0))
    .sort((a, b) => (b.valueCad ?? -1) - (a.valueCad ?? -1))
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">StockStream</div><h2>Your investments</h2></div></div>
    <div className="stat-row">
      <div><span>Total</span><strong>{loading ? '…' : cad(total)}</strong></div>
      <div><span>Cash ready</span><strong>{loading ? '…' : cad(stock?.cashCad)}</strong></div>
      <div><span>XEQT core</span><strong>{loading ? '…' : pct(stock?.corePct)}</strong></div>
    </div>
    <ul className="holdings">
      {holdings.map(h => {
        const share = total && h.valueCad != null ? (h.valueCad / total) * 100 : null
        return <li key={h.symbol}>
          <div className="holding-line">
            <strong>{h.symbol.replace(/\.(NE|TO)$/, '')}</strong>
            <span className="muted">{h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh</span>
            <span className="num">{cad(h.valueCad)}</span>
          </div>
          <div className="bar" role="img" aria-label={share == null ? 'Share of portfolio unknown' : `${share.toFixed(1)}% of portfolio`}>
            <span style={{ width: `${Math.max(0, Math.min(100, share ?? 0))}%` }} />
          </div>
        </li>
      })}
      {!holdings.length && !loading && <li className="muted small">No investments to show yet.</li>}
    </ul>
  </article>
}

// Spending so far against last month by the same day: one bar, one sentence.
function ThisMonth({ personal, rent }: { personal: PersonalBooks | null; rent: RentSnapshot | null }) {
  const pace = personal?.pace
  const last = pace?.lastMonthSameDay ?? null
  const ratio = pace && last ? pace.thisMonth / last : null
  const verdict = ratio == null ? null : ratio > 1.1 ? 'ahead of' : ratio < 0.9 ? 'behind' : 'about level with'
  const bills = personal?.bills.dueNext30Days.slice(0, 3) ?? []
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">This month</div><h2>{pace ? cad(pace.thisMonth) : 'Unknown'} <span className="h2-sub">spent</span></h2></div></div>
    {ratio != null && <>
      <div className={`bar bar-pace ${ratio > 1.1 ? 'bar-warn' : 'bar-good'}`} role="img" aria-label={`${Math.round(ratio * 100)}% of last month by day ${pace!.day}`}>
        <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        {ratio > 1 && <i style={{ left: `${100 / ratio}%` }} />}
      </div>
      <p className="muted small">You're {verdict} last month ({cad(last)} by day {pace!.day}).</p>
    </>}
    <dl className="kv">
      <Row label="Rent still to collect" value={bdt(rent?.outstandingBdt)} tone={rent?.overdueBdt ? 'warn' : undefined} />
      {bills.map(b => <Row key={`${b.name}-${b.date}`} label={`${b.name} · due ${new Date(`${b.date}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`} value={cad(b.amount)} />)}
    </dl>
  </article>
}

const greeting = (d: Date) => d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening'

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'good' }) {
  return <div className="kv-row"><dt>{label}</dt><dd className={tone ? `tone-${tone}` : undefined}>{value}</dd></div>
}

export default function LiveDashboard() {
  const [rentUser, setRentUser] = useState<string | null>(null)
  const [stockUser, setStockUser] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const rentSession = useCallback((user: string | null) => setRentUser(user), [])
  const stockSession = useCallback((user: string | null) => setStockUser(user), [])
  const [permanent, setPermanent] = useState<Permanent | null>(null)
  const [fx, setFx] = useState<FxReference | null>(null)
  const [money, setMoney] = useState<MoneyState>(null)
  const [moneyError, setMoneyError] = useState('')
  // Personal money records, kept by the local server; reloaded after every change.
  const loadMoney = useCallback(() => {
    fetch('/api/money').then(async res => {
      const body = await res.json().catch(() => ({ error: `Personal money read failed (${res.status})` }))
      if (!res.ok) throw new Error(body.error)
      setMoney(body); setMoneyError('')
    }).catch(error => setMoneyError(error instanceof Error ? error.message : 'Personal money read failed'))
  }, [])
  useEffect(() => { loadMoney(); const timer = setInterval(loadMoney, HOUR); return () => clearInterval(timer) }, [loadMoney])
  // Daily CAD/BDT reference rate from the local server; re-checked hourly.
  useEffect(() => {
    const load = () => fetch('/api/fx').then(r => r.ok ? r.json() : null).then(rate => setFx(current => rate && (current?.rate !== rate.rate || current?.asOf !== rate.asOf) ? rate : current)).catch(() => {})
    load()
    const timer = setInterval(load, HOUR)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => { fetch('/api/sources').then(r => r.ok ? r.json() : null).then(setPermanent).catch(() => setPermanent({ rentstream: false, stockstream: false })) }, [])
  const r = useSnapshot(permanent?.rentstream ? PERMANENT_USER : permanent ? rentUser : null, permanent?.rentstream ? permanentRent : rentAdapter)
  const s = useSnapshot(permanent?.stockstream ? PERMANENT_USER : permanent ? stockUser : null, permanent?.stockstream ? permanentStock : stockAdapter)
  const { refresh: refreshRent } = r, { refresh: refreshStock } = s
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer) }, [])
  // Permanently connected figures stay current on their own: re-read hourly.
  useEffect(() => {
    if (!permanent?.rentstream && !permanent?.stockstream) return
    const timer = setInterval(() => { if (permanent.rentstream) refreshRent(); if (permanent.stockstream) refreshStock() }, HOUR)
    return () => clearInterval(timer)
  }, [permanent, refreshRent, refreshStock])

  const rent = r.data, stock = s.data
  const reading = r.loading || s.loading
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const snapshotStale = [rent?.fetchedAt, stock?.fetchedAt].some(t => t && isStale(t, now, 1 / 24))
  // Recomputed only when the records change, not on every minute tick; the
  // Canadian calendar day is what matters here.
  const today = now.toDateString()
  const personal = useMemo(() => money ? buildPersonalBooks(money, new Date(), rent?.treasury ?? []) : null, [money, rent, today])
  const nextBills = personal?.bills.dueNext30Days ?? []
  const needsSetup = permanent !== null && (!(permanent.rentstream || rentUser) || !(permanent.stockstream || stockUser))
  const lastRead = [rent?.fetchedAt, stock?.fetchedAt].filter((t): t is string => !!t).sort()[0]
  const canRefresh = !reading && !!(r.data || s.data || r.error || s.error)
  const refreshAll = () => { r.refresh(); s.refresh(); loadMoney() }
  const billsTone = personal && rent?.treasuryCashCad != null && personal.bills.dueNext30DaysTotal > rent.treasuryCashCad ? 'warn' : undefined

  return <main className="shell">
    <header className="topbar">
      <div>
        <div className="brand"><span className="brand-mark" aria-hidden="true">F</span>Finance Manager</div>
        <h1 className="greeting">{greeting(now)}</h1>
      </div>
      <div className="topbar-actions">
        <span className={`chip ${reading ? '' : snapshotStale || r.error || s.error ? 'chip-warn' : lastRead ? 'chip-good' : ''}`} role="status">
          {reading ? 'Reading sources…' : lastRead ? `Updated ${ago(lastRead, now)}` : 'Not connected'}
        </span>
        <button onClick={refreshAll} disabled={!canRefresh}>{reading ? 'Reading…' : 'Refresh'}</button>
      </div>
    </header>

    {r.error && <p className="banner banner-bad" role="alert">Could not read RentStream: {r.error}</p>}
    {s.error && <p className="banner banner-bad" role="alert">Could not read StockStream: {s.error}</p>}
    {snapshotStale && !reading && <p className="banner banner-warn" role="status">Some figures are over an hour old. Press Refresh to read them again.</p>}

    <section className="metrics-grid" aria-label="Summary">
      <MetricCard label="Money in Canada" loading={!rent && r.loading} value={cad(rent?.treasuryCashCad)} note="Cash in your Canadian accounts" />
      <MetricCard label="Investments" loading={!stock && s.loading} value={cad(stock?.portfolioCad)} note="StockStream portfolio" />
      <MetricCard label="Bills coming up" loading={!personal && !moneyError} value={personal ? cad(personal.bills.dueNext30DaysTotal) : 'Unknown'}
        note={nextBills.length ? `${nextBills.length} bill${nextBills.length === 1 ? '' : 's'} in the next 30 days` : 'Nothing recorded as due'} tone={billsTone} />
      <MetricCard label="Safe to invest" loading={!rent && r.loading} value={bdt(rent?.strategicDeployableBdt)} note="After protected money is set aside" tone={rent?.strategicDeployableBdt ? 'good' : undefined} />
    </section>

    <RadarPanel />
    <AssistantPanel rent={rent} stock={stock} fx={fx} money={money} reading={reading} />

    <section className="two-col">
      <Portfolio stock={stock} loading={!stock && s.loading} />
      <ThisMonth personal={personal} rent={rent} />

    </section>

    <details className="section-fold">
      <summary><span>Money details</span><span className="muted small">Spending, bills, draws and balances</span></summary>
      <EverydayMoney money={money} books={personal} error={moneyError} onChanged={loadMoney} />
    </details>
    <details className="section-fold" open={needsSetup}>
      <summary><span>Data & connections</span><span className={`small ${issues.length ? 'tone-warn' : 'muted'}`}>{issues.length ? `${issues.length} note${issues.length === 1 ? '' : 's'}` : 'All clear'}</span></summary>
      {permanent && <section className="two-col">
        {permanent.rentstream ? <PermanentConnection source="RentStream" /> : <Connection source="RentStream" client={clients.RentStream} onSession={rentSession} />}
        {permanent.stockstream ? <PermanentConnection source="StockStream" /> : <Connection source="StockStream" client={clients.StockStream} onSession={stockSession} />}
      </section>}
      <dl className="kv">
        <Row label="RentStream read" value={dateTime(rent?.fetchedAt)} />
        <Row label="StockStream read" value={dateTime(stock?.fetchedAt)} />
        <Row label="Exchange rate" value={fx ? `1 CAD = ৳${fx.rate.toFixed(2)} · ${fx.asOf}` : 'Not available'} />
      </dl>
      {fx && <p className="muted small">Rate source: {fx.source}. A market reference, not a transfer rate.</p>}
      <ul className="notes">{issues.length ? issues.map((issue, i) => <li key={i}>{issue}</li>) : <li className="muted">No data warnings.</li>}</ul>
    </details>

    <footer>Finance Manager · read-only on your sources · saves only your research, bills, spending and draws · never moves money or places trades</footer>
  </main>
}
