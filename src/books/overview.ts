import type { RentSnapshot, StockSnapshot } from '../live/models'
import type { PersonalBooks } from './personal'

// The two countries side by side in one currency, at a dated reference rate.
// Facts for allocation decisions, not the decision: the owner's money moves at
// whatever rate the transfer gets, and property values are not recorded.
export interface FxReference { rate: number; asOf: string; source: string }

export interface Overview {
  rate: FxReference
  bangladesh: {
    bankCash: number | null
    depositsHeld: number
    cardDebt: number | null
    cashAfterDebt: number | null
    monthOfOperatingCosts: number | null
    cashAfterReserve: number | null
    latestMonthlySurplus: { month: string; amount: number } | null
  } | null
  canada: { portfolio: number | null; cash: number | null; averageMonthlyInvested: number | null } | null
  personal: { latestCompleteMonth: { month: string; spending: number } | null; averageSpending: { months: number; amount: number } | null; draws12Months: number; monthsOfSpendingInBangladeshCash: number | null } | null
  // Everything the owner counts as his: Bangladesh business cash after card debt,
  // recorded Canadian account balances and the investment portfolio.
  ownersTotalCad: number | null
  canadaInvestingShareOfBangladeshSurplus: number | null
}

export function buildOverview(rent: RentSnapshot | null, stock: StockSnapshot | null, rate: FxReference, personalBooks: PersonalBooks | null = null): Overview {
  const toCad = (bdt: number | null) => bdt === null ? null : bdt / rate.rate
  const books = rent?.books
  const bangladesh = rent ? {
    bankCash: rent.bankCashBdt,
    depositsHeld: rent.refundableDepositsBdt,
    cardDebt: rent.cardDebtBdt,
    // Deposits revolve into departing tenants' final rent, so they are not subtracted.
    cashAfterDebt: rent.bankCashBdt === null || rent.cardDebtBdt === null ? null : rent.bankCashBdt - rent.cardDebtBdt,
    monthOfOperatingCosts: books?.opportunities.reserve.oneMonthOperatingExpenses ?? null,
    cashAfterReserve: books?.opportunities.reserve.cashAfterDebtAndReserve ?? null,
    latestMonthlySurplus: books?.opportunities.latestCompleteSurplus ? { month: books.opportunities.latestCompleteSurplus.month, amount: books.opportunities.latestCompleteSurplus.surplus } : null,
  } : null
  const canada = stock ? { portfolio: stock.portfolioCad, cash: stock.cashCad, averageMonthlyInvested: stock.books?.goal.averageMonthlyInvested ?? null } : null
  const bdAvailable = toCad(bangladesh?.cashAfterDebt ?? null)
  const surplus = bangladesh?.latestMonthlySurplus?.amount ?? null
  // Personal spending side by side with the business: past months only.
  const completeMonths = personalBooks?.months.filter(m => m.complete && m.lines > 0) ?? []
  const recent = completeMonths.slice(-3)
  const averageSpending = recent.length ? { months: recent.length, amount: Math.round(recent.reduce((s, m) => s + m.spending, 0) / recent.length * 100) / 100 } : null
  const personal = personalBooks ? {
    latestCompleteMonth: completeMonths.length ? { month: completeMonths[completeMonths.length - 1].month, spending: completeMonths[completeMonths.length - 1].spending } : null,
    averageSpending,
    draws12Months: Math.round(personalBooks.draws.reduce((s, d) => s + d.cad, 0) * 100) / 100,
    monthsOfSpendingInBangladeshCash: averageSpending && averageSpending.amount > 0 && bangladesh?.cashAfterReserve != null
      ? Math.round(bangladesh.cashAfterReserve / rate.rate / averageSpending.amount * 10) / 10 : null,
  } : null
  return {
    rate, bangladesh, canada, personal,
    ownersTotalCad: bdAvailable === null ? null : Math.round((bdAvailable + (personalBooks?.balances.reduce((s, b) => s + b.balance, 0) ?? 0) + (canada?.portfolio ?? 0)) * 100) / 100,
    canadaInvestingShareOfBangladeshSurplus: surplus && surplus > 0 && canada?.averageMonthlyInvested != null ? Math.round(canada.averageMonthlyInvested * rate.rate / surplus * 1000) / 10 : null,
  }
}

