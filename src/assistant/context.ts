import type { RentSnapshot, StockSnapshot } from '../live/models'
import { RENT_GUIDE, renderRentBooks } from '../books/renderRent'
import { STOCK_GUIDE, renderStockBooks } from '../books/renderStock'
import { buildOverview, renderOverview, type FxReference } from '../books/overview'
import { buildPersonalBooks, type PersonalBooks } from '../books/personal'
import { PERSONAL_GUIDE, renderPersonalBooks } from '../books/renderPersonal'
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

// The page's own figures under the page's own names, each with the question it
// answers. Small models pick the wrong row from the full books (for example
// comparing all collections with this month's billing); a named, ready answer
// removes that guess. The books below explain each figure.
export function quickAnswers(rent: RentSnapshot | null, stock: StockSnapshot | null, fx: FxReference | null, personal: PersonalBooks | null): string {
  const inCad = (n: number | null | undefined) => n != null && fx ? ` (≈ ${cad(Math.round(n / fx.rate * 100) / 100)} at 1 CAD = ৳${fx.rate.toFixed(2)}, ${fx.asOf})` : ''
  const lines = [
    personal && `- Spent this month (Canada, personal, day ${personal.pace.day}): ${cad(personal.pace.thisMonth)}. Last month by the same day: ${cad(personal.pace.lastMonthSameDay)}.`,
    personal && `- Bills coming up (recorded bills due in the next 30 days): ${cad(personal.bills.dueNext30DaysTotal)}${personal.bills.dueNext30Days.length ? `: ${personal.bills.dueNext30Days.map(b => `${b.name} ${cad(b.amount)} on ${b.date}`).join('; ')}` : ''}.`,
    rent && `- Money in Canada (cash in the owner's Canadian accounts, recorded in RentStream): ${cad(rent.treasuryCashCad ?? null)}.`,
    stock && `- Investments (StockStream portfolio, including brokerage cash): ${cad(stock.portfolioCad)}.`,
    rent && `- Rent still to collect this month (unpaid on this collection month's bills): ${bdt(rent.outstandingBdt)}. Billed ${bdt(rent.expectedBdt)}, settled ${bdt(rent.collectedBdt)}. Overdue from earlier months, separately: ${bdt(rent.overdueBdt)}.`,
    rent && `- Safe to invest (business money after card debt, a three-month reserve and family money): ${bdt(rent.strategicDeployableBdt)}${inCad(rent.strategicDeployableBdt)}.`,
    rent && `- Business credit-card debt: ${bdt(rent.cardDebtBdt)}.`,
  ].filter(Boolean)
  return lines.length ? `# Quick answers\nWhen a question matches one of these, answer with that figure exactly as written here, in its currency. Use the books below only for detail.\n${lines.join('\n')}` : ''
}

// The document the assistant reads: the dashboard summary, then the full
// books for each source that was read.
export function assistantContext(rent: RentSnapshot | null, stock: StockSnapshot | null, fx: FxReference | null = null, money: (MoneyData & { suggestions?: SuggestedBill[] }) | null = null, now = new Date()): string {
  const personal = money ? buildPersonalBooks(money, now, rent?.treasury ?? []) : null
  // The local model re-reads this whole document for every question unless its
  // start is byte-identical to the previous request. So the fixed guides come
  // first, no timestamps are included, and the figures follow.
  const withoutGuide = (text: string, guide: string) => text.startsWith(guide) ? text.slice(guide.length).trimStart() : text
  return [
    `# How to read the owner's records\n${[RENT_GUIDE, PERSONAL_GUIDE, STOCK_GUIDE].join('\n\n')}`,
    quickAnswers(rent, stock, fx, personal),
    fx ? `# ${renderOverview(buildOverview(rent, stock, fx, personal)).slice(3)}` : '# Overview across both countries\nNo CAD/BDT reference rate is available, so the two sides cannot be compared in one currency.',
    rent?.books ? `# Bangladesh: RentStream books\n${withoutGuide(renderRentBooks(rent.books), RENT_GUIDE)}` : '',
    personal ? `# Canada: personal money\n${withoutGuide(renderPersonalBooks(personal), PERSONAL_GUIDE)}` : '',
    stock?.books ? `# Canada: StockStream books\n${withoutGuide(renderStockBooks(stock.books), STOCK_GUIDE)}` : '',
  ].filter(Boolean).join('\n\n')
}
