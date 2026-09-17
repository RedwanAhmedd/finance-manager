import { monthlyEquivalent } from '../money/categorise'
import { merchantKey, type SuggestedBill } from '../money/lines'
import type { Category, MoneyData, MoneyTransaction } from '../money/types'
import type { TreasuryBalance } from '../live/models'

// The owner's personal money in Canada, as books: what was spent by category and
// month, recorded bills, draws from the rental business and account balances.
// Recorded facts only. Nothing here projects forward.

export interface PersonalMonth {
  month: string
  complete: boolean
  spending: number
  byCategory: Partial<Record<Category, number>>
  draws: number
  otherIncome: number
  net: number
  lines: number
}
export interface PersonalBooks {
  asOf: string
  currentMonth: string
  recordsSince: string | null
  months: PersonalMonth[]
  pace: { day: number; thisMonth: number; lastMonthSameDay: number | null }
  latestCompleteVsAverage: { month: string; priorMonths: number; rows: { category: Category; latest: number; priorAverage: number }[] } | null
  topMerchants: { month: string; rows: { merchant: string; spent: number; lines: number }[] } | null
  bills: {
    active: { name: string; category: Category; amount: number; cadence: string; dueDay: number | null; monthly: number }[]
    monthlyTotal: number
    subscriptionsMonthly: number
    subscriptionsCount: number
    dueLaterThisMonth: { name: string; amount: number; dueDay: number }[]
    // Monthly bills by their recorded due day, from tomorrow through the next 30 days
    // (a bill due today has usually already been charged).
    dueNext30Days: { name: string; amount: number; date: string }[]
    dueNext30DaysTotal: number
    suggested: SuggestedBill[]
  }
  draws: { date: string; cad: number; bdt: number | null }[]
  balances: { account: string; balance: number; date: string; source: 'statement' | 'rentstream' }[]
  needsReview: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const addMonths = (ym: string, n: number) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }
// The owner lives in Canada; dates on Canadian statements are local dates.
export const canadaDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

// Spending is money out as a positive number, net of refunds.
const spent = (t: MoneyTransaction) => t.kind === 'spend' || t.kind === 'refund' ? -t.amount : 0

