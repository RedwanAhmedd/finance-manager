import type { RentSnapshot, StockSnapshot } from '../live/models'
import { renderRentBooks } from '../books/renderRent'
import { renderStockBooks } from '../books/renderStock'
import { buildOverview, renderOverview, type FxReference } from '../books/overview'
import { buildPersonalBooks } from '../books/personal'
import { renderPersonalBooks } from '../books/renderPersonal'
import type { MoneyData } from '../money/types'
import type { SuggestedBill } from '../money/lines'

const round = (n: number | null) => n === null ? null : Math.round(n * 100) / 100
const total = (...parts: (number | null)[]) => parts.some(p => p === null) ? null : round(parts.reduce<number>((s, p) => s + p!, 0))

// Amounts carry their currency symbol in the text itself. A bare number beside
// a separate currency field let a small model relabel taka as dollars.
const money = (symbol: '৳' | 'C$') => (n: number | null) => n === null ? 'unknown' :
  `${n < 0 ? '−' : ''}${symbol}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const bdt = money('৳'), cad = money('C$')

// Pre-computed so the answer does not depend on the model's arithmetic, which is
// weakest on small local models. Each carries its formula; any unknown input
// leaves the result unknown.
function bangladeshTotals(rent: RentSnapshot) {
  const liquid = total(rent.bankCashBdt, rent.operatingCashBdt)
  return {
    recordedLiquidCash: { value: bdt(liquid), formula: 'bank accounts + operating cash ledger' },
    liquidCashAfterCardDebt: {
      value: bdt(total(liquid, rent.cardDebtBdt === null ? null : -rent.cardDebtBdt)),
      formula: 'recorded liquid cash − credit-card debt (tenant deposits revolve and are not subtracted)',
    },
    collectedShareOfThisMonthBilling: {
      value: rent.expectedBdt > 0 ? `${Math.round(rent.collectedBdt / rent.expectedBdt * 1000) / 10}%` : 'unknown',
      formula: 'settled ÷ billed',
    },
    totalOwedByTenants: {
      value: bdt(rent.outstandingBdt + rent.overdueBdt),
      formula: "this month's unpaid bills + earlier months' overdue bills (rent and utilities together; excludes tenants with no bill recorded this month)",
    },
    net30DayCashFlow: { value: bdt(rent.cashReceipts30dBdt - rent.expenses30dBdt), formula: 'cash rent receipts − recorded expenses, last 30 days' },
  }
}

// The figures the assistant may reason over. Unknowns say "unknown" (never
// zero) and every source keeps its read time, so the model can say how old a
// figure is. A source that is not connected is stated, not omitted.
export function assistantSummary(rent: RentSnapshot | null, stock: StockSnapshot | null, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    exchangeRateCadBdt: 'see the overview',
    bangladesh: rent ? {
      source: 'RentStream', currency: 'BDT (Bangladeshi taka, ৳)', readAt: rent.fetchedAt, businessDate: rent.businessDate, billingMonth: rent.month,
      cash: {
        bankAccountsTotal: bdt(rent.bankCashBdt),
        operatingCashLedger: bdt(rent.operatingCashBdt),
        lastPhysicalCashCount: rent.cashCountDate,
        creditCardDebt: bdt(rent.cardDebtBdt),
        tenantDepositsHeldRevolving: bdt(rent.refundableDepositsBdt),
      },
      accounts: rent.banks.map(b => ({ name: b.name, type: b.type, balance: bdt(b.balance), balanceAnchoredOn: b.anchorDate })),
      thisMonthBilling: { billedRentAndUtilities: bdt(rent.expectedBdt), settled: bdt(rent.collectedBdt), unpaid: bdt(rent.outstandingBdt) },
      earlierMonthsOverdue: { unpaid: bdt(rent.overdueBdt), bills: rent.overdueBills, tenants: rent.overdueTenants, oldestUnpaidMonth: rent.overdueSince },
      last30Days: { cashRentReceipts: bdt(rent.cashReceipts30dBdt), recordedExpenses: bdt(rent.expenses30dBdt) },
      totals: bangladeshTotals(rent),
      issues: rent.issues,
    } : { connected: false },
    canada: stock ? {
      source: 'StockStream', currency: 'CAD (Canadian dollars, C$)', readAt: stock.fetchedAt,
      portfolioIncludingCash: cad(stock.portfolioCad),
      investedHoldings: cad(stock.investedCad),
      brokerageCash: cad(stock.cashCad), brokerageCashRecordedOn: stock.cashAsOf,
      coreShareOfPortfolio: stock.corePct === null ? 'unknown' : `${Math.round(stock.corePct * 10) / 10}%`,
      contributedYearToDate: cad(stock.contributedYtdCad),
      holdings: stock.holdings.map(h => ({ symbol: h.symbol, role: h.role, shares: h.shares, value: cad(h.valueCad), priceBasis: h.priceSource, priceDate: h.asOf?.slice(0, 10) ?? null })),
      issues: stock.issues,
    } : { connected: false },
  }
}

// The document the assistant reads: the dashboard summary, then the full
// books for each source that was read.
export function assistantContext(rent: RentSnapshot | null, stock: StockSnapshot | null, fx: FxReference | null = null, money: (MoneyData & { suggestions?: SuggestedBill[] }) | null = null, now = new Date()): string {
  const personal = money ? buildPersonalBooks(money, now, rent?.treasury ?? []) : null
  return [
    fx ? `# ${renderOverview(buildOverview(rent, stock, fx, personal)).slice(3)}` : '# Overview across both countries\nNo CAD/BDT reference rate is available, so the two sides cannot be compared in one currency.',
    `# Summary of both sources\n${JSON.stringify(assistantSummary(rent, stock, now), null, 1)}`,
    rent?.books ? `# Bangladesh: RentStream books\n${renderRentBooks(rent.books)}` : '',
    personal ? `# Canada: personal money\n${renderPersonalBooks(personal)}` : '',
    stock?.books ? `# Canada: StockStream books\n${renderStockBooks(stock.books)}` : '',
  ].filter(Boolean).join('\n\n')
}
