import { describe, expect, it } from 'vitest'
import { buildChatGptFinanceContext } from '../src/integration/chatgptFacade'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'

const now = new Date('2026-09-16T12:00:00.000Z')

const rent: RentSnapshot = {
  fetchedAt: '2026-09-16T11:45:00.000Z',
  businessDate: '2026-09-16',
  month: '2026-09',
  banks: [],
  treasury: [],
  bankCashBdt: 100,
  treasuryCashBdt: 0,
  treasuryCashCad: 0,
  cardDebtBdt: 0,
  operatingCashBdt: 20,
  cashCountDate: '2026-09-16',
  refundableDepositsBdt: 10,
  expectedBdt: 100,
  collectedBdt: 90,
  outstandingBdt: 10,
  cashReceipts30dBdt: 90,
  expenses30dBdt: 15,
  operatingReserveTargetBdt: 45,
  familyRestrictedCashBdt: 0,
  familyMonthlyProtectedOutflowBdt: 0,
  familyRunwayMonths: null,
  unclassifiedCashBdt: 0,
  allocationEligibleCashBdt: 120,
  strategicDeployableBdt: 75,
  issues: [],
}

const stock: StockSnapshot = {
  fetchedAt: '2026-09-16T11:50:00.000Z',
  holdings: [],
  portfolioCad: 1000,
  investedCad: 900,
  cashCad: 100,
  cashAsOf: '2026-09-16',
  corePct: 50,
  contributedYtdCad: 1000,
  monthlyContributionCad: 500,
  issues: [],
}

describe('buildChatGptFinanceContext', () => {
  it('exposes healthy fresh snapshots with hard read-only permissions', () => {
    const context = buildChatGptFinanceContext({ rent, stock }, now)

    expect(context.access).toBe('read-only')
    expect(context.permissions).toEqual({
      moveMoney: false,
      executeTrades: false,
      writeSourceSystems: false,
      approveRecommendations: false,
    })
    expect(context.sourceHealth.rentStream.status).toBe('healthy')
    expect(context.sourceHealth.stockStream.status).toBe('healthy')
    expect(context.sourceHealth.rentStream.error).toBeNull()
    expect(context.sourceHealth.rentStream.errorCode).toBeNull()
    expect(context.attention).toEqual([])
  })

  it('marks old source reads as attention without changing the supplied data', () => {
    const oldRent = { ...rent, fetchedAt: '2026-09-16T09:00:00.000Z' }
    const context = buildChatGptFinanceContext({ rent: oldRent, stock }, now)

    expect(context.sourceHealth.rentStream.status).toBe('attention')
    expect(context.sourceHealth.rentStream.stale).toBe(true)
    expect(context.rent?.bankCashBdt).toBe(100)
    expect(context.attention[0]).toContain('RentStream read is stale')
  })

  it('surfaces structured failures instead of treating them as zero', () => {
    const failure = { code: 'AUTH_REQUIRED' as const, message: 'RentStream authentication is required.' }
    const context = buildChatGptFinanceContext({ stock, rentFailure: failure }, now)

    expect(context.rent).toBeNull()
    expect(context.sourceHealth.rentStream.status).toBe('unavailable')
    expect(context.sourceHealth.rentStream.error).toBe('RentStream authentication is required.')
    expect(context.sourceHealth.rentStream.errorCode).toBe('AUTH_REQUIRED')
    expect(context.attention).toContain('RentStream unavailable: RentStream authentication is required.')
    expect(context.stock?.portfolioCad).toBe(1000)
  })

  it('keeps deprecated string failures non-sensitive', () => {
    const context = buildChatGptFinanceContext({ stock, rentError: 'JWT secret abc' }, now)

    expect(context.sourceHealth.rentStream.error).toBe('RentStream read failed.')
    expect(context.sourceHealth.rentStream.errorCode).toBe('SOURCE_ERROR')
    expect(JSON.stringify(context)).not.toContain('JWT secret abc')
  })
})
