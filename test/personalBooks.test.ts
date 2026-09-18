import { describe, expect, it } from 'vitest'
import { buildPersonalBooks } from '../src/books/personal'
import { renderPersonalBooks } from '../src/books/renderPersonal'
import type { MoneyTransaction } from '../src/money/types'

const now = new Date('2026-09-17T16:00:00Z') // 17 Sep in Toronto
let n = 0
const t = (posted_date: string, description: string, amount: number, kind: MoneyTransaction['kind'], category: MoneyTransaction['category'] = null, extra: Partial<MoneyTransaction> = {}): MoneyTransaction =>
  ({ id: `t${++n}`, account: 'td_card', posted_date, description, amount, amount_bdt: null, kind, category, flagged: false, balance_after: null, bill_id: null, note: null, source: 'td_csv', import_hash: `h${n}`, ...extra })

const transactions = [
  t('2026-06-01', 'RENT ETRANSFER', -1600, 'spend', 'housing'), t('2026-06-10', 'LOBLAWS 12', -300, 'spend', 'groceries'),
  t('2026-07-01', 'RENT ETRANSFER', -1600, 'spend', 'housing'), t('2026-07-12', 'LOBLAWS 12', -350, 'spend', 'groceries'),
  t('2026-08-01', 'RENT ETRANSFER', -1600, 'spend', 'housing'), t('2026-08-09', 'LOBLAWS 12', -250, 'spend', 'groceries'),
  t('2026-08-10', 'UBER EATS', -90, 'spend', 'dining'), t('2026-08-20', 'LOBLAWS REFUND', 20, 'refund', 'groceries'),
  t('2026-09-01', 'RENT ETRANSFER', -1600, 'spend', 'housing'), t('2026-09-15', 'LOBLAWS 12', -200, 'spend', 'groceries'),
  t('2026-09-20', 'FUTURE', -99, 'spend', 'other'), // after today: ignored
  t('2026-08-25', 'TD VISA PREAUTH PYMT', 900, 'transfer', null, { account: 'td_chequing', balance_after: 4100 }),
  t('2026-09-02', 'WEALTHSIMPLE', -500, 'investing', null, { account: 'td_chequing', balance_after: 3600 }),
  t('2026-09-05', 'Draw from rental business', 2000, 'draw', null, { account: 'manual', amount_bdt: 176000, source: 'manual' }),
  t('2026-09-06', 'MYSTERY', -12, 'spend', 'other', { flagged: true }),
]
const bills = [
  { id: 'b1', name: 'Rent', category: 'housing' as const, amount: 1600, cadence: 'monthly' as const, due_day: 1, account: null, active: true, note: null },
  { id: 'b2', name: 'Netflix', category: 'subscriptions' as const, amount: 18.99, cadence: 'monthly' as const, due_day: 20, account: null, active: true, note: null },
  { id: 'b3', name: 'Car insurance', category: 'insurance' as const, amount: 1200, cadence: 'yearly' as const, due_day: null, account: null, active: true, note: null },
  { id: 'b4', name: 'Old gym', category: 'health' as const, amount: 40, cadence: 'monthly' as const, due_day: 5, account: null, active: false, note: null },
]

describe('Personal books', () => {
  const treasury = [{ id: 'a', name: 'TD Every Day Savings Account', institution: 'TD Canada Trust', country: 'Canada' as const, currency: 'CAD' as const, balance: 337.04, balanceAsOf: '2026-09-16' }, { id: 'b', name: 'Dhaka FDR', institution: null, country: 'Bangladesh' as const, currency: 'BDT' as const, balance: 500000, balanceAsOf: '2026-09-16' }]
  const books = buildPersonalBooks({ transactions, bills, rules: [], suggestions: [{ name: 'SPOTIFY', category: 'subscriptions', amount: 11.99, months: ['2026-07', '2026-08'] }] }, now, treasury)
  it('totals spending by month net of refunds, excluding transfers and investing', () => {
    expect(books.recordsSince).toBe('2026-06-01')
    expect(books.months.map(m => [m.month, m.complete, m.spending, m.draws, m.net])).toEqual([
      ['2026-06', true, 1900, 0, -1900], ['2026-07', true, 1950, 0, -1950], ['2026-08', true, 1920, 0, -1920], ['2026-09', false, 1812, 2000, 188],
    ])
    expect(books.months[2].byCategory).toEqual({ housing: 1600, groceries: 230, dining: 90 })
  })
  it('compares month to date with last month on the same day, and the latest month with its past average', () => {
    expect(books.pace).toEqual({ day: 17, thisMonth: 1812, lastMonthSameDay: 1940 })
    expect(books.latestCompleteVsAverage).toEqual({ month: '2026-08', priorMonths: 2, rows: [
      { category: 'groceries', latest: 230, priorAverage: 325 }, { category: 'dining', latest: 90, priorAverage: 0 }, { category: 'housing', latest: 1600, priorAverage: 1600 },
    ] })
    expect(books.topMerchants?.rows[0]).toEqual({ merchant: 'RENT ETRANSFER', spent: 1600, lines: 1 })
  })
  it('summarises bills, draws, balances and review work', () => {
    expect(books.bills).toMatchObject({ monthlyTotal: 1718.99, subscriptionsMonthly: 18.99, subscriptionsCount: 1, dueLaterThisMonth: [{ name: 'Netflix', amount: 18.99, dueDay: 20 }] })
    expect(books.bills.active.map(b => b.name)).toEqual(['Rent', 'Car insurance', 'Netflix'])
    // 17 Sep to 17 Oct: Netflix on 20 Sep and 1 Oct rent; the yearly bill has no due date.
    expect(books.bills.dueNext30Days).toEqual([{ name: 'Netflix', amount: 18.99, date: '2026-09-20' }, { name: 'Rent', amount: 1600, date: '2026-10-01' }])
    expect(books.bills.dueNext30DaysTotal).toBe(1618.99)
    // Canadian treasury C$337.04 − C$1,618.99 due.
    expect(books.bills.canadianCashAfterDueBills).toBe(-1281.95)
    expect(books.draws).toEqual([{ date: '2026-09-05', cad: 2000, bdt: 176000 }])
    // Canadian balances come from RentStream treasury accounts; BDT treasury is not personal Canadian cash.
    expect(books.balances).toEqual([{ account: 'td_chequing', balance: 3600, date: '2026-09-02', source: 'statement' }, { account: 'TD Every Day Savings Account', balance: 337.04, date: '2026-09-16', source: 'rentstream' }])
    expect(books.needsReview).toBe(1)
  })
  it('renders facts in C$ with the guide and no projections', () => {
    const text = renderPersonalBooks(books)
    expect(text).toContain('Draws from the rental business')
    expect(text).toContain('Sep 2026 (in progress) | C$1,812.00')
    expect(text).toContain('Month to date on day 17: spent C$1,812.00; last month by the same day: C$1,940.00.')
    expect(text).toContain('All bills: C$1,718.99 a month. Subscriptions: 1, C$18.99 a month.')
    expect(text).toContain('2026-09-05: C$2,000.00 (৳176,000 sent, ৳88.00 per C$)')
    expect(text).toContain('SPOTIFY C$11.99 (2 months)')
    expect(text).not.toMatch(/by (the end of|December)|will have|projected/i)
    expect(renderPersonalBooks(buildPersonalBooks({ transactions: [], bills: [], rules: [] }, now))).toContain('No statements imported and no bills recorded yet.')
  })
})
