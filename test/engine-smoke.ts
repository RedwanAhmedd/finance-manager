import { buildFinanceReport } from '../src/engine/financeEngine'
import { demoPolicy, demoRentStream, demoStockStream } from '../src/fixtures/demoData'

const report = buildFinanceReport(demoRentStream, demoStockStream, demoPolicy, new Date())
const freePool = report.liquidity.accounts.reduce((sum, a) => sum + a.deployableCad, 0) + report.liquidity.stockStreamCashCad
const allocated = report.recommendation.actions.reduce((sum, a) => sum + a.amountCad, 0)

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

assert(Math.abs(freePool - allocated) < 0.01, 'Allocation engine must account for the full free cash pool exactly once.')
assert(report.recommendation.actions.every((a) => a.approvalRequired), 'Every action must require approval.')
assert(report.recommendation.actions[0]?.bucket === 'reserve', 'Reserve protection must be the first allocation gate.')
assert(report.liquidity.deployableCashCad >= 0, 'Deployable cash must never be negative.')

console.log('Finance Manager engine smoke check passed.')
