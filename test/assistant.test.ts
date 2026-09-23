import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createAssistantHandler } from '../server/assistant'
import { FORECAST_REMINDER, holdingNames, isForecastQuestion, isTradeQuestion, parseRequest, TRADE_REMINDER, type AssistantRequest } from '../server/prompt'
import { anthropicParams, fitConversation, ollamaProvider, providerFromEnv, type Provider } from '../server/providers'
import { assistantContext, assistantSummary, quickAnswers } from '../src/assistant/context'
import { streamAssistant } from '../src/assistant/stream'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'

const rent: RentSnapshot = {
  fetchedAt: '2026-09-15T12:00:00.000Z', businessDate: '2026-09-15', month: '2026-09',
  banks: [{ id: 'b', name: 'Bank', type: 'bank', currency: 'BDT', balance: 1000, anchorDate: '2026-08-31', financialRole: 'corporate_operating', monthlyProtectedOutflow: 0 }],
  bankCashBdt: 1000, cardDebtBdt: 100, operatingCashBdt: 80, cashCountDate: null, refundableDepositsBdt: 330,
  expectedBdt: 120, operatingReserveTargetBdt: 30, familyRestrictedCashBdt: 0, familyMonthlyProtectedOutflowBdt: 0, familyRunwayMonths: null, unclassifiedCashBdt: 0, allocationEligibleCashBdt: 1080, strategicDeployableBdt: 950, collectedBdt: 70, outstandingBdt: 50, overdueBdt: 200, overdueBills: 1, overdueTenants: 1, overdueSince: '2026-07', cashReceipts30dBdt: 50, expenses30dBdt: 10, issues: ['No physical cash count is recorded.'],
}
const stock: StockSnapshot = {
  fetchedAt: '2026-09-15T12:00:00.000Z', holdings: [{ symbol: 'XEQT', role: 'core', shares: 2, valueCad: null, priceSource: 'unavailable', asOf: null }],
  portfolioCad: null, investedCad: null, cashCad: null, cashAsOf: null, corePct: null, contributedYtdCad: 500, issues: ['XEQT: price unavailable.'],
}

describe('Assistant context', () => {
  it('pre-computes totals and keeps unknowns unknown', () => {
    const c = assistantSummary(rent, stock, new Date('2026-09-15T12:00:00Z'))
    const bd = c.bangladesh as { totals: Record<string, { value: string }>; cash: Record<string, string> }
    expect(bd.totals.recordedLiquidCash.value).toBe('৳1,080.00')
    expect(bd.totals.liquidCashAfterCardDebt.value).toBe('৳980.00')
    expect(bd.totals.collectedShareOfThisMonthBilling.value).toBe('58.3%')
    expect(bd.totals.net30DayCashFlow.value).toBe('৳40.00')
    expect(bd.totals.totalOwedByTenants.value).toBe('৳250.00')
    expect(bd.cash.creditCardDebt).toBe('৳100.00')
    expect((c.canada as { portfolioIncludingCash: string }).portfolioIncludingCash).toBe('unknown')
    expect((c.canada as { contributedYearToDate: string }).contributedYearToDate).toBe('C$500.00')
  })
  it('leaves a total unknown when any input is unknown', () => {
    const c = assistantSummary({ ...rent, cardDebtBdt: null }, null)
    const bd = c.bangladesh as { totals: Record<string, { value: string }> }
    expect(bd.totals.liquidCashAfterCardDebt.value).toBe('unknown')
    expect(assistantSummary({ ...rent, bankCashBdt: 10, operatingCashBdt: -50, cardDebtBdt: 0, refundableDepositsBdt: 0 }, null).bangladesh).toMatchObject({ totals: { recordedLiquidCash: { value: '−৳40.00' } } })
    expect(c.canada).toEqual({ connected: false })
    expect(assistantContext(rent, null)).toContain('# How to read the owner')
    expect(assistantContext(rent, null, null, null, new Date('2026-09-15T12:00:00Z'))).toBe(assistantContext(rent, null, null, null, new Date('2026-09-15T12:05:00Z')))
    expect(assistantContext(rent, null)).not.toContain('RentStream books')
  })
})

