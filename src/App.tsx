import { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import { MockRentStreamAdapter, MockStockStreamAdapter } from './adapters/mockAdapters'
import { buildFinanceReport } from './engine/financeEngine'
import { demoPolicy } from './fixtures/demoData'
import type { FinanceReport } from './domain/models'

const rentStream = new MockRentStreamAdapter()
const stockStream = new MockStockStreamAdapter()

export default function App() {
  const [report, setReport] = useState<FinanceReport | null>(null)

  useEffect(() => {
    Promise.all([rentStream.getSummary(), stockStream.getSummary()]).then(([rent, stock]) => {
      setReport(buildFinanceReport(rent, stock, demoPolicy))
    })
  }, [])

  if (!report) return <main className="shell"><div className="panel">Loading Finance Manager…</div></main>
  return <Dashboard report={report} policy={demoPolicy} />
}
