import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readOnlyFetch } from '../src/live/transport'
import { normalizeRent, ReadOnlyRentStreamAdapter, type RentRaw } from '../src/live/rentstream'
import { normalizeStock, type StockRaw } from '../src/live/stockstream'
import { isStale } from '../src/live/models'

const now = new Date('2026-09-15T12:00:00Z')
function rentRaw(): RentRaw {
  return {
    accounts: [{id:'bank',name:'Bank',account_type:'bank',balance_known:true,is_archived:false,opening_balance:20,opening_balance_as_of:'2026-07-31'}, {id:'card',name:'Card',account_type:'credit_card',balance_known:true,is_archived:false,opening_balance:-100,opening_balance_as_of:'2026-08-31'}],
    statements: [{id:'s',bank_account_id:'bank',statement_date:'2026-08-31',closing_balance:1000}],
    transactions: [{id:'t0',bank_account_id:'bank',txn_date:'2026-08-31',txn_type:'deposit',amount:999}, {id:'t1',bank_account_id:'bank',txn_date:'2026-09-01',txn_type:'deposit',amount:100}, {id:'t2',bank_account_id:'bank',txn_date:'2026-09-02',txn_type:'withdrawal',amount:40},{id:'t3',bank_account_id:'bank',txn_date:'2026-10-01',txn_type:'deposit',amount:4000}],
    payments: [{id:'bill',tenant_id:'tenant',payment_month:'2026-09-01',status:'partial',amount:100,utility_bill:20,amount_paid:70}],
    tenants: [{id:'tenant',deposit_opening_liability:300,status:'active',move_in_date:'2026-01-01',actual_move_out_date:null}],
    deposits: [{id:'d1',tenant_id:'tenant',transaction_date:'2026-09-01',transaction_type:'received',amount:50},{id:'d2',tenant_id:'tenant',transaction_date:'2026-09-02',transaction_type:'applied',amount:20}],
    entries: [{id:'e1',payment_date:'2026-09-02',amount:50}], expenses: [{id:'ex',expense_date:'2026-09-02',amount:10}],
    cash:[{cash_source_type:'operating',remaining_amount:80}], locks:[],
  }
}
function stockRaw(): StockRaw {
  return {
    positions: [{id:'p',symbol:'TEST.NE',role:'satellite',shares:999,manual_price:null,anchor_price:null,anchor_underlying:null,updated_at:'2026-09-14'},{id:'cash',symbol:'CAD',role:'cash',shares:50,manual_price:null,anchor_price:null,anchor_underlying:null,updated_at:'2026-09-14'}],
    trades:[{id:'buy',symbol:'TEST.NE',trade_date:'2026-09-01',shares:10,price:5,created_at:'2026-09-01'}, {id:'sale',symbol:'TEST.NE',trade_date:'2026-09-02',shares:-2,price:8,created_at:'2026-09-02'}],
    symbols:[{symbol:'TEST.NE',currency:'CAD',underlying_symbol:'TEST',cdr_ratio:0.1,cdr_fx_rate:1.4,cdr_as_of:'2026-09-14'}],
    quotes:[{symbol:'TEST',trade_date:'2026-09-14',close:100}],
    settings:[{user_id:'u',base_currency:'CAD',contributed_ytd:500}], fx:[],
  }
}

