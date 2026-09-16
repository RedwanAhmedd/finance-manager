import type { SupabaseClient } from '@supabase/supabase-js'
import { dhakaDate, number, isStale, type RentSnapshot } from './models'
import { readAll } from './read'

type Amount = number | string
export interface RentRaw {
  accounts: {id: string; name: string; account_type: string; balance_known: boolean; is_archived: boolean; opening_balance: Amount; opening_balance_as_of: string | null}[]
  transactions: {id: string; bank_account_id: string; txn_date: string; txn_type: string; amount: Amount}[]
  statements: {id: string; bank_account_id: string; statement_date: string; closing_balance: Amount}[]
  payments: {id: string; tenant_id: string; payment_month: string; amount: Amount; utility_bill: Amount; amount_paid: Amount}[]
  entries: {id: string; payment_date: string; amount: Amount}[]
  expenses: {id: string; expense_date: string; amount: Amount}[]
  deposits: {id: string; tenant_id: string; transaction_date: string; transaction_type: string; amount: Amount}[]
  tenants: {id: string; deposit_opening_liability: Amount; status: string; move_in_date: string; actual_move_out_date: string | null}[]
  locks: {id: string; lock_date: string; actual_cash_count: Amount | null}[]
  cash: {cash_source_type: string; remaining_amount: Amount}[]
}

export function normalizeRent(raw: RentRaw, now = new Date()): RentSnapshot {
  const today = dhakaDate(now)
  const month = today.slice(0, 7)
  const windowStart = dhakaDate(new Date(now.getTime() - 29 * 86400000))
  const issues: string[] = []
  const banks = raw.accounts.filter(a => !a.is_archived).map(account => {
    const statement = raw.statements.filter(s => s.bank_account_id === account.id && s.statement_date <= today)
      .sort((a, b) => b.statement_date.localeCompare(a.statement_date))[0]
    const anchorDate = statement?.statement_date ?? account.opening_balance_as_of
    let balance: number | null = null
    if (account.balance_known && anchorDate && anchorDate <= today) {
      balance = number(statement?.closing_balance ?? account.opening_balance)
      for (const txn of raw.transactions.filter(t => t.bank_account_id === account.id && t.txn_date > anchorDate && t.txn_date <= today)) {
        if (!['deposit', 'withdrawal', 'adjustment'].includes(txn.txn_type)) throw new Error(`Unsupported bank movement: ${txn.txn_type}`)
        balance += number(txn.amount) * (txn.txn_type === 'withdrawal' ? -1 : 1)
      }
    } else issues.push(`${account.name}: no known statement or opening balance.`)
    return { id: account.id, name: account.name, type: account.account_type, currency: 'BDT' as const, balance, anchorDate }
  })
  if (!banks.length) throw new Error('No RentStream accounts are visible to this user')
  const cashBanks = banks.filter(b => b.type !== 'credit_card')
  const cards = banks.filter(b => b.type === 'credit_card')
  // Credit limits and card overpayments are not withdrawable cash.
  const bankCashBdt = cashBanks.some(b => b.balance === null) ? null : cashBanks.reduce((s, b) => s + b.balance!, 0)
  const cardDebtBdt = cards.some(b => b.balance === null) ? null : cards.reduce((s, b) => s + Math.max(0, -b.balance!), 0)
  const rows = raw.payments.filter(p => p.payment_month.startsWith(month))
  if (!rows.length) issues.push('No payment records are available for the current month.')
  const expectedBdt = rows.reduce((s, p) => s + number(p.amount) + number(p.utility_bill), 0)
  const collectedBdt = rows.reduce((s, p) => s + number(p.amount_paid), 0)
  const outstandingBdt = rows.reduce((s, p) => s + Math.max(0, number(p.amount) + number(p.utility_bill) - number(p.amount_paid)), 0)
  // Match RentStream's prior-month occupancy eligibility for the billing month.
  const prevEnd = new Date(`${month}-01T00:00:00Z`); prevEnd.setUTCDate(0)
  const prevEndDate = prevEnd.toISOString().slice(0, 10)
  const prevStart = `${prevEndDate.slice(0, 7)}-01`
  const withRecords = new Set(rows.map(p => p.tenant_id))
  const missing = raw.tenants.filter(t => ['active', 'notice_given'].includes(t.status) && t.move_in_date <= prevEndDate && (!t.actual_move_out_date || t.actual_move_out_date >= prevStart) && !withRecords.has(t.id)).length
  if (missing) issues.push(`${missing} eligible tenants have no payment record for this month; expected income is incomplete.`)
  const liabilityByTenant = new Map(raw.tenants.map(t => [t.id, number(t.deposit_opening_liability)]))
  for (const txn of raw.deposits.filter(d => d.transaction_date <= today)) {
    if (!['received', 'refunded', 'applied'].includes(txn.transaction_type)) throw new Error('Unsupported deposit movement')
    if (!liabilityByTenant.has(txn.tenant_id)) throw new Error('Deposit owner is not visible')
    liabilityByTenant.set(txn.tenant_id, liabilityByTenant.get(txn.tenant_id)! + number(txn.amount) * (txn.transaction_type === 'received' ? 1 : -1))
  }
  if ([...liabilityByTenant.values()].some(v => v < -0.01)) issues.push('A tenant deposit balance is negative and needs reconciliation.')
  const refundableDepositsBdt = [...liabilityByTenant.values()].reduce((s, v) => s + Math.max(0, v), 0)
  const operating = raw.cash.filter(c => c.cash_source_type === 'operating')
  if (operating.length !== 1) throw new Error('Expected one shared operating-cash balance')
  const operatingCashBdt = number(operating[0].remaining_amount)
  if (operatingCashBdt < 0) issues.push('Recorded operating cash is negative and needs reconciliation.')
  const cashCountDate = raw.locks.filter(l => l.lock_date <= today && l.actual_cash_count !== null).map(l => l.lock_date).sort().pop() ?? null
  if (!cashCountDate) issues.push('No physical cash count is recorded. Operating cash is a ledger balance.')
  else if (isStale(cashCountDate, now)) issues.push(`Last physical cash count is ${cashCountDate}; today's operating cash is calculated, not freshly counted.`)
  issues.push('Canadian bank account is not connected. RentStream currently stores account balances in BDT.')
  return {
    fetchedAt: now.toISOString(), businessDate: today, month, banks, bankCashBdt, cardDebtBdt,
    operatingCashBdt, cashCountDate, refundableDepositsBdt, expectedBdt, collectedBdt, outstandingBdt,
    cashReceipts30dBdt: raw.entries.filter(e => e.payment_date >= windowStart && e.payment_date <= today).reduce((s,e) => s + number(e.amount), 0),
    expenses30dBdt: raw.expenses.filter(e => e.expense_date >= windowStart && e.expense_date <= today).reduce((s,e) => s + number(e.amount), 0),
    issues,
  }
}

