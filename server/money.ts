import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNTS, CADENCES, CATEGORIES, KINDS, type Bill, type CategoryRule, type MoneyTransaction } from '../src/money/types.ts'
import { merchantKey, prepareLines, suggestBills, type PreparedLine } from '../src/money/lines.ts'
import { parseStatement, UnsupportedStatement } from '../src/money/parsers.ts'

// Personal money records live in money_* tables in the StockStream database and
// are written only here, by the local server, with that project's secret key.
// The client's transport allows nothing but those three tables.

const MAX_BODY_BYTES = 3_000_000
const TABLES = new Set(['money_transactions', 'money_bills', 'money_category_rules'])

export interface MoneyStore {
  load(): Promise<{ transactions: MoneyTransaction[]; bills: Bill[]; rules: CategoryRule[] }>
  existingHashes(hashes: string[]): Promise<Set<string>>
  insertTransactions(rows: Omit<MoneyTransaction, 'id'>[]): Promise<number>
  saveBill(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill>
  updateTransaction(id: string, patch: Partial<Pick<MoneyTransaction, 'kind' | 'category' | 'flagged'>>): Promise<MoneyTransaction>
  saveRule(rule: Omit<CategoryRule, 'id'>): Promise<void>
}

class InputError extends Error {}

function moneyFetch(baseUrl: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith('/rest/v1/') || !TABLES.has(url.pathname.slice('/rest/v1/'.length)) || !['GET', 'POST', 'PATCH'].includes(method)) {
      throw new Error('Finance Manager money store allows only its own tables')
    }
    return fetch(input, init)
  }
}

async function readAll<T>(client: SupabaseClient, table: string, order: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(table).select('*').order(order).order('id').range(offset, offset + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data as T[]))
    if (data.length < 1000) return rows
  }
}

const num = (v: unknown) => v === null || v === undefined ? null : Number(v)

export function supabaseMoneyStore(url: string, secretKey: string): MoneyStore {
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: moneyFetch(url) } })
  const tx = (r: Record<string, unknown>) => ({ ...r, amount: num(r.amount), amount_bdt: num(r.amount_bdt), balance_after: num(r.balance_after) }) as MoneyTransaction
  return {
    async load() {
      const [transactions, bills, rules] = await Promise.all([
        readAll<Record<string, unknown>>(client, 'money_transactions', 'posted_date'),
        readAll<Record<string, unknown>>(client, 'money_bills', 'name'),
        readAll<CategoryRule>(client, 'money_category_rules', 'pattern'),
      ])
      return { transactions: transactions.map(tx), bills: bills.map(b => ({ ...b, amount: Number(b.amount) }) as Bill), rules }
    },
    async existingHashes(hashes) {
      const found = new Set<string>()
      for (let i = 0; i < hashes.length; i += 200) {
        const { data, error } = await client.from('money_transactions').select('import_hash').in('import_hash', hashes.slice(i, i + 200))
        if (error) throw new Error(error.message)
        for (const r of data) found.add(r.import_hash)
      }
      return found
    },
    async insertTransactions(rows) {
      let inserted = 0
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await client.from('money_transactions').upsert(rows.slice(i, i + 500), { onConflict: 'import_hash', ignoreDuplicates: true }).select('id')
        if (error) throw new Error(error.message)
        inserted += data.length
      }
      return inserted
    },
    async saveBill(bill) {
      const { id, ...fields } = bill
      const query = id
        ? client.from('money_bills').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single()
        : client.from('money_bills').insert(fields).select().single()
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return { ...data, amount: Number(data.amount) } as Bill
    },
    async updateTransaction(id, patch) {
      const { data, error } = await client.from('money_transactions').update(patch).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return tx(data)
    },
    async saveRule(rule) {
      const { error } = await client.from('money_category_rules').upsert(rule, { onConflict: 'pattern' })
      if (error) throw new Error(error.message)
    },
  }
}

