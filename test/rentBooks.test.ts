import { describe, expect, it } from 'vitest'
import { buildRentBooks, type RentDetail } from '../src/books/rent'
import { renderRentBooks } from '../src/books/renderRent'
import { normalizeRent, type RentRaw } from '../src/live/rentstream'

const now = new Date('2026-09-17T06:00:00Z')
function raw(): RentRaw & RentDetail {
  const tenants = [
    { id: 't1', name: 'Asha', unit_number: '1A', property_id: 'p1', rent_amount: 10000, status: 'active', move_in_date: '2020-01-01', actual_move_out_date: null, deposit_opening_liability: 20000 },
    { id: 't2', name: 'Bilal', unit_number: '1B', property_id: 'p1', rent_amount: 12000, status: 'notice_given', move_in_date: '2025-12-01', actual_move_out_date: null, planned_move_out_date: '2026-09-30', deposit_opening_liability: 24000 },
    { id: 't3', name: 'Chitra', unit_number: '2A', property_id: 'p2', rent_amount: 8000, status: 'booked', move_in_date: '2026-10-01', actual_move_out_date: null, deposit_opening_liability: 0 },
    { id: 't4', name: 'Dev', unit_number: '2B', property_id: 'p2', rent_amount: 9000, status: 'inactive', move_in_date: '2024-01-01', actual_move_out_date: '2026-08-15', deposit_opening_liability: 0 },
    { id: 't5', name: 'Esha', unit_number: '2B', property_id: 'p2', rent_amount: 9500, status: 'booked', move_in_date: '2026-09-10', actual_move_out_date: null, deposit_opening_liability: 0 },
  ]
  const bill = (id: string, tenant: string, property: string, m: string, status: string, amount: number, utility: number, paid: number) =>
    ({ id, tenant_id: tenant, property_id: property, payment_month: `${m}-01`, status, amount, utility_bill: utility, amount_paid: paid })
  return {
    accounts: [{ id: 'bank', name: 'Main', account_type: 'bank', balance_known: true, is_archived: false, opening_balance: 0, opening_balance_as_of: '2026-07-01', financial_role: 'corporate_operating', monthly_protected_outflow: 0 },
      { id: 'card', name: 'Card', account_type: 'credit_card', balance_known: true, is_archived: false, opening_balance: -500, opening_balance_as_of: '2026-07-01', financial_role: 'unclassified', monthly_protected_outflow: 0 }],
    statements: [{ id: 's7', bank_account_id: 'bank', statement_date: '2026-07-31', closing_balance: 90000 }, { id: 's8', bank_account_id: 'bank', statement_date: '2026-08-31', closing_balance: 60000 }],
    transactions: [{ id: 'x', bank_account_id: 'bank', txn_date: '2026-09-10', txn_type: 'deposit', amount: 5000 }],
    payments: [
      bill('a7', 't1', 'p1', '2026-07', 'paid', 10000, 1000, 11000), bill('b7', 't2', 'p1', '2026-07', 'paid', 12000, 1000, 13000),
      bill('a8', 't1', 'p1', '2026-08', 'paid', 10000, 1500, 11000), bill('b8', 't2', 'p1', '2026-08', 'partial', 12000, 1500, 6000),
      bill('a9', 't1', 'p1', '2026-09', 'paid', 10000, 1200, 11200), bill('b9', 't2', 'p1', '2026-09', 'unpaid', 12000, 1200, 0),
      bill('old', 't1', 'p1', '2025-01', 'paid', 9000, 0, 9000),
    ],
    entries: [
      { id: 'e7a', payment_id: 'a7', payment_date: '2026-07-05', amount: 11000 }, { id: 'e7b', payment_id: 'b7', payment_date: '2026-07-20', amount: 13000 },
      { id: 'e8a', payment_id: 'a8', payment_date: '2026-08-10', amount: 11000 }, { id: 'e8b', payment_id: 'b8', payment_date: '2026-08-25', amount: 6000 },
      { id: 'e9a', payment_id: 'a9', payment_date: '2026-09-12', amount: 11200 },
      { id: 'hist', payment_id: 'old', payment_date: null, amount: 9000 },
    ],
    expenses: [
      { id: 'x1', expense_date: '2026-07-30', amount: 1000, category: 'utilities', cash_source_type: 'operating', description: 'Electric' },
      { id: 'x2', expense_date: '2026-08-05', amount: 4000, category: 'salary', cash_source_type: 'operating', description: 'Guard' },
      { id: 'x3', expense_date: '2026-08-06', amount: 2500, category: 'other', cash_source_type: 'operating', description: 'Gas bill' },
      { id: 'x4', expense_date: '2026-08-07', amount: 700, category: 'repairs', cash_source_type: 'security_deposit', description: 'Paint on move-out' },
      { id: 'x5', expense_date: '2026-09-03', amount: 3000, category: 'salary', cash_source_type: 'operating', description: 'Guard' },
    ],
    deposits: [{ id: 'd', tenant_id: 't1', transaction_date: '2026-08-07', transaction_type: 'applied', amount: 700 }],
    tenants, locks: [], cash: [{ cash_source_type: 'operating', remaining_amount: 0 }],
    properties: [{ id: 'p1', address: 'North Building', total_units: 2 }, { id: 'p2', address: 'South Building', total_units: 2 }],
    manualIncome: [{ id: 'm', income_date: '2026-08-16', amount: 1400, description: 'Storage rent' }],
    rentHistory: [{ id: 'h', tenant_id: 't2', effective_from: '2026-01-01' }],
  }
}