export class ReadOnlyRentStreamAdapter {
  constructor(private readonly client: SupabaseClient) {}
  async getSnapshot(now = new Date()): Promise<RentSnapshot> {
    const c = this.client
    const read = <K extends keyof RentRaw>(key: K, table: string, fields: string, filters = {}) => readAll<RentRaw[K][number]>(c, table, fields, ['id'], filters)
    const [accounts, transactions, statements, payments, entries, expenses, deposits, tenants, locks, cashResponse] = await Promise.all([
      read('accounts', 'bank_accounts', 'id,name,account_type,balance_known,is_archived,opening_balance,opening_balance_as_of'),
      read('transactions', 'bank_transactions', 'id,bank_account_id,txn_date,txn_type,amount'),
      read('statements', 'bank_balance_statements', 'id,bank_account_id,statement_date,closing_balance'),
      read('payments', 'payments', 'id,tenant_id,payment_month,amount,utility_bill,amount_paid', { payment_month: `${dhakaDate(now).slice(0, 7)}-01` }),
      read('entries', 'payment_entries', 'id,payment_date,amount'),
      read('expenses', 'expenses', 'id,expense_date,amount'),
      read('deposits', 'security_deposit_transactions', 'id,tenant_id,transaction_date,transaction_type,amount'),
      read('tenants', 'tenants', 'id,deposit_opening_liability,status,move_in_date,actual_move_out_date'),
      read('locks', 'reconciliation_locks', 'id,lock_date,actual_cash_count'),
      c.rpc('reconciliation_cash_source_balances', { p_date: dhakaDate(now) }, { get: true }),
    ])
    if (cashResponse.error) throw new Error(`Operating cash: ${cashResponse.error.message}`)
    return normalizeRent({accounts, transactions, statements, payments, entries, expenses, deposits, tenants, locks, cash: cashResponse.data}, now)
  }
}
