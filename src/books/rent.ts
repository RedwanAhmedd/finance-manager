import { dhakaDate, number, type RentSnapshot } from '../live/models'
import type { RentRaw } from '../live/rentstream'

// RentStream's own record, reshaped into the books an accountant would keep:
// collections by month, costs, cash, liabilities, arrears and tenancy. Every
// figure is computed here so the assistant reads results, not raw rows.

type Row = RentRaw['payments'][number]
export interface RentDetail {
  properties: { id: string; address: string; total_units: number }[]
  manualIncome: { id: string; income_date: string; amount: number | string; description: string | null }[]
  rentHistory: { id: string; tenant_id: string | null; effective_from: string }[]
}

export interface MonthCollections {
  month: string // collection month YYYY-MM; the rent is for the month before
  bills: number
  rentBilled: number
  utilitiesBilled: number
  collected: number
  unpaid: number
  unpaidBills: number
}
export interface PropertyBook {
  name: string
  units: number
  tenants: number
  onNotice: number
  booked: number
  monthlyRentRoll: number
  averageRent: number | null
  refundableDeposits: number
  currentMonth: { billed: number; collected: number; unpaid: number; unpaidBills: number }
}
export interface RentBooks {
  asOf: string
  currentMonth: string
  firstFullBillingMonth: string | null
  expensesRecordedSince: string | null
  collections: MonthCollections[]
  collectionPace: { day: number; thisMonthPercent: number | null; lastMonthPercent: number | null }
  expenses: { month: string; complete: boolean; byCategory: Record<string, number>; operating: number; fromDeposits: number }[]
  largestRecentExpenses: { date: string; category: string; description: string; amount: number }[]
  otherIncome: { month: string; total: number; items: string[] }[]
  operatingResult: { month: string; complete: boolean; cashCollected: number; otherIncome: number; operatingExpenses: number; surplus: number }[]
  properties: PropertyBook[]
  bankMonthEnd: { month: string; total: number | null; accounts: Record<string, number | null> }[]
  bankNow: number | null
  cardDebtNow: number | null
  refundableDeposits: number
  overdue: { tenant: string; unit: string; property: string; month: string; unpaid: number }[]
  tenancy: {
    moves: { month: string; movedIn: number; movedOut: number }[]
    onNotice: { tenant: string; unit: string; property: string; rent: number; leaving: string | null }[]
    booked: { tenant: string; unit: string; property: string; rent: number; movingIn: string }[]
    rentLastSet: { label: string; tenants: number }[]
  }
  opportunities: {
    longUnchangedRent: { years: number; tenants: number; monthlyRent: number }
    relets: { tenants: number; withPreviousTenant: number; rentUp: number; rentSame: number; rentDown: number; monthlyRentChange: number; averageVacantDays: number | null; rentLostWhileVacant: number }
    reserve: { latestCompleteExpenseMonth: string | null; oneMonthOperatingExpenses: number | null; cashAfterDebtAndReserve: number | null }
    latestCompleteSurplus: { month: string; surplus: number } | null
  }
}

const month = (date: string) => date.slice(0, 7)
const addMonths = (ym: string, n: number) => {
  const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)
const due = (p: Row) => number(p.amount) + number(p.utility_bill)
const unpaid = (p: Row) => Math.max(0, due(p) - number(p.amount_paid))
const owes = (p: Row) => p.status !== 'paid' && unpaid(p) > 0

