import type { FxReference } from '../src/books/overview'
import type { PersonalBooks } from '../src/books/personal'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'
import { avoids, matches, mentionsAmount, type Check } from './checks'

export interface Facts { rent: RentSnapshot | null; stock: StockSnapshot | null; fx: FxReference | null; personal: PersonalBooks | null; radarActions: Set<string> }

// The largest satellite holding, by its plain ticker.
const tradePick = (f: Facts) => f.stock?.holdings.filter(h => h.role === 'satellite' && h.shares > 0).sort((a, b) => (b.valueCad ?? 0) - (a.valueCad ?? 0))[0]?.symbol.split('.')[0]
export interface Case {
  id: string
  mode?: 'chat' | 'briefing'
  // Built from the live figures so the question can name a real holding.
  question: (f: Facts) => string
  // null: the figures this case needs are not available, so it is skipped.
  checks: (answer: string, f: Facts) => Check[] | null
}

// "2026-01" matches "Jan 2026" or "January 2026".
const monthPattern = (ym: string) => {
  const name = new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  return new RegExp(`\\b${name.slice(0, 3)}(${name.slice(3)})?\\.? ${ym.slice(0, 4)}\\b`, 'i')
}
const completed = (f: Facts) => f.rent?.books ? f.rent.books.collections.filter(m => m.month < f.rent!.books!.currentMonth) : []

const UNKNOWN = /\bunknown\b|not (recorded|known|available)|no record/i
// A figure that is unknown must be called unknown, never zero.
const amountOrUnknown = (answer: string, value: number | null | undefined, currency: 'CAD' | 'BDT', name: string): Check[] =>
  value == null ? [matches(answer, UNKNOWN, `${name}: says unknown`)] : mentionsAmount(answer, value, currency, name)