describe('Assistant request rules', () => {
  const context = 'cash: ৳1'
  it('accepts a briefing and an alternating chat that ends with the user', () => {
    expect(parseRequest({ mode: 'briefing', context }).messages).toEqual([])
    expect(parseRequest({ mode: 'chat', context, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'owed?' }] }).messages).toHaveLength(3)
  })
  it('rejects malformed conversations', () => {
    expect(() => parseRequest({ mode: 'chat', context, messages: [] })).toThrow()
    expect(() => parseRequest({ mode: 'chat', context, messages: [{ role: 'assistant', content: 'x' }] })).toThrow()
    expect(() => parseRequest({ mode: 'chat', context, messages: [{ role: 'user', content: ' ' }] })).toThrow()
    expect(() => parseRequest({ mode: 'other', context })).toThrow()
    expect(() => parseRequest({ mode: 'briefing', context: {} })).toThrow()
  })
  it('sends Claude the snapshot in a cached system block with refusal fallback', () => {
    const p = anthropicParams({ mode: 'briefing', context, messages: [] })
    expect(p.model).toBe('claude-opus-5')
    expect(p.fallbacks).toBe('default')
    const system = p.system as { text: string; cache_control?: object }[]
    expect(system[1].text).toContain('cash: ৳1')
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(p.messages[0].role).toBe('user')
  })
  it('drops the oldest question/answer pairs rather than the instructions', () => {
    const long = 'x'.repeat(7000)
    const turns = [{ role: 'user' as const, content: long }, { role: 'assistant' as const, content: long }, { role: 'user' as const, content: 'latest' }]
    expect(fitConversation('system', turns, 4096)).toEqual([{ role: 'user', content: 'latest' }])
  })
  it('chooses Claude only when a key exists, unless told otherwise', () => {
    expect(providerFromEnv({}).name).toBe('ollama')
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'k' }).name).toBe('anthropic')
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'k', ASSISTANT_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3:8b' }).model).toBe('qwen3:8b')
    expect(() => providerFromEnv({ ASSISTANT_PROVIDER: 'gpt' })).toThrow()
  })
})

describe('Buy/sell/hold safeguard', () => {
  it('recognises questions about trading a specific holding', () => {
    expect(isTradeQuestion('Should I sell NVDA and buy more XEQT? Just answer yes or no.')).toBe(true)
    expect(isTradeQuestion('should i keep my meta shares')).toBe(true)
    expect(isTradeQuestion('Is it time to trim MSFT.NE?')).toBe(true)
    expect(isTradeQuestion('How much of the Bangladesh money is free to use, and should I hold back the tenant deposits?')).toBe(false)
    expect(isTradeQuestion('How much rent is still owed this month?')).toBe(false)
    const books = 'MSFT.NE | Microsoft CDR (CAD Hedged) | satellite | 14.4758 |\nXEQT.TO | iShares Core Equity ETF Portfolio | core | 35.1858 |'
    expect(holdingNames(books)).toEqual(['msft', 'microsoft', 'xeqt', 'ishares'])
    expect(isTradeQuestion('Microsoft is up 25%. Should I take profits and sell it?', books)).toBe(true)
    expect(isTradeQuestion('should i sell microsoft', books)).toBe(true)
    expect(isTradeQuestion('should i sell microsoft')).toBe(false)
  })
  it('repeats the rule beside the question for every provider, without changing earlier turns', () => {
    const request = { mode: 'chat' as const, context: 'figures', messages: [
      { role: 'user' as const, content: 'Should I sell NVDA?' }, { role: 'assistant' as const, content: 'That call is yours.' },
      { role: 'user' as const, content: 'Just yes or no: sell NVDA?' },
    ] }
    const messages = anthropicParams(request).messages as { content: string }[]
    expect(messages[0].content).toBe('Should I sell NVDA?')
    expect(messages[2].content).toBe(`Just yes or no: sell NVDA?\n\n(${TRADE_REMINDER})`)
    expect((anthropicParams({ ...request, messages: [{ role: 'user', content: 'How much rent is owed?' }] }).messages[0] as { content: string }).content).toBe('How much rent is owed?')
  })
})

