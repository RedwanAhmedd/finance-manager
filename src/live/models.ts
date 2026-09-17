import type { RentBooks } from '../books/rent'
import type { StockBooks } from '../books/stock'
export interface BankBalance {
  id: string
  name: string
  type: string
  currency: 'BDT'
  balance: number | null
  anchorDate: string | null
}
export interface RentSnapshot {
  fetchedAt: string
  businessDate: string
  month: string
  banks: BankBalance[]
  bankCashBdt: number | null
  cardDebtBdt: number | null
  operatingCashBdt: number | null
  cashCountDate: string | null
  refundableDepositsBdt: number
  expectedBdt: number
  collectedBdt: number
  outstandingBdt: number
  overdueBdt: number
  overdueBills: number
  overdueTenants: number
  overdueSince: string | null
  cashReceipts30dBdt: number
  books?: RentBooks
  expenses30dBdt: number
  issues: string[]
}
export interface Holding {
  symbol: string
  role: string
  shares: number
  valueCad: number | null
  priceSource: 'cash record' | 'manual' | 'quote' | 'issuer derived' | 'estimated' | 'unavailable'
  asOf: string | null
}
export interface StockSnapshot {
  fetchedAt: string
  holdings: Holding[]
  portfolioCad: number | null
  investedCad: number | null
  cashCad: number | null
  cashAsOf: string | null
  corePct: number | null
  contributedYtdCad: number | null
  issues: string[]
  books?: StockBooks
}
export function number(value: unknown, label = 'Source value'): number {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new Error(`${label} is missing`)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${label} is invalid`)
  return n
}
export function isStale(date: string | null, now = new Date(), days = 3): boolean {
  if (!date) return true
  const parsed = new Date(date).getTime()
  return !Number.isFinite(parsed) || parsed > now.getTime() + 86400000 || now.getTime() - parsed > days * 86400000
}
export function dhakaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