describe('Live source accounting', () => {
  it('uses the latest statement and later dated movements, excluding same-day and future entries', () => {
    const r=normalizeRent(rentRaw(),now)
    expect(r.bankCashBdt).toBe(1060)
    expect(r.cardDebtBdt).toBe(100)
    expect(r.operatingCashBdt).toBe(80)
  })
  it('does not count card credit as cash and does not hide unknown bank balances', () => {
    const raw=rentRaw();raw.accounts[1].opening_balance=10000
    expect(normalizeRent(raw,now).bankCashBdt).toBe(1060)
    raw.accounts[0].balance_known=false
    expect(normalizeRent(raw,now).bankCashBdt).toBeNull()
  })
  it('keeps refundable deposits, bill settlements, actual receipts and expenses distinct', () => {
    const r=normalizeRent(rentRaw(),now)
    expect(r.refundableDepositsBdt).toBe(330)
    expect(r.expectedBdt).toBe(120)
    expect(r.collectedBdt).toBe(70)
    expect(r.outstandingBdt).toBe(50)
    expect(r.cashReceipts30dBdt).toBe(50)
    expect(r.expenses30dBdt).toBe(10)
  })
  it("keeps earlier months' unpaid bills owed, as RentStream defines overdue", () => {
    const raw=rentRaw()
    raw.payments.push(
      {id:'july',tenant_id:'tenant',payment_month:'2026-07-01',status:'partial',amount:100,utility_bill:10,amount_paid:30},
      {id:'aug',tenant_id:'other',payment_month:'2026-08-01',status:'unpaid',amount:100,utility_bill:0,amount_paid:60},
      {id:'aug-paid',tenant_id:'tenant',payment_month:'2026-08-01',status:'paid',amount:100,utility_bill:20,amount_paid:120},
      {id:'june-waived',tenant_id:'tenant',payment_month:'2026-06-01',status:'paid',amount:100,utility_bill:0,amount_paid:75},
      {id:'oct',tenant_id:'tenant',payment_month:'2026-10-01',status:'unpaid',amount:100,utility_bill:0,amount_paid:0},
    )
    const r=normalizeRent(raw,now)
    expect(r.outstandingBdt).toBe(50)
    expect(r.overdueBdt).toBe(120)
    expect(r.overdueBills).toBe(2)
    expect(r.overdueTenants).toBe(2)
    expect(r.overdueSince).toBe('2026-07')
    expect(r.issues.join(' ')).not.toContain('marked paid')
    expect(normalizeRent(rentRaw(),now)).toMatchObject({overdueBdt:0,overdueSince:null})
  })
  it('does not treat unbilled tenants as zero expected income', () => {
    const raw=rentRaw();raw.payments=[]
    expect(normalizeRent(raw,now).issues.join(' ')).toContain('eligible tenants have no payment record')
  })
  it('rejects missing or malformed values instead of promoting them to zero', () => {
    const raw=rentRaw();raw.statements[0].closing_balance='not-a-number'
    expect(() => normalizeRent(raw,now)).toThrow('invalid')
    const cashMissing=rentRaw();cashMissing.cash=[]
    expect(() => normalizeRent(cashMissing,now)).toThrow('one shared operating-cash balance')
  })
  it('derives remaining shares from trades, preserves CDR labels, and counts cash once', () => {
    const s=normalizeStock(stockRaw(),now)
    expect(s.holdings[0].shares).toBe(8)
    expect(s.holdings[0].priceSource).toBe('issuer derived')
    expect(s.investedCad).toBeCloseTo(112)
    expect(s.cashCad).toBe(50)
    expect(s.portfolioCad).toBeCloseTo(162)
  })
  it('withholds portfolio value for an unpriced holding and cash for a missing cash record', () => {
    const raw=stockRaw();raw.quotes=[];raw.positions=raw.positions.filter(p=>p.role!=='cash')
    const s=normalizeStock(raw,now)
    expect(s.portfolioCad).toBeNull()
    expect(s.cashCad).toBeNull()
    expect(s.issues.join(' ')).toContain('Cash is unknown')
  })
  it('labels old cash and incomplete trade history', () => {
    const raw=stockRaw();raw.positions[1].updated_at='2026-08-01';raw.trades[0].shares=-2
    const s=normalizeStock(raw,now)
    expect(s.issues.join(' ')).toContain('sale exceeds shares')
    expect(s.issues.join(' ')).toContain('stale or undated')
  })
  it('clears historical sale alerts for closed mementos without changing balances', () => {
    const raw=stockRaw();raw.positions[0].role='memento';raw.positions[1].updated_at='2026-08-01';raw.trades=raw.trades.slice(1)
    const s=normalizeStock(raw,now)
    expect(s.holdings[0].shares).toBe(0)
    expect(s.holdings[0].valueCad).toBe(0)
    expect(s.portfolioCad).toBe(50)
    expect(s.issues.join(' ')).not.toContain('sale exceeds shares')
    expect(s.issues.join(' ')).toContain('stale or undated')
    raw.positions[0].role='satellite'
    expect(normalizeStock(raw,now).issues.join(' ')).toContain('sale exceeds shares')
  })
  it('retains incomplete-history alerts for mementos with shares remaining after a later buy', () => {
    const raw=stockRaw();raw.positions[0].role='memento';raw.trades[0].shares=-2;raw.trades[1].shares=3
    const s=normalizeStock(raw,now)
    expect(s.holdings[0].shares).toBe(3)
    expect(s.issues.join(' ')).toContain('sale exceeds shares')
  })
  it('converts actual USD holdings with a dated USD/CAD rate', () => {
    const raw=stockRaw();raw.symbols[0].currency='USD';raw.quotes=[{symbol:'TEST.NE',trade_date:'2026-09-14',close:10}];raw.fx=[{base:'USD',quote:'CAD',rate_date:'2026-09-14',rate:1.4}]
    expect(normalizeStock(raw,now).investedCad).toBeCloseTo(112)
    raw.fx=[]
    expect(normalizeStock(raw,now).portfolioCad).toBeNull()
  })
  it('checks freshness against record dates including missing and future dates', () => {
    expect(isStale('2026-08-01',now)).toBe(true)
    expect(isStale('2026-09-14',now)).toBe(false)
    expect(isStale(null,now)).toBe(true)
    expect(isStale('2026-11-01',now)).toBe(true)
  })
})

