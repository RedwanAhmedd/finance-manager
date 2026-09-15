import { useMemo, useState } from 'react'
import type { FinanceReport, FinancePolicy } from '../domain/models'
import { planScenario } from '../engine/scenario'
import { MetricCard } from '../components/MetricCard'
import { SafetyBanner } from '../components/SafetyBanner'
import { StatusPill } from '../components/StatusPill'
import { Freshness } from '../components/Freshness'

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const bdt = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 })

export default function Dashboard({ report, policy }: { report: FinanceReport; policy: FinancePolicy }) {
  const [scenarioAmount, setScenarioAmount] = useState(6000)
  const [scenarioMode, setScenarioMode] = useState<'spend' | 'invest'>('spend')
  const scenario = useMemo(() => planScenario(report, policy, {
    label: scenarioMode === 'spend' ? 'Planned purchase / trip' : 'Additional investment',
    spendCad: scenarioMode === 'spend' ? scenarioAmount : 0,
    investCad: scenarioMode === 'invest' ? scenarioAmount : 0,
  }), [report, policy, scenarioAmount, scenarioMode])

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">FINANCE MANAGER</div>
          <div className="muted">Family-office control layer · v0.1</div>
        </div>
        <div className="demo-badge">DEMO DATA</div>
      </header>

      <SafetyBanner />

      <section className="hero panel">
        <div>
          <div className="eyebrow">Executive briefing</div>
          <div className="hero-title-row">
            <h1>{report.recommendation.headline}</h1>
            <StatusPill status={report.status} />
          </div>
          <p className="muted hero-copy">
            RentStream owns cash and rental operations. StockStream owns investments. Finance Manager coordinates both and recommends — it never executes.
          </p>
        </div>
        <div className="hero-decision">
          <span className="eyebrow">Decisions required</span>
          <strong>{report.decisionsRequired}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="Total liquid cash" value={cad.format(report.liquidity.totalCashCad)} note="RentStream + brokerage cash" />
        <MetricCard label="Reserved + committed" value={cad.format(report.liquidity.reservedCashCad + report.liquidity.committedCashCad)} note="Protected from discretionary allocation" />
        <MetricCard label="Deployable cash" value={cad.format(report.liquidity.deployableCashCad)} note="After guardrails and near-term obligations" tone={report.liquidity.deployableCashCad > 0 ? 'good' : 'warn'} />
        <MetricCard label="Near-term obligations" value={cad.format(report.liquidity.nearTermObligationsCad)} note={`Inside ${policy.nearTermObligationWindowDays} days`} />
      </section>

      <section className="two-col">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">RentStream</div>
              <h2>Income & treasury</h2>
            </div>
            <span className="system-tag">SOURCE OF TRUTH</span>
          </div>
          <div className="mini-grid">
            <div><span>Expected rent</span><strong>{bdt.format(report.rent.expectedRent30d.amount)}</strong></div>
            <div><span>Collected</span><strong>{bdt.format(report.rent.collectedRent30d.amount)}</strong></div>
            <div><span>Outstanding</span><strong>{bdt.format(report.rent.outstandingRent30d.amount)}</strong></div>
            <div><span>30d property costs</span><strong>{bdt.format(report.rent.propertyExpenses30d.amount)}</strong></div>
          </div>
          <div className="account-list">
            {report.liquidity.accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <div>
                  <strong>{account.name}</strong>
                  <div className="muted">{account.country} · {account.currency} · owned by {account.ownerSystem}</div>
                </div>
                <div className="right">
                  <strong>{account.currency === 'CAD' ? cad.format(account.balance) : bdt.format(account.balance)}</strong>
                  <div className="muted">deployable {cad.format(account.deployableCad)}</div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">StockStream</div>
              <h2>Investment engine</h2>
            </div>
            <span className="system-tag">SOURCE OF TRUTH</span>
          </div>
          <div className="mini-grid">
            <div><span>Portfolio value</span><strong>{cad.format(report.stock.portfolioValueCad)}</strong></div>
            <div><span>Brokerage cash</span><strong>{cad.format(report.stock.brokerageCashCad)}</strong></div>
            <div><span>Core allocation</span><strong>{report.stock.coreAllocationPct.toFixed(0)}%</strong></div>
            <div><span>Single stocks</span><strong>{report.stock.singleStockAllocationPct.toFixed(0)}%</strong></div>
          </div>
          <div className="progress-wrap">
            <div className="progress-label"><span>Annual contribution</span><strong>{cad.format(report.stock.contributionYtdCad)} / {cad.format(report.stock.contributionTargetCad)}</strong></div>
            <div className="progress"><span style={{ width: `${Math.min(100, report.stock.contributionYtdCad / report.stock.contributionTargetCad * 100)}%` }} /></div>
          </div>
          {report.stock.strikeOpportunities.map((x) => (
            <div className="strike-card" key={x.ticker}>
              <div><strong>{x.ticker}</strong> · {x.label}</div>
              <div className="muted">StockStream confidence {x.confidence}% · cap {cad.format(x.suggestedMaxAllocationCad)}</div>
            </div>
          ))}
        </article>
      </section>

      <section className="two-col">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Allocation engine</div>
              <h2>What should available money do?</h2>
            </div>
          </div>
          <div className="action-list">
            {report.recommendation.actions.map((action) => (
              <div className="action-row" key={`${action.priority}-${action.label}`}>
                <span className="priority">{action.priority}</span>
                <div className="action-body">
                  <div className="action-title"><strong>{action.label}</strong><strong>{cad.format(action.amountCad)}</strong></div>
                  <div className="muted">{action.reason}</div>
                  <div className="confidence">Confidence {action.confidence}% · approval required</div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Scenario planner</div>
              <h2>Can I afford this?</h2>
            </div>
          </div>
          <div className="scenario-controls">
            <div className="toggle-row">
              <button className={scenarioMode === 'spend' ? 'active' : ''} onClick={() => setScenarioMode('spend')}>Spend</button>
              <button className={scenarioMode === 'invest' ? 'active' : ''} onClick={() => setScenarioMode('invest')}>Invest</button>
            </div>
            <label>
              Amount (CAD)
              <input type="number" min="0" step="100" value={scenarioAmount} onChange={(e) => setScenarioAmount(Number(e.target.value) || 0)} />
            </label>
          </div>
          <div className={`scenario-result scenario-${scenario.verdict}`}>
            <div className="eyebrow">{scenario.verdict.replace('-', ' ')}</div>
            <div className="scenario-money">{cad.format(scenario.postActionDeployableCad)}</div>
            <div className="muted">deployable after scenario</div>
            <p>{scenario.explanation}</p>
          </div>
        </article>
      </section>

      <section className="two-col">
        <article className="panel">
          <div className="panel-heading"><div><div className="eyebrow">Attention</div><h2>What needs Redwan</h2></div></div>
          <div className="attention-list">
            {report.attention.map((x) => <div className="attention-row" key={x}>{x}</div>)}
          </div>
        </article>
        <Freshness items={[report.rent.meta, report.stock.meta]} />
      </section>

      <footer>
        Finance Manager v0.1 · calculations are deterministic · no bank or brokerage execution permissions
      </footer>
    </main>
  )
}
