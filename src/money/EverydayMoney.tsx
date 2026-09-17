import { useMemo, useState, type FormEvent } from 'react'
import { buildPersonalBooks } from '../books/personal'
import { monthlyEquivalent } from './categorise'
import type { SuggestedBill } from './lines'
import { CADENCES, CATEGORIES, KINDS, type Bill, type Kind, type MoneyData } from './types'
import type { TreasuryBalance } from '../live/models'

export type MoneyState = (MoneyData & { suggestions: SuggestedBill[] }) | null
type View = 'month' | 'log' | 'bills' | 'review' | 'import' | 'draws'

const cad = (n: number | null | undefined) => n == null ? '—' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const words = (s: string) => s.replace('_', ' / ')

async function post<T>(path: string, body: unknown, readOnly = false): Promise<T> {
  if (readOnly) throw new Error('Demo: changes are not saved.')
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

// Personal money in Canada: what was spent, recorded bills, statement imports,
// lines to review and draws from the rental business. Records only; the
// advisor above explains them.
export default function EverydayMoney({ money, treasury, error, onChanged, readOnly = false }: { money: MoneyState; treasury: TreasuryBalance[]; error: string; onChanged: () => void; readOnly?: boolean }) {
  const [view, setView] = useState<View>('month')
  const books = useMemo(() => money ? buildPersonalBooks(money, new Date(), treasury) : null, [money, treasury])
  const flagged = money?.transactions.filter(t => t.flagged).length ?? 0

  return <section className="panel money" aria-label="Everyday money">
    <div className="panel-heading">
      <div><div className="eyebrow">Canada · personal</div><h2>Everyday money</h2></div>
      <span className="system-tag">CAD</span>
    </div>
    {error ? <p className="error small" role="alert">{error}</p> : !money || !books ? <p className="muted">Reading personal records…</p> : <>
      <div className="money-tabs" role="tablist">
        {([['month', 'This month'], ['log', 'Log spending'], ['bills', `Bills (${books.bills.active.length})`], ['review', `Review${flagged ? ` (${flagged})` : ''}`], ['import', 'Import statements'], ['draws', 'Draws & balances']] as [View, string][])
          .map(([id, text]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{text}</button>)}
      </div>
      {view === 'month' && <MonthView books={books} />}
      {view === 'log' && <LogSpendingView books={books} onChanged={onChanged} readOnly={readOnly} />}
      {view === 'bills' && <BillsView bills={money.bills} suggestions={money.suggestions} onChanged={onChanged} readOnly={readOnly} />}
      {view === 'review' && <ReviewView money={money} onChanged={onChanged} readOnly={readOnly} />}
      {view === 'import' && <ImportView onChanged={onChanged} readOnly={readOnly} />}
      {view === 'draws' && <DrawsView books={books} onChanged={onChanged} readOnly={readOnly} />}
    </>}
  </section>
}

function MonthView({ books }: { books: ReturnType<typeof buildPersonalBooks> }) {
  if (!books.recordsSince) return <p className="muted">No spending recorded yet. Log purchases in Log spending, or import TD and Wealthsimple statements when you have them.</p>
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

function BillsView({ bills, suggestions, onChanged, readOnly }: { bills: Bill[]; suggestions: SuggestedBill[]; onChanged: () => void; readOnly: boolean }) {
  const [form, setForm] = useState(emptyBill)
  const [status, setStatus] = useState('')
  const save = async (body: Record<string, unknown>, done = '') => {
    setStatus('')
    try { await post('/api/money/bills', body, readOnly); setStatus(done); onChanged() } catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save the bill') }
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

function ReviewView({ money, onChanged, readOnly }: { money: NonNullable<MoneyState>; onChanged: () => void; readOnly: boolean }) {
  const lines = money.transactions.filter(t => t.flagged).sort((a, b) => b.posted_date.localeCompare(a.posted_date)).slice(0, 50)
  const [choice, setChoice] = useState<Record<string, Partial<{ kind: Kind; category: string; always: boolean }>>>({})
  const [status, setStatus] = useState('')
  if (!lines.length) return <p className="muted">Nothing to review. Every imported line has a category.</p>
  const save = async (id: string, fallback: { kind: Kind; category: string }) => {
    const c = { ...fallback, always: true, ...choice[id] }
    try { const r = await post<{ applied: number }>('/api/money/categorise', c.kind === 'spend' || c.kind === 'refund' ? { id, ...c } : { id, kind: c.kind, always: c.always }, readOnly); setStatus(`Saved${r.applied > 1 ? ` for ${r.applied} lines from this merchant` : ''}.`); onChanged() }
    catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save') }
  }
  return <>
    <p className="muted small">These lines could not be categorised automatically. "Always" remembers the choice for this merchant.</p>
    <div className="account-list">{lines.map(t => {
      const fallback: { kind: Kind; category: string } = { kind: t.kind, category: t.category ?? 'other' }
      const c = { ...fallback, always: true, ...choice[t.id] }
      const set = (patch: Partial<typeof c>) => setChoice({ ...choice, [t.id]: { ...c, ...patch } })
      return <div className="account-row money-review" key={t.id}>
        <div><strong>{t.description}</strong><div className="muted">{t.posted_date} · {cad(t.amount)}</div></div>
        <div className="money-review-controls">
          <select aria-label="Kind" value={c.kind} onChange={e => set({ kind: e.target.value as Kind })}>{KINDS.filter(k => t.amount < 0 ? ['spend', 'transfer', 'investing'].includes(k) : k !== 'spend').map(k => <option key={k} value={k}>{k}</option>)}</select>
          {(c.kind === 'spend' || c.kind === 'refund') && <select aria-label="Category" value={c.category} onChange={e => set({ category: e.target.value })}>{CATEGORIES.map(x => <option key={x} value={x}>{words(x)}</option>)}</select>}
          <label className="small"><input type="checkbox" checked={c.always} onChange={e => set({ always: e.target.checked })} /> always</label>
          <button onClick={() => void save(t.id, fallback)}>Save</button>
        </div>
      </div>
    })}</div>
    {status && <p className="small muted" role="status">{status}</p>}
  </>
}

type Preview = { total: number; new: number; duplicates: number; transfers: number; investing: number; flagged: number; dateRange: [string, string] | null; lines: { date: string; description: string; amount: number; kind: string; category: string | null; flagged: boolean }[]; inserted?: number }

function ImportView({ onChanged, readOnly }: { onChanged: () => void; readOnly: boolean }) {
  const [account, setAccount] = useState('td_chequing')
  const [csv, setCsv] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (path: string) => {
    if (!csv) return
    setBusy(true); setStatus('')
    try {
      const result = await post<Preview>(path, { account, csv }, readOnly)
      setPreview(result)
      if (result.inserted !== undefined) { setStatus(`Imported ${result.inserted} new line${result.inserted === 1 ? '' : 's'}; ${result.duplicates} already recorded.`); onChanged() }
    } catch (e) { setPreview(null); setStatus(e instanceof Error ? e.message : 'Import failed') }
    finally { setBusy(false) }
  }
  return <>
    <div className="money-form">
      <select aria-label="Account" value={account} onChange={e => { setAccount(e.target.value); setPreview(null) }}>
        <option value="td_chequing">TD chequing</option><option value="td_card">TD credit card</option><option value="wealthsimple">Wealthsimple</option>
      </select>
      <input aria-label="Statement file" type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; setPreview(null); setStatus(''); if (f) void f.text().then(setCsv) }} />
      <button onClick={() => void run('/api/money/import/preview')} disabled={!csv || busy}>Preview</button>
    </div>
    {preview && preview.inserted === undefined && <>
      <p className="small">{preview.total} lines{preview.dateRange ? ` from ${preview.dateRange[0]} to ${preview.dateRange[1]}` : ''}: <strong>{preview.new} new</strong>, {preview.duplicates} already recorded, {preview.transfers} transfers, {preview.investing} investing, {preview.flagged} to review.</p>
      <div className="holdings-table-wrap"><table className="holdings-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Description · classification</th></tr></thead>
        <tbody>{preview.lines.slice(0, 40).map((l, i) => <tr key={i}><td>{l.date}</td><td>{cad(l.amount)}</td><td>{l.description}<div className="muted small">{l.kind}{l.category ? ` · ${words(l.category)}` : ''}{l.flagged ? ' · to review' : ''}</div></td></tr>)}</tbody>
      </table></div>
      <button onClick={() => void run('/api/money/import/commit')} disabled={busy || preview.new === 0}>Import {preview.new} new line{preview.new === 1 ? '' : 's'}</button>
    </>}
    {status && <p className="small muted" role="status">{status}</p>}
  </>
}

function LogSpendingView({ books, onChanged, readOnly }: { books: ReturnType<typeof buildPersonalBooks>; onChanged: () => void; readOnly: boolean }) {
  const blank = { date: books.asOf, amount: '', category: 'groceries', description: '' }
  const [form, setForm] = useState(blank)
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setStatus('')
    try { await post('/api/money/spending', form, readOnly); setStatus(`Logged ${cad(Number(form.amount))} for ${form.description}.`); setForm({ ...blank, date: form.date, category: form.category }); onChanged() }
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

function DrawsView({ books, onChanged, readOnly }: { books: ReturnType<typeof buildPersonalBooks>; onChanged: () => void; readOnly: boolean }) {
  const [form, setForm] = useState({ date: books.asOf, amount_cad: '', amount_bdt: '', note: '' })
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setStatus('')
    try { await post('/api/money/draws', form, readOnly); setStatus('Draw recorded.'); setForm({ ...form, amount_cad: '', amount_bdt: '', note: '' }); onChanged() }
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