export function buildPersonalBooks(data: MoneyData & { suggestions?: SuggestedBill[] }, now = new Date(), treasury: TreasuryBalance[] = []): PersonalBooks {
  const today = canadaDate(now)
  const current = today.slice(0, 7)
  const day = Number(today.slice(8, 10))
  const tx = data.transactions.filter(t => t.posted_date <= today)
  const recordsSince = tx.map(t => t.posted_date).sort()[0] ?? null

  const monthKeys: string[] = []
  if (recordsSince) for (let m = recordsSince.slice(0, 7); m <= current; m = addMonths(m, 1)) monthKeys.push(m)
  const months = monthKeys.slice(-7).map(month => {
    const rows = tx.filter(t => t.posted_date.startsWith(month))
    const byCategory: Partial<Record<Category, number>> = {}
    for (const t of rows) if (t.category && (t.kind === 'spend' || t.kind === 'refund')) byCategory[t.category] = round2((byCategory[t.category] ?? 0) + spent(t))
    const spending = round2(rows.reduce((s, t) => s + spent(t), 0))
    const draws = round2(rows.filter(t => t.kind === 'draw').reduce((s, t) => s + t.amount, 0))
    const otherIncome = round2(rows.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0))
    return { month, complete: month < current, spending, byCategory, draws, otherIncome, net: round2(draws + otherIncome - spending), lines: rows.length }
  })

  const spentBy = (month: string, lastDay: number) => round2(tx.filter(t => t.posted_date.startsWith(month) && Number(t.posted_date.slice(8, 10)) <= lastDay).reduce((s, t) => s + spent(t), 0))
  const lastMonth = addMonths(current, -1)
  const pace = { day, thisMonth: spentBy(current, day), lastMonthSameDay: monthKeys.includes(lastMonth) ? spentBy(lastMonth, day) : null }

  const complete = months.filter(m => m.complete)
  const latest = complete[complete.length - 1]
  const prior = complete.slice(-4, -1)
  const latestCompleteVsAverage = latest && prior.length ? {
    month: latest.month, priorMonths: prior.length,
    rows: [...new Set([...Object.keys(latest.byCategory), ...prior.flatMap(p => Object.keys(p.byCategory))])].map(c => {
      const category = c as Category
      return { category, latest: latest.byCategory[category] ?? 0, priorAverage: round2(prior.reduce((s, p) => s + (p.byCategory[category] ?? 0), 0) / prior.length) }
    }).sort((a, b) => Math.abs(b.latest - b.priorAverage) - Math.abs(a.latest - a.priorAverage)),
  } : null

  const topMerchantsFor = (month: string) => {
    const totals = new Map<string, { spent: number; lines: number }>()
    for (const t of tx.filter(t => t.posted_date.startsWith(month) && (t.kind === 'spend' || t.kind === 'refund'))) {
      const key = merchantKey(t.description) || t.description
      const e = totals.get(key) ?? { spent: 0, lines: 0 }
      totals.set(key, { spent: e.spent + spent(t), lines: e.lines + 1 })
    }
    return [...totals].map(([merchant, v]) => ({ merchant, spent: round2(v.spent), lines: v.lines })).sort((a, b) => b.spent - a.spent).slice(0, 8)
  }

  const active = data.bills.filter(b => b.active).map(b => ({ name: b.name, category: b.category, amount: b.amount, cadence: b.cadence, dueDay: b.due_day, monthly: monthlyEquivalent(b.amount, b.cadence) }))
    .sort((a, b) => b.monthly - a.monthly)
  const subscriptions = active.filter(b => b.category === 'subscriptions')
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 30)
  const lastDay = end.toISOString().slice(0, 10)
  const dueNext30Days = active.filter(b => b.cadence === 'monthly' && b.dueDay !== null).flatMap(b => [current, addMonths(current, 1), addMonths(current, 2)].map(m => {
    const daysInMonth = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()
    return { name: b.name, amount: b.amount, date: `${m}-${String(Math.min(b.dueDay!, daysInMonth)).padStart(2, '0')}` }
  })).filter(x => x.date > today && x.date <= lastDay).sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)

  const latestByAccount = new Map<string, MoneyTransaction>()
  for (const t of [...tx].sort((a, b) => a.posted_date.localeCompare(b.posted_date))) if (t.balance_after !== null) latestByAccount.set(t.account, t)

  return {
    asOf: today, currentMonth: current, recordsSince, months, pace, latestCompleteVsAverage,
    topMerchants: latest ? { month: latest.month, rows: topMerchantsFor(latest.month) } : null,
    bills: {
      active, monthlyTotal: round2(active.reduce((s, b) => s + b.monthly, 0)),
      subscriptionsMonthly: round2(subscriptions.reduce((s, b) => s + b.monthly, 0)), subscriptionsCount: subscriptions.length,
      dueLaterThisMonth: active.filter(b => b.cadence === 'monthly' && b.dueDay !== null && b.dueDay > day).map(b => ({ name: b.name, amount: b.amount, dueDay: b.dueDay! })).sort((a, b) => a.dueDay - b.dueDay),
      dueNext30Days, dueNext30DaysTotal: round2(dueNext30Days.reduce((s, b) => s + b.amount, 0)),
      suggested: data.suggestions ?? [],
    },
    draws: tx.filter(t => t.kind === 'draw' && t.posted_date >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`).map(t => ({ date: t.posted_date, cad: t.amount, bdt: t.amount_bdt })).sort((a, b) => b.date.localeCompare(a.date)),
    // Latest balance per account: RentStream treasury accounts (the owner's recorded
    // Canadian balances) and any balance column in imported statement lines.
    balances: (() => {
      const latest = new Map<string, { account: string; balance: number; date: string; source: 'statement' | 'rentstream' }>()
      for (const [account, t] of latestByAccount) latest.set(account, { account, balance: t.balance_after!, date: t.posted_date, source: 'statement' })
      for (const a of treasury.filter(a => a.currency === 'CAD' && a.balanceAsOf <= today)) latest.set(a.name, { account: a.name, balance: a.balance, date: a.balanceAsOf, source: 'rentstream' })
      return [...latest.values()].sort((a, b) => b.balance - a.balance)
    })(),
    needsReview: tx.filter(t => t.flagged).length,
  }
}
