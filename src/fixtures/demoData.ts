import type { FinancePolicy, RentStreamSummary, StockStreamSummary } from '../domain/models'

const now = new Date().toISOString()

export const demoPolicy: FinancePolicy = {
  baseCurrency: 'CAD',
  bdtPerCad: 89,
  emergencyReserveTargetCad: 5_000,
  minimumPropertyReserveCad: 2_500,
  nearTermObligationWindowDays: 45,
  plannedCoreMonthlyCad: 500,
  maxStrikeAllocationPctOfDeployable: 20,
}

export const demoRentStream: RentStreamSummary = {
  meta: { source: 'RentStream', asOf: now, freshness: 'fresh' },
  accounts: [
    {
      id: 'ca-bank',
      name: 'Canadian Bank Account',
      ownerSystem: 'RentStream',
      institution: 'Canadian bank',
      country: 'Canada',
      currency: 'CAD',
      balance: 8_200,
      reserved: 2_000,
      committed: 600,
      meta: { source: 'RentStream', asOf: now, freshness: 'fresh' },
    },
    {
      id: 'bd-rent',
      name: 'Bangladesh Rental Account',
      ownerSystem: 'RentStream',
      institution: 'Bangladesh bank',
      country: 'Bangladesh',
      currency: 'BDT',
      balance: 470_000,
      reserved: 150_000,
      committed: 65_000,
      meta: { source: 'RentStream', asOf: now, freshness: 'fresh' },
    },
  ],
  expectedRent30d: { amount: 520_000, currency: 'BDT' },
  collectedRent30d: { amount: 455_000, currency: 'BDT' },
  outstandingRent30d: { amount: 65_000, currency: 'BDT' },
  propertyExpenses30d: { amount: 82_000, currency: 'BDT' },
  propertyReserveTarget: { amount: 250_000, currency: 'BDT' },
  propertyReserveCurrent: { amount: 215_000, currency: 'BDT' },
  emergencyReserveCurrent: { amount: 4_500, currency: 'CAD' },
  netRentalIncome90d: { amount: 1_210_000, currency: 'BDT' },
  obligations: [
    {
      id: 'property-maintenance',
      label: 'Scheduled property maintenance',
      dueDate: new Date(Date.now() + 18 * 86400000).toISOString(),
      amount: { amount: 55_000, currency: 'BDT' },
      category: 'property',
      priority: 'high',
    },
    {
      id: 'insurance',
      label: 'Annual insurance',
      dueDate: new Date(Date.now() + 39 * 86400000).toISOString(),
      amount: { amount: 420, currency: 'CAD' },
      category: 'personal',
      priority: 'medium',
    },
  ],
}

export const demoStockStream: StockStreamSummary = {
  meta: { source: 'StockStream', asOf: now, freshness: 'fresh' },
  portfolioValueCad: 12_750,
  investedValueCad: 12_150,
  brokerageCashCad: 600,
  coreAllocationPct: 68,
  singleStockAllocationPct: 32,
  contributionYtdCad: 4_850,
  contributionTargetCad: 6_000,
  concentrationWarnings: ['Single-stock sleeve is above the preferred 30% planning level.'],
  strikeOpportunities: [
    {
      ticker: 'MSFT',
      label: 'Microsoft',
      confidence: 78,
      suggestedMaxAllocationCad: 350,
      reason: 'Demo opportunity from StockStream. Real signal wiring comes later.',
    },
  ],
}