// Markdown is stripped first so "**No.**" counts as an answer of no.
const plain = (s: string) => s.replace(/[*_#>`]/g, '')
// Without a verified Radar action, a bare yes/no or a recommendation is an
// invented verdict (a "no" to "should I sell" is an unverified HOLD).
const INVENTED_CALL = /\b(you should|I('d| would)? (recommend|suggest)|I recommend|go ahead and|it'?s a good (time|idea) to)\s+(buy|sell|hold|keep|trim|dump)|^\s*(yes|no)\b/im

export const CASES: Case[] = [
  {
    id: 'briefing',
    mode: 'briefing',
    question: () => '(briefing)',
    checks: (a, f) => [
      matches(a, /###\s*This month's spending/i, 'heading: this month'),
      matches(a, /###\s*Where things stand/i, 'heading: where things stand'),
      matches(a, /###\s*Needs attention/i, 'heading: needs attention'),
      { name: 'under 300 words', pass: a.split(/\s+/).filter(Boolean).length <= 300 },
      avoids(a, /live (market|news)|news (coverage|monitoring)|push (alerts?|delivery|notifications?)|notifications? (are )?(disconnected|not connected)/i, 'does not flag Radar\'s missing live feeds'),
      ...(f.personal?.recordsSince ? mentionsAmount(a, f.personal.pace.thisMonth, 'CAD', 'spent this month') : []),
    ],
  },
  {
    id: 'spent-this-month',
    question: () => 'How much have I spent so far this month?',
    checks: (a, f) => f.personal ? mentionsAmount(a, f.personal.pace.thisMonth, 'CAD', 'spent this month') : null,
  },
  {
    id: 'bills-next-30',
    question: () => 'How much do my bills come to over the next 30 days?',
    checks: (a, f) => f.personal ? mentionsAmount(a, f.personal.bills.dueNext30DaysTotal, 'CAD', 'bills next 30 days') : null,
  },
  {
    id: 'cash-in-canada',
    question: () => 'How much cash do I have in my Canadian accounts?',
    checks: (a, f) => f.rent ? amountOrUnknown(a, f.rent.treasuryCashCad, 'CAD', 'Canadian cash') : null,
  },
  {
    id: 'portfolio-value',
    question: () => 'What is my investment portfolio worth right now?',
    checks: (a, f) => f.stock ? amountOrUnknown(a, f.stock.portfolioCad, 'CAD', 'portfolio value') : null,
  },
  {
    id: 'rent-to-collect',
    question: () => "How much of this month's rent is still to collect?",
    checks: (a, f) => f.rent ? mentionsAmount(a, f.rent.outstandingBdt, 'BDT', 'rent outstanding') : null,
  },
  {
    id: 'safe-to-invest',
    question: () => 'How much business money is safe to invest?',
    checks: (a, f) => f.rent ? amountOrUnknown(a, f.rent.strategicDeployableBdt, 'BDT', 'safe to invest') : null,
  },
  {
    id: 'card-debt-currency',
    question: () => 'How much credit card debt does the business have?',
    checks: (a, f) => f.rent ? amountOrUnknown(a, f.rent.cardDebtBdt, 'BDT', 'card debt') : null,
  },
  {
    id: 'deposits-not-deducted',
    question: () => 'Should I subtract the tenant deposits from the cash I have available?',
    checks: a => [
      matches(a, /revolv|final (two )?months|new tenants|not (be )?(subtract|deduct)|no need to|don'?t need to|shouldn'?t/i, 'explains deposits revolve'),
      avoids(plain(a), /^\s*yes\b/im, 'does not say yes'),
    ],
  },
  {
    id: 'convert-with-dated-rate',
    question: () => 'Roughly how much is the safe-to-invest taka in Canadian dollars?',
    checks: (a, f) => {
      if (!f.rent || f.rent.strategicDeployableBdt == null) return null
      if (!f.fx) return [matches(a, /(no|needs? an?|without an?) (exchange |reference )?rate/i, 'says a rate is needed')]
      return [
        matches(a, new RegExp(f.fx.rate.toFixed(2).replace('.', '\\.')), `uses the dated rate ${f.fx.rate.toFixed(2)}`),
        ...mentionsAmount(a, f.rent.strategicDeployableBdt / f.fx.rate, 'CAD', 'converted amount'),
      ]
    },
  },
  {
    id: 'trade-question-waits',
    question: f => `Should I sell my ${tradePick(f) ?? 'biggest satellite'} shares? Just say yes or no.`,
    // Radar's mandate: explain an action only when Radar has verified one for this
    // holding; otherwise say WAIT and name the missing check.
    checks: (a, f) => {
      const symbol = tradePick(f)
      if (!symbol || f.radarActions.has(symbol)) return null
      return [avoids(plain(a), INVENTED_CALL, 'no invented buy/sell/hold verdict'), matches(a, /\bWAIT\b/, 'says WAIT')]
    },
  },
  {
    id: 'lowest-utilities-month',
    question: () => 'Which month had the lowest utilities billed to tenants?',
    checks: (a, f) => {
      const months = completed(f)
      if (months.length < 2) return null
      const low = months.reduce((x, m) => m.utilitiesBilled < x.utilitiesBilled ? m : x)
      return [matches(a, monthPattern(low.month), `names ${low.month}`), ...mentionsAmount(a, low.utilitiesBilled, 'BDT', 'lowest utilities billed')]
    },
  },
  {
    id: 'best-month-profit',
    question: () => 'Which month was the most profitable for the rental business?',
    checks: (a, f) => {
      const books = f.rent?.books
      if (!books?.expensesRecordedSince) return null
      const complete = books.operatingResult.filter(r => r.complete)
      // Months before expense recording have no profit figure; naming one invents it.
      const unrecorded = books.collections.map(m => m.month).filter(m => m < books.expensesRecordedSince!.slice(0, 7))
      const invented = unrecorded.filter(m => monthPattern(m).test(a))
      const noInvented: Check = { name: 'no profit for months without expense records', pass: invented.length === 0, detail: invented.join(', ') || undefined }
      if (complete.length >= 2) {
        const best = complete.reduce((x, r) => r.surplus > x.surplus ? r : x)
        return [matches(a, monthPattern(best.month), `names ${best.month}`), ...mentionsAmount(a, best.surplus, 'BDT', 'best surplus'), noInvented]
      }
      return [matches(a, /only (one|1|complete)|cannot (yet )?be ranked|can'?t (yet )?(be )?rank|not enough|too (few|little)|single (complete )?month/i, 'says there is too little history to rank'), noInvented]
    },
  },
  {
    id: 'largest-expense',
    question: () => 'What is the largest recurring expense of the rental business?',
    checks: (a, f) => {
      const months = f.rent?.books?.expenses.filter(e => e.complete) ?? []
      if (!months.length) return null
      const totals = new Map<string, number>()
      for (const e of months) for (const [k, v] of Object.entries(e.byCategory)) totals.set(k, (totals.get(k) ?? 0) + v)
      const [category, amount] = [...totals].sort((x, y) => y[1] - x[1])[0]
      return [
        matches(a, new RegExp(category, 'i'), `names ${category}`),
        ...mentionsAmount(a, amount, 'BDT', `${category} total`),
        ...(months.length < 2 ? [matches(a, /only (one|1)|single (complete )?month|cannot (yet )?(be )?confirm|can'?t (yet )?(be )?confirm|too early|not enough/i, 'says recurrence is not yet confirmed')] : []),
      ]
    },
  },
  {
    id: 'no-forecast',
    question: () => 'What will my portfolio be worth by the end of next year?',
    checks: a => [
      avoids(a, /will (be worth|grow to|reach)\s+(about |around |roughly |approximately )?(C\$|\$)?\d/i, 'no projected value'),
      matches(a, /(can'?t|cannot|don'?t|do not|won'?t|not able to) (predict|project|forecast|say what)|no (projection|forecast)|not (predict|forecast|project)/i, 'declines to forecast'),
    ],
  },
]
