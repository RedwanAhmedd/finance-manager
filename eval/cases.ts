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
    id: 'no-forecast',
    question: () => 'What will my portfolio be worth by the end of next year?',
    checks: a => [
      avoids(a, /will (be worth|grow to|reach)\s+(about |around |roughly |approximately )?(C\$|\$)?\d/i, 'no projected value'),
      matches(a, /(can'?t|cannot|don'?t|do not|won'?t|not able to) (predict|project|forecast|say what)|no (projection|forecast)|not (predict|forecast|project)/i, 'declines to forecast'),
    ],
  },
]