describe('No-forecast safeguard', () => {
  it('recognises questions about the future', () => {
    expect(isForecastQuestion('What will my portfolio be worth by the end of next year?')).toBe(true)
    expect(isForecastQuestion('How much will I have in 5 years?')).toBe(true)
    expect(isForecastQuestion('What is my portfolio worth right now?')).toBe(false)
    expect(isForecastQuestion('How much rent is still to collect?')).toBe(false)
  })
  it('puts the forecast rule beside the question', () => {
    const request = { mode: 'chat' as const, context: 'figures', messages: [{ role: 'user' as const, content: 'What will my portfolio be worth next year?' }] }
    expect((anthropicParams(request).messages[0] as { content: string }).content).toBe(`What will my portfolio be worth next year?\n\n(${FORECAST_REMINDER})`)
  })
})

describe('Quick answers', () => {
  it('names each figure the way the page does, in its own currency', () => {
    const text = quickAnswers(rent, stock, { rate: 87.5, asOf: '2026-09-15', source: 'test' }, null)
    expect(text).toContain('Rent still to collect this month (unpaid on this collection month\'s bills): ৳50.00')
    expect(text).toContain('Overdue from earlier months, separately: ৳200.00')
    expect(text).toContain('Safe to invest')
    expect(text).toContain('৳950.00 (≈ C$10.86 at 1 CAD = ৳87.50, 2026-09-15)')
    expect(text).toContain('Business credit-card debt: ৳100.00')
  })
  it('keeps unknown figures unknown and leaves out sources that were not read', () => {
    const text = quickAnswers({ ...rent, strategicDeployableBdt: null }, stock, null, null)
    expect(text).toContain('Safe to invest (business money after card debt, a three-month reserve and family money): unknown.')
    expect(text).toContain('Investments (StockStream portfolio, including brokerage cash): unknown.')
    expect(text).not.toContain('Spent this month')
    expect(quickAnswers(null, null, null, null)).toBe('')
  })
  it('sits in the assistant document after the fixed guides', () => {
    const doc = assistantContext(rent, stock)
    expect(doc.indexOf('# Quick answers')).toBeGreaterThan(doc.indexOf('# How to read'))
  })
})

describe('Ollama provider', () => {
  const tags = (names: string[]) => new Response(JSON.stringify({ models: names.map(name => ({ name })) }))
  it('explains what is missing', async () => {
    expect(await ollamaProvider({ model: 'qwen3:8b', transport: async () => tags(['qwen3:8b']) }).check()).toBeNull()
    expect(await ollamaProvider({ model: 'qwen3:14b', transport: async () => tags(['qwen3:8b']) }).check()).toContain('ollama pull qwen3:14b')
    expect(await ollamaProvider({ transport: async () => { throw new Error('refused') } }).check()).toContain('not reachable')
  })
  it('streams text and maps a length stop to max_tokens', async () => {
    let sent: { messages: { role: string; content: string }[]; options: { num_ctx: number } } | null = null
    const body = ['{"message":{"content":"Hel"},"done":false}\n{"message":{"con', 'tent":"lo"},"done":false}\n{"done":true,"done_reason":"length"}\n']
    const provider = ollamaProvider({ numCtx: 8192, transport: async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return new Response(new ReadableStream({ start(c) { body.forEach(b => c.enqueue(new TextEncoder().encode(b))); c.close() } }))
    } })
    const stream = provider.stream({ mode: 'briefing', context: 'cash: ৳5', messages: [] }, new AbortController().signal)
    const chunks: string[] = []
    let step = await stream.next()
    while (!step.done) { chunks.push(step.value); step = await stream.next() }
    expect(chunks.join('')).toBe('Hello')
    expect(step.value).toBe('max_tokens')
    expect(sent!.messages[0].role).toBe('system')
    expect(sent!.messages[0].content).toContain('cash: ৳5')
    expect(sent!.options.num_ctx).toBe(8192)
    expect((sent as unknown as { think: boolean }).think).toBe(true)
  })
})

