import { useMemo, useState, type FormEvent } from 'react'
import { buildPersonalBooks } from '../books/personal'
import { monthlyEquivalent } from './categorise'
import type { SuggestedBill } from './lines'
import { CADENCES, CATEGORIES, type Bill, type MoneyData } from './types'
import type { TreasuryBalance } from '../live/models'

export type MoneyState = (MoneyData & { suggestions: SuggestedBill[] }) | null
type View = 'month' | 'log' | 'bills' | 'draws'

const cad = (n: number | null | undefined) => n == null ? '—' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const words = (s: string) => s.replace('_', ' / ')

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

// Personal money in Canada: what was spent, recorded bills, statement imports,
// lines to review and draws from the rental business. Records only; the
// advisor above explains them.
export default function EverydayMoney({ money, treasury, error, onChanged }: { money: MoneyState; treasury: TreasuryBalance[]; error: string; onChanged: () => void }) {
  const [view, setView] = useState<View>('month')
  const books = useMemo(() => money ? buildPersonalBooks(money, new Date(), treasury) : null, [money, treasury])

  return <section className="panel money" aria-label="Everyday money">
    <div className="panel-heading">
      <div><div className="eyebrow">Canada · personal</div><h2>Everyday money</h2></div>
      <span className="system-tag">CAD</span>
    </div>
    {error ? <p className="error small" role="alert">{error}</p> : !money || !books ? <p className="muted">Reading personal records…</p> : <>
      <div className="money-tabs" role="tablist">
        {([['month', 'This month'], ['log', 'Log spending'], ['bills', `Bills (${books.bills.active.length})`], ['draws', 'Draws & balances']] as [View, string][])
          .map(([id, text]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{text}</button>)}
      </div>
      {view === 'month' && <MonthView books={books} />}
      {view === 'log' && <LogSpendingView books={books} onChanged={onChanged} />}
      {view === 'bills' && <BillsView bills={money.bills} suggestions={money.suggestions} onChanged={onChanged} />}
      {view === 'draws' && <DrawsView books={books} onChanged={onChanged} />}
    </>}
  </section>
}

function MonthView({ books }: { books: ReturnType<typeof buildPersonalBooks> }) {
  if (!books.recordsSince) return <p className="muted">No spending recorded yet. Log purchases in Log spending.</p>
  const current = books.months[books.months.length - 1]
  const categories = Object.entries(current?.byCategory ?? {}).sort((a, b) => b[1] - a[1])
  return <>
    <div className="mini-grid">
      <div><span>Spent this month · day {books.pace.day}</span><strong>{cad(books.pace.thisMonth)}</strong></div>
      <div><span>Last month by the same day</span><strong>{cad(books.pace.lastMonthSameDay)}</strong></div>
      <div><span>Recorded bills · monthly equivalent</span><strong>{cad(books.bills.monthlyTotal)}</strong></div>
      <div><span>Draws received this month</span><strong>{cad(current?.draws)}</strong></div>
    </div>
    {categories.length > 0 && <div className="account-list">{categories.map(([c, v]) => <div className="account-row" key={c}><span>{words(c)}</span><strong>{cad(v)}</strong></div>)}</div>}
    <div className="holdings-table-wrap"><table className="holdings-table">
      <thead><tr><th>Month</th><th>Spending</th><th>Draws</th><th>Net</th></tr></thead>
      <tbody>{[...books.months].reverse().map(m => <tr key={m.month}><td>{label(m.month)}{m.complete ? '' : ' · in progress'}</td><td>{cad(m.spending)}</td><td>{cad(m.draws)}</td><td>{cad(m.net)}</td></tr>)}</tbody>
    </table></div>
    <p className="muted small">Spending is net of refunds and leaves out transfers between your own accounts and investment purchases. Records since {books.recordsSince}.</p>
  </>
}

const emptyBill = { name: '', category: 'subscriptions', amount: '', cadence: 'monthly', due_day: '' }

function BillsView({ bills, suggestions, onChanged }: { bills: Bill[]; suggestions: SuggestedBill[]; onChanged: () => void }) {
  const [form, setForm] = useState(emptyBill)
  const [status, setStatus] = useState('')
  const save = async (body: Record<string, unknown>, done = '') => {
    setStatus('')
    try { await post('/api/money/bills', body); setStatus(done); onChanged() } catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save the bill') }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void save(form, 'Bill saved.').then(() => setForm(emptyBill)) }
  const active = bills.filter(b => b.active), inactive = bills.filter(b => !b.active)
  return <>
    {active.length ? <div className="account-list">{active.map(b => <div className="account-row" key={b.id}>
      <div><strong>{b.name}</strong><div className="muted">{words(b.category)} · {b.cadence}{b.due_day ? ` · due day ${b.due_day}` : ''}</div></div>
      <div className="right"><strong>{cad(b.amount)}</strong><div className="muted">{cad(monthlyEquivalent(b.amount, b.cadence))}/month</div>
        <button className="link-button" onClick={() => void save({ ...b, active: false }, `${b.name} stopped.`)}>Stop</button></div>
    </div>)}</div> : <p className="muted">No bills recorded yet. Add your rent, phone and subscriptions.</p>}
    {suggestions.length > 0 && <div className="attention-list">
      <p className="muted small">These charge every month but are not recorded as bills:</p>
      {suggestions.map(s => <div className="attention-row money-suggestion" key={s.name}>
        <span>{s.name} · {cad(s.amount)} · {words(s.category)} · {s.months.length} months</span>
        <button onClick={() => void save({ name: s.name, category: s.category, amount: s.amount, cadence: 'monthly' }, `${s.name} added.`)}>Add as bill</button>
      </div>)}
    </div>}
    <form className="money-form" onSubmit={submit}>
      <input aria-label="Bill name" placeholder="Bill name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={120} />
      <select aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c} value={c}>{words(c)}</option>)}</select>
      <input aria-label="Amount" placeholder="Amount C$" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
      <select aria-label="Cadence" value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })}>{CADENCES.map(c => <option key={c} value={c}>{c}</option>)}</select>
      <input aria-label="Due day" placeholder="Due day" inputMode="numeric" value={form.due_day} onChange={e => setForm({ ...form, due_day: e.target.value })} />
      <button type="submit">Add bill</button>
    </form>
    {inactive.length > 0 && <p className="muted small">Stopped: {inactive.map(b => <button key={b.id} className="link-button" onClick={() => void save({ ...b, active: true }, `${b.name} restarted.`)}>{b.name}</button>)}</p>}
    {status && <p className="small muted" role="status">{status}</p>}
  </>
}

