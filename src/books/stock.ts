import { number, type StockSnapshot } from '../live/models'
import type { StockRaw } from '../live/stockstream'

// StockStream's record reshaped into investment books: cost base, gains, money
// put in, trading activity, the savings goal and short price moves. Everything
// is computed here; the assistant reads results.

export interface StockDetail {
  watchlist: { symbol: string }[]
}

export interface HoldingBook {
  symbol: string
  name: string
  role: string
  shares: number
  averageCost: number | null
  bookCost: number | null
  value: number | null
  gain: number | null
  gainPercent: number | null
  weightPercent: number | null
  priceBasis: string
  priceDate: string | null
  historyComplete: boolean
}
export interface StockBooks {
  asOf: string
  currency: 'CAD'
  historyStarts: string | null
  holdings: HoldingBook[]
  totals: { value: number | null; bookCost: number | null; gain: number | null; gainPercent: number | null; coreValue: number | null; satelliteValue: number | null; corePercent: number | null; satellitePercent: number | null; cash: number | null }
  realized: { symbol: string; name: string; realized: number; closed: boolean }[]
  realizedTotal: number
  excludedFromCost: string[]
  months: { month: string; trades: number; bought: number; sold: number; netInvested: number }[]
  activity: { trades: number; symbolsTraded: number; openedAndClosed: string[]; sameDayRoundTrips: string[] }
  goal: { amount: number | null; date: string | null; monthsLeft: number | null; averageMonthlyInvested: number | null; completeMonthsMeasured: number; progressPercent: number | null; stillToReach: number | null }
  priceMoves: { symbol: string; from: string; to: string; changePercent: number }[]
  watchlist: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildStockBooks(raw: StockRaw & StockDetail, snapshot: StockSnapshot, now = new Date()): StockBooks {
  const today = now.toISOString().slice(0, 10)
  const meta = new Map(raw.symbols.map(s => [s.symbol, s]))
  // Imported trades share one timestamp, so within a day a sale could sort before
  // the purchase it closes. Nothing is sold short: buys come first on the same date.
  const trades = raw.trades.filter(t => t.trade_date <= today)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date) || Math.sign(number(b.shares)) - Math.sign(number(a.shares)) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const cadTrade = (symbol: string) => (meta.get(symbol)?.currency ?? (symbol === 'CAD' ? 'CAD' : null)) === 'CAD'

  // Adjusted cost base per symbol (Canadian average-cost method). A sale larger
  // than the shares recorded means the position predates the history, so its
  // cost is unknown rather than guessed.
  const ledger = new Map<string, { shares: number; basis: number; realized: number; complete: boolean; bought: boolean }>()
  for (const t of trades) {
    const l = ledger.get(t.symbol) ?? { shares: 0, basis: 0, realized: 0, complete: true, bought: false }
    const qty = number(t.shares), price = number(t.price)
    if (qty > 0) { l.shares += qty; l.basis += qty * price; l.bought = true }
    else {
      const sell = -qty
      if (sell > l.shares + 1e-6) l.complete = false
      const matched = Math.min(sell, l.shares)
      const avg = l.shares > 0 ? l.basis / l.shares : 0
      l.realized += matched * (price - avg)
      l.basis -= matched * avg
      l.shares -= matched
      if (l.shares < 1e-6) { l.shares = 0; l.basis = 0 }
    }
    ledger.set(t.symbol, l)
  }
  const excludedFromCost = [...ledger.keys()].filter(s => !cadTrade(s) || !ledger.get(s)!.complete)

  const valued = snapshot.holdings.filter(h => h.role !== 'cash' && (h.shares > 0))
  const totalValue = snapshot.portfolioCad
  const holdings: HoldingBook[] = valued.map(h => {
    const l = ledger.get(h.symbol)
    const known = !!l && l.complete && cadTrade(h.symbol)
    const bookCost = known ? round2(l!.basis) : null
    const gain = bookCost !== null && h.valueCad !== null ? round2(h.valueCad - bookCost) : null
    return {
      symbol: h.symbol, name: meta.get(h.symbol)?.display_name ?? h.symbol, role: h.role, shares: h.shares,
      averageCost: known && h.shares > 0 ? round2(l!.basis / h.shares) : null, bookCost, value: h.valueCad === null ? null : round2(h.valueCad),
      gain, gainPercent: gain !== null && bookCost ? Math.round(gain / bookCost * 1000) / 10 : null,
      weightPercent: h.valueCad !== null && totalValue ? Math.round(h.valueCad / totalValue * 1000) / 10 : null,
      priceBasis: h.priceSource, priceDate: h.asOf?.slice(0, 10) ?? null, historyComplete: known,
    }
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1))

