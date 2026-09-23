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
    familyRestricted: number | null
    operatingReserveTarget: number
    strategicDeployable: number | null
    latestMonthlySurplus: { month: string; amount: number } | null
  } | null
  canada: { portfolio: number | null; cash: number | null; averageMonthlyInvested: number | null } | null
  // Cash in the owner's Canadian bank accounts (RentStream treasury), not brokerage cash.
  canadianBankCash: number | null
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
    familyRestricted: rent.familyRestrictedCashBdt,
    operatingReserveTarget: rent.operatingReserveTargetBdt,
    strategicDeployable: rent.strategicDeployableBdt,
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
    monthsOfSpendingInBangladeshCash: averageSpending && averageSpending.amount > 0 && bangladesh?.strategicDeployable != null
      ? Math.round(bangladesh.strategicDeployable / rate.rate / averageSpending.amount * 10) / 10 : null,
  } : null
  return {
    rate, bangladesh, canada, personal, canadianBankCash: rent?.treasuryCashCad ?? null,
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
- Family-restricted cash (kept for family use, not deployable): ${both(b.familyRestricted, r)}.
- Safe to invest (strategic deployable cash; the page's "Safe to invest"): ${both(b.strategicDeployable, r)}. This is what remains after card debt, a three-month operating reserve (${both(b.operatingReserveTarget, r)}) and excluding family-restricted and unclassified accounts. When the owner asks what is safe or free to invest, use this figure, not cash after card debt.
- Latest complete month's operating surplus: ${b.latestMonthlySurplus ? `${both(b.latestMonthlySurplus.amount, r)} (${b.latestMonthlySurplus.month}, the only complete month so far)` : 'unknown'}.`)
  else lines.push('Bangladesh: RentStream not read.')
  lines.push(`Canada (bank cash): cash in the owner's Canadian bank accounts, recorded in RentStream: ${cad(o.canadianBankCash)}. This is the owner's cash in Canada; brokerage cash is separate and sits inside the portfolio.`)
  if (c) lines.push(`Canada (investments):
- Portfolio ${cad(c.portfolio)} (≈ ${bdt(c.portfolio === null ? null : c.portfolio * r)}), of which brokerage cash (inside the portfolio, not bank cash) ${cad(c.cash)}.
- Actually invested on average ${cad(c.averageMonthlyInvested)} a month (≈ ${bdt(c.averageMonthlyInvested === null ? null : c.averageMonthlyInvested * r)}) over the short history.`)
  else lines.push('Canada: StockStream not read.')
  const p = o.personal
  if (p) lines.push(`Personal spending in Canada:
- Latest complete month: ${p.latestCompleteMonth ? `${cad(p.latestCompleteMonth.spending)} (≈ ${bdt(p.latestCompleteMonth.spending * r)}) in ${p.latestCompleteMonth.month}` : 'no complete month recorded yet'}.
- Past average: ${p.averageSpending ? `${cad(p.averageSpending.amount)} a month (≈ ${bdt(p.averageSpending.amount * r)}) over ${p.averageSpending.months} complete month${p.averageSpending.months === 1 ? '' : 's'}` : 'not enough records yet'}.
- Draws received from the rental business in the last 12 months: ${cad(p.draws12Months)}.
- Bangladesh strategic deployable cash equals ${p.monthsOfSpendingInBangladeshCash === null ? 'an unknown number of' : p.monthsOfSpendingInBangladeshCash} months of that average personal spending.`)
  else lines.push('Personal spending in Canada: not connected.')
  lines.push(`Across both:
- The owner's total (Bangladesh business cash after card debt, recorded Canadian account balances and the investment portfolio): ${cad(o.ownersTotalCad)}. Of this, the portfolio is invested, not spending cash.
- Average monthly Canadian investing is ${o.canadaInvestingShareOfBangladeshSurplus === null ? 'unknown' : `${o.canadaInvestingShareOfBangladeshSurplus}%`} of the latest Bangladesh monthly surplus.`)
  return lines.join('\n')
}
