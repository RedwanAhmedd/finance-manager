import type { RentBooks } from './rent'

const bdt = (n: number | null) => n === null ? 'unknown' : `${n < 0 ? '−' : ''}৳${Math.round(Math.abs(n)).toLocaleString('en-US')}`
const pct = (n: number | null) => n === null ? 'unknown' : `${n}%`
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const rentFor = (ym: string) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return label(d.toISOString().slice(0, 7)) }
const table = (head: string[], rows: (string | number)[][]) => [head.join(' | '), head.map(() => '---').join(' | '), ...rows.map(r => r.join(' | '))].join('\n')
const change = (from: number | null, to: number | null) => from === null || to === null || from === 0 ? 'unknown' : `${to - from >= 0 ? '+' : '−'}${bdt(Math.abs(to - from))} (${to - from >= 0 ? '+' : '−'}${Math.abs(Math.round((to - from) / from * 1000) / 10)}%)`

// How the business and RentStream work. Without this a model misreads the
// collection month as the rent month and misreads how deposits are used.
export const RENT_GUIDE = `## How the Bangladesh rental business works (RentStream)
- The owner rents residential units in several buildings in Bangladesh. All amounts are Bangladeshi taka (৳).
- RentStream is the owner's reconciled record: every payment is entered by the owner, cash is reconciled daily and deposited to the bank, and bank balances are anchored to bank statements. Treat its figures as correct.
- A bill is labelled by COLLECTION month. The "Sep 2026" bill is the rent for August 2026, collected during September. Collection normally runs through the month, so a current month that is still in progress will show a large unpaid amount that is normal, not a problem. Compare it with last month at the same day instead.
- Each bill = rent + utilities. Utilities billed to tenants are a pass-through: the owner pays the electricity, gas and water (WASA) bills and recovers them from tenants.
- A bill marked paid is settled. Overdue means a bill from an earlier collection month that is still unpaid or partly paid.
- Security deposits revolve. Most tenants do not pay rent for their last two months; their deposit covers it. New tenants bring new deposits. The owner does not treat deposits as a liability that needs cash set aside, so do not subtract them from available cash or present them as a risk. Their only cash effect: in months when departing tenants live on their deposit, less rent arrives as cash. Some small expenses are also paid from a tenant's deposit.
- Expense recording in RentStream began on the date shown below, so there is no earlier cost history. Expense categories are recorded loosely (for example, a gas bill may appear under maintenance or other), so judge costs by total and description rather than by category.
- Bank balances fall at times when the owner withdraws money from the business; RentStream records those withdrawals only from mid-2026. A fall in bank cash is not by itself a loss.
- Other income is money outside tenant bills (for example storage rent).
- There is no market-rent data here. Never claim rents are above or below market.
- When a question asks for the largest or smallest item, use the ranked lists below rather than scanning a table.`

export function renderRentBooks(b: RentBooks): string {
  const sections: string[] = [RENT_GUIDE, `## RentStream books as of ${b.asOf}
Full monthly billing starts: ${b.firstFullBillingMonth ? label(b.firstFullBillingMonth) : 'unknown'}. Expenses recorded since: ${b.expensesRecordedSince ?? 'no expenses recorded'}.`]

  const c = b.collections
  const done = c.filter(m => m.month < b.currentMonth)
  sections.push(`### Tenant billing and collection by collection month
${table(['Collection month', 'Rent for', 'Bills', 'Rent billed', 'Utilities billed', 'Total billed', 'Collected', 'Still unpaid', 'Unpaid bills'],
    c.map(m => [label(m.month) + (m.month === b.currentMonth ? ' (in progress)' : ''), rentFor(m.month), m.bills, bdt(m.rentBilled), bdt(m.utilitiesBilled), bdt(m.rentBilled + m.utilitiesBilled), bdt(m.collected), bdt(m.unpaid), m.unpaidBills]))}
${done.length ? `Completed months (${done.length}): average rent billed ${bdt(done.reduce((s, m) => s + m.rentBilled, 0) / done.length)}, average utilities billed ${bdt(done.reduce((s, m) => s + m.utilitiesBilled, 0) / done.length)}, average total billed ${bdt(done.reduce((s, m) => s + m.rentBilled + m.utilitiesBilled, 0) / done.length)} per month. Total billed over these months: ${bdt(done.reduce((s, m) => s + m.rentBilled + m.utilitiesBilled, 0))}.` : ''}
${done.length >= 2 ? `Rent billed, first vs latest completed month: ${change(done[0].rentBilled, done[done.length - 1].rentBilled)}.` : ''}
Collection pace on day ${b.collectionPace.day}: this month ${pct(b.collectionPace.thisMonthPercent)} of billed collected; last month on the same day ${pct(b.collectionPace.lastMonthPercent)}.`)

  sections.push(`### Overdue bills from earlier months
${b.overdue.length ? `${table(['Tenant', 'Unit', 'Building', 'Collection month', 'Unpaid'], b.overdue.map(o => [o.tenant, o.unit, o.property, label(o.month), bdt(o.unpaid)]))}
Total overdue: ${bdt(b.overdue.reduce((s, o) => s + o.unpaid, 0))}` : 'None.'}`)

  sections.push(`### Buildings
${table(['Building', 'Units', 'Tenants', 'On notice', 'Booked', 'Monthly rent roll', 'Average rent', 'Deposits held', `This month billed`, 'This month collected', 'This month unpaid (bills)'],
    b.properties.map(p => [p.name, p.units, p.tenants, p.onNotice, p.booked, bdt(p.monthlyRentRoll), bdt(p.averageRent), bdt(p.refundableDeposits), bdt(p.currentMonth.billed), bdt(p.currentMonth.collected), `${bdt(p.currentMonth.unpaid)} (${p.currentMonth.unpaidBills})`]))}
Totals: ${b.properties.reduce((s, p) => s + p.units, 0)} units, ${b.properties.reduce((s, p) => s + p.tenants, 0)} tenants, occupancy ${pct(Math.round(b.properties.reduce((s, p) => s + p.tenants, 0) / Math.max(1, b.properties.reduce((s, p) => s + p.units, 0)) * 1000) / 10)}, monthly rent roll ${bdt(b.properties.reduce((s, p) => s + p.monthlyRentRoll, 0))}.`)

  sections.push(`### Expenses paid (calendar month of payment)
${b.expenses.length ? table(['Month', 'Complete month?', 'Operating expenses', 'By category', 'Paid from tenant deposits'],
    b.expenses.map(e => [label(e.month), e.complete ? 'yes' : 'no (partial)', bdt(e.operating), Object.entries(e.byCategory).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${bdt(v)}`).join('; '), bdt(e.fromDeposits)])) : 'No expenses recorded.'}
