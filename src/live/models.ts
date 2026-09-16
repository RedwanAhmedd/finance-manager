export type BankFinancialRole = 'corporate_operating' | 'savings' | 'family_restricted' | 'personal' | 'unclassified'

export interface BankBalance {
  id: string
  name: string
  type: string
  currency: 'BDT'
  balance: number | null
  anchorDate: string | null
  financialRole: BankFinancialRole
  monthlyProtectedOutflow: number
}

export interface TreasuryBalance {
  id: string
  name: string
  institution: string | null
  country: 'Canada' | 'Bangladesh'
  currency: 'CAD' | 'BDT'
  balance: number
  balanceAsOf: string
}

export interface RentSnapshot {
  fetchedAt: string
  businessDate: string
  month: string
  banks: BankBalance[]
  treasury?: TreasuryBalance[]
  bankCashBdt: number | null
  treasuryCashBdt?: number
  treasuryCashCad?: number
  cardDebtBdt: number | null
  operatingCashBdt: number | null
  cashCountDate: string | null
  refundableDepositsBdt: number
  expectedBdt: number
  collectedBdt: number
  outstandingBdt: number
  cashReceipts30dBdt: number
  expenses30dBdt: number
  operatingReserveTargetBdt: number
  familyRestrictedCashBdt: number | null
  familyMonthlyProtectedOutflowBdt: number
  familyRunwayMonths: number | null
  unclassifiedCashBdt: number | null
  allocationEligibleCashBdt: number | null
  strategicDeployableBdt: number | null
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
  monthlyContributionCad: number | null
  issues: string[]
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
