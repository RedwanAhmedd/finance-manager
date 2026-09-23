import type { SupabaseClient } from '@supabase/supabase-js'
import { number, isStale, type DailyClose, type Holding, type StockSnapshot } from './models'
import { readAll } from './read'
import { buildStockBooks, type StockDetail } from '../books/stock'

type Amount = number | string
export interface StockRaw {
  positions: {id: string; symbol: string; role: string; shares: Amount; manual_price: Amount | null; anchor_price: Amount | null; anchor_underlying: Amount | null; updated_at: string}[]
  trades: {id: string; symbol: string; trade_date: string; shares: Amount; price: Amount; created_at: string}[]
  quotes: {symbol: string; trade_date: string; close: Amount}[]
  symbols: {symbol: string; currency: string; underlying_symbol: string | null; cdr_ratio: Amount | null; cdr_fx_rate: Amount | null; cdr_as_of: string | null; display_name?: string}[]
  settings: {user_id: string; base_currency: string; contributed_ytd: Amount | null; goal_amount?: Amount | null; goal_date?: string | null}[]
  fx: {base: string; quote: string; rate_date: string; rate: Amount}[]
}

export function normalizeStock(raw: StockRaw, now = new Date()): StockSnapshot {
  if (!raw.positions.length) throw new Error('No StockStream positions are visible to this user')
  const issues: string[] = []
  const today = now.toISOString().slice(0,10)
  const latest = new Map<string, StockRaw['quotes'][number]>()
  for (const q of [...raw.quotes].filter(q => q.trade_date <= today).sort((a,b) => b.trade_date.localeCompare(a.trade_date))) if (!latest.has(q.symbol)) latest.set(q.symbol, q)
  const metadata = new Map(raw.symbols.map(s => [s.symbol,s]))
  const usdCad = raw.fx.filter(f => f.base === 'USD' && f.quote === 'CAD' && f.rate_date <= today).sort((a,b) => b.rate_date.localeCompare(a.rate_date))[0]
  const holdings: Holding[] = raw.positions.map(pos => {
    const trades = raw.trades.filter(t => t.symbol === pos.symbol && t.trade_date <= today).sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    let shares = number(pos.shares)
    const tradeIssues: string[] = []
    if (trades.length && pos.role !== 'cash') {
      shares = 0
      for (const trade of trades) {
        const delta = number(trade.shares)
        if (shares + delta < -0.000001) tradeIssues.push(`${pos.symbol}: sale exceeds shares in the imported history.`)
        shares = delta > 0 ? shares + delta : Math.max(0, shares + delta)
      }
    }
    // Closed mementos retain their sale history without an actionable holdings alert.
    // Keep the alert for active roles and for mementos with remaining shares.
    if (pos.role !== 'memento' || shares !== 0) issues.push(...tradeIssues)
    if (shares < 0) throw new Error(`${pos.symbol}: negative position`)
    const meta = metadata.get(pos.symbol)
    const quote = latest.get(pos.symbol)
    const underlying = meta?.underlying_symbol ? latest.get(meta.underlying_symbol) : undefined
    let price: number | null = null
    let priceSource: Holding['priceSource'] = 'unavailable'
    let asOf: string | null = null
    if (pos.role === 'cash') { price = 1; priceSource = 'cash record'; asOf = pos.updated_at }
    else if (pos.manual_price !== null && number(pos.manual_price) > 0) { price = number(pos.manual_price); priceSource = 'manual'; asOf = pos.updated_at }
    else if (quote) { price = number(quote.close); priceSource = 'quote'; asOf = quote.trade_date }
    else if (underlying && meta?.cdr_ratio && meta.cdr_fx_rate) {
      price = number(underlying.close) * number(meta.cdr_ratio) * number(meta.cdr_fx_rate)
      priceSource = 'issuer derived'; asOf = [underlying.trade_date, meta.cdr_as_of ?? ''].sort()[0] || null
    } else if (underlying && pos.anchor_price && pos.anchor_underlying && number(pos.anchor_underlying) > 0) {
      price = number(pos.anchor_price) * number(underlying.close) / number(pos.anchor_underlying)
      priceSource = 'estimated'; asOf = [underlying.trade_date, pos.updated_at.slice(0,10)].sort()[0]
    }
    const currency = pos.role === 'cash' && pos.symbol === 'CAD' ? 'CAD' : meta?.currency
    let multiplier: number | null = currency === 'CAD' ? 1 : currency === 'USD' && usdCad ? number(usdCad.rate) : null
    if (multiplier !== null && multiplier <= 0) multiplier = null
    const valueCad = shares === 0 ? 0 : price !== null && price >= 0 && multiplier !== null ? shares * price * multiplier : null
    if (shares > 0 && valueCad === null) issues.push(`${pos.symbol}: price or currency conversion unavailable; portfolio total withheld.`)
    if ((shares > 0 || pos.role === 'cash') && isStale(asOf, now)) issues.push(`${pos.symbol}: ${priceSource} is stale or undated (${asOf?.slice(0,10) ?? 'unknown'}).`)
    if (shares > 0 && priceSource === 'estimated') issues.push(`${pos.symbol}: estimated CDR value; not a quoted receipt price.`)
    if (shares > 0 && currency === 'USD' && (!usdCad || isStale(usdCad.rate_date, now))) issues.push(`${pos.symbol}: USD/CAD rate needs verification.`)
    return { symbol: pos.symbol, role: pos.role, shares, valueCad, priceSource, asOf }
  })
  const closes: DailyClose[] = raw.positions.filter(p => p.role !== 'cash').flatMap(pos => {
    const own = raw.quotes.filter(q => q.symbol === pos.symbol && q.trade_date <= today).sort((a, b) => b.trade_date.localeCompare(a.trade_date))
    if (!own.length) return []
    return [{ symbol: pos.symbol, currency: metadata.get(pos.symbol)?.currency ?? null, date: own[0].trade_date, close: number(own[0].close),
      previousDate: own[1]?.trade_date ?? null, previousClose: own[1] ? number(own[1].close) : null }]
  })
  const sum = (rows: Holding[]) => rows.some(r => r.valueCad === null) ? null : rows.reduce((s,r) => s + r.valueCad!,0)
  const cashRows = holdings.filter(h => h.role === 'cash')
  const cashCad = cashRows.length ? sum(cashRows) : null
  if (!cashRows.length) issues.push('No brokerage-cash position is recorded. Cash is unknown, not zero.')
  const portfolioCad = sum(holdings)
  const investedCad = sum(holdings.filter(h => h.role !== 'cash'))
  const core = sum(holdings.filter(h => h.role === 'core'))
  const settings = raw.settings.length === 1 ? raw.settings[0] : null
  if (settings?.base_currency !== 'CAD') issues.push('Contribution settings are unavailable or not denominated in CAD.')
  return {
    fetchedAt: now.toISOString(), holdings, portfolioCad, investedCad, cashCad,
    cashAsOf: cashRows.map(h => h.asOf).sort()[0] ?? null,
    corePct: portfolioCad !== null && portfolioCad > 0 && core !== null ? core / portfolioCad * 100 : null,
    contributedYtdCad: settings?.base_currency === 'CAD' && settings.contributed_ytd !== null ? number(settings.contributed_ytd) : null,
    issues, closes,
  }
}

