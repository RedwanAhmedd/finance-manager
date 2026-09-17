import type { Category, CategoryRule, Kind } from './types'

// Bank descriptions shout, pad and append store numbers ("NETFLIX.COM   866-579-7172 ON").
export function normaliseDescription(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').trim()
}

interface Builtin { pattern: RegExp; kind: Kind; category: Category | null }

// A starting point only. The owner's own rules always win, and anything not
// matched is flagged for review rather than guessed.
const BUILTINS: Builtin[] = [
  { pattern: /NETFLIX|SPOTIFY|DISNEY ?\+|DISNEYPLUS|CRAVE|PRIME VIDEO|AMAZON PRIME|APPLE\.COM\/BILL|GOOGLE \*|YOUTUBE ?PREMIUM|CHATGPT|OPENAI|ANTHROPIC|CLAUDE\.AI|ICLOUD|PATREON|AUDIBLE/, kind: 'spend', category: 'subscriptions' },
  { pattern: /ROGERS|BELL CANADA|\bBELL\b|FIDO|KOODO|TELUS|FREEDOM MOBILE|VIRGIN PLUS|CHATR|PUBLIC MOBILE|LUCKY MOBILE|SHAW|VIDEOTRON/, kind: 'spend', category: 'phone_internet' },
  { pattern: /HYDRO|ENBRIDGE|FORTISBC|EPCOR|ATCO|TORONTO HYDRO|ALECTRA|WATER BILL/, kind: 'spend', category: 'utilities' },
  { pattern: /LOBLAW|NO FRILLS|NOFRILLS|METRO\b|SOBEYS|FRESHCO|FOOD BASICS|WALMART|COSTCO|FARM BOY|T&T|SUPERSTORE|SAVE ON FOODS|IGA\b|ADONIS|INSTACART|VOILA/, kind: 'spend', category: 'groceries' },
  { pattern: /UBER ?EATS|DOORDASH|SKIPTHEDISHES|SKIP THE DISHES|TIM HORTONS|STARBUCKS|MCDONALD|A&W|SUBWAY|PIZZA|RESTAURANT|CAFE|COFFEE/, kind: 'spend', category: 'dining' },
  { pattern: /PRESTO|\bTTC\b|GO TRANSIT|OC TRANSPO|STM\b|TRANSLINK|UBER\b(?! ?EATS)|LYFT|PETRO|ESSO|SHELL|PIONEER|ULTRAMAR|CANADIAN TIRE GAS|PARKING|IMPARK|GREEN P/, kind: 'spend', category: 'transport' },
  { pattern: /INSURANCE|INTACT|DESJARDINS INS|AVIVA|BELAIR|SQUARE ONE/, kind: 'spend', category: 'insurance' },
  { pattern: /PHARMA|SHOPPERS DRUG|REXALL|DENTAL|CLINIC|PHYSIO|OPTOMETR/, kind: 'spend', category: 'health' },
  { pattern: /AMAZON|AMZN|BEST BUY|IKEA|WINNERS|CANADIAN TIRE|DOLLARAMA|H&M|UNIQLO|APPLE STORE/, kind: 'spend', category: 'shopping' },
  { pattern: /AIR CANADA|WESTJET|FLAIR|PORTER AIR|AIRBNB|EXPEDIA|BOOKING\.COM|HOTEL|VIA RAIL/, kind: 'spend', category: 'travel' },
  { pattern: /MONTHLY ACCOUNT FEE|SERVICE CHARGE|OVERDRAFT|INTEREST CHARGE|ANNUAL FEE|NSF FEE|\bFEE\b/, kind: 'spend', category: 'fees' },
  { pattern: /\bRENT\b|PROPERTY MGMT|PROPERTY MANAGEMENT/, kind: 'spend', category: 'housing' },
]

export interface Classification { kind: Kind; category: Category | null; flagged: boolean; rule: 'owner' | 'builtin' | 'none' }

// Owner rules are case-insensitive substrings; the longest (most specific) wins.
export function classify(description: string, amount: number, rules: Pick<CategoryRule, 'pattern' | 'kind' | 'category'>[]): Classification {
  const text = normaliseDescription(description)
  const owner = rules.filter(r => text.includes(normaliseDescription(r.pattern))).sort((a, b) => b.pattern.length - a.pattern.length)[0]
  if (owner) return fitSign({ kind: owner.kind, category: owner.category, flagged: false, rule: 'owner' }, amount)
  const builtin = BUILTINS.find(b => b.pattern.test(text))
  if (builtin) return fitSign({ kind: builtin.kind, category: builtin.category, flagged: false, rule: 'builtin' }, amount)
  return amount < 0
    ? { kind: 'spend', category: 'other', flagged: true, rule: 'none' }
    : { kind: 'income', category: null, flagged: true, rule: 'none' }
}

// A spending category on money coming in is a refund from that merchant, and
// an income or draw rule cannot apply to money going out.
function fitSign(c: Classification, amount: number): Classification {
  if ((c.kind === 'spend' || c.kind === 'refund') && c.category) return { ...c, kind: amount < 0 ? 'spend' : 'refund' }
  if ((c.kind === 'income' || c.kind === 'draw') && amount < 0) return { kind: 'spend', category: 'other', flagged: true, rule: c.rule }
  return c
}

export function monthlyEquivalent(amount: number, cadence: 'weekly' | 'biweekly' | 'monthly' | 'yearly'): number {
  const factor = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, yearly: 1 / 12 }[cadence]
  return Math.round(amount * factor * 100) / 100
}
