import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createMoneyHandler, type MoneyStore } from '../server/money'
import type { Bill, CategoryRule, MoneyTransaction } from '../src/money/types'
import type { StatementLine } from '../src/money/lines'

function memoryStore() {
  const db = { transactions: [] as MoneyTransaction[], bills: [] as Bill[], rules: [] as CategoryRule[] }
  let n = 0
  const store: MoneyStore = {
    async load() { return structuredClone(db) },
    async existingHashes(hashes) { return new Set(db.transactions.map(t => t.import_hash).filter(h => hashes.includes(h))) },
    async insertTransactions(rows) {
      const fresh = rows.filter(r => !db.transactions.some(t => t.import_hash === r.import_hash))
      db.transactions.push(...fresh.map(r => ({ ...r, id: `t${++n}` })))
      return fresh.length
    },
    async saveBill(bill) {
      const saved = { ...bill, id: bill.id ?? `b${++n}` } as Bill
      db.bills = [...db.bills.filter(b => b.id !== saved.id), saved]
      return saved
    },
    async updateTransaction(id, patch) { const t = db.transactions.find(x => x.id === id)!; Object.assign(t, patch); return t },
    async saveRule(rule) { db.rules = [...db.rules.filter(r => r.pattern !== rule.pattern), { ...rule, id: `r${++n}` }] },
  }
  return { db, store }
}

const statement: StatementLine[] = [
  { account: 'td_card', date: '2026-08-03', description: 'NETFLIX.COM 866', amount: -18.99, balance: null },
  { account: 'td_card', date: '2026-08-05', description: 'CORNER STORE 12', amount: -7.5, balance: null },
  { account: 'td_card', date: '2026-09-05', description: 'CORNER STORE 99', amount: -8, balance: null },
  { account: 'td_card', date: '2026-08-20', description: 'PAYMENT - THANK YOU', amount: 300, balance: null },
]
const servers: http.Server[] = []
afterEach(() => servers.splice(0).forEach(s => s.close()))
async function serve(store: MoneyStore | null) {
  const handler = createMoneyHandler(store, () => statement)
  const server = http.createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end('next') }))
  servers.push(server)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { base, post }
}

describe('Personal money API', () => {
  it('previews and commits an import once, however often the file is imported', async () => {
    const { db, store } = memoryStore()
    const { post } = await serve(store)
    const preview = await (await post('/api/money/import/preview', { account: 'td_card', csv: 'file' })).json()
    expect(preview).toMatchObject({ total: 4, new: 4, duplicates: 0, flagged: 3, dateRange: ['2026-08-03', '2026-09-05'] })
    expect(db.transactions).toHaveLength(0)
    expect((await (await post('/api/money/import/commit', { account: 'td_card', csv: 'file' })).json()).inserted).toBe(4)
    const again = await (await post('/api/money/import/commit', { account: 'td_card', csv: 'file' })).json()
    expect(again).toMatchObject({ new: 0, duplicates: 4, inserted: 0 })
    expect(db.transactions.find(t => t.description.startsWith('NETFLIX'))).toMatchObject({ kind: 'spend', category: 'subscriptions', source: 'td_csv', flagged: false })
  })
  it('recategorises with "always": saves a rule and settles the same merchant', async () => {
    const { db, store } = memoryStore()
    const { post } = await serve(store)
    await post('/api/money/import/commit', { account: 'td_card', csv: 'file' })
    const corner = db.transactions.find(t => t.description === 'CORNER STORE 12')!
    const result = await (await post('/api/money/categorise', { id: corner.id, kind: 'spend', category: 'groceries', always: true })).json()
    expect(result.applied).toBe(2)
    expect(db.rules).toEqual([{ id: expect.any(String), pattern: 'CORNER STORE', kind: 'spend', category: 'groceries' }])
    expect(db.transactions.filter(t => t.description.startsWith('CORNER')).map(t => [t.category, t.flagged])).toEqual([['groceries', false], ['groceries', false]])
    const payment = db.transactions.find(t => t.amount === 300)!
    expect((await post('/api/money/categorise', { id: payment.id, kind: 'spend', category: 'fees' })).status).toBe(400)
    expect((await (await post('/api/money/categorise', { id: payment.id, kind: 'transfer' })).json()).transaction).toMatchObject({ kind: 'transfer', category: null })
  })
  it('records bills and draws with validation, and serves everything with bill suggestions', async () => {
    const { db, store } = memoryStore()
    const { base, post } = await serve(store)
    expect((await post('/api/money/bills', { name: 'Rent', category: 'housing', amount: '1650', cadence: 'monthly', due_day: 1 })).status).toBe(200)
    expect((await post('/api/money/bills', { name: 'Gym', category: 'fitness', amount: 40, cadence: 'monthly' })).status).toBe(400)
    expect((await post('/api/money/bills', { name: 'Gym', category: 'health', amount: -40, cadence: 'monthly' })).status).toBe(400)
    expect((await post('/api/money/draws', { date: '2026-09-10', amount_cad: 2000, amount_bdt: 175000, note: 'From Dhaka Bank' })).status).toBe(200)
    expect((await post('/api/money/draws', { date: '10/09/2026', amount_cad: 2000 })).status).toBe(400)
    expect((await post('/api/money/spending', { date: '2026-09-12', amount: 84.2, category: 'groceries', description: 'No Frills' })).status).toBe(200)
    expect((await post('/api/money/spending', { date: '2026-09-12', amount: 10, category: 'groceries' })).status).toBe(400)
    expect((await post('/api/money/balances', { account: 'TD savings', balance: 1, as_of: '2026-09-17' })).status).toBe(404)
    expect(db.transactions.find(t => t.description === 'No Frills')).toMatchObject({ kind: 'spend', amount: -84.2, category: 'groceries', account: 'manual', source: 'manual', flagged: false })
    expect(db.bills[0]).toMatchObject({ name: 'Rent', amount: 1650, due_day: 1, active: true, account: null })
    expect(db.transactions[0]).toMatchObject({ kind: 'draw', amount: 2000, amount_bdt: 175000, account: 'manual', source: 'manual' })
    const all = await (await fetch(`${base}/api/money`)).json()
    expect(all).toMatchObject({ bills: [{ name: 'Rent' }], transactions: [{ kind: 'draw' }, { kind: 'spend' }], suggestions: [] })
  })
  it('refuses other sites, other methods, bad bodies, and works only when connected', async () => {
    const { store } = memoryStore()
    const { base, post } = await serve(store)
    expect((await post('/api/money/bills', {}, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await fetch(`${base}/api/money/bills`)).status).toBe(405)
    expect((await fetch(`${base}/api/money/draws`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await fetch(`${base}/api/money/draws`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1]' })).status).toBe(400)
    expect(await (await fetch(`${base}/api/other`)).text()).toBe('next')
    const disconnected = await serve(null)
    expect((await fetch(`${disconnected.base}/api/money`)).status).toBe(503)
  })
})
