import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { RentSnapshot, StockSnapshot } from '../live/models'
import { assistantContext } from './context'
import { endNote, streamAssistant, type Turn } from './stream'
import { RichText } from './RichText'
import type { FxReference } from '../books/overview'
import type { MoneyState } from '../money/EverydayMoney'

type Status = { provider: 'anthropic' | 'ollama'; model: string; local: boolean; ready: boolean; setup: string | null } | 'checking' | 'unavailable'
type Briefing = { text: string; state: 'idle' | 'writing' | 'done' | 'error'; note: string | null }

const SUGGESTIONS = [
  'Where did my money go last month?',
  'Which subscriptions am I paying for?',
  'Can I afford C$300 this month?',
  'How is the rental business doing this month?',
]

export default function AssistantPanel({ rent, stock, fx, money, reading }: { rent: RentSnapshot | null; stock: StockSnapshot | null; fx: FxReference | null; money: MoneyState; reading: boolean }) {
  const [status, setStatus] = useState<Status>('checking')
  const [briefing, setBriefing] = useState<Briefing>({ text: '', state: 'idle', note: null })
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatAbort = useRef<AbortController | null>(null)
  const [briefingRun, setBriefingRun] = useState(0)

  const context = useMemo(() => rent || stock || money ? assistantContext(rent, stock, fx, money) : null, [rent, stock, fx, money])
  const ready = typeof status === 'object' && status.ready

  const checkStatus = () => { fetch('/api/assistant/status').then(r => r.ok ? r.json() : Promise.reject()).then(setStatus).catch(() => setStatus('unavailable')) }
  useEffect(checkStatus, [])

  // New figures (refresh, sign-in, sign-out) start a fresh briefing and a fresh
  // conversation, so no answer rests on figures that are no longer displayed.
  useEffect(() => {
    chatAbort.current?.abort()
    setTurns([]); setChatError(''); setChatBusy(false)
    if (!ready || !context || reading) { setBriefing({ text: '', state: 'idle', note: null }); return }
    const controller = new AbortController()
    setBriefing({ text: '', state: 'writing', note: null })
    streamAssistant({ mode: 'briefing', context }, text => setBriefing(b => ({ ...b, text: b.text + text })), controller.signal)
      .then(end => setBriefing(b => ({ ...b, state: 'done', note: endNote(end) })))
      .catch(error => { if (!controller.signal.aborted) setBriefing(b => ({ ...b, state: 'error', note: error instanceof Error ? error.message : 'Briefing failed' })) })
    return () => controller.abort()
  }, [ready, context, reading, briefingRun])

  useEffect(() => () => chatAbort.current?.abort(), [])

  async function ask(question: string) {
    const content = question.trim()
    if (!content || !context || chatBusy) return
    const history: Turn[] = [...turns, { role: 'user', content }]
    setTurns([...history, { role: 'assistant', content: '' }])
    setDraft(''); setChatError(''); setChatBusy(true)
    const controller = new AbortController()
    chatAbort.current = controller
    let answer = ''
    try {
      const end = await streamAssistant({ mode: 'chat', context, messages: history }, text => {
        answer += text
        setTurns([...history, { role: 'assistant', content: answer }])
      }, controller.signal)
      const note = endNote(end)
      if (note) setTurns([...history, { role: 'assistant', content: answer ? `${answer}\n\n${note}` : note }])
    } catch (error) {
      if (controller.signal.aborted) return
      setTurns(turns); setDraft(content)
      setChatError(error instanceof Error ? error.message : 'The assistant failed')
    } finally {
      if (chatAbort.current === controller) setChatBusy(false)
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(draft) }

  return <section className="panel assistant" aria-label="Financial assistant">
    <div className="panel-heading">
      <div><div className="eyebrow">Assistant</div><h2>Your financial briefing</h2></div>
      <span className="system-tag">{typeof status === 'object' ? status.model.toUpperCase() : 'AI'}</span>
    </div>

    {status === 'checking' ? <p className="muted">Checking the assistant…</p>
      : status === 'unavailable' ? <p className="muted">The assistant endpoint is not running. Start the app with <code>npm run dev</code>.</p>
      : !status.ready ? <div className="assistant-setup">
          <p>The assistant is not ready yet: {status.setup}</p>
          <button onClick={() => { setStatus('checking'); checkStatus() }}>Check again</button>
        </div>
      : !context ? <p className="muted">{reading ? 'Reading your sources…' : 'Connect RentStream or StockStream and I will brief you on where things stand.'}</p>
      : <>
          <div className="briefing" aria-live="polite">
            {briefing.text ? <RichText text={briefing.text} /> : briefing.state === 'writing' ? <p className="muted">Reading your figures and writing the briefing…</p> : null}
            {briefing.note && <p className={briefing.state === 'error' ? 'error small' : 'muted small'}>{briefing.note}</p>}
            {(briefing.state === 'done' || briefing.state === 'error') && <button className="link-button" onClick={() => setBriefingRun(n => n + 1)}>Rewrite briefing</button>}
          </div>

          <div className="chat">
            {turns.map((turn, i) => <div key={i} className={`chat-turn chat-${turn.role}`}>
              {turn.role === 'user' ? <p>{turn.content}</p> : turn.content ? <RichText text={turn.content} /> : <p className="muted">Thinking…</p>}
            </div>)}
            {!turns.length && <div className="suggestions">{SUGGESTIONS.map(s => <button key={s} onClick={() => void ask(s)} disabled={chatBusy}>{s}</button>)}</div>}
            {chatError && <p role="alert" className="error small">{chatError}</p>}
            <form className="chat-form" onSubmit={submit}>
              <input aria-label="Ask the assistant" placeholder="Ask about your money…" value={draft} onChange={e => setDraft(e.target.value)} maxLength={8000} disabled={chatBusy} />
              <button type="submit" disabled={chatBusy || !draft.trim()}>{chatBusy ? 'Answering…' : 'Ask'}</button>
            </form>
          </div>
          <p className="muted small">{status.local ? `Runs on this Mac with ${status.model}; your figures never leave it.` : `Answers are generated by ${status.model} through Anthropic's API, which receives the figures on this page.`} The assistant explains and calculates; it cannot move money or place trades, and it leaves buy/sell calls on individual stocks to you.</p>
        </>}
  </section>
}