export function buildRentBooks(raw: RentRaw & RentDetail, snapshot: RentSnapshot, now = new Date()): RentBooks {
  const today = dhakaDate(now)
  const current = month(today)
  const current_tenants = raw.tenants.filter(t => t.status === 'active' || t.status === 'notice_given')
  const tenantById = new Map(raw.tenants.map(t => [t.id, t]))
  const propertyName = new Map(raw.properties.map(p => [p.id, p.address]))
  const who = (tenantId: string) => {
    const t = tenantById.get(tenantId)
    return { tenant: t?.name ?? 'unknown tenant', unit: t?.unit_number ?? '?', property: propertyName.get(t?.property_id ?? '') ?? 'unknown property' }
  }

  // Billing is complete from the first month with a bill for most occupied units;
  // earlier months hold only a few back-filled bills and would distort trends.
  const billsByMonth = new Map<string, Row[]>()
  for (const p of raw.payments) if (month(p.payment_month) <= current) billsByMonth.set(month(p.payment_month), [...(billsByMonth.get(month(p.payment_month)) ?? []), p])
  const fullMonths = [...billsByMonth.entries()].filter(([, rows]) => rows.length >= current_tenants.length * 0.8).map(([m]) => m).sort()
  const firstFullBillingMonth = fullMonths[0] ?? null
  const months = Array.from({ length: 13 }, (_, i) => addMonths(current, i - 12)).filter(m => firstFullBillingMonth && m >= firstFullBillingMonth)

  const collections = months.map(m => {
    const rows = billsByMonth.get(m) ?? []
    return {
      month: m, bills: rows.length,
      rentBilled: sum(rows, r => number(r.amount)), utilitiesBilled: sum(rows, r => number(r.utility_bill)),
      collected: sum(rows, r => number(r.amount_paid)),
      unpaid: sum(rows.filter(owes), unpaid) + sum(rows.filter(r => m === current && r.status === 'paid'), unpaid),
      unpaidBills: rows.filter(r => r.status !== 'paid').length,
    }
  })

  // How far through collection this month is, against last month on the same day.
  const day = Number(today.slice(8, 10))
  const paymentById = new Map(raw.payments.map(p => [p.id, p]))
  const pace = (m: string) => {
    const billed = sum(billsByMonth.get(m) ?? [], due)
    if (!billed) return null
    const cutoff = `${m}-${String(day).padStart(2, '0')}`
    const got = sum(raw.entries.filter(e => e.payment_id && e.payment_date && month(paymentById.get(e.payment_id)?.payment_month ?? '') === m && e.payment_date <= cutoff), e => number(e.amount))
    return Math.round(got / billed * 1000) / 10
  }

  const expenseDates = raw.expenses.map(e => e.expense_date).filter(d => d <= today).sort()
  const expensesRecordedSince = expenseDates[0] ?? null
  const firstCompleteExpenseMonth = expensesRecordedSince ? (expensesRecordedSince.slice(8) === '01' ? month(expensesRecordedSince) : addMonths(month(expensesRecordedSince), 1)) : null
  const expenseMonths = [...new Set(expenseDates.map(month))]
  const expenses = expenseMonths.map(m => {
    const rows = raw.expenses.filter(e => month(e.expense_date) === m && e.expense_date <= today)
    const operatingRows = rows.filter(e => e.cash_source_type !== 'security_deposit')
    const byCategory: Record<string, number> = {}
    for (const e of operatingRows) byCategory[e.category ?? 'uncategorised'] = (byCategory[e.category ?? 'uncategorised'] ?? 0) + number(e.amount)
    return { month: m, complete: !!firstCompleteExpenseMonth && m >= firstCompleteExpenseMonth && m < current, byCategory, operating: sum(operatingRows, e => number(e.amount)), fromDeposits: sum(rows.filter(e => e.cash_source_type === 'security_deposit'), e => number(e.amount)) }
  })
  const recentCutoff = dhakaDate(new Date(now.getTime() - 60 * 86400000))
  const largestRecentExpenses = raw.expenses.filter(e => e.expense_date >= recentCutoff && e.expense_date <= today)
    .sort((a, b) => number(b.amount) - number(a.amount)).slice(0, 12)
    .map(e => ({ date: e.expense_date, category: e.category ?? 'uncategorised', description: e.description?.trim() || '(no description)', amount: number(e.amount) }))

  const otherIncome = [...new Set(raw.manualIncome.filter(i => i.income_date <= today).map(i => month(i.income_date)))].sort().map(m => {
    const rows = raw.manualIncome.filter(i => month(i.income_date) === m)
    return { month: m, total: sum(rows, i => number(i.amount)), items: rows.map(i => `${i.description?.trim() || 'unlabelled'} ৳${number(i.amount).toLocaleString('en-US')}`) }
  })

  // Cash actually received in each calendar month, less what was spent from
  // operating cash. Only months with expense records give a real result.
  const operatingResult = expenses.map(e => {
    // Entries without a date (historical back-fill) cannot be placed in a month.
    const cashCollected = sum(raw.entries.filter(x => x.payment_date && month(x.payment_date) === e.month && x.payment_date <= today), x => number(x.amount))
    const other = otherIncome.find(o => o.month === e.month)?.total ?? 0
    return { month: e.month, complete: e.complete, cashCollected, otherIncome: other, operatingExpenses: e.operating, surplus: cashCollected + other - e.operating }
  })

  const properties = raw.properties.map(p => {
    const here = current_tenants.filter(t => t.property_id === p.id)
    const bills = (billsByMonth.get(current) ?? []).filter(b => (b.property_id ?? tenantById.get(b.tenant_id)?.property_id) === p.id)
    const roll = sum(here, t => number(t.rent_amount ?? 0))
    return {
      name: p.address, units: p.total_units, tenants: here.length,
      onNotice: here.filter(t => t.status === 'notice_given').length,
      booked: raw.tenants.filter(t => t.property_id === p.id && t.status === 'booked').length,
      monthlyRentRoll: roll, averageRent: here.length ? Math.round(roll / here.length) : null,
      refundableDeposits: 0,
      currentMonth: { billed: sum(bills, due), collected: sum(bills, b => number(b.amount_paid)), unpaid: sum(bills, unpaid), unpaidBills: bills.filter(b => b.status !== 'paid').length },
    }
  })
  // Refundable deposits per property, using the same per-tenant ledger as the snapshot.
  const depositByTenant = new Map(raw.tenants.map(t => [t.id, number(t.deposit_opening_liability)]))
  for (const d of raw.deposits.filter(d => d.transaction_date <= today)) depositByTenant.set(d.tenant_id, (depositByTenant.get(d.tenant_id) ?? 0) + number(d.amount) * (d.transaction_type === 'received' ? 1 : -1))
  for (const [tenantId, amount] of depositByTenant) {
    const book = properties.find(p => p.name === propertyName.get(tenantById.get(tenantId)?.property_id ?? ''))
    if (book) book.refundableDeposits += Math.max(0, amount)
  }

  const bankAccounts = raw.accounts.filter(a => !a.is_archived && a.account_type !== 'credit_card')
  const bankMonthEnd = months.filter(m => m < current).map(m => {
    const accounts: Record<string, number | null> = {}
    for (const a of bankAccounts) {
      const s = raw.statements.filter(x => x.bank_account_id === a.id && month(x.statement_date) === m).sort((x, y) => y.statement_date.localeCompare(x.statement_date))[0]
      accounts[a.name] = s ? number(s.closing_balance) : null
    }
    const values = Object.values(accounts)
    return { month: m, accounts, total: values.some(v => v === null) ? null : sum(values as number[], v => v) }
  })

  const moveMonths = months.filter(m => m >= addMonths(current, -11))
  const tenancy = {
    moves: moveMonths.map(m => ({ month: m, movedIn: raw.tenants.filter(t => t.status !== 'booked' && month(t.move_in_date) === m).length, movedOut: raw.tenants.filter(t => t.actual_move_out_date && month(t.actual_move_out_date) === m).length })),
    onNotice: raw.tenants.filter(t => t.status === 'notice_given').map(t => ({ ...who(t.id), rent: number(t.rent_amount ?? 0), leaving: t.planned_move_out_date ?? null })),
    booked: raw.tenants.filter(t => t.status === 'booked').map(t => ({ ...who(t.id), rent: number(t.rent_amount ?? 0), movingIn: t.move_in_date })),
    rentLastSet: (() => {
      const lastChange = new Map<string, string>()
      for (const h of raw.rentHistory) if (h.tenant_id && h.effective_from <= today && h.effective_from > (lastChange.get(h.tenant_id) ?? '')) lastChange.set(h.tenant_id, h.effective_from)
      const years = current_tenants.map(t => (now.getTime() - new Date(lastChange.get(t.id) ?? t.move_in_date).getTime()) / (365.25 * 86400000))
      return [
        { label: 'under 1 year ago', tenants: years.filter(y => y < 1).length },
        { label: '1 to 2 years ago', tenants: years.filter(y => y >= 1 && y < 2).length },
        { label: '2 to 3 years ago', tenants: years.filter(y => y >= 2 && y < 3).length },
        { label: '3 or more years ago', tenants: years.filter(y => y >= 3).length },
      ]
    })(),
  }

  // Levers visible in the owner's own records. Facts only: no market rents or
  // targets are assumed.
  const lastSet = new Map<string, string>()
  for (const h of raw.rentHistory) if (h.tenant_id && h.effective_from <= today && h.effective_from > (lastSet.get(h.tenant_id) ?? '')) lastSet.set(h.tenant_id, h.effective_from)
  const yearsSince = (d: string) => (now.getTime() - new Date(d).getTime()) / (365.25 * 86400000)
  const unchanged = current_tenants.filter(t => yearsSince(lastSet.get(t.id) ?? t.move_in_date) >= 3)
  const yearAgo = dhakaDate(new Date(now.getTime() - 365 * 86400000))
  const newTenants = raw.tenants.filter(t => t.status !== 'inactive' && t.move_in_date >= yearAgo && t.move_in_date <= today)
  const relets = newTenants.map(t => {
    const previous = raw.tenants.filter(p => p.id !== t.id && p.property_id === t.property_id && p.unit_number === t.unit_number && p.actual_move_out_date && p.actual_move_out_date <= t.move_in_date)
      .sort((a, b) => b.actual_move_out_date!.localeCompare(a.actual_move_out_date!))[0]
    if (!previous || t.unit_number == null) return null
    const vacantDays = Math.round((new Date(t.move_in_date).getTime() - new Date(previous.actual_move_out_date!).getTime()) / 86400000)
    return { change: number(t.rent_amount ?? 0) - number(previous.rent_amount ?? 0), vacantDays, lost: number(previous.rent_amount ?? 0) * vacantDays / 30 }
  }).filter((r): r is NonNullable<typeof r> => r !== null)
  const latestComplete = [...expenses].filter(e => e.complete).pop() ?? null
  const surplus = [...operatingResult].filter(o => o.complete).pop() ?? null
  const opportunities = {
    longUnchangedRent: { years: 3, tenants: unchanged.length, monthlyRent: sum(unchanged, t => number(t.rent_amount ?? 0)) },
    relets: {
      tenants: newTenants.length, withPreviousTenant: relets.length,
      rentUp: relets.filter(r => r.change > 0).length, rentSame: relets.filter(r => r.change === 0).length, rentDown: relets.filter(r => r.change < 0).length,
      monthlyRentChange: sum(relets, r => r.change),
      averageVacantDays: relets.length ? Math.round(sum(relets, r => r.vacantDays) / relets.length) : null,
      rentLostWhileVacant: Math.round(sum(relets, r => r.lost)),
    },
    reserve: {
      latestCompleteExpenseMonth: latestComplete?.month ?? null,
      oneMonthOperatingExpenses: latestComplete?.operating ?? null,
      // Deposits revolve (they become departing tenants' final rent), so they are not held back here.
      cashAfterDebtAndReserve: snapshot.bankCashBdt === null || snapshot.cardDebtBdt === null || !latestComplete ? null
        : snapshot.bankCashBdt - snapshot.cardDebtBdt - latestComplete.operating,
    },
    latestCompleteSurplus: surplus ? { month: surplus.month, surplus: surplus.surplus } : null,
  }

  return {
    opportunities,
    asOf: today, currentMonth: current, firstFullBillingMonth, expensesRecordedSince,
    collections, collectionPace: { day, thisMonthPercent: pace(current), lastMonthPercent: pace(addMonths(current, -1)) },
    expenses, largestRecentExpenses, otherIncome, operatingResult, properties, bankMonthEnd,
    bankNow: snapshot.bankCashBdt, cardDebtNow: snapshot.cardDebtBdt, refundableDeposits: snapshot.refundableDepositsBdt,
    overdue: raw.payments.filter(p => month(p.payment_month) < current && owes(p)).map(p => ({ ...who(p.tenant_id), month: month(p.payment_month), unpaid: unpaid(p) })),
    tenancy,
  }
}
