import { useCallback, useEffect, useMemo, useState } from 'react'
import { clients } from './client'
import Connection from './Connections'
import AssistantPanel from '../assistant/AssistantPanel'
import type { FxReference } from '../books/overview'
import EverydayMoney, { type MoneyState } from '../money/EverydayMoney'
import { buildPersonalBooks } from '../books/personal'
import { MetricCard } from '../components/MetricCard'
import { ReadOnlyRentStreamAdapter } from './rentstream'
import { ReadOnlyStockStreamAdapter } from './stockstream'
import { useSnapshot } from './useSnapshot'
import { isStale, type RentSnapshot, type StockSnapshot } from './models'

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
// Taka in lakh grouping (৳12,34,567), poisha only when present.
const bdt = (n: number | null | undefined) => {
  if (n == null) return 'Unknown'
  const hasPoisha = !Number.isInteger(Math.round(n * 100) / 100)
  return `৳${n.toLocaleString('en-IN', {minimumFractionDigits: hasPoisha ? 2 : 0, maximumFractionDigits: hasPoisha ? 2 : 0})}`
}
const cad = (n: number | null | undefined) => n == null ? 'Unknown' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (s: string | null | undefined) => s ? new Date(s).toLocaleString() : 'Not recorded'

function PermanentConnection({ source }: { source: string }) {
  return <article className="panel connection"><div className="panel-heading"><h2>{source}</h2><span className="system-tag">CONNECTED</span></div><p className="muted small">Connected permanently through this Mac's local server. No sign-in needed; figures refresh every hour or when you press Refresh.</p></article>
}


