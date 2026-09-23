import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyRadarInput, parseRadarInput, type RadarInput } from './engine'
import { emptyEliteReview, parseEliteReview, type EliteReview } from './elite'
import type { RadarSnapshot } from './types'

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const money = (n: number) => `C$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`
export default function RadarPanel() {
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<{ input: RadarInput; review: EliteReview | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [symbol, setSymbol] = useState('')
  const [underlying, setUnderlying] = useState('')
  const request = useRef(0), importRequest = useRef(0)
  const [testing, setTesting] = useState(false)
  async function sendTest() {
    setTesting(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/radar/test-alert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Test alert failed')
      setMessage('Test alert sent. Check your phone.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Test alert failed') }
    finally { setTesting(false) }
  }
  const refresh = useCallback(async () => {
    const token = ++request.current
    setLoading(true); setError(''); setSnapshot(null)
    try {
      const response = await fetch('/api/radar', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Radar unavailable')
      if (token === request.current) setSnapshot(body)
    } catch (e) { if (token === request.current) setError(e instanceof Error ? e.message : 'Radar unavailable') }
    finally { if (token === request.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => { clearInterval(timer); request.current++; importRequest.current++ }
  }, [refresh])
  async function importFile(file: File) {
    const token = ++importRequest.current
    setDraft(null); setMessage(''); setError('')
    try {
      if (file.size > 1_000_000) throw new Error('Choose a file smaller than 1 MB.')
      const json = JSON.parse(await file.text())
      if (token !== importRequest.current) return
      const input = parseRadarInput(json?.input ?? json)
      if (!input.ok) throw new Error(input.errors.slice(0, 3).join('; '))
      let review: EliteReview | null = null
      if (json?.review) { const parsed = parseEliteReview(json.review); if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).join('; ')); review = parsed.review }
      setDraft({ input: input.input, review }); setMessage('Imported for review. Not saved yet.')
    } catch (e) { if (token === importRequest.current) setError(e instanceof Error ? e.message : 'Invalid research file') }
  }
  async function save() {
    if (!draft || !snapshot) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/radar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, createState: !snapshot.journalExists }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Save failed')
      setDraft(null); setMessage(`Saved and verified. ${result.decision.action}.`); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }
  const candidates = error ? [] : snapshot?.candidates ?? []
  const actionable = candidates.filter(c => c.decision.action !== 'WAIT')
  const benchmark = snapshot?.benchmark
  return <section className="panel radar" aria-label="Strike Radar">
    <div className="panel-heading"><div><div className="eyebrow">Finance Manager · ELITE 5.2</div><h2>Strike Radar</h2></div><span className="status status-watch">{loading ? 'CHECKING' : actionable.length ? 'REVIEW' : 'WAIT'}</span></div>
    <p>{loading ? 'Checking…' : error ? 'Radar needs attention.' : actionable.length ? actionable.length === 1 ? 'One thing needs your review.' : `${actionable.length} things need your review.` : 'Nothing to do right now.'}</p>
    {!loading && !error && !actionable.length && <article className="strike-card"><strong>⚪ WAIT</strong><p>No verified opportunity beats doing nothing right now.</p></article>}
    {actionable.map(c => <article className="strike-card" key={c.decision.symbol}>
      <strong>{c.decision.symbol} · {c.decision.action}{c.decision.amountCad != null ? ` · ${money(c.decision.amountCad)}` : ''}</strong>
      <p>{c.decision.reason}</p>
      {c.entryPriceCad != null && <p className="muted">{c.priceSide === 'bid' ? 'Bid' : 'Ask'}: {money(c.entryPriceCad)}{c.priceEvidence.map((e, i) => <span key={`${e.sourceUrl}-${i}`}> · <a href={e.sourceUrl} target="_blank" rel="noreferrer">{new Date(e.asOf).toLocaleString()}</a></span>)}</p>}
    </article>)}
    <p className="muted small">{snapshot?.alerts?.configured ? `📱 Phone alerts ON${snapshot.alerts.failing ? ' · retrying a failed delivery' : ''}` : '📵 Phone alerts OFF'} · {snapshot?.owned.length ?? '—'} positions watched</p>
    <details><summary>Why?</summary>
      <div className="radar-facts"><span>Capital: confirm before sizing</span><span>XEQT: {benchmark?.status === 'EXACT' ? `${money(benchmark.alphaCad!)} relative result (${benchmark.periodStart?.slice(0, 10)}–${benchmark.asOf?.slice(0, 10)})` : benchmark?.status === 'ESTIMATE' ? 'estimate only' : 'comparison pending'}</span></div>
      {snapshot?.alerts?.recent[0] && <p className="muted small">Last alert: {snapshot.alerts.recent[0].title} · {new Date(snapshot.alerts.recent[0].createdAt).toLocaleDateString()}</p>}
      {snapshot?.alerts?.configured && <button className="link-button" disabled={testing} onClick={() => void sendTest()}>{testing ? 'Sending…' : 'Test phone alert'}</button>}
    </details>
    <details><summary>Advanced research</summary>
      <div className="radar-details">
        <p className="muted small">{snapshot?.runCount ?? 0} saved runs. Research is stored on this Mac. No trades are placed.</p>
        {(snapshot?.issues ?? []).map(issue => <p className="muted small" key={issue}>{issue}</p>)}
        {benchmark && <p className="muted small">{benchmark.status}: {benchmark.reason}{benchmark.profitLossCad != null ? ` Current recorded P/L: ${money(benchmark.profitLossCad)}.` : ''}</p>}
        {candidates.map(c => <details className="strike-card" key={c.decision.symbol}><summary>{c.decision.symbol} · {c.decision.action}</summary>
          <p className="small">Thesis: {c.decision.thesis} · Opportunity: {c.decision.opportunity} · Allocation: {c.decision.allocation}</p>
          <ul className="small">{c.decision.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <p className="muted small">Saved {new Date(c.savedAt).toLocaleString()}</p>
        </details>)}
        <button onClick={() => void refresh()} disabled={loading}>Refresh Radar</button>
        <details className="radar-import"><summary>Import or start research</summary>
          <p className="muted small">Load a reviewed dossier, inspect it, then save. Missing ELITE reviews keep action at WAIT.</p>
          <input aria-label="Import Radar research" type="file" accept=".json,application/json" disabled={saving} onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
          {draft && <div className="strike-card"><strong>{draft.input.instrument.symbol || 'Unverified instrument'}</strong><p className="muted small">Revision {draft.input.researchRevision} · {draft.review ? 'ELITE review included' : 'ELITE review needed'}</p><button onClick={() => void save()} disabled={saving || !snapshot}>{saving ? 'Saving…' : snapshot && !snapshot.journalExists ? 'Start journal & save research' : 'Save research'}</button><button onClick={() => {setDraft(null);setMessage('')}} disabled={saving}>Cancel</button></div>}
          <div className="radar-starter"><label>Canadian instrument<input aria-label="Radar instrument" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="MSFT.NE" /></label><label>Underlying<input aria-label="Radar underlying" value={underlying} onChange={e => setUnderlying(e.target.value.toUpperCase())} placeholder="MSFT" /></label>
            <button disabled={!symbol.trim() || !underlying.trim()} onClick={() => {const input = emptyRadarInput(symbol.trim(), underlying.trim());download('radar-research.json', {input, review: emptyEliteReview(input, new Date().toISOString())})}}>Download worksheet</button>
          </div>
        </details>
      </div>
    </details>
    {error && <p role="alert" className="error small">{error}</p>}
    {message && <p role="status" className="muted small">{message}</p>}
  </section>
}