Largest expenses in the last 60 days: ${b.largestRecentExpenses.map(e => `${e.date} ${e.description} (${e.category}) ${bdt(e.amount)}`).join('; ') || 'none'}.`)

  sections.push(`### Operating result (cash received from tenants + other income − operating expenses, by calendar month)
${b.operatingResult.length ? table(['Month', 'Complete month?', 'Cash received from tenants', 'Other income', 'Operating expenses', 'Surplus'],
    b.operatingResult.map(r => [label(r.month), r.complete ? 'yes' : 'no (partial)', bdt(r.cashCollected), bdt(r.otherIncome), bdt(r.operatingExpenses), bdt(r.surplus)])) : 'Not available: no expense records.'}
Other income items: ${b.otherIncome.map(o => `${label(o.month)}: ${o.items.join(', ')}`).join('; ') || 'none'}.`)

  const ranked = (title: string, rows: [string, number][], fmt: (n: number) => string = bdt) =>
    `${title}: ${[...rows].sort((x, y) => y[1] - x[1]).map(([name, v], i) => `${i + 1}. ${name} ${fmt(v)}`).join('; ')}.`

  // Small models cannot reliably find the highest or lowest row of a long table,
  // and fill in months that have no records. Extremes are computed here instead.
  const extremes = (rows: [string, number][]) => {
    const values = rows.map(r => r[1])
    const max = Math.max(...values), min = Math.min(...values)
    const at = (v: number) => rows.filter(r => r[1] === v).map(r => r[0]).join(' and ')
    return max === min ? `the same in every month, ${bdt(max)}` : `highest ${at(max)} ${bdt(max)}; lowest ${at(min)} ${bdt(min)}`
  }
  const byMonth = (value: (m: typeof done[number]) => number): [string, number][] => done.map(m => [label(m.month), value(m)])
  const results = b.operatingResult.filter(r => r.complete)
  const costMonths = b.expenses.filter(e => e.complete)
  const categoryTotals = Object.entries(costMonths.reduce<Record<string, number>>((t, e) => { for (const [k, v] of Object.entries(e.byCategory)) t[k] = (t[k] ?? 0) + v; return t }, {}))
  const costSpan = `${costMonths.length} complete month${costMonths.length === 1 ? '' : 's'}: ${costMonths.map(e => label(e.month)).join(', ')}`
  sections.push(`### Months ranked
Only months that appear in these books have records. Never fill in, repeat or estimate a month that is not listed.
${done.length ? `Completed collection months, ${label(done[0].month)} to ${label(done[done.length - 1].month)} (${done.length} months; the month in progress is left out; each is labelled by collection month):
- Total billed: ${extremes(byMonth(m => m.rentBilled + m.utilitiesBilled))}.
- Rent billed: ${extremes(byMonth(m => m.rentBilled))}.
- Utilities billed to tenants: ${extremes(byMonth(m => m.utilitiesBilled))}.
- Collected: ${extremes(byMonth(m => m.collected))}.` : 'No completed collection month yet.'}
Operating surplus (profit after expenses): ${results.length >= 2 ? `${extremes(results.map(r => [label(r.month), r.surplus]))} (complete months only).` : results.length === 1 ? `only one complete month has expense records (${label(results[0].month)}, surplus ${bdt(results[0].surplus)}), so months cannot be ranked by surplus or profit yet. Expenses are recorded since ${b.expensesRecordedSince}.` : 'no complete month has expense records yet, so months cannot be ranked by surplus or profit.'}
${categoryTotals.length ? `${ranked(`Expenses by category, total over ${costSpan}`, categoryTotals)} The largest expense is the first of these. Utilities billed to tenants are recovered from them, so they are not an expense of the business.${costMonths.length < 2 ? ' With only one complete month, whether an expense recurs cannot be confirmed yet.' : ''}` : 'Expenses by category: no complete month of expense records yet.'}`)

  sections.push(`### Buildings ranked (largest first)
