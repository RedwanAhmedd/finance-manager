import { useCallback, useEffect, useState } from 'react'
import { clients } from './client'
import Connection from './Connections'
import { SafetyBanner } from '../components/SafetyBanner'
import AssistantPanel from '../assistant/AssistantPanel'
import type { FxReference } from '../books/overview'
import EverydayMoney, { type MoneyState } from '../money/EverydayMoney'
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
const bdt = (n: number | null | undefined) => n == null ? 'Unknown' : new Intl.NumberFormat('en-BD', {style:'currency', currency:'BDT', maximumFractionDigits:2}).format(n)
const cad = (n: number | null | undefined) => n == null ? 'Unknown' : new Intl.NumberFormat('en-CA', {style:'currency', currency:'CAD', maximumFractionDigits:2}).format(n)
const date = (s: string | null | undefined) => s ? new Date(s).toLocaleString() : 'Not recorded'

function PermanentConnection({ source }: { source: string }) {
  return <article className="panel connection"><div className="panel-heading"><h2>{source}</h2><span className="system-tag">CONNECTED</span></div><p className="muted small">Connected permanently through this Mac's local server. No sign-in needed; figures refresh every hour or when you press Refresh.</p></article>
}

function RentView({ rent }: {rent: RentSnapshot}) {
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">RentStream · {rent.month}</div><h2>Income & treasury</h2></div><span className="system-tag">BDT</span></div>
    <div className="mini-grid">
      <div><span>Billed rent + utilities</span><strong>{bdt(rent.expectedBdt)}</strong></div>
      <div><span>Settled against this month's bills</span><strong>{bdt(rent.collectedBdt)}</strong></div>
      <div><span>Unpaid from this month's bills</span><strong>{bdt(rent.outstandingBdt)}</strong></div>
      <div><span>Overdue from earlier months{rent.overdueSince ? ` · since ${rent.overdueSince}` : ''}</span><strong>{bdt(rent.overdueBdt)}</strong></div>
      <div><span>Total owed by tenants · rent + utilities</span><strong>{bdt(rent.outstandingBdt + rent.overdueBdt)}</strong></div>
      <div><span>Cash rent receipts · last 30 days</span><strong>{bdt(rent.cashReceipts30dBdt)}</strong></div>
      <div><span>Recorded expenses · last 30 days</span><strong>{bdt(rent.expenses30dBdt)}</strong></div>
      <div><span>Tenant deposits held</span><strong>{bdt(rent.refundableDepositsBdt)}</strong></div>
    </div>
    <p className="muted small">Tenant deposits revolve: departing tenants normally use theirs as their final two months of rent, and new tenants bring new deposits. Bill settlements can include deposit applications; cash receipts are shown separately.</p>
    <div className="account-list">{rent.banks.map(b => <div className="account-row" key={b.id}><div><strong>{b.name}</strong><div className="muted">{b.type === 'credit_card' ? 'Credit card · excluded from liquid cash' : 'Bank account'} · statement anchor {b.anchorDate ?? 'unknown'}</div></div><div className="right"><strong>{bdt(b.balance)}</strong><div className="muted">{b.type === 'credit_card' ? 'signed card balance' : 'statement + later movements'}</div></div></div>)}</div>
    <p className="muted small">Ledger cash through {rent.businessDate}. Last physical count: {rent.cashCountDate ?? 'not recorded'}.</p>
  </article>
}
function StockView({stock}: {stock: StockSnapshot}) {
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">StockStream</div><h2>Investment holdings</h2></div><span className="system-tag">CAD</span></div>
    <div className="mini-grid">
      <div><span>Portfolio · includes recorded cash</span><strong>{cad(stock.portfolioCad)}</strong></div>
      <div><span>Invested holdings</span><strong>{cad(stock.investedCad)}</strong></div>
      <div><span>Core share of portfolio</span><strong>{stock.corePct === null ? 'Unknown' : `${stock.corePct.toFixed(1)}%`}</strong></div>
      <div><span>Recorded YTD contributions</span><strong>{cad(stock.contributedYtdCad)}</strong></div>
    </div>
    <div className="holdings-table-wrap"><table className="holdings-table"><thead><tr><th>Holding</th><th>Value (CAD)</th><th>Price basis / date</th></tr></thead><tbody>{stock.holdings.map(h => <tr key={h.symbol}><td><strong>{h.symbol}</strong><div className="muted small">{h.shares.toLocaleString(undefined,{maximumFractionDigits:6})} · {h.role}</div></td><td>{cad(h.valueCad)}</td><td>{h.priceSource}<div className="muted small">{h.asOf?.slice(0,10) ?? 'unknown'}</div></td></tr>)}</tbody></table></div>
    <p className="muted small">Holdings with a trade history use the remaining shares from that history. Receipt prices preserve their source labels. USD holdings use StockStream's dated USD/CAD rate.</p>
  </article>
}