describe('RentStream books', () => {
  const r = raw()
  const books = buildRentBooks(r, normalizeRent(r, now), now)
  it('ignores sparse back-filled months and follows RentStream collection months', () => {
    expect(books.firstFullBillingMonth).toBe('2026-07')
    expect(books.collections.map(c => c.month)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(books.collections[1]).toMatchObject({ rentBilled: 22000, utilitiesBilled: 3000, collected: 17000, unpaid: 7500, unpaidBills: 1 })
    expect(books.collections[2]).toMatchObject({ collected: 11200, unpaid: 13200, unpaidBills: 1 })
  })
  it('compares collection pace with last month on the same day', () => {
    expect(books.collectionPace).toEqual({ day: 17, thisMonthPercent: 45.9, lastMonthPercent: 44 })
  })
  it('separates complete expense months, deposit-funded costs and the operating result', () => {
    expect(books.expensesRecordedSince).toBe('2026-07-30')
    expect(books.expenses.map(e => [e.month, e.complete, e.operating, e.fromDeposits])).toEqual([['2026-07', false, 1000, 0], ['2026-08', true, 6500, 700], ['2026-09', false, 3000, 0]])
    expect(books.operatingResult.find(o => o.month === '2026-08')).toMatchObject({ cashCollected: 17000, otherIncome: 1400, operatingExpenses: 6500, surplus: 11900 })
  })
  it('summarises buildings, overdue bills, cash and tenancy', () => {
    expect(books.properties[0]).toMatchObject({ name: 'North Building', tenants: 2, onNotice: 1, monthlyRentRoll: 22000, averageRent: 11000, refundableDeposits: 43300 })
    expect(books.properties[1]).toMatchObject({ tenants: 0, booked: 2 })
    expect(books.overdue).toEqual([{ tenant: 'Bilal', unit: '1B', property: 'North Building', month: '2026-08', unpaid: 7500 }])
    expect(books.bankMonthEnd.map(m => m.total)).toEqual([90000, 60000])
    expect(books.bankNow).toBe(65000)
    expect(books.tenancy.moves.find(m => m.month === '2026-08')).toEqual({ month: '2026-08', movedIn: 0, movedOut: 1 })
    expect(books.tenancy.rentLastSet).toEqual([{ label: 'under 1 year ago', tenants: 1 }, { label: '1 to 2 years ago', tenants: 0 }, { label: '2 to 3 years ago', tenants: 0 }, { label: '3 or more years ago', tenants: 1 }])
  })
  it('states the levers in the records without assuming market rents', () => {
    expect(books.opportunities.longUnchangedRent).toEqual({ years: 3, tenants: 1, monthlyRent: 10000 })
    expect(books.opportunities.relets).toEqual({ tenants: 2, withPreviousTenant: 1, rentUp: 1, rentSame: 0, rentDown: 0, monthlyRentChange: 500, averageVacantDays: 26, rentLostWhileVacant: 7800 })
    // 30-day expenses to 17 Sep = 3000 (Sept salary), so the reserve is 9000; main account is corporate operating.
    expect(books.opportunities.allocation).toEqual({ operatingReserveTarget: 9000, familyRestricted: 0, familyMonthlyOutflow: 0, unclassified: 0, allocationEligible: 65000, strategicDeployable: 55500 })
    expect(books.opportunities.latestCompleteSurplus).toEqual({ month: '2026-08', surplus: 11900 })
    const text = renderRentBooks(books)
    expect(text).toContain('By tenant deposits held: 1. North Building ৳43,300; 2. South Building ৳0.')
    expect(text).toContain('1 current tenants paying ৳10,000 a month in rent together. Occupancy')
    expect(text).not.toContain('would add')
    expect(text).toContain('Most tenants do not pay rent for their last two months; their deposit covers it.')
  })
  it('renders every amount with its currency and explains how to read it', () => {
    const text = renderRentBooks(books)
    expect(text).toContain('The "Sep 2026" bill is the rent for August 2026')
    expect(text).toContain('Sep 2026 (in progress) | Aug 2026 | 2 | ৳22,000 | ৳2,400 | ৳24,400 | ৳11,200 | ৳13,200 | 1')
    expect(text).toContain('Total overdue: ৳7,500')
    expect(text).toContain('Bank cash minus card debt: ৳64,500')
    expect(text).not.toMatch(/\| \d{4,}/)
  })
})
