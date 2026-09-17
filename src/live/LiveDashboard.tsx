import { useCallback, useEffect, useMemo, useState } from 'react'
import { clients } from './client'
import Connection from './Connections'
import AssistantPanel from '../assistant/AssistantPanel'
import type { FxReference } from '../books/overview'
import EverydayMoney, { type MoneyState } from '../money/EverydayMoney'
import { buildPersonalBooks } from '../books/personal'
import { sampleFx, sampleMoney, sampleRent, sampleStock } from '../demo/sample'
import { MetricCard } from '../components/MetricCard'
import { ReadOnlyRentStreamAdapter } from './rentstream'
import { ReadOnlyStockStreamAdapter } from './stockstream'
import { useSnapshot } from './useSnapshot'
import { isStale, type BankFinancialRole, type RentSnapshot, type StockSnapshot } from './models'

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
// The demo runs the same page on made-up records built by the same normalisers.
const demoRent = { getSnapshot: async () => sampleRent() }
const demoStock = { getSnapshot: async () => sampleStock() }
const DEMO_USER = 'sample data'
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

const roleLabel: Record<BankFinancialRole, string> = {
  corporate_operating: 'Business operating',
  savings: 'Savings',
  family_restricted: 'Family money',
  personal: 'Personal',
  unclassified: 'Purpose not set',
}