  const sumOf = (rows: HoldingBook[], f: (h: HoldingBook) => number | null) => rows.some(r => f(r) === null) ? null : round2(rows.reduce((s, r) => s + f(r)!, 0))
  const bookCost = sumOf(holdings, h => h.bookCost)
  const value = sumOf(holdings, h => h.value)
  const coreValue = sumOf(holdings.filter(h => h.role === 'core'), h => h.value)
  const satelliteValue = sumOf(holdings.filter(h => h.role === 'satellite'), h => h.value)
  const pctOf = (part: number | null) => part === null || !totalValue ? null : Math.round(part / totalValue * 1000) / 10

  const realized = [...ledger.entries()].filter(([s, l]) => cadTrade(s) && l.complete && Math.abs(l.realized) >= 0.005)
    .map(([symbol, l]) => ({ symbol, name: meta.get(symbol)?.display_name ?? symbol, realized: round2(l.realized), closed: l.shares === 0 }))
    .sort((a, b) => a.realized - b.realized)

  const monthKeys = [...new Set(trades.map(t => t.trade_date.slice(0, 7)))].sort()
  const months = monthKeys.map(m => {
    // Broker cash amounts are recorded in CAD for every trade, and a sale of a
    // position that predates the history still funds later buys, so all count.
    const rows = trades.filter(t => t.trade_date.startsWith(m))
    const bought = round2(rows.filter(t => number(t.shares) > 0).reduce((s, t) => s + number(t.shares) * number(t.price), 0))
    const sold = round2(rows.filter(t => number(t.shares) < 0).reduce((s, t) => s - number(t.shares) * number(t.price), 0))
    return { month: m, trades: trades.filter(t => t.trade_date.startsWith(m)).length, bought, sold, netInvested: round2(bought - sold) }
  })

  const byDay = new Map<string, Set<string>>()
  for (const t of trades) {
    const key = `${t.symbol}|${t.trade_date}`
    byDay.set(key, (byDay.get(key) ?? new Set()).add(number(t.shares) > 0 ? 'buy' : 'sell'))
  }
  const activity = {
    trades: trades.length, symbolsTraded: ledger.size,
    openedAndClosed: [...ledger.entries()].filter(([, l]) => l.bought && l.complete && l.shares === 0).map(([s]) => s),
    sameDayRoundTrips: [...new Set([...byDay.entries()].filter(([, kinds]) => kinds.size === 2).map(([k]) => k.split('|')[0]))],
  }

  const settings = raw.settings.length === 1 ? raw.settings[0] : null
  const goalAmount = settings?.goal_amount != null ? number(settings.goal_amount) : null
  const goalDate = settings?.goal_date ?? null
  // Whole calendar months only: counting a partial month made the plan look on pace.
  const monthsLeft = goalDate ? Math.max(0, (Number(goalDate.slice(0, 4)) - now.getUTCFullYear()) * 12 + Number(goalDate.slice(5, 7)) - (now.getUTCMonth() + 1) - 1) : null
  // Recorded facts only: what has been invested and how far the portfolio is
  // from the goal. Nothing here projects forward.
  const completeMonths = months.filter(m => m.month < today.slice(0, 7))
  const averageMonthlyInvested = completeMonths.length ? round2(completeMonths.reduce((s, m) => s + m.netInvested, 0) / completeMonths.length) : null
  const goal = {
    amount: goalAmount, date: goalDate, monthsLeft,
    averageMonthlyInvested, completeMonthsMeasured: completeMonths.length,
    progressPercent: goalAmount && totalValue !== null ? Math.round(totalValue / goalAmount * 1000) / 10 : null,
    stillToReach: goalAmount !== null && totalValue !== null ? round2(Math.max(0, goalAmount - totalValue)) : null,
  }

  // Price change over the recorded quote history for each holding (its
  // underlying for receipts). The history is short, so it is a move, not a trend.
  const priceMoves = valued.map(h => {
    const symbol = meta.get(h.symbol)?.underlying_symbol ?? h.symbol
    const q = raw.quotes.filter(x => x.symbol === symbol && x.trade_date <= today).sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    if (q.length < 2) return null
    const first = number(q[0].close), last = number(q[q.length - 1].close)
    return first > 0 ? { symbol: h.symbol, from: q[0].trade_date, to: q[q.length - 1].trade_date, changePercent: Math.round((last - first) / first * 1000) / 10 } : null
  }).filter((m): m is NonNullable<typeof m> => m !== null)

  return {
    asOf: today, currency: 'CAD', historyStarts: trades[0]?.trade_date ?? null, holdings,
    totals: { value, bookCost, gain: value !== null && bookCost !== null ? round2(value - bookCost) : null, gainPercent: value !== null && bookCost ? Math.round((value - bookCost) / bookCost * 1000) / 10 : null, coreValue, satelliteValue, corePercent: pctOf(coreValue), satellitePercent: pctOf(satelliteValue), cash: snapshot.cashCad },
    realized, realizedTotal: round2(realized.reduce((s, r) => s + r.realized, 0)), excludedFromCost,
    months, activity, goal, priceMoves, watchlist: raw.watchlist.map(w => w.symbol),
  }
}
