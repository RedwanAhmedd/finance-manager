import { buildRentBooks, type RentDetail } from '../books/rent'
import { buildStockBooks, type StockDetail } from '../books/stock'
import type { FxReference } from '../books/overview'
import { canadaDate } from '../books/personal'
import { dhakaDate, type RentSnapshot, type StockSnapshot } from '../live/models'
import { normalizeRent, type RentRaw } from '../live/rentstream'
import { normalizeStock, type StockRaw } from '../live/stockstream'
import { suggestBills } from '../money/lines'
import type { Bill, MoneyData, MoneyTransaction } from '../money/types'
import type { SuggestedBill } from '../money/lines'

// Made-up records for the demo. They go through exactly the same normalisers
// and books as the owner's real data, so the demo is the live app with sample
// numbers. Dates are relative to today so the demo never goes stale. No real
// names, balances or accounts appear here.

const DAY = 86_400_000
const pick = (seed: number, min: number, max: number, step = 1) => min + Math.floor(((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * ((max - min) / step + 1)) * step
const ym = (date: string) => date.slice(0, 7)
const addMonths = (month: string, n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }
const onDay = (month: string, day: number) => `${month}-${String(Math.min(day, 28)).padStart(2, '0')}`

export function sampleRent(now = new Date()): RentSnapshot {
  const today = dhakaDate(now), current = ym(today), dayOfMonth = Number(today.slice(8, 10))
  const properties = [
    { id: 'p1', address: 'Sample Tower', total_units: 12 },
    { id: 'p2', address: 'Garden House', total_units: 8 },
    { id: 'p3', address: 'Lake View', total_units: 6 },
  ]
  const tenants: RentRaw['tenants'] = []
  let unit = 0
  for (const p of properties) for (let i = 1; i <= p.total_units; i++) {
    unit++
    const movedIn = addMonths(current, -pick(unit, 6, 60))
    tenants.push({
      id: `t${unit}`, name: `Tenant ${unit}`, unit_number: `${p.id.toUpperCase()}-${i}`, property_id: p.id,
      rent_amount: pick(unit + 3, 8000, 15000, 500), deposit_opening_liability: pick(unit + 7, 20000, 45000, 5000),
      status: unit === 5 ? 'notice_given' : unit === 26 ? 'inactive' : 'active', move_in_date: `${movedIn}-01`,
      actual_move_out_date: unit === 26 ? onDay(addMonths(current, -1), 20) : null,
      planned_move_out_date: unit === 5 ? onDay(addMonths(current, 1), 28) : null,
    })
  }
  tenants.push({ id: 't27', name: 'Tenant 27', unit_number: 'P3-6', property_id: 'p3', rent_amount: 11500, deposit_opening_liability: 0, status: 'active', move_in_date: `${addMonths(current, -1)}-25`, actual_move_out_date: null, planned_move_out_date: null })

  const payments: RentRaw['payments'] = []
  const entries: RentRaw['entries'] = []
  for (let back = 11; back >= 0; back--) {
    const month = addMonths(current, -back)
    for (const t of tenants) {
      if (t.move_in_date > `${month}-01` || (t.actual_move_out_date && t.actual_move_out_date < `${addMonths(month, -1)}-01`)) continue
      const n = Number(t.id.slice(1)), id = `${t.id}-${month}`
      const rent = Number(t.rent_amount), utility = pick(n * 31 + back, 900, 2600, 50)
      const payDay = pick(n * 7 + back, 3, 26)
      const overdue = back === 1 && (n === 3 || n === 17)
      const paidNow = back > 0 ? !overdue : payDay <= dayOfMonth
      const paid = overdue ? Math.round((rent + utility) / 2) : paidNow ? rent + utility : 0
      payments.push({ id, tenant_id: t.id, property_id: t.property_id, payment_month: `${month}-01`, status: paid >= rent + utility ? 'paid' : paid > 0 ? 'partial' : 'unpaid', amount: rent, utility_bill: utility, amount_paid: paid })
      if (paid > 0) entries.push({ id: `e-${id}`, payment_id: id, payment_date: onDay(month, back === 0 ? Math.min(payDay, dayOfMonth) : payDay), amount: paid })
    }
  }

  const expenses: RentRaw['expenses'] = []
  for (let back = 2; back >= 0; back--) {
    const month = addMonths(current, -back)
    const lines: [number, string, number, string][] = [[5, 'salary', 45000, 'Caretakers'], [10, 'utilities', 38000, 'Electricity bill'], [14, 'utilities', 21000, 'Gas bill'], [18, 'maintenance', 12500, 'Pump repair'], [22, 'other', 6000, 'Cleaning'], [25, 'supplies', 4200, 'Bulbs and paint']]
    lines.forEach(([day, category, amount, description], i) => { if (back > 0 || day <= dayOfMonth) expenses.push({ id: `x-${month}-${i}`, expense_date: onDay(month, day), amount, category, cash_source_type: 'operating', description }) })
  }
  expenses.push({ id: 'x-deposit', expense_date: onDay(addMonths(current, -1), 21), amount: 3000, category: 'repairs', cash_source_type: 'security_deposit', description: 'Paint after move-out' })

  const accounts: RentRaw['accounts'] = [
    { id: 'a1', name: 'Sample Operating', account_type: 'bank', balance_known: true, is_archived: false, opening_balance: 0, opening_balance_as_of: `${addMonths(current, -11)}-01`, financial_role: 'corporate_operating', monthly_protected_outflow: 0 },
    { id: 'a2', name: 'Sample Savings', account_type: 'bank', balance_known: true, is_archived: false, opening_balance: 0, opening_balance_as_of: `${addMonths(current, -11)}-01`, financial_role: 'savings', monthly_protected_outflow: 0 },
    { id: 'a3', name: 'Family Account', account_type: 'bank', balance_known: true, is_archived: false, opening_balance: 0, opening_balance_as_of: `${addMonths(current, -11)}-01`, financial_role: 'family_restricted', monthly_protected_outflow: 40000 },
    { id: 'a4', name: 'Sample Card', account_type: 'credit_card', balance_known: true, is_archived: false, opening_balance: 0, opening_balance_as_of: `${addMonths(current, -11)}-01`, financial_role: 'unclassified', monthly_protected_outflow: 0 },
  ]
  const statements: RentRaw['statements'] = []
  for (let back = 10; back >= 1; back--) {
    const month = addMonths(current, -back), end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
    statements.push(
      { id: `s1-${month}`, bank_account_id: 'a1', statement_date: end, closing_balance: 180000 + pick(back, 0, 120000, 1000) },
      { id: `s2-${month}`, bank_account_id: 'a2', statement_date: end, closing_balance: 1200000 + (10 - back) * 35000 },
      { id: `s3-${month}`, bank_account_id: 'a3', statement_date: end, closing_balance: 260000 - back * 3000 },
      { id: `s4-${month}`, bank_account_id: 'a4', statement_date: end, closing_balance: -pick(back + 40, 8000, 25000, 500) },
    )
  }
  const transactions: RentRaw['transactions'] = [3, 9, 15].filter(d => d <= dayOfMonth).map((d, i) => ({ id: `tx${i}`, bank_account_id: 'a1', txn_date: onDay(current, d), txn_type: 'deposit', amount: 60000 }))

  const raw: RentRaw & RentDetail = {
    accounts, statements, transactions, payments, entries, expenses, tenants, properties,
    treasury: [
      { id: 'c1', name: 'Sample Chequing (Canada)', institution: 'Sample Bank', country: 'Canada', currency: 'CAD', balance: 1240.5, balance_as_of: today, is_archived: false },
      { id: 'c2', name: 'Sample Savings (Canada)', institution: 'Sample Bank', country: 'Canada', currency: 'CAD', balance: 3100, balance_as_of: today, is_archived: false },
    ],
    deposits: [{ id: 'd1', tenant_id: 't26', transaction_date: onDay(addMonths(current, -1), 21), transaction_type: 'applied', amount: 3000 }],
    locks: [{ id: 'l1', lock_date: today, actual_cash_count: 0 }],
    cash: [{ cash_source_type: 'operating', remaining_amount: 0 }],
    manualIncome: [{ id: 'm1', income_date: onDay(addMonths(current, -1), 16), amount: 6000, description: 'Storage rent' }],
    rentHistory: tenants.filter((_, i) => i % 4 === 0).map(t => ({ id: `h-${t.id}`, tenant_id: t.id, effective_from: `${addMonths(current, -pick(Number(t.id.slice(1)), 13, 50))}-01` })),
  }
  const snapshot = normalizeRent(raw, now)
  return { ...snapshot, books: buildRentBooks(raw, snapshot, now) }
}

export function sampleStock(now = new Date()): StockSnapshot {
  const today = now.toISOString().slice(0, 10), current = ym(today)
  const days = Array.from({ length: 15 }, (_, i) => new Date(now.getTime() - (14 - i) * DAY).toISOString().slice(0, 10))
  const quote = (symbol: string, start: number, drift: number) => days.map((d, i) => ({ symbol, trade_date: d, close: Math.round(start * (1 + drift * i + 0.01 * Math.sin(i)) * 100) / 100 }))
  const raw: StockRaw & StockDetail = {
    positions: [
      { id: 'q1', symbol: 'CORE.TO', role: 'core', shares: 0, manual_price: null, anchor_price: null, anchor_underlying: null, updated_at: today },
      { id: 'q2', symbol: 'ACME.NE', role: 'satellite', shares: 0, manual_price: null, anchor_price: null, anchor_underlying: null, updated_at: today },
      { id: 'q3', symbol: 'GLOBEX.NE', role: 'satellite', shares: 0, manual_price: null, anchor_price: null, anchor_underlying: null, updated_at: today },
      { id: 'q4', symbol: 'CAD', role: 'cash', shares: 45.1, manual_price: null, anchor_price: null, anchor_underlying: null, updated_at: today },
    ],
    trades: [
      { id: 'r1', symbol: 'CORE.TO', trade_date: `${addMonths(current, -2)}-10`, shares: 20, price: 40, created_at: today },
      { id: 'r2', symbol: 'ACME.NE', trade_date: `${addMonths(current, -2)}-18`, shares: 15, price: 22, created_at: today },
      { id: 'r3', symbol: 'CORE.TO', trade_date: `${addMonths(current, -1)}-09`, shares: 10, price: 41.5, created_at: today },
      { id: 'r4', symbol: 'GLOBEX.NE', trade_date: `${addMonths(current, -1)}-15`, shares: 12, price: 18, created_at: today },
      { id: 'r5', symbol: 'ACME.NE', trade_date: `${addMonths(current, -1)}-22`, shares: -5, price: 25, created_at: today },
      { id: 'r6', symbol: 'CORE.TO', trade_date: onDay(current, 2), shares: 6, price: 42, created_at: today },
    ],
    quotes: [...quote('CORE.TO', 41.2, 0.001), ...quote('ACME', 190, 0.004), ...quote('GLOBEX', 150, -0.002)],
    symbols: [
      { symbol: 'CORE.TO', currency: 'CAD', underlying_symbol: null, cdr_ratio: null, cdr_fx_rate: null, cdr_as_of: null, display_name: 'Sample Global Equity ETF' },
      { symbol: 'ACME.NE', currency: 'CAD', underlying_symbol: 'ACME', cdr_ratio: 0.1, cdr_fx_rate: 1.37, cdr_as_of: today, display_name: 'Acme Corp CDR (CAD Hedged)' },
      { symbol: 'GLOBEX.NE', currency: 'CAD', underlying_symbol: 'GLOBEX', cdr_ratio: 0.1, cdr_fx_rate: 1.37, cdr_as_of: today, display_name: 'Globex CDR (CAD Hedged)' },
      { symbol: 'CAD', currency: 'CAD', underlying_symbol: null, cdr_ratio: null, cdr_fx_rate: null, cdr_as_of: null, display_name: 'Canadian dollar cash' },
    ],
    settings: [{ user_id: 'sample', base_currency: 'CAD', contributed_ytd: 2100, goal_amount: 20000, goal_date: `${Number(today.slice(0, 4)) + 4}-06-01` }],
    fx: [], watchlist: [{ symbol: 'INITECH' }],
  }
  const snapshot = normalizeStock(raw, now)
  return { ...snapshot, books: buildStockBooks(raw, snapshot, now) }
}

export function sampleMoney(now = new Date()): MoneyData & { suggestions: SuggestedBill[] } {
  const today = canadaDate(now), current = ym(today), dayOfMonth = Number(today.slice(8, 10))
  const bills: Bill[] = [
    { id: 'b1', name: 'Rent', category: 'housing', amount: 1450, cadence: 'monthly', due_day: 1, account: null, active: true, note: null },
    { id: 'b2', name: 'Mobile plan', category: 'phone_internet', amount: 55, cadence: 'monthly', due_day: 12, account: null, active: true, note: null },
    { id: 'b3', name: 'Streaming', category: 'subscriptions', amount: 16.99, cadence: 'monthly', due_day: 20, account: null, active: true, note: null },
    { id: 'b4', name: 'Cloud storage', category: 'subscriptions', amount: 3.99, cadence: 'monthly', due_day: 26, account: null, active: true, note: null },
  ]
  const transactions: MoneyTransaction[] = []
  let n = 0
  const add = (date: string, description: string, amount: number, kind: MoneyTransaction['kind'], category: MoneyTransaction['category'], extra: Partial<MoneyTransaction> = {}) =>
    transactions.push({ id: `m${++n}`, account: 'manual', posted_date: date, description, amount, amount_bdt: null, kind, category, flagged: false, balance_after: null, bill_id: null, note: null, source: 'manual', import_hash: `sample|${n}`, ...extra })
  for (let back = 3; back >= 0; back--) {
    const month = addMonths(current, -back)
    const lines: [number, string, number, MoneyTransaction['category']][] = [
      [1, 'Rent', 1450, 'housing'], [4, 'Grocery store', 96 + back * 7, 'groceries'], [9, 'Transit pass', 128, 'transport'], [11, 'Grocery store', 84, 'groceries'],
      [12, 'Mobile plan', 55, 'phone_internet'], [15, 'Dinner out', 42 + back * 5, 'dining'], [18, 'Grocery store', 103, 'groceries'], [20, 'Streaming', 16.99, 'subscriptions'],
      [23, 'Pharmacy', 24, 'health'], [26, 'Cloud storage', 3.99, 'subscriptions'], [27, back === 1 ? 'Winter jacket' : 'Household items', back === 1 ? 180 : 35, 'shopping'],
    ]
    for (const [day, description, amount, category] of lines) if (back > 0 || day <= dayOfMonth) add(onDay(month, day), description, -amount, 'spend', category)
    if (back === 2 || back === 0 && dayOfMonth >= 6) add(onDay(month, 6), 'Draw from rental business', 2500, 'draw', null, { amount_bdt: 220000 })
  }
  return { transactions, bills, rules: [], suggestions: suggestBills(transactions, bills.map(b => b.name)) }
}

export const sampleFx = (now = new Date()): FxReference => ({ rate: 88, asOf: now.toISOString().slice(0, 10), source: 'a sample rate (demo)' })
