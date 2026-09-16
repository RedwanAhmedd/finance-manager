import { useCallback, useEffect, useState } from 'react'
import { clients } from './client'
import Connection from './Connections'
import { SafetyBanner } from '../components/SafetyBanner'
import { MetricCard } from '../components/MetricCard'
import { ReadOnlyRentStreamAdapter } from './rentstream'
import { ReadOnlyStockStreamAdapter } from './stockstream'
import { useSnapshot } from './useSnapshot'
import { isStale, type BankFinancialRole, type RentSnapshot, type StockSnapshot } from './models'

const rentAdapter = clients.RentStream ? new ReadOnlyRentStreamAdapter(clients.RentStream) : null
const stockAdapter = clients.StockStream ? new ReadOnlyStockStreamAdapter(clients.StockStream) : null
const bdt = (n: number | null | undefined) => {
  if (n == null) return 'Unknown'
  const hasPoisha = !Number.isInteger(Math.round(n * 100) / 100)
  return `৳${n.toLocaleString('en-IN', {minimumFractionDigits: hasPoisha ? 2 : 0, maximumFractionDigits: hasPoisha ? 2 : 0})}`
}
const cad = (n: number | null | undefined) => n == null ? 'Unknown' : new Intl.NumberFormat('en-CA', {style:'currency', currency:'CAD', maximumFractionDigits:2}).format(n)
const date = (s: string | null | undefined) => s ? new Date(s).toLocaleString() : 'Not recorded'
const roleLabel: Record<BankFinancialRole, string> = {
  corporate_operating: 'Corporate operating',
  savings: 'Savings',
  family_restricted: 'Family-restricted',
  personal: 'Personal',
  unclassified: 'Unclassified',
}

function RentView({ rent }: {rent: RentSnapshot}) {
  const treasury = rent.treasury ?? []
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">RentStream · {rent.month}</div><h2>Income & treasury</h2></div><span className="system-tag">BDT + CAD</span></div>
    <div className="mini-grid">
      <div><span>Billed rent + utilities</span><strong>{bdt(rent.expectedBdt)}</strong></div>
      <div><span>Settled against this month's bills</span><strong>{bdt(rent.collectedBdt)}</strong></div>
      <div><span>Outstanding billed amount</span><strong>{bdt(rent.outstandingBdt)}</strong></div>
      <div><span>Cash rent receipts · last 30 days</span><strong>{bdt(rent.cashReceipts30dBdt)}</strong></div>
      <div><span>Recorded expenses · last 30 days</span><strong>{bdt(rent.expenses30dBdt)}</strong></div>
      <div><span>Tenant deposits on record</span><strong>{bdt(rent.refundableDepositsBdt)}</strong></div>
    </div>
    <p className="muted small">Tenant deposits are tracked separately from headline liquidity. The final amount refundable to a tenant may be reduced by unpaid rent or other valid charges recorded in RentStream.</p>
    <div className="account-list">{rent.banks.map(b => <div className="account-row" key={b.id}><div><strong>{b.name}</strong><div className="muted">{b.type === 'credit_card' ? 'Credit card' : roleLabel[b.financialRole]} · statement anchor {b.anchorDate ?? 'unknown'}</div>{b.monthlyProtectedOutflow > 0 && <div className="muted small">Protected monthly outflow {bdt(b.monthlyProtectedOutflow)}</div>}</div><div className="right"><strong>{bdt(b.balance)}</strong><div className="muted">{b.type === 'credit_card' ? 'signed card balance' : 'statement + later movements'}</div></div></div>)}</div>
    {treasury.length > 0 && <>
      <div className="eyebrow" style={{marginTop:'1rem'}}>Treasury accounts</div>
      <div className="account-list">{treasury.map(a => <div className="account-row" key={a.id}><div><strong>{a.name}</strong><div className="muted">{a.institution ?? a.country} · balance snapshot {a.balanceAsOf}</div></div><div className="right"><strong>{a.currency === 'CAD' ? cad(a.balance) : bdt(a.balance)}</strong><div className="muted">{a.currency}</div></div></div>)}</div>
    </>}
    <p className="muted small">Rental ledger cash through {rent.businessDate}. Last physical count: {rent.cashCountDate ?? 'not recorded'}.</p>
  </article>
}