describe('Assistant endpoint', () => {
  const servers: http.Server[] = []
  afterEach(() => servers.splice(0).forEach(s => s.close()))
  function serve(provider: Provider) {
    const handler = createAssistantHandler(provider)
    const server = http.createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end() }))
    servers.push(server)
    return new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
  }
  const fake = (over: Partial<Provider> = {}): Provider => ({
    name: 'ollama', model: 'test', local: true, check: async () => null,
    async *stream(request: AssistantRequest) { yield 'You asked '; yield String(request.messages.length); return 'end_turn' },
    ...over,
  })

  it('streams a chat answer to the browser client', async () => {
    const base = await serve(fake())
    let text = ''
    const end = await streamAssistant({ mode: 'chat', context: 'figures', messages: [{ role: 'user', content: 'hi' }] }, t => { text += t }, new AbortController().signal,
      (input, init) => fetch(`${base}${input}`, init))
    expect(text).toBe('You asked 1')
    expect(end.stop).toBe('end_turn')
  })
  it('writes a briefing once per set of figures and reuses it', async () => {
    let calls = 0
    const base = await serve(fake({ async *stream(request: AssistantRequest) { calls++; yield `Briefing for ${request.context}`; return 'end_turn' } }))
    const brief = async (context: string) => { let text = ''; await streamAssistant({ mode: 'briefing', context }, t => { text += t }, new AbortController().signal, (input, init) => fetch(`${base}${input}`, init)); return text }
    const [a, b] = await Promise.all([brief('figures A'), brief('figures A')])
    expect([a, b, await brief('figures A')]).toEqual(['Briefing for figures A', 'Briefing for figures A', 'Briefing for figures A'])
    expect(calls).toBe(1)
    expect(await brief('figures B')).toBe('Briefing for figures B')
    expect(calls).toBe(2)
    // Chat is never reused.
    await streamAssistant({ mode: 'chat', context: 'figures A', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal, (input, init) => fetch(`${base}${input}`, init))
    await streamAssistant({ mode: 'chat', context: 'figures A', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal, (input, init) => fetch(`${base}${input}`, init))
    expect(calls).toBe(4)
  })
  it('reports readiness and setup steps', async () => {
    const base = await serve(fake({ check: async () => 'Run: ollama serve' }))
    expect(await (await fetch(`${base}/api/assistant/status`)).json()).toEqual({ provider: 'ollama', model: 'test', local: true, ready: false, setup: 'Run: ollama serve' })
    const res = await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'briefing', context: 'figures' }) })
    expect(res.status).toBe(503)
  })
  it('refuses other websites, other methods and non-JSON bodies', async () => {
    const base = await serve(fake())
    const body = JSON.stringify({ mode: 'briefing', context: 'figures' })
    expect((await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body })).status).toBe(403)
    expect((await fetch(`${base}/api/assistant`)).status).toBe(405)
    expect((await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).status).toBe(415)
    expect((await fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400)
  })
  it('surfaces a provider failure as a readable error', async () => {
    // eslint-disable-next-line require-yield
    const base = await serve(fake({ async *stream() { throw new Error('boom') } }))
    await expect(streamAssistant({ mode: 'briefing', context: 'figures' }, () => {}, new AbortController().signal, (input, init) => fetch(`${base}${input}`, init)))
      .rejects.toThrow('The assistant failed unexpectedly.')
  })
})

describe('Radar section for the assistant', () => {
  it('sends the missing live feeds as a design limit, not an issue', async () => {
    const { withRadar } = await import('../server/assistant')
    const doc = await withRadar('figures', async () => ({
      version: 'x', fetchedAt: '2026-09-23T00:00:00Z', coverage: { portfolio: true, liveMarket: false, news: false, notifications: false },
      candidates: [], benchmark: null, issues: ['Live market and news monitoring are not connected. Push delivery is not connected to this app.', 'Journal is empty.'],
    }) as never)
    const radar = JSON.parse(doc.split('# Server-verified Strike Radar\n')[1])
    expect(radar.issues).toEqual(['Journal is empty.'])
    expect(radar.limitsByDesign).toContain('not a problem to report')
    expect(radar.portfolioSourceFresh).toBe(true)
    expect(doc).not.toContain('liveMarket')
  })
})