describe('Read-only transport', () => {
  it('rejects writes, unknown RPCs, edge functions and different origins before sending', async () => {
    const transport=vi.fn();const read=readOnlyFetch('RentStream','https://example.supabase.co',transport)
    for (const method of ['POST','PATCH','DELETE','PUT']) await expect(read('https://example.supabase.co/rest/v1/bank_accounts',{method})).rejects.toThrow('approved reads')
    await expect(read('https://example.supabase.co/rest/v1/rpc/finalize_day')).rejects.toThrow('approved reads')
    await expect(read('https://example.supabase.co/functions/v1/fetch-quotes')).rejects.toThrow('Unsupported')
    await expect(read('https://other.example/rest/v1/bank_accounts')).rejects.toThrow('origin')
    expect(transport).not.toHaveBeenCalled()
  })
  it('reads the approved stable cash RPC by GET and pages past the default row limit', async () => {
    const raw=rentRaw();raw.entries=Array.from({length:1253},(_,i)=>({id:`e${i}`,payment_date:'2026-09-02',amount:1}))
    const byTable: Record<string, unknown[]> = {bank_accounts:raw.accounts,bank_transactions:raw.transactions,bank_balance_statements:raw.statements,payments:raw.payments,payment_entries:raw.entries,expenses:raw.expenses,security_deposit_transactions:raw.deposits,tenants:raw.tenants,reconciliation_locks:raw.locks,'rpc/reconciliation_cash_source_balances':raw.cash,properties:[],manual_income:[],rent_history:[]}
    const calls: string[]=[]
    const transport: typeof fetch = async (input,init) => {
      const u=new URL(String(input));const t=u.pathname.replace('/rest/v1/','');calls.push(t)
      expect(init?.method ?? 'GET').toBe('GET')
      const offset=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??500)
      return new Response(JSON.stringify(byTable[t].slice(offset,offset+limit)),{status:200,headers:{'Content-Type':'application/json'}})
    }
    const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:readOnlyFetch('RentStream','https://example.supabase.co',transport)}})
    const r=await new ReadOnlyRentStreamAdapter(client).getSnapshot(now)
    expect(r.cashReceipts30dBdt).toBe(1253)
    expect(calls.filter(x=>x==='payment_entries')).toHaveLength(3)
    expect(calls).toContain('rpc/reconciliation_cash_source_balances')
  })
  it('surfaces source errors rather than replacing unavailable data with an empty list', async () => {
    const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false},global:{fetch:async()=>new Response(JSON.stringify({message:'permission denied'}),{status:403,headers:{'Content-Type':'application/json'}})}})
    await expect(new ReadOnlyRentStreamAdapter(client).getSnapshot(now)).rejects.toThrow('permission denied')
  })
})