function CapitalView({rent, stock}: {rent: RentSnapshot; stock: StockSnapshot | null}) {
  const surplus30d = rent.cashReceipts30dBdt - rent.expenses30dBdt
  return <article className="panel">
    <div className="panel-heading"><div><div className="eyebrow">Capital allocation v1</div><h2>What can actually be deployed</h2></div><span className="system-tag">policy</span></div>
    <div className="mini-grid">
      <div><span>3-month operating reserve target</span><strong>{bdt(rent.operatingReserveTargetBdt)}</strong></div>
      <div><span>Allocation-eligible BDT cash</span><strong>{bdt(rent.allocationEligibleCashBdt)}</strong></div>
      <div><span>Strategic deployable BDT</span><strong>{bdt(rent.strategicDeployableBdt)}</strong></div>
      <div><span>Family-restricted cash</span><strong>{bdt(rent.familyRestrictedCashBdt)}</strong></div>
      <div><span>Protected family outflow / month</span><strong>{bdt(rent.familyMonthlyProtectedOutflowBdt)}</strong></div>
      <div><span>Family cash runway</span><strong>{rent.familyRunwayMonths == null ? 'N/A' : `${rent.familyRunwayMonths.toFixed(1)} months`}</strong></div>
    </div>
    <p className="muted small">The operating reserve is three times RentStream's trailing 30-day expenses, so household expenses already recorded in RentStream are automatically included. Family-restricted accounts and unclassified cash are excluded from deployable capital. Tenant deposits remain visible but are not automatically deducted from headline liquidity.</p>
    <div className="attention-list">
      <div className="attention-row">Trailing 30-day cash surplus: <strong>{bdt(surplus30d)}</strong>.</div>
      <div className="attention-row">Unclassified BDT cash held out of allocation: <strong>{bdt(rent.unclassifiedCashBdt)}</strong>.</div>
      <div className="attention-row">Core portfolio share: <strong>{stock?.corePct == null ? 'Unknown' : `${stock.corePct.toFixed(1)}%`}</strong>. Below 50%, new investment money should normally favor the core unless Strike Radar produces a genuine STRIKE.</div>
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

export default function LiveDashboard({ onDemo }: { onDemo: () => void }) {
  const [rentUser, setRentUser] = useState<string | null>(null)
  const [stockUser, setStockUser] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const rentSession = useCallback((user: string | null) => setRentUser(user), [])
  const stockSession = useCallback((user: string | null) => setStockUser(user), [])
  const r = useSnapshot(rentUser, rentAdapter)
  const s = useSnapshot(stockUser, stockAdapter)
  useEffect(() => { const timer = setInterval(() => setNow(new Date()),60_000); return () => clearInterval(timer) }, [])
  const rent = r.data, stock = s.data
  const reading = r.loading || s.loading
  const cashBdt = rent?.bankCashBdt != null && rent.operatingCashBdt !== null ? rent.bankCashBdt + rent.operatingCashBdt + (rent.treasuryCashBdt ?? 0) : null
  const cashCad = rent?.treasuryCashCad
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const snapshotStale = [rent?.fetchedAt, stock?.fetchedAt].some(t => t && isStale(t, now, 1/24))
  return <main className="shell">
    <header className="topbar"><div><div className="brand">FINANCE MANAGER</div><div className="muted">Your rental income, treasury, capital policy and investments · v0.4</div></div><button onClick={onDemo}>View demo</button></header>
    <SafetyBanner />
    <section className="hero panel"><div><div className="eyebrow">{reading ? 'Refreshing source records' : rent && stock ? 'Live source reads' : 'Connect your sources'}</div><h1>Your financial picture, together.</h1><p className="muted">Balances come from RentStream and StockStream. Their record dates remain visible; fetching a record does not make an old balance current.</p></div><span className="status status-watch">{reading ? 'Reading' : rent && stock ? 'Capital policy active' : 'Setup'}</span></section>
    <details className="connections" open={!rentUser || !stockUser}><summary>Source connections</summary><section className="two-col"><Connection source="RentStream" client={clients.RentStream} onSession={rentSession} /><Connection source="StockStream" client={clients.StockStream} onSession={stockSession} /></section></details>
    <div className="refresh-row"><p className="muted small">RentStream read: {date(rent?.fetchedAt)}<br/>StockStream read: {date(stock?.fetchedAt)}</p><button onClick={() => {r.refresh(); s.refresh()}} disabled={r.loading || s.loading || (!rentUser && !stockUser)}>{r.loading || s.loading ? 'Reading sources…' : 'Refresh source data'}</button></div>
    {r.error && <p className="panel error" role="alert">RentStream read failed: {r.error}. Its figures have been cleared.</p>}
    {s.error && <p className="panel error" role="alert">StockStream read failed: {s.error}. Its figures have been cleared.</p>}
    {snapshotStale && <p className="safety-banner" role="status">This snapshot is more than one hour old. Refresh before using its figures.</p>}
    <section className="metrics-grid">
      <MetricCard label="Recorded cash · Bangladesh" value={bdt(cashBdt)} note="All BDT bank balances + operating cash; family-restricted and unclassified cash are separated below" />
      <MetricCard label="Strategic deployable · BDT" value={bdt(rent?.strategicDeployableBdt)} note="After card debt and 3 months of recorded expenses; excludes family-restricted and unclassified accounts" />
      <MetricCard label="Recorded cash · Canada" value={cad(cashCad)} note={rent?.treasury?.some(a => a.currency === 'CAD') ? `TD treasury snapshot · ${rent.treasury.filter(a => a.currency === 'CAD').map(a => a.balanceAsOf).sort().at(0) ?? 'date unknown'}` : 'No Canadian treasury account connected'} />
      <MetricCard label="Brokerage cash · recorded" value={cad(stock?.cashCad)} note={stock?.cashAsOf ? `Record ${stock.cashAsOf.slice(0,10)}${isStale(stock.cashAsOf,now) ? ' · STALE' : ''}` : 'Connect StockStream to read its cash position'} tone={stock && isStale(stock.cashAsOf,now) ? 'warn' : undefined} />
      <MetricCard label="Credit-card debt" value={bdt(rent?.cardDebtBdt)} note="Amount owed; kept separate from liquid cash" />
    </section>
    <section className="two-col">{rent ? <RentView rent={rent} /> : <article className="panel"><h2>RentStream</h2><p className="muted">{r.loading ? 'Reading accounts and reconciliation…' : 'Connect RentStream to see actual income and treasury data.'}</p></article>}{stock ? <StockView stock={stock}/> : <article className="panel"><h2>StockStream</h2><p className="muted">{s.loading ? 'Reading holdings and quotes…' : 'Connect StockStream to see actual investments.'}</p></article>}</section>
    {rent && <section className="two-col"><CapitalView rent={rent} stock={stock ?? null} /><article className="panel"><div className="eyebrow">Allocation rules</div><h2>Money gets a job before it gets invested</h2><ol className="input-gaps"><li>Protect three months of RentStream-recorded expenses.</li><li>Keep family-restricted cash out of personal deployable capital.</li><li>Exclude unclassified accounts until their role is confirmed.</li><li>Maintain the planned core contribution; while core is below 50%, normally favor XEQT.</li><li>Use Strike capital only when StockStream/Strike Radar independently clears its investment gates.</li><li>No recommendation moves money or executes a trade without explicit approval.</li></ol><p className="muted small">The 50% core / 25% strike reserve / 15% flexible / 10% free split applies to new surplus after the protection rules above are satisfied. Existing accumulated cash is not automatically swept into that split.</p></article></section>}
    <section className="two-col">
      <article className="panel"><div className="eyebrow">Cross-border policy</div><h2>Recommendations remain approval-only</h2><p className="muted">Canadian cash is connected, but Finance Manager never assumes that BDT should be converted or transferred to Canada. Cross-border deployment needs a dated FX rate, a deliberate transfer decision, and an approved investment use.</p><p className="muted small">TD cash remains treasury cash. Brokerage cash remains StockStream cash. They are never silently merged.</p></article>
      <article className="panel"><div className="eyebrow">Source evidence</div><h2>What needs attention</h2><div className="attention-list">{issues.length ? issues.map((issue,i) => <div className="attention-row" key={i}>{issue}</div>) : <p className="muted">No current source warnings.</p>}</div></article>
    </section>
    <footer>Finance Manager v0.4 · source reads only · no transfers, payments or trades</footer>
  </main>
}