export function moneyStoreFromEnv(env: Record<string, string | undefined>): MoneyStore | null {
  const url = env.VITE_STOCKSTREAM_URL, key = env.STOCKSTREAM_SECRET_KEY?.trim()
  return url && key && key.startsWith('sb_secret_') ? supabaseMoneyStore(url, key) : null
}

// ---------------------------------------------------------------- validation

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new InputError(`${field} must be one of ${allowed.join(', ')}`)
  return value as T
}
const date = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new InputError(`${field} must be a date (YYYY-MM-DD)`)
  return value
}
const money = (value: unknown, field: string, { positive = true } = {}) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n) || (positive && n <= 0) || Math.abs(n) > 1e9) throw new InputError(`${field} must be ${positive ? 'a positive ' : 'an '}amount`)
  return Math.round(n * 100) / 100
}
const text = (value: unknown, field: string, max: number, required = false) => {
  if (value === undefined || value === null || value === '') { if (required) throw new InputError(`${field} is required`); return null }
  if (typeof value !== 'string' || value.trim().length > max) throw new InputError(`${field} must be text up to ${max} characters`)
  return value.trim() || (required ? (() => { throw new InputError(`${field} is required`) })() : null)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new InputError('Request is too large')
    chunks.push(chunk as Buffer)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch { throw new InputError('Request body must be a JSON object') }
}

// ---------------------------------------------------------------- handler