const bdt = (n: number | null) => n === null ? 'unknown' : `${n < 0 ? '−' : ''}৳${Math.round(Math.abs(n)).toLocaleString('en-US')}`
const cad = (n: number | null) => n === null ? 'unknown' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const both = (taka: number | null, rate: number) => taka === null ? 'unknown' : `${bdt(taka)} (≈ ${cad(taka / rate)})`

export function renderOverview(o: Overview): string {
  const r = o.rate.rate, b = o.bangladesh, c = o.canada
  const lines = [`## Overview across both countries
Reference rate: 1 CAD = ৳${r.toFixed(2)} (1 BDT = C$${(1 / r).toFixed(5)}), dated ${o.rate.asOf}, from ${o.rate.source}. It is a market reference for comparing the two sides; money actually transferred between countries gets a different rate and fees. Property values are not recorded, so this is cash and investments only.`]
  if (b) lines.push(`Bangladesh (business cash):
- Bank cash ${both(b.bankCash, r)}; card debt ${both(b.cardDebt, r)}.
- Cash after card debt: ${both(b.cashAfterDebt, r)}.
- Tenant deposits held ${both(b.depositsHeld, r)}: revolving, normally used as departing tenants' final two months of rent and replaced by new tenants' deposits, so not set aside.
- After also keeping one month of operating costs (${both(b.monthOfOperatingCosts, r)}): ${both(b.cashAfterReserve, r)}.
- Latest complete month's operating surplus: ${b.latestMonthlySurplus ? `${both(b.latestMonthlySurplus.amount, r)} (${b.latestMonthlySurplus.month}, the only complete month so far)` : 'unknown'}.`)
  else lines.push('Bangladesh: RentStream not read.')
  if (c) lines.push(`Canada (investments):
- Portfolio ${cad(c.portfolio)} (≈ ${bdt(c.portfolio === null ? null : c.portfolio * r)}), of which brokerage cash ${cad(c.cash)}.
- Actually invested on average ${cad(c.averageMonthlyInvested)} a month (≈ ${bdt(c.averageMonthlyInvested === null ? null : c.averageMonthlyInvested * r)}) over the short history.`)
  else lines.push('Canada: StockStream not read.')
  const p = o.personal
  if (p) lines.push(`Personal spending in Canada:
- Latest complete month: ${p.latestCompleteMonth ? `${cad(p.latestCompleteMonth.spending)} (≈ ${bdt(p.latestCompleteMonth.spending * r)}) in ${p.latestCompleteMonth.month}` : 'no complete month recorded yet'}.
- Past average: ${p.averageSpending ? `${cad(p.averageSpending.amount)} a month (≈ ${bdt(p.averageSpending.amount * r)}) over ${p.averageSpending.months} complete month${p.averageSpending.months === 1 ? '' : 's'}` : 'not enough records yet'}.
- Draws received from the rental business in the last 12 months: ${cad(p.draws12Months)}.
- Bangladesh cash after card debt and a one-month business reserve equals ${p.monthsOfSpendingInBangladeshCash === null ? 'an unknown number of' : p.monthsOfSpendingInBangladeshCash} months of that average personal spending.`)
  else lines.push('Personal spending in Canada: not connected.')
  lines.push(`Across both:
- The owner's total (Bangladesh business cash after card debt, recorded Canadian account balances and the investment portfolio): ${cad(o.ownersTotalCad)}. Of this, the portfolio is invested, not spending cash.
- Average monthly Canadian investing is ${o.canadaInvestingShareOfBangladeshSurplus === null ? 'unknown' : `${o.canadaInvestingShareOfBangladeshSurplus}%`} of the latest Bangladesh monthly surplus.`)
  return lines.join('\n')
}
