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


function CapitalView({rent, stock}: {rent: RentSnapshot; stock: StockSnapshot | null}) {
  const surplus30d = rent.cashReceipts30dBdt - rent.expenses30dBdt
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">Business money</div><h2>What is free to invest</h2></div><span className="system-tag">policy</span></div>
    <div className="mini-grid">
      <div><span>Kept for 3 months of costs</span><strong>{bdt(rent.operatingReserveTargetBdt)}</strong></div>
      <div><span>Business cash that can be used</span><strong>{bdt(rent.allocationEligibleCashBdt)}</strong></div>
      <div><span>Free to invest</span><strong>{bdt(rent.strategicDeployableBdt)}</strong></div>
      <div><span>Family money (kept aside)</span><strong>{bdt(rent.familyRestrictedCashBdt)}</strong></div>
      <div><span>Family spending per month</span><strong>{bdt(rent.familyMonthlyProtectedOutflowBdt)}</strong></div>
      <div><span>Family money lasts</span><strong>{rent.familyRunwayMonths == null ? 'N/A' : `${rent.familyRunwayMonths.toFixed(1)} months`}</strong></div>
    </div>
    <p className="muted small">The operating reserve is three times RentStream's trailing 30-day expenses. Family-restricted and unclassified accounts are excluded from deployable capital. Tenant deposits revolve (departing tenants use them as their final rent) and are not deducted.</p>
    <div className="attention-list">
      <div className="attention-row">Trailing 30-day cash surplus: <strong>{bdt(surplus30d)}</strong>.</div>
      <div className="attention-row">Unclassified BDT cash held out of allocation: <strong>{bdt(rent.unclassifiedCashBdt)}</strong>.</div>
      <div className="attention-row">Core portfolio share: <strong>{stock?.corePct == null ? 'Unknown' : `${stock.corePct.toFixed(1)}%`}</strong>.</div>
    </div>
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
    {snapshotStale && <p className="safety-banner" role="status">These figures are more than an hour old. Open "Connections and data checks" and refresh.</p>}

    <section className="metrics-grid summary-grid">
      <MetricCard label="Cash in Canada" value={!rent && r.loading ? '…' : cad(rent?.treasuryCashCad)} note={canadianAccounts.length ? `${canadianAccounts.length} account${canadianAccounts.length === 1 ? '' : 's'} · as of ${canadianAccounts.map(a => a.balanceAsOf).sort()[0]}` : reading ? 'Reading…' : 'No Canadian account recorded'} />
      <MetricCard label="Bills in the next 30 days" value={personal ? cad(personal.bills.dueNext30DaysTotal) : '…'} note={nextBills.length ? nextBills.slice(0, 3).map(b => `${b.name} ${new Date(`${b.date}T00:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`).join(' · ') : 'No bills due'} tone={personal && rent?.treasuryCashCad != null && personal.bills.dueNext30DaysTotal > rent.treasuryCashCad ? 'warn' : undefined} />
      <MetricCard label="Spent this month" value={personal ? cad(personal.pace.thisMonth) : '…'} note={personal?.recordsSince ? `Last month by today: ${cad(personal.pace.lastMonthSameDay)}` : 'Log spending to see this'} />
      <MetricCard label="Business money free to invest" value={!rent && r.loading ? '…' : bdt(rent?.strategicDeployableBdt)} note={rent?.strategicDeployableBdt != null && fx ? `≈ ${cad(rent.strategicDeployableBdt / fx.rate)} · after card debt, 3 months of costs and family money` : 'After card debt, 3 months of costs and family money'} />
    </section>

    <AssistantPanel rent={rent} stock={stock} fx={fx} money={money} reading={reading} />
    <EverydayMoney money={money} treasury={rent?.treasury ?? []} error={moneyError} onChanged={loadMoney} />

    <details className="section-fold">
      <summary><span>How "free to invest" is worked out</span><span className="muted small">Reserves, family money and the rules</span></summary>
      {rent ? <section className="two-col"><CapitalView rent={rent} stock={stock ?? null} /><article className="panel"><div className="eyebrow">The rules</div><h2>Money gets a job before it gets invested</h2><ol className="input-gaps"><li>Keep three months of the business's recorded costs.</li><li>Keep family money out of what can be invested.</li><li>Leave out accounts whose purpose isn't set yet.</li><li>Only put money into a single stock when StockStream's Strike Radar clears it on its own.</li><li>Nothing moves money or makes a trade without your approval.</li></ol><p className="muted small">New surplus, once the rules above are met, splits 50% core / 25% strike reserve / 15% flexible / 10% free. Money already saved is not swept into that split automatically.</p></article></section> : <p className="muted">Needs RentStream.</p>}
    </details>
    <details className="section-fold" open={needsSetup}>
      <summary><span>Connections and data checks</span><span className="muted small">{issues.length ? `${issues.length} note${issues.length === 1 ? '' : 's'}` : 'All clear'}</span></summary>
      {permanent && <section className="two-col">
        {permanent.rentstream ? <PermanentConnection source="RentStream" /> : <Connection source="RentStream" client={clients.RentStream} onSession={rentSession} />}
        {permanent.stockstream ? <PermanentConnection source="StockStream" /> : <Connection source="StockStream" client={clients.StockStream} onSession={stockSession} />}
      </section>}
      <div className="refresh-row"><p className="muted small">RentStream read: {date(rent?.fetchedAt)}<br/>StockStream read: {date(stock?.fetchedAt)}<br/>Exchange rate: {fx ? `1 CAD = ৳${fx.rate.toFixed(2)} · ${fx.asOf} · ${fx.source}` : 'not available'}</p><button onClick={() => {r.refresh(); s.refresh()}} disabled={r.loading || s.loading || (!r.data && !s.data && !r.error && !s.error)}>{r.loading || s.loading ? 'Reading…' : 'Refresh'}</button></div>
      <div className="attention-list">{issues.length ? issues.map((issue,i) => <div className="attention-row" key={i}>{issue}</div>) : <p className="muted small">No data warnings.</p>}</div>
    </details>

    <footer>Finance Manager · cannot move money or place trades · reads RentStream and StockStream without changing them · saves only the bills, spending and draws you record</footer>
  </main>
}