function SimplePortfolio({ stock }: { stock: StockSnapshot | null }) {
  const holdings = (stock?.holdings ?? []).filter(h => h.role !== 'cash' && (h.shares !== 0 || (h.valueCad ?? 0) !== 0))
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">StockStream</div><h2>Your investments</h2></div><span className="system-tag">SIMPLE</span></div>
    <div className="mini-grid">
      <div><span>Total</span><strong>{cad(stock?.portfolioCad)}</strong></div>
      <div><span>Cash ready</span><strong>{cad(stock?.cashCad)}</strong></div>
      <div><span>XEQT core</span><strong>{stock?.corePct == null ? 'Unknown' : `${stock.corePct.toFixed(0)}%`}</strong></div>
    </div>
    <div className="attention-list">
      {holdings.map(h => <div className="attention-row" key={h.symbol}><strong>{h.symbol.replace('.NE','').replace('.TO','')}</strong> · {h.shares.toLocaleString('en-US', {maximumFractionDigits: 4})} shares · {cad(h.valueCad)}</div>)}
      {!holdings.length && <p className="muted small">No investments to show yet.</p>}
    </div>
    <p className="muted small">That is the useful bit. Prices, CDR checks, cost-basis maths and data-quality checks still run underneath.</p>
  </article>
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
  useEffect(() => { loadMoney(); const timer = setInterval(loadMoney, 3_600_000); return () => clearInterval(timer) }, [loadMoney])
  // Daily CAD/BDT reference rate from the local server; re-checked hourly.
  useEffect(() => {
    const load = () => fetch('/api/fx').then(r => r.ok ? r.json() : null).then(rate => setFx(current => rate && (current?.rate !== rate.rate || current?.asOf !== rate.asOf) ? rate : current)).catch(() => {})
    load()
    const timer = setInterval(load, 3_600_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => { fetch('/api/sources').then(r => r.ok ? r.json() : null).then(setPermanent).catch(() => setPermanent({ rentstream: false, stockstream: false })) }, [])
  const r = useSnapshot(permanent?.rentstream ? PERMANENT_USER : permanent ? rentUser : null, permanent?.rentstream ? permanentRent : rentAdapter)
  const s = useSnapshot(permanent?.stockstream ? PERMANENT_USER : permanent ? stockUser : null, permanent?.stockstream ? permanentStock : stockAdapter)
  const { refresh: refreshRent } = r, { refresh: refreshStock } = s
  useEffect(() => { const timer = setInterval(() => setNow(new Date()),60_000); return () => clearInterval(timer) }, [])
  // Permanently connected figures stay current on their own: re-read hourly.
  useEffect(() => {
    if (!permanent?.rentstream && !permanent?.stockstream) return
    const timer = setInterval(() => { if (permanent.rentstream) refreshRent(); if (permanent.stockstream) refreshStock() }, 3_600_000)
    return () => clearInterval(timer)
  }, [permanent, refreshRent, refreshStock])
  const rent = r.data, stock = s.data
  const reading = r.loading || s.loading
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const snapshotStale = [rent?.fetchedAt, stock?.fetchedAt].some(t => t && isStale(t, now, 1/24))
  const personal = useMemo(() => money ? buildPersonalBooks(money, now, rent?.treasury ?? []) : null, [money, now, rent])
  const canadianAccounts = (rent?.treasury ?? []).filter(a => a.currency === 'CAD')
  const nextBills = personal?.bills.dueNext30Days ?? []
  const needsSetup = permanent !== null && (!(permanent.rentstream || rentUser) || !(permanent.stockstream || stockUser))
  return <main className="shell">
    <header className="topbar"><div className="brand">FINANCE MANAGER</div></header>
    {r.error && <p className="panel error" role="alert">Could not read RentStream: {r.error}</p>}
    {s.error && <p className="panel error" role="alert">Could not read StockStream: {s.error}</p>}
    {snapshotStale && <p className="safety-banner" role="status">Some numbers may be old. Tap Data & connections below to refresh.</p>}

    <section className="metrics-grid summary-grid">
      <MetricCard label="Money in Canada" value={!rent && r.loading ? '…' : cad(rent?.treasuryCashCad)} note="Cash you can see in your Canadian accounts" />
      <MetricCard label="Investments" value={!stock && s.loading ? '…' : cad(stock?.portfolioCad)} note="Your StockStream portfolio today" />
      <MetricCard label="Bills coming up" value={personal ? cad(personal.bills.dueNext30DaysTotal) : '…'} note={nextBills.length ? `${nextBills.length} bill${nextBills.length === 1 ? '' : 's'} in the next 30 days` : 'Nothing recorded as due'} tone={personal && rent?.treasuryCashCad != null && personal.bills.dueNext30DaysTotal > rent.treasuryCashCad ? 'warn' : undefined} />
      <MetricCard label="Safe to invest" value={!rent && r.loading ? '…' : bdt(rent?.strategicDeployableBdt)} note="After keeping protected money aside" />
    </section>

    <AssistantPanel rent={rent} stock={stock} fx={fx} money={money} reading={reading} />

    <section className="two-col">
      <SimplePortfolio stock={stock ?? null} />
      <article className="panel">
        <div className="eyebrow">Finance Manager</div><h2>What matters right now</h2>
        <div className="attention-list">
          <div className="attention-row">Spent this month: <strong>{personal ? cad(personal.pace.thisMonth) : 'Unknown'}</strong></div>
          <div className="attention-row">Rent still to collect: <strong>{bdt(rent?.outstandingBdt)}</strong></div>
          <div className="attention-row">Safe to invest: <strong>{bdt(rent?.strategicDeployableBdt)}</strong></div>
          <div className="attention-row">Data problems: <strong>{issues.length ? issues.length : 'None'}</strong></div>
        </div>
        <p className="muted small">Ask Finance Manager anything in plain English. The complicated accounting stays underneath.</p>
      </article>
    </section>

    <details className="section-fold">
      <summary><span>Money details</span><span className="muted small">Only open this when you need the receipts</span></summary>
      <EverydayMoney money={money} treasury={rent?.treasury ?? []} error={moneyError} onChanged={loadMoney} />
    </details>
    <details className="section-fold" open={needsSetup}>
      <summary><span>Data & connections</span><span className="muted small">{issues.length ? `${issues.length} note${issues.length === 1 ? '' : 's'}` : 'All clear'}</span></summary>
      {permanent && <section className="two-col">
        {permanent.rentstream ? <PermanentConnection source="RentStream" /> : <Connection source="RentStream" client={clients.RentStream} onSession={rentSession} />}
        {permanent.stockstream ? <PermanentConnection source="StockStream" /> : <Connection source="StockStream" client={clients.StockStream} onSession={stockSession} />}
      </section>}
      <div className="refresh-row"><p className="muted small">RentStream read: {date(rent?.fetchedAt)}<br/>StockStream read: {date(stock?.fetchedAt)}<br/>Exchange rate: {fx ? `1 CAD = ৳${fx.rate.toFixed(2)} · ${fx.asOf} · ${fx.source}` : 'not available'}</p><button onClick={() => {r.refresh(); s.refresh()}} disabled={r.loading || s.loading || (!r.data && !s.data && !r.error && !s.error)}>{r.loading || s.loading ? 'Reading…' : 'Refresh'}</button></div>
      <div className="attention-list">{issues.length ? issues.map((issue,i) => <div className="attention-row" key={i}>{issue}</div>) : <p className="muted small">No data warnings.</p>}</div>
    </details>

    <footer>Finance Manager · simple on top, careful underneath · never moves money or places trades</footer>
  </main>
}