export default function LiveDashboard({ onDemo }: { onDemo: () => void }) {
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
  const cashBdt = rent?.bankCashBdt != null && rent.operatingCashBdt !== null ? rent.bankCashBdt + rent.operatingCashBdt : null
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const snapshotStale = [rent?.fetchedAt, stock?.fetchedAt].some(t => t && isStale(t, now, 1/24))
  return <main className="shell">
    <header className="topbar"><div><div className="brand">FINANCE MANAGER</div><div className="muted">Your everyday money, rental business and investments · v0.4</div></div><button onClick={onDemo}>View demo</button></header>
    <SafetyBanner />
    <section className="hero panel"><div><div className="eyebrow">{reading ? 'Refreshing source records' : rent && stock ? 'Live source reads' : 'Connect your sources'}</div><h1>Your financial picture, together.</h1><p className="muted">Balances come from RentStream and StockStream. Their record dates remain visible; fetching a record does not make an old balance current.</p></div><span className="status status-watch">{reading ? 'Reading' : rent && stock ? 'Review data gaps' : 'Setup'}</span></section>
    {permanent && <details className="connections" open={!(permanent.rentstream || rentUser) || !(permanent.stockstream || stockUser)}><summary>Source connections</summary><section className="two-col">
      {permanent.rentstream ? <PermanentConnection source="RentStream" /> : <Connection source="RentStream" client={clients.RentStream} onSession={rentSession} />}
      {permanent.stockstream ? <PermanentConnection source="StockStream" /> : <Connection source="StockStream" client={clients.StockStream} onSession={stockSession} />}
    </section></details>}
    <div className="refresh-row"><p className="muted small">RentStream read: {date(rent?.fetchedAt)}<br/>StockStream read: {date(stock?.fetchedAt)}<br/>CAD/BDT reference: {fx ? `1 CAD = ৳${fx.rate.toFixed(2)} · ${fx.asOf} · ${fx.source}` : 'not available'}</p><button onClick={() => {r.refresh(); s.refresh()}} disabled={r.loading || s.loading || (!r.data && !s.data && !r.error && !s.error)}>{r.loading || s.loading ? 'Reading sources…' : 'Refresh source data'}</button></div>
    {r.error && <p className="panel error" role="alert">RentStream read failed: {r.error}. Its figures have been cleared.</p>}
    {s.error && <p className="panel error" role="alert">StockStream read failed: {s.error}. Its figures have been cleared.</p>}
    {snapshotStale && <p className="safety-banner" role="status">This snapshot is more than one hour old. Refresh before using its figures.</p>}
    <AssistantPanel rent={rent} stock={stock} fx={fx} money={money} reading={reading} />
    <EverydayMoney money={money} error={moneyError} onChanged={loadMoney} />
    <section className="metrics-grid">
      <MetricCard label="Recorded cash · Bangladesh" value={bdt(cashBdt)} note="Bank balances + operating cash; excludes card credit" />
      <MetricCard label="Operating cash · ledger" value={bdt(rent?.operatingCashBdt)} note={rent?.cashCountDate ? `Last physical count ${rent.cashCountDate}` : 'No verified physical count available'} />
      <MetricCard label="Brokerage cash · recorded" value={cad(stock?.cashCad)} note={stock?.cashAsOf ? `Record ${stock.cashAsOf.slice(0,10)}${isStale(stock.cashAsOf,now) ? ' · STALE' : ''}` : 'Connect StockStream to read its cash position'} tone={stock && isStale(stock.cashAsOf,now) ? 'warn' : undefined} />
      <MetricCard label="Credit-card debt" value={bdt(rent?.cardDebtBdt)} note="Amount owed; kept separate from liquid cash" />
    </section>
    <section className="two-col">{rent ? <RentView rent={rent} /> : <article className="panel"><h2>RentStream</h2><p className="muted">{r.loading ? 'Reading accounts and reconciliation…' : 'Connect RentStream to see actual income and treasury data.'}</p></article>}{stock ? <StockView stock={stock}/> : <article className="panel"><h2>StockStream</h2><p className="muted">{s.loading ? 'Reading holdings and quotes…' : 'Connect StockStream to see actual investments.'}</p></article>}</section>
    <section>
      <article className="panel"><div className="eyebrow">Source evidence</div><h2>What needs attention</h2><div className="attention-list">{issues.length ? issues.map((issue,i) => <div className="attention-row" key={i}>{issue}</div>) : <p className="muted">Connect your sources to inspect data coverage and freshness.</p>}</div></article>
    </section>
    <footer>Finance Manager v0.4 · reads your sources and keeps your personal records · no transfers, payments or trades</footer>
  </main>
}