function LogSpendingView({ books, onChanged }: { books: ReturnType<typeof buildPersonalBooks>; onChanged: () => void }) {
  const blank = { date: books.asOf, amount: '', category: 'groceries', description: '' }
  const [form, setForm] = useState(blank)
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setStatus('')
    try { await post('/api/money/spending', form); setStatus(`Logged ${cad(Number(form.amount))} for ${form.description}.`); setForm({ ...blank, date: form.date, category: form.category }); onChanged() }
    catch (err) { setStatus(err instanceof Error ? err.message : 'Could not log the spending') }
  }
  return <>
    <p className="muted small">No statement? Log purchases here as you make them: groceries, eating out, transport, shopping. Bills you recorded don't need logging.</p>
    <form className="money-form" onSubmit={e => void submit(e)}>
      <input aria-label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
      <input aria-label="What" placeholder="What (e.g. No Frills)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required maxLength={200} />
      <input aria-label="Amount C$" placeholder="Amount C$" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
      <select aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c} value={c}>{words(c)}</option>)}</select>
      <button type="submit">Log</button>
    </form>
    {status && <p className="small muted" role="status">{status}</p>}
  </>
}

function DrawsView({ books, onChanged }: { books: ReturnType<typeof buildPersonalBooks>; onChanged: () => void }) {
  const [form, setForm] = useState({ date: books.asOf, amount_cad: '', amount_bdt: '', note: '' })
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setStatus('')
    try { await post('/api/money/draws', form); setStatus('Draw recorded.'); setForm({ ...form, amount_cad: '', amount_bdt: '', note: '' }); onChanged() }
    catch (err) { setStatus(err instanceof Error ? err.message : 'Could not record the draw') }
  }
  return <>
    <p className="muted small">Record money you receive in Canada from the rental business.</p>
    <form className="money-form" onSubmit={e => void submit(e)}>
      <input aria-label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
      <input aria-label="Received C$" placeholder="Received C$" inputMode="decimal" value={form.amount_cad} onChange={e => setForm({ ...form, amount_cad: e.target.value })} required />
      <input aria-label="Sent ৳ (optional)" placeholder="Sent ৳ (optional)" inputMode="decimal" value={form.amount_bdt} onChange={e => setForm({ ...form, amount_bdt: e.target.value })} />
      <input aria-label="Note" placeholder="Note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} maxLength={500} />
      <button type="submit">Record draw</button>
    </form>
    <p className="muted small">Canadian account balances (recorded in RentStream):</p>
    {books.balances.length ? <div className="account-list">{books.balances.map(b => <div className="account-row" key={b.account}><span>{b.account}<span className="muted small"> · {b.date}</span></span><strong>{cad(b.balance)}</strong></div>)}</div> : <p className="muted small">No Canadian balances recorded in RentStream.</p>}
    <p className="muted small">Draws received in the last 12 months:</p>
    {books.draws.length ? <div className="account-list">{books.draws.map((d, i) => <div className="account-row" key={i}><span>{d.date}</span><strong>{cad(d.cad)}{d.bdt ? ` · ৳${d.bdt.toLocaleString('en-US')}` : ''}</strong></div>)}</div> : <p className="muted small">No draws recorded in the last 12 months.</p>}
    {status && <p className="small muted" role="status">{status}</p>}
  </>
}
