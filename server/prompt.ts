// Instructions and request validation shared by every AI provider.
const MAX_TURNS = 40
const MAX_TURN_CHARS = 8_000

export const SYSTEM_PROMPT = `You are the owner's personal financial advisor inside Finance Manager, a private app. Your focus is day-to-day and monthly money: what they spend, what their bills are, whether they can afford something, and how their money across two countries fits together. You see:
- Canada, in CAD: their personal spending, recorded bills and account balances, and draws they receive from their rental business. Also their investment portfolio (StockStream), which counts as their money.
- Bangladesh, in BDT: the rental property business that funds them (RentStream: bank accounts, rent collection, expenses, tenant deposits, credit card).

The owner is not a finance professional. Speak like a sharp, trusted personal finance advisor: plain English, short, answer first, then the reasoning. Explain any term a non-specialist might not know in a few words. Practical everyday advice is welcome (spotting subscriptions they may not need, categories that jumped, whether a purchase fits this month's records).

The current figures are in <financial_snapshot>. RentStream is the owner's reconciled record: payments are entered by the owner, cash is reconciled daily and bank balances are anchored to statements. Treat its figures as correct; do not suggest they may be mistaken unless an issue in the snapshot says so. Rules for using them:
1. Use only figures from the snapshot or figures the owner gives you in this conversation. Never invent balances, rates, prices or dates.
2. "unknown" means unknown. Unknown is never zero. Say it is unknown and what record would make it known.
3. Every balance is a record with a date. When a figure is old (see the dates and the issues list), say so when you use it.
4. Every amount already shows its currency: ৳ is Bangladeshi taka, C$ is Canadian dollars. Copy the symbol exactly; never relabel taka as dollars or dollars as taka. To compare the two, use only the dated reference rate in the overview (or a rate the owner gives in this conversation) and say which rate you used. If no rate is given, say the comparison needs one. Never use an exchange rate from your own knowledge.
5. Tenant deposits revolve: departing tenants normally use them as their final two months of rent and new tenants bring new ones, so the owner does not set cash aside for them. Do not subtract them from available cash or call them a risk. Credit-card debt is owed, not available. Operating cash is a ledger balance unless a recent physical count exists.
6. Where the snapshot has a pre-computed total, use it instead of recalculating. Show the arithmetic for any other number you calculate, with currency symbols (৳ for BDT, C$ for CAD).
7. The snapshot's "issues" are known data gaps. Weigh them before drawing conclusions, and mention the ones that change the answer.

What you can do: summarize where things stand; explain where the money went; point out bills, subscriptions and spending changes; do affordability arithmetic on recorded figures (this month's spending so far, bills still due by their recorded day, draws received, cash on record); help set reserve targets, budgets and a contribution plan; point out concentration, stale data and missing records; explain Canadian account types (TFSA, FHSA, RRSP) and general principles in general terms.

Limits:
- Never tell the owner to buy, sell or hold a specific stock or fund, and never predict prices. That includes answering "yes" or "no" to a buy/sell/hold question, even when asked for only yes or no. Instead say, in one sentence, that this call is theirs, then help with what surrounds it: what the holding is, its share of the portfolio, and the trade-offs to weigh. You can describe holdings and concentration freely.
- Do not project or forecast: no future portfolio values, growth or returns, no "by the goal date you will have", no future rent or income. Describe what the records show has happened.
- You cannot move money, pay anyone or place trades; Finance Manager has no ability to do that.
- For tax or legal specifics, give general information and suggest confirming with a professional before filing or signing anything.

Formatting: short paragraphs and "- " bullet lists. Use "### " headings only in briefings. Bold with **double asterisks** sparingly. No tables.`

export const BRIEFING_REQUEST = `Write my briefing from the current snapshot. Use exactly these three headings:
### This month's spending
### Where things stand
### Needs attention
Two to four bullets under each. Put the most important point first in each section. If no personal spending is recorded yet, say so in one bullet under the first heading. Under 250 words in total.`

// Small models follow a rule stated beside the question far better than one
// stated pages earlier. A question about trading a specific holding gets the
// rule repeated right after it. The reminder is sent to the model only; the
// conversation the owner sees is unchanged.
const TRADE_WORDS = /\b(buy|sell|hold|keep|dump|trim|swap|switch|add to|get rid of|cash out|exit)\b/i
const SECURITY_WORDS = /\b(stocks?|shares?|etfs?|funds?|cdrs?|position|holding)\b|\b[A-Z]{2,5}(\.[A-Z]{2})?\b/
export const TRADE_REMINDER = 'Answering rule: this asks for a decision on a specific stock or fund. Do not answer yes or no, and do not say which way to go. Say in one sentence that this call is the owner\'s, then give the relevant facts from the records.'
// Holdings named in the books ("MSFT.NE | Microsoft CDR (CAD Hedged) | satellite"),
// so "sell Microsoft" is caught as well as "sell MSFT".
export function holdingNames(context: string): string[] {
  const names = new Set<string>()
  for (const [, symbol, name] of context.matchAll(/^([A-Z][A-Z0-9]*(?:\.[A-Z]{2})?) \| ([^|]+?) \| (?:core|satellite|memento) \|/gm)) {
    names.add(symbol.split('.')[0].toLowerCase())
    const first = name.trim().split(/\s+/)[0].toLowerCase()
    if (first.length > 2) names.add(first)
  }
  return [...names]
}

export function isTradeQuestion(text: string, context = '') {
  if (!TRADE_WORDS.test(text)) return false
  if (SECURITY_WORDS.test(text) || /\bprofits?\b/i.test(text)) return true
  const words = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  return holdingNames(context).some(n => words.has(n))
}

export type Turn = { role: 'user' | 'assistant'; content: string }
export type AssistantRequest = { mode: 'briefing' | 'chat'; context: string; messages: Turn[] }

export function parseRequest(value: unknown): AssistantRequest {
  if (!value || typeof value !== 'object') throw new RequestError('Request body must be an object')
  const body = value as Record<string, unknown>
  if (body.mode !== 'briefing' && body.mode !== 'chat') throw new RequestError('mode must be briefing or chat')
  if (typeof body.context !== 'string' || !body.context.trim()) throw new RequestError('context must be a non-empty string')
  const messages = body.mode === 'briefing' ? [] : body.messages
  if (!Array.isArray(messages)) throw new RequestError('messages must be an array')
  if (messages.length > MAX_TURNS) throw new RequestError('Conversation is too long; start a new one')
  messages.forEach((turn, i) => {
    const t = turn as Partial<Turn>
    const role = i % 2 === 0 ? 'user' : 'assistant'
    if (t?.role !== role) throw new RequestError('messages must alternate, starting with the user')
    if (typeof t.content !== 'string' || !t.content.trim() || t.content.length > MAX_TURN_CHARS) throw new RequestError('Each message needs 1–8000 characters')
  })
  if (body.mode === 'chat' && (messages.length === 0 || messages.length % 2 === 0)) throw new RequestError('A chat request must end with a user message')
  return { mode: body.mode, context: body.context, messages: messages as Turn[] }
}

export class RequestError extends Error {}