export function createMoneyHandler(store: MoneyStore | null, parse = parseStatement) {
  const prepare = async (body: Record<string, unknown>) => {
    const account = oneOf(body.account, ['td_chequing', 'td_card', 'wealthsimple'] as const, 'account')
    const csv = text(body.csv, 'csv', MAX_BODY_BYTES, true)!
    const { rules } = await store!.load()
    const lines = prepareLines(parse(account, csv), rules)
    const existing = await store!.existingHashes(lines.map(l => l.import_hash))
    return { account, lines, fresh: lines.filter(l => !existing.has(l.import_hash)) }
  }
  const summary = (account: string, lines: PreparedLine[], fresh: PreparedLine[]) => ({
    account, total: lines.length, new: fresh.length, duplicates: lines.length - fresh.length,
    transfers: fresh.filter(l => l.kind === 'transfer').length, investing: fresh.filter(l => l.kind === 'investing').length,
    flagged: fresh.filter(l => l.flagged).length,
    dateRange: lines.length ? [lines.map(l => l.date).sort()[0], lines.map(l => l.date).sort().pop()] : null,
    lines: fresh.slice(0, 300).map(({ date, description, amount, kind, category, flagged }) => ({ date, description, amount, kind, category, flagged })),
  })

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? ''
    if (path !== '/api/money' && !path.startsWith('/api/money/')) return next()
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)) }
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin requests are not allowed' })
    if (!store) return json(503, { error: 'Personal money storage is not connected. Add STOCKSTREAM_SECRET_KEY to .env.local.' })
    try {
      if (path === '/api/money') {
        if (req.method !== 'GET') return json(405, { error: 'GET only' })
        const data = await store.load()
        return json(200, { ...data, suggestions: suggestBills(data.transactions, data.bills.map(b => b.name)) })
      }
      if (req.method !== 'POST') return json(405, { error: 'POST only' })
      if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Send application/json' })
      const body = await readJson(req)

      if (path === '/api/money/import/preview') {
        const { account, lines, fresh } = await prepare(body)
        return json(200, summary(account, lines, fresh))
      }
      if (path === '/api/money/import/commit') {
        const { account, lines, fresh } = await prepare(body)
        const inserted = await store.insertTransactions(fresh.map(l => ({
          account: l.account, posted_date: l.date, description: l.description.slice(0, 500), amount: l.amount, amount_bdt: null,
          kind: l.kind, category: l.category, flagged: l.flagged, balance_after: l.balance, bill_id: null, note: null,
          source: account === 'wealthsimple' ? 'ws_csv' : 'td_csv', import_hash: l.import_hash,
        })))
        return json(200, { ...summary(account, lines, fresh), inserted })
      }
      if (path === '/api/money/bills') {
        const bill = await store.saveBill({
          ...(body.id ? { id: text(body.id, 'id', 64, true)! } : {}),
          name: text(body.name, 'name', 120, true)!, category: oneOf(body.category, CATEGORIES, 'category'),
          amount: money(body.amount, 'amount'), cadence: oneOf(body.cadence, CADENCES, 'cadence'),
          due_day: body.due_day === null || body.due_day === undefined || body.due_day === '' ? null : (() => { const d = Number(body.due_day); if (!Number.isInteger(d) || d < 1 || d > 31) throw new InputError('due_day must be 1–31'); return d })(),
          account: body.account === null || body.account === undefined || body.account === '' ? null : oneOf(body.account, ACCOUNTS, 'account'),
          active: body.active === undefined ? true : body.active === true,
          note: text(body.note, 'note', 500),
        })
        return json(200, bill)
      }
      if (path === '/api/money/draws') {
        const posted_date = date(body.date, 'date'), amount = money(body.amount_cad, 'amount_cad')
        const amount_bdt = body.amount_bdt === undefined || body.amount_bdt === null || body.amount_bdt === '' ? null : money(body.amount_bdt, 'amount_bdt')
        const note = text(body.note, 'note', 500)
        await store.insertTransactions([{ account: 'manual', posted_date, description: note ?? 'Draw from rental business', amount, amount_bdt, kind: 'draw', category: null, flagged: false, balance_after: null, bill_id: null, note, source: 'manual', import_hash: `manual|draw|${randomUUID()}` }])
        return json(200, { ok: true })
      }
      if (path === '/api/money/spending') {
        // Spending logged by hand, for when no statement is available.
        const posted_date = date(body.date, 'date')
        const amount = money(body.amount, 'amount')
        const category = oneOf(body.category, CATEGORIES, 'category')
        const description = text(body.description, 'description', 200, true)!
        await store.insertTransactions([{ account: 'manual', posted_date, description, amount: -amount, amount_bdt: null, kind: 'spend', category, flagged: false, balance_after: null, bill_id: null, note: text(body.note, 'note', 500), source: 'manual', import_hash: `manual|spend|${randomUUID()}` }])
        return json(200, { ok: true })
      }
      if (path === '/api/money/categorise') {
        const id = text(body.id, 'id', 64, true)!
        const kind = oneOf(body.kind, KINDS, 'kind')
        const category = kind === 'spend' || kind === 'refund' ? oneOf(body.category, CATEGORIES, 'category') : null
        const { transactions } = await store.load()
        const target = transactions.find(t => t.id === id)
        if (!target) return json(404, { error: 'Transaction not found' })
        if ((kind === 'spend' && target.amount > 0) || (['refund', 'income', 'draw'].includes(kind) && target.amount < 0)) throw new InputError(`A ${target.amount < 0 ? 'payment out' : 'deposit'} cannot be recorded as ${kind}`)
        const updated = await store.updateTransaction(id, { kind, category, flagged: false })
        let applied = 1
        if (body.always === true) {
          const pattern = merchantKey(target.description)
          if (pattern.length >= 2) {
            await store.saveRule({ pattern, kind, category })
            // Apply to the same merchant's other lines that the owner has not already settled.
            for (const other of transactions.filter(t => t.id !== id && t.flagged && merchantKey(t.description) === pattern && Math.sign(t.amount) === Math.sign(target.amount))) {
              await store.updateTransaction(other.id, { kind, category, flagged: false }); applied++
            }
          }
        }
        return json(200, { transaction: updated, applied })
      }
      return json(404, { error: 'Unknown money endpoint' })
    } catch (error) {
      if (error instanceof InputError || error instanceof UnsupportedStatement) return json(400, { error: error.message })
      return json(502, { error: error instanceof Error ? error.message : 'Money storage failed' })
    }
  }
}