export class ReadOnlyStockStreamAdapter {
  constructor(private readonly client: SupabaseClient) {}
  async getSnapshot(now = new Date()): Promise<StockSnapshot> {
    const c = this.client
    const [positions, trades, quotes, symbols, settings, fx, watchlist] = await Promise.all([
      readAll<StockRaw['positions'][number]>(c, 'positions', 'id,symbol,role,shares,manual_price,anchor_price,anchor_underlying,updated_at'),
      readAll<StockRaw['trades'][number]>(c, 'trades', 'id,symbol,trade_date,shares,price,created_at'),
      readAll<StockRaw['quotes'][number]>(c, 'quotes', 'symbol,trade_date,close', ['symbol','trade_date']),
      readAll<StockRaw['symbols'][number]>(c, 'symbols', 'symbol,currency,underlying_symbol,cdr_ratio,cdr_fx_rate,cdr_as_of,display_name', ['symbol']),
      readAll<StockRaw['settings'][number]>(c, 'settings', 'user_id,base_currency,contributed_ytd,goal_amount,goal_date', ['user_id']),
      readAll<StockRaw['fx'][number]>(c, 'fx_rates', 'base,quote,rate_date,rate', ['base','quote','rate_date']),
      readAll<StockDetail['watchlist'][number]>(c, 'watchlist', 'symbol', ['symbol']),
    ])
    const raw = {positions,trades,quotes,symbols,settings,fx}
    const snapshot = normalizeStock(raw, now)
    return { ...snapshot, books: buildStockBooks({ ...raw, watchlist }, snapshot, now) }
  }
}
