import type { PersonalBooks } from './personal'

const cad = (n: number | null) => n === null ? 'unknown' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const table = (head: string[], rows: (string | number)[][]) => [head.join(' | '), head.map(() => '---').join(' | '), ...rows.map(r => r.join(' | '))].join('\n')
const words = (c: string) => c.replace('_', ' / ')
const ACCOUNT_NAMES: Record<string, string> = { td_chequing: 'TD chequing', td_card: 'TD credit card', wealthsimple: 'Wealthsimple', manual: 'manual entry' }

export const PERSONAL_GUIDE = `## How the owner's personal money in Canada works
- The owner lives in Canada. Personal spending is paid from a TD chequing account, a TD credit card and Wealthsimple. All amounts are Canadian dollars (C$).
- Spending comes from imported bank and card statements and from purchases the owner logs by hand. Hand-logged spending can miss small purchases. Recorded bills are listed separately and count as spending only once a payment is imported or logged. Moving money between the owner's own accounts (for example paying the credit card) and buying investments are not spending and are excluded.
- Income is draws from the Bangladesh rental business, entered by the owner when they happen. They are irregular.
- Bills are recurring commitments the owner recorded (rent, phone, subscriptions). Their monthly equivalent is arithmetic on those records, not a forecast.
- The current month is in progress; compare it with last month on the same day, not with a full month.
- Averages below are past averages, not expectations. Do not project future spending or balances.`

export function renderPersonalBooks(b: PersonalBooks): string {
  if (!b.recordsSince && !b.bills.active.length) return `${PERSONAL_GUIDE}\n\n## Personal money records as of ${b.asOf}\nNo statements imported and no bills recorded yet.`
  const sections = [PERSONAL_GUIDE, `## Personal money records as of ${b.asOf}
Statements recorded since: ${b.recordsSince ?? 'none imported'}. Lines still needing the owner's review: ${b.needsReview}.`]

  const categories = [...new Set(b.months.flatMap(m => Object.keys(m.byCategory)))]
  sections.push(`### Spending by month (net of refunds)
${table(['Month', 'Total spending', ...categories.map(words), 'Draws received', 'Other income', 'Net (in − spending)'],
    b.months.map(m => [label(m.month) + (m.complete ? '' : ' (in progress)'), cad(m.spending), ...categories.map(c => cad((m.byCategory as Record<string, number>)[c] ?? 0)), cad(m.draws), cad(m.otherIncome), cad(m.net)]))}
Month to date on day ${b.pace.day}: spent ${cad(b.pace.thisMonth)}; last month by the same day: ${cad(b.pace.lastMonthSameDay)}.`)

  if (b.latestCompleteVsAverage) {
    const v = b.latestCompleteVsAverage
    sections.push(`### ${label(v.month)} against the average of the ${v.priorMonths} month${v.priorMonths === 1 ? '' : 's'} before it (largest differences first)
${v.rows.map(r => `${words(r.category)}: ${cad(r.latest)} vs ${cad(r.priorAverage)} (${r.latest - r.priorAverage >= 0 ? '+' : '−'}${cad(Math.abs(r.latest - r.priorAverage))})`).join('; ')}.`)
  }
  if (b.topMerchants?.rows.length) sections.push(`### Where the money went in ${label(b.topMerchants.month)} (largest first)
${b.topMerchants.rows.map((r, i) => `${i + 1}. ${r.merchant} ${cad(r.spent)} (${r.lines} line${r.lines === 1 ? '' : 's'})`).join('; ')}.`)

  const bills = b.bills
  sections.push(`### Recorded bills
${bills.active.length ? table(['Bill', 'Category', 'Amount', 'Cadence', 'Due day', 'Monthly equivalent'], bills.active.map(x => [x.name, words(x.category), cad(x.amount), x.cadence, x.dueDay ?? '—', cad(x.monthly)])) : 'No bills recorded.'}
All bills: ${cad(bills.monthlyTotal)} a month. Subscriptions: ${bills.subscriptionsCount}, ${cad(bills.subscriptionsMonthly)} a month.
Monthly bills due in the next 30 days (by recorded due day): ${bills.dueNext30Days.map(x => `${x.name} ${cad(x.amount)} on ${x.date}`).join('; ') || 'none'}; total ${cad(bills.dueNext30DaysTotal)}.
Monthly bills still due later this month (by recorded due day): ${bills.dueLaterThisMonth.map(x => `${x.name} ${cad(x.amount)} on day ${x.dueDay}`).join('; ') || 'none'}.
Charges that repeat monthly but are not recorded as bills (suggestions): ${bills.suggested.map(s => `${s.name} ${cad(s.amount)} (${s.months.length} months)`).join('; ') || 'none'}.`)

  sections.push(`### Draws from the rental business (last 12 months)
${b.draws.length ? b.draws.map(d => `${d.date}: ${cad(d.cad)}${d.bdt ? ` (৳${d.bdt.toLocaleString('en-US')} sent, ৳${(d.bdt / d.cad).toFixed(2)} per C$)` : ''}`).join('; ') : 'None recorded.'}
Total: ${cad(b.draws.reduce((s, d) => s + d.cad, 0))}.`)

  sections.push(`### Latest recorded account balances
${b.balances.map(x => `${ACCOUNT_NAMES[x.account] ?? x.account}: ${cad(x.balance)} on ${x.date} (${x.source === 'rentstream' ? 'recorded in RentStream' : 'from a statement'})`).join('; ') || 'No balances recorded.'}`)
  return sections.join('\n\n')
}