function RentView({ rent }: {rent: RentSnapshot}) {
  const treasury = rent.treasury ?? []
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">RentStream · {rent.month}</div><h2>Rent and bank accounts</h2></div><span className="system-tag">BDT</span></div>
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
    <div className="account-list">{rent.banks.map(b => <div className="account-row" key={b.id}><div><strong>{b.name}</strong><div className="muted">{b.type === 'credit_card' ? 'Credit card · excluded from liquid cash' : roleLabel[b.financialRole]} · statement anchor {b.anchorDate ?? 'unknown'}</div>{b.monthlyProtectedOutflow > 0 && <div className="muted small">Protected monthly outflow {bdt(b.monthlyProtectedOutflow)}</div>}</div><div className="right"><strong>{bdt(b.balance)}</strong><div className="muted">{b.type === 'credit_card' ? 'signed card balance' : 'statement + later movements'}</div></div></div>)}</div>
    {treasury.length > 0 && <>
      <div className="eyebrow" style={{marginTop:'1rem'}}>Canadian bank accounts</div>
      <div className="account-list">{treasury.map(a => <div className="account-row" key={a.id}><div><strong>{a.name}</strong><div className="muted">{a.institution ?? a.country} · balance snapshot {a.balanceAsOf}</div></div><div className="right"><strong>{a.currency === 'CAD' ? cad(a.balance) : bdt(a.balance)}</strong><div className="muted">{a.currency}</div></div></div>)}</div>
    </>}
    <p className="muted small">Ledger cash through {rent.businessDate}. Last physical count: {rent.cashCountDate ?? 'not recorded'}.</p>
  </article>
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

export default function LiveDashboard({ demo, onToggleDemo }: { demo: boolean; onToggleDemo: () => void }) {
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
    if (demo) { setMoney(sampleMoney()); setMoneyError(''); return }
    fetch('/api/money').then(async res => {
      const body = await res.json().catch(() => ({ error: `Personal money read failed (${res.status})` }))
      if (!res.ok) throw new Error(body.error)
      setMoney(body); setMoneyError('')
    }).catch(error => setMoneyError(error instanceof Error ? error.message : 'Personal money read failed'))
  }, [demo])
  useEffect(() => { loadMoney(); const timer = setInterval(loadMoney, 3_600_000); return () => clearInterval(timer) }, [loadMoney])
  // Daily CAD/BDT reference rate from the local server; re-checked hourly.
  useEffect(() => {
    if (demo) { setFx(sampleFx()); return }
    const load = () => fetch('/api/fx').then(r => r.ok ? r.json() : null).then(rate => setFx(current => rate && (current?.rate !== rate.rate || current?.asOf !== rate.asOf) ? rate : current)).catch(() => {})
    load()
    const timer = setInterval(load, 3_600_000)
    return () => clearInterval(timer)
  }, [demo])
  useEffect(() => { if (demo) return; fetch('/api/sources').then(r => r.ok ? r.json() : null).then(setPermanent).catch(() => setPermanent({ rentstream: false, stockstream: false })) }, [])
  const r = useSnapshot(demo ? DEMO_USER : permanent?.rentstream ? PERMANENT_USER : permanent ? rentUser : null, demo ? demoRent : permanent?.rentstream ? permanentRent : rentAdapter)
  const s = useSnapshot(demo ? DEMO_USER : permanent?.stockstream ? PERMANENT_USER : permanent ? stockUser : null, demo ? demoStock : permanent?.stockstream ? permanentStock : stockAdapter)
  const { refresh: refreshRent } = r, { refresh: refreshStock } = s
  useEffect(() => { const timer = setInterval(() => setNow(new Date()),60_000); return () => clearInterval(timer) }, [])
  // Permanently connected figures stay current on their own: re-read hourly.
  useEffect(() => {
    if (demo || (!permanent?.rentstream && !permanent?.stockstream)) return
    const timer = setInterval(() => { if (permanent.rentstream) refreshRent(); if (permanent.stockstream) refreshStock() }, 3_600_000)
    return () => clearInterval(timer)
  }, [demo, permanent, refreshRent, refreshStock])
  const rent = r.data, stock = s.data
  const reading = r.loading || s.loading
  const cashBdt = rent?.bankCashBdt != null && rent.operatingCashBdt !== null ? rent.bankCashBdt + rent.operatingCashBdt + (rent.treasuryCashBdt ?? 0) : null
  const cashCad = rent?.treasuryCashCad
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const snapshotStale = [rent?.fetchedAt, stock?.fetchedAt].some(t => t && isStale(t, now, 1/24))
  const personal = useMemo(() => money ? buildPersonalBooks(money, now, rent?.treasury ?? []) : null, [money, now, rent])
  const canadianAccounts = (rent?.treasury ?? []).filter(a => a.currency === 'CAD')
  const nextBills = personal?.bills.dueNext30Days ?? []
  const needsSetup = !demo && permanent !== null && (!(permanent.rentstream || rentUser) || !(permanent.stockstream || stockUser))
  return <main className="shell">
    <header className="topbar">
      <div className="brand">FINANCE MANAGER</div>
      <div className="mode-toggle" role="tablist" aria-label="Which finances">
        <button role="tab" aria-selected={!demo} className={demo ? '' : 'active'} onClick={() => demo && onToggleDemo()}>My finances</button>
        <button role="tab" aria-selected={demo} className={demo ? 'active' : ''} onClick={() => !demo && onToggleDemo()}>Demo</button>
      </div>
    </header>
    {demo && <div className="safety-banner demo-banner" role="status"><strong>Demo · sample data</strong><span>Everything here is made up, and nothing you do in the demo is saved.</span></div>}
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
    <EverydayMoney money={money} treasury={rent?.treasury ?? []} error={moneyError} onChanged={loadMoney} readOnly={demo} />

    <details className="section-fold">
      <summary><span>Rental business in Bangladesh</span><span className="muted small">{rent ? `${bdt(rent.bankCashBdt)} in the bank · ${bdt(rent.outstandingBdt)} rent still to collect this month` : 'Not read yet'}</span></summary>
      {rent ? <RentView rent={rent} /> : <p className="muted">{r.loading ? 'Reading RentStream…' : 'RentStream is not connected.'}</p>}
    </details>
    <details className="section-fold">
      <summary><span>Investments</span><span className="muted small">{stock ? `${cad(stock.portfolioCad)} portfolio` : 'Not read yet'}</span></summary>
      {stock ? <StockView stock={stock} /> : <p className="muted">{s.loading ? 'Reading StockStream…' : 'StockStream is not connected.'}</p>}
    </details>
    <details className="section-fold">
      <summary><span>How "free to invest" is worked out</span><span className="muted small">Reserves, family money and the rules</span></summary>
      {rent ? <section className="two-col"><CapitalView rent={rent} stock={stock ?? null} /><article className="panel"><div className="eyebrow">The rules</div><h2>Money gets a job before it gets invested</h2><ol className="input-gaps"><li>Keep three months of the business's recorded costs.</li><li>Keep family money out of what can be invested.</li><li>Leave out accounts whose purpose isn't set yet.</li><li>Only put money into a single stock when StockStream's Strike Radar clears it on its own.</li><li>Nothing moves money or makes a trade without your approval.</li></ol><p className="muted small">New surplus, once the rules above are met, splits 50% core / 25% strike reserve / 15% flexible / 10% free. Money already saved is not swept into that split automatically.</p></article></section> : <p className="muted">Needs RentStream.</p>}
    </details>
    <details className="section-fold" open={needsSetup}>
      <summary><span>Connections and data checks</span><span className="muted small">{issues.length ? `${issues.length} note${issues.length === 1 ? '' : 's'}` : 'All clear'}</span></summary>
      {!demo && permanent && <section className="two-col">
        {permanent.rentstream ? <PermanentConnection source="RentStream" /> : <Connection source="RentStream" client={clients.RentStream} onSession={rentSession} />}
        {permanent.stockstream ? <PermanentConnection source="StockStream" /> : <Connection source="StockStream" client={clients.StockStream} onSession={stockSession} />}
      </section>}
      <div className="refresh-row"><p className="muted small">RentStream read: {date(rent?.fetchedAt)}<br/>StockStream read: {date(stock?.fetchedAt)}<br/>Exchange rate: {fx ? `1 CAD = ৳${fx.rate.toFixed(2)} · ${fx.asOf} · ${fx.source}` : 'not available'}</p><button onClick={() => {r.refresh(); s.refresh()}} disabled={r.loading || s.loading || (!r.data && !s.data && !r.error && !s.error)}>{r.loading || s.loading ? 'Reading…' : 'Refresh'}</button></div>
      <div className="attention-list">{issues.length ? issues.map((issue,i) => <div className="attention-row" key={i}>{issue}</div>) : <p className="muted small">No data warnings.</p>}</div>
    </details>

    <footer>Finance Manager · cannot move money or place trades · reads RentStream and StockStream without changing them · saves only the bills, spending and draws you record</footer>
  </main>
}
