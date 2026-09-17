import type { StockBooks } from './stock'

const cad = (n: number | null) => n === null ? 'unknown' : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const signed = (n: number | null) => n === null ? 'unknown' : `${n >= 0 ? '+' : ''}${cad(n)}`
const pct = (n: number | null) => n === null ? 'unknown' : `${n}%`
const signedPct = (n: number | null) => n === null ? 'unknown' : `${n >= 0 ? '+' : ''}${n}%`
const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const table = (head: string[], rows: (string | number)[][]) => [head.join(' | '), head.map(() => '---').join(' | '), ...rows.map(r => r.join(' | '))].join('\n')

// How the Canadian investment side works. Without it a model treats receipts as
// US shares, reads a two-week price move as a trend, or picks stocks.
export const STOCK_GUIDE = `## How the Canadian investments work (StockStream)
- The owner invests in Canada through a brokerage account; count it as the owner's money. All amounts are Canadian dollars (C$).
- The portfolio has a core and satellites. The core is XEQT, a single ETF holding thousands of companies worldwide; it is the diversified base. Satellites are individual companies the owner chose, held as CDRs (Canadian Depositary Receipts): CAD-hedged receipts traded in Canada that track a US share without currency risk. A memento is a token position kept for sentimental reasons.
- Cost and gains use the Canadian adjusted-cost-base method (average cost). Trade history starts on the date shown below; positions bought earlier have unknown cost and are listed as excluded.
- StockStream's project notes describe this as a single TFSA account, where gains are not taxed. The records themselves do not store the account type, so mention that caveat if tax matters to the answer.
- The price history covers only a few weeks. Short price moves are not trends and say nothing about future returns.
- The owner has a savings goal. Progress is measured by today's portfolio value and what has actually been invested. There is no monthly plan, and nothing here projects future values.
- Never tell the owner to buy, sell or hold a specific stock or fund. You can describe what the records show: concentration, costs of frequent trading, realised results, and progress to the goal.`

export function renderStockBooks(b: StockBooks): string {
  const t = b.totals, g = b.goal, a = b.activity
  const sections = [STOCK_GUIDE, `## StockStream books as of ${b.asOf}
Trade history starts: ${b.historyStarts ?? 'no trades recorded'}.`]

  sections.push(`### Holdings (largest first)
${table(['Symbol', 'Name', 'Role', 'Shares', 'Average cost', 'Book cost', 'Market value', 'Gain', 'Gain %', 'Share of portfolio', 'Price basis (date)'],
    b.holdings.map(h => [h.symbol, h.name, h.role, h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }), cad(h.averageCost), cad(h.bookCost), cad(h.value), signed(h.gain), signedPct(h.gainPercent), pct(h.weightPercent), `${h.priceBasis} (${h.priceDate ?? 'unknown'})`]))}
Totals: market value ${cad(t.value)}; book cost ${cad(t.bookCost)}; unrealised gain ${signed(t.gain)} (${signedPct(t.gainPercent)}); brokerage cash ${cad(t.cash)}.
Core ${cad(t.coreValue)} (${pct(t.corePercent)} of portfolio); satellites ${cad(t.satelliteValue)} (${pct(t.satellitePercent)}).
Ranked by gain %: ${[...b.holdings].filter(h => h.gainPercent !== null).sort((x, y) => y.gainPercent! - x.gainPercent!).map((h, i) => `${i + 1}. ${h.symbol} ${signedPct(h.gainPercent)}`).join('; ') || 'unknown'}.
${b.excludedFromCost.length ? `Excluded from cost and gains (history incomplete or not in CAD): ${b.excludedFromCost.join(', ')}.` : ''}`)

  sections.push(`### Realised results from sales (average-cost method)
${b.realized.length ? table(['Symbol', 'Name', 'Realised', 'Position now closed?'], b.realized.map(r => [r.symbol, r.name, signed(r.realized), r.closed ? 'yes' : 'no'])) : 'No sales with known cost.'}
Total realised: ${signed(b.realizedTotal)}.`)

  sections.push(`### Money put in and taken out, by month (all trades, broker cash amounts)
${table(['Month', 'Trades', 'Bought', 'Sold', 'Net new money invested'], b.months.map(m => [label(m.month), m.trades, cad(m.bought), cad(m.sold), signed(m.netInvested)]))}
Trading activity: ${a.trades} trades across ${a.symbolsTraded} symbols since ${b.historyStarts ?? 'unknown'}. Positions opened and fully closed again: ${a.openedAndClosed.join(', ') || 'none'}. Bought and sold on the same day: ${a.sameDayRoundTrips.join(', ') || 'none'}.`)

  sections.push(`### Savings goal (recorded facts only, no projections)
Goal: ${cad(g.amount)} by ${g.date ?? 'unknown'}; ${g.monthsLeft ?? 'unknown'} whole months left. Portfolio today ${cad(t.value)} = ${pct(g.progressPercent)} of the goal; ${cad(g.stillToReach)} still to reach it.
Actually invested: ${cad(g.averageMonthlyInvested)} a month on average over ${g.completeMonthsMeasured} complete month${g.completeMonthsMeasured === 1 ? '' : 's'} of history (a short record; the first month includes the move into this account).`)

  sections.push(`### Price moves over the recorded quote history (too short to be a trend)
${b.priceMoves.map(m => `${m.symbol} ${signedPct(m.changePercent)} (${m.from} to ${m.to})`).join('; ') || 'Not enough price history.'}
Watchlist (researching, not held): ${b.watchlist.join(', ') || 'empty'}.`)

  return sections.join('\n\n')
}
