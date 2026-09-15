export type Currency = 'CAD' | 'BDT'
export type Freshness = 'fresh' | 'aging' | 'stale'

export interface Money {
  amount: number
  currency: Currency
}

export interface DataPointMeta {
  source: 'RentStream' | 'StockStream' | 'Finance Manager'
  asOf: string
  freshness: Freshness
}

export interface CashAccount {
  id: string
  name: string
  ownerSystem: 'RentStream' | 'StockStream'
  institution?: string
  country: 'Canada' | 'Bangladesh'
  currency: Currency
  balance: number
  reserved: number
  committed: number
  meta: DataPointMeta
}

export interface Obligation {
  id: string
  label: string
  dueDate: string
  amount: Money
  category: 'property' | 'personal' | 'travel' | 'investment' | 'tax' | 'other'
  priority: 'high' | 'medium' | 'low'
}

export interface RentStreamSummary {
  meta: DataPointMeta
  accounts: CashAccount[]
  expectedRent30d: Money
  collectedRent30d: Money
  outstandingRent30d: Money
  propertyExpenses30d: Money
  propertyReserveTarget: Money
  propertyReserveCurrent: Money
  emergencyReserveCurrent: Money
  netRentalIncome90d: Money
  obligations: Obligation[]
}

export interface StrikeOpportunity {
  ticker: string
  label: string
  confidence: number
  suggestedMaxAllocationCad: number
  reason: string
}

export interface StockStreamSummary {
  meta: DataPointMeta
  portfolioValueCad: number
  investedValueCad: number
  brokerageCashCad: number
  coreAllocationPct: number
  singleStockAllocationPct: number
  contributionYtdCad: number
  contributionTargetCad: number
  concentrationWarnings: string[]
  strikeOpportunities: StrikeOpportunity[]
}

export interface FinancePolicy {
  baseCurrency: 'CAD'
  bdtPerCad: number
  emergencyReserveTargetCad: number
  minimumPropertyReserveCad: number
  nearTermObligationWindowDays: number
  plannedCoreMonthlyCad: number
  maxStrikeAllocationPctOfDeployable: number
}

export interface NormalizedCashAccount extends CashAccount {
  balanceCad: number
  reservedCad: number
  committedCad: number
  deployableCad: number
}

export interface LiquiditySnapshot {
  totalCashCad: number
  reservedCashCad: number
  committedCashCad: number
  deployableCashCad: number
  rentStreamCashCad: number
  stockStreamCashCad: number
  reserveGapCad: number
  propertyReserveGapCad: number
  emergencyReserveGapCad: number
  nearTermObligationsCad: number
  accounts: NormalizedCashAccount[]
}

export interface AllocationAction {
  priority: number
  bucket: 'reserve' | 'obligation' | 'core' | 'strike' | 'cash'
  label: string
  amountCad: number
  reason: string
  confidence: number
  approvalRequired: true
}

export interface FinanceRecommendation {
  status: 'healthy' | 'watch' | 'attention'
  headline: string
  actions: AllocationAction[]
  assumptions: string[]
}

export interface FinanceReport {
  status: FinanceRecommendation['status']
  generatedAt: string
  liquidity: LiquiditySnapshot
  rent: RentStreamSummary
  stock: StockStreamSummary
  recommendation: FinanceRecommendation
  attention: string[]
  decisionsRequired: number
}
