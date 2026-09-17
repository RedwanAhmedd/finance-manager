import { describe, expect, it, vi } from 'vitest'
import { getFinanceContext } from '../src/integration/financeContextService'
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

describe('getFinanceContext', () => {
  it('reads both sources with the same clock and returns their live snapshots', async () => {
    const rentReader = { getSnapshot: vi.fn().mockResolvedValue(rent) }
    const stockReader = { getSnapshot: vi.fn().mockResolvedValue(stock) }

    const context = await getFinanceContext({ rent: rentReader, stock: stockReader }, now)

    expect(rentReader.getSnapshot).toHaveBeenCalledWith(now)
    expect(stockReader.getSnapshot).toHaveBeenCalledWith(now)
    expect(context.rent).toBe(rent)
    expect(context.stock).toBe(stock)
    expect(context.sourceHealth.rentStream.status).toBe('healthy')
    expect(context.sourceHealth.stockStream.status).toBe('healthy')
  })

  it('keeps a successful source when the other source fails and hides raw adapter details', async () => {
    const rentReader = { getSnapshot: vi.fn().mockRejectedValue(new Error('JWT expired: secret token abc')) }
    const stockReader = { getSnapshot: vi.fn().mockResolvedValue(stock) }

    const context = await getFinanceContext({ rent: rentReader, stock: stockReader }, now)

    expect(context.rent).toBeNull()
    expect(context.stock).toBe(stock)
    expect(context.sourceHealth.rentStream.error).toEqual({
      code: 'AUTH_REQUIRED',
      message: 'RentStream authentication is required.',
    })
    expect(JSON.stringify(context)).not.toContain('secret token abc')
    expect(context.attention).toContain('RentStream unavailable: RentStream authentication is required.')
  })

  it('captures synchronous failures and never represents unavailable data as zero', async () => {
    const rentReader = {
      getSnapshot: () => {
        throw new Error('permission denied by RLS')
      },
    }
    const stockReader = {
      getSnapshot: () => {
        throw new TypeError('fetch failed')
      },
    }

    const context = await getFinanceContext({ rent: rentReader, stock: stockReader }, now)

    expect(context.rent).toBeNull()
    expect(context.stock).toBeNull()
    expect(context.sourceHealth.rentStream.error).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'RentStream access was denied.',
    })
    expect(context.sourceHealth.stockStream.error).toEqual({
      code: 'NETWORK_ERROR',
      message: 'StockStream could not be reached.',
    })
    expect(context.attention).toEqual([
      'RentStream unavailable: RentStream access was denied.',
      'StockStream unavailable: StockStream could not be reached.',
    ])
  })

  it('starts both independent reads even when one rejects', async () => {
    const started: string[] = []
    const rentReader = {
      getSnapshot: vi.fn(async () => {
        started.push('rent')
        throw new Error('source failure')
      }),
    }
    const stockReader = {
      getSnapshot: vi.fn(async () => {
        started.push('stock')
        return stock
      }),
    }

    await getFinanceContext({ rent: rentReader, stock: stockReader }, now)

    expect(started).toEqual(['rent', 'stock'])
  })
})