${ranked('By tenant deposits held', b.properties.map(p => [p.name, p.refundableDeposits]))}
${ranked('By monthly rent roll', b.properties.map(p => [p.name, p.monthlyRentRoll]))}
${ranked('By average rent per tenant', b.properties.filter(p => p.averageRent !== null).map(p => [p.name, p.averageRent!]))}
${ranked("By this month's unpaid amount", b.properties.map(p => [p.name, p.currentMonth.unpaid]))}
${ranked('By units', b.properties.map(p => [p.name, p.units]), n => String(n))}`)

  const withTotals = b.bankMonthEnd.filter(m => m.total !== null)
  sections.push(`### Cash and liabilities
Bank cash now (statements plus later recorded movements): ${bdt(b.bankNow)}. Credit-card debt now: ${bdt(b.cardDebtNow)}.
Tenant deposits held (revolving; normally used as tenants' final two months of rent, replaced by new tenants' deposits): ${bdt(b.refundableDeposits)}.
Bank cash minus card debt: ${b.bankNow === null || b.cardDebtNow === null ? 'unknown' : bdt(b.bankNow - b.cardDebtNow)}.
${table(['Month end', 'Total bank cash', ...Object.keys(b.bankMonthEnd[0]?.accounts ?? {})], b.bankMonthEnd.map(m => [label(m.month), bdt(m.total), ...Object.values(m.accounts).map(bdt)]))}
${withTotals.length >= 2 ? `Total bank cash, ${label(withTotals[0].month)} to ${label(withTotals[withTotals.length - 1].month)}: ${change(withTotals[0].total, withTotals[withTotals.length - 1].total)}.` : ''}`)

  const t = b.tenancy
  sections.push(`### Tenancy
${table(['Month', 'Moved in', 'Moved out'], t.moves.map(m => [label(m.month), m.movedIn, m.movedOut]))}
Last 12 months: ${t.moves.reduce((s, m) => s + m.movedIn, 0)} moved in, ${t.moves.reduce((s, m) => s + m.movedOut, 0)} moved out.
On notice: ${t.onNotice.map(n => `${n.tenant}, unit ${n.unit}, ${n.property}, rent ${bdt(n.rent)}, leaving ${n.leaving ?? 'date not set'}`).join('; ') || 'none'}.
Booked to move in: ${t.booked.map(n => `${n.tenant}, unit ${n.unit}, ${n.property}, rent ${bdt(n.rent)}, from ${n.movingIn}`).join('; ') || 'none'}.
When current tenants' rent was last set (last rent change, or move-in if never changed): ${t.rentLastSet.map(r => `${r.label}: ${r.tenants}`).join('; ')}.`)

  const o = b.opportunities
  sections.push(`### Opportunities and limits visible in these records (facts, not targets)
- Rent not changed for ${o.longUnchangedRent.years}+ years: ${o.longUnchangedRent.tenants} current tenants paying ${bdt(o.longUnchangedRent.monthlyRent)} a month in rent together. Occupancy is ${pct(Math.round(b.properties.reduce((s, p) => s + p.tenants, 0) / Math.max(1, b.properties.reduce((s, p) => s + p.units, 0)) * 1000) / 10)}.
- Re-letting in the last 12 months: ${o.relets.tenants} new tenants; ${o.relets.withPreviousTenant} replaced a previous tenant in the same unit. Rent went up for ${o.relets.rentUp}, stayed the same for ${o.relets.rentSame}, went down for ${o.relets.rentDown}; combined change ${bdt(o.relets.monthlyRentChange)} a month. Units stood empty ${o.relets.averageVacantDays ?? 'unknown'} days on average between tenants, about ${bdt(o.relets.rentLostWhileVacant)} of rent not earned.
- Latest complete month's operating surplus: ${o.latestCompleteSurplus ? `${bdt(o.latestCompleteSurplus.surplus)} (${label(o.latestCompleteSurplus.month)}; only one complete expense month exists, so this is not yet a trend)` : 'not available'}.
- Capital allocation (RentStream account roles): allocation-eligible cash ${bdt(o.allocation.allocationEligible)} (corporate operating, savings and personal accounts plus operating cash); family-restricted cash ${bdt(o.allocation.familyRestricted)} set apart for family use (${bdt(o.allocation.familyMonthlyOutflow)} a month protected); unclassified cash ${bdt(o.allocation.unclassified)} excluded until its role is confirmed. After card debt and a three-month operating reserve (${bdt(o.allocation.operatingReserveTarget)}, three times the last 30 days of recorded expenses), strategic deployable cash (shown on the page as "Safe to invest") is ${bdt(o.allocation.strategicDeployable)}.`)

  return sections.join('\n\n')
}
