import type {
  AllocationAction,
  Currency,
  FinancePolicy,
  FinanceRecommendation,
  FinanceReport,
  LiquiditySnapshot,
  Money,
  RentStreamSummary,
  StockStreamSummary,
} from '../domain/models'

export function toCad(money: Money, policy: FinancePolicy): number {
  if (money.currency === 'CAD') return money.amount
  return money.amount / policy.bdtPerCad
}

function amountToCad(amount: number, currency: Currency, policy: FinancePolicy): number {
  return currency === 'CAD' ? amount : amount / policy.bdtPerCad
}

function daysUntil(iso: string, now = new Date()): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86400000)
}

export function buildLiquidity(
  rent: RentStreamSummary,
  stock: StockStreamSummary,
  policy: FinancePolicy,
  now = new Date(),
): LiquiditySnapshot {
  const accounts = rent.accounts.map((account) => {
    const balanceCad = amountToCad(account.balance, account.currency, policy)
    const reservedCad = amountToCad(account.reserved, account.currency, policy)
    const committedCad = amountToCad(account.committed, account.currency, policy)
    return {
      ...account,
      balanceCad,
      reservedCad,
      committedCad,
      deployableCad: Math.max(0, balanceCad - reservedCad - committedCad),
    }
  })

  const rentStreamCashCad = accounts.reduce((sum, a) => sum + a.balanceCad, 0)
  const stockStreamCashCad = stock.brokerageCashCad
  const reservedCashCad = accounts.reduce((sum, a) => sum + a.reservedCad, 0)
  const committedCashCad = accounts.reduce((sum, a) => sum + a.committedCad, 0)
  const nearTermObligationsCad = rent.obligations
    .filter((x) => daysUntil(x.dueDate, now) <= policy.nearTermObligationWindowDays && daysUntil(x.dueDate, now) >= 0)
    .reduce((sum, x) => sum + toCad(x.amount, policy), 0)

  const propertyReserveCurrentCad = toCad(rent.propertyReserveCurrent, policy)
  const propertyReserveTargetCad = Math.max(
    toCad(rent.propertyReserveTarget, policy),
    policy.minimumPropertyReserveCad,
  )
  const propertyReserveGapCad = Math.max(0, propertyReserveTargetCad - propertyReserveCurrentCad)
  const emergencyReserveCurrentCad = toCad(rent.emergencyReserveCurrent, policy)
  const emergencyReserveGapCad = Math.max(0, policy.emergencyReserveTargetCad - emergencyReserveCurrentCad)
  const reserveGapCad = propertyReserveGapCad + emergencyReserveGapCad

  const totalCashCad = rentStreamCashCad + stockStreamCashCad
  const protectedTargetCad = reserveGapCad
  const rawDeployable =
    accounts.reduce((sum, a) => sum + a.deployableCad, 0) + stockStreamCashCad - nearTermObligationsCad

  return {
    totalCashCad,
    reservedCashCad,
    committedCashCad,
    deployableCashCad: Math.max(0, rawDeployable - protectedTargetCad),
    rentStreamCashCad,
    stockStreamCashCad,
    reserveGapCad,
    propertyReserveGapCad,
    emergencyReserveGapCad,
    nearTermObligationsCad,
    accounts,
  }
}

export function recommendAllocation(
  liquidity: LiquiditySnapshot,
  stock: StockStreamSummary,
  policy: FinancePolicy,
): FinanceRecommendation {
  const actions: AllocationAction[] = []
  let remaining = liquidity.accounts.reduce((sum, a) => sum + a.deployableCad, 0) + liquidity.stockStreamCashCad
  let priority = 1

  if (liquidity.emergencyReserveGapCad > 0) {
    const amount = Math.min(remaining, liquidity.emergencyReserveGapCad)
    if (amount > 0) {
      actions.push({
        priority: priority++,
        bucket: 'reserve',
        label: 'Top up emergency reserve',
        amountCad: amount,
        reason: 'Close the emergency-cash gap before discretionary investing.',
        confidence: 98,
        approvalRequired: true,
      })
      remaining -= amount
    }
  }

  if (liquidity.propertyReserveGapCad > 0) {
    const amount = Math.min(remaining, liquidity.propertyReserveGapCad)
    if (amount > 0) {
      actions.push({
        priority: priority++,
        bucket: 'reserve',
        label: 'Top up property reserve',
        amountCad: amount,
        reason: 'Protect rental operations before allocating new money to investments.',
        confidence: 96,
        approvalRequired: true,
      })
      remaining -= amount
    }
  }

  if (liquidity.nearTermObligationsCad > 0) {
    const amount = Math.min(remaining, liquidity.nearTermObligationsCad)
    if (amount > 0) {
      actions.push({
        priority: priority++,
        bucket: 'obligation',
        label: 'Ring-fence near-term obligations',
        amountCad: amount,
        reason: `Bills due inside ${policy.nearTermObligationWindowDays} days should be protected before discretionary investing.`,
        confidence: 98,
        approvalRequired: true,
      })
      remaining -= amount
    }
  }

  const coreAmount = Math.min(Math.max(0, remaining), policy.plannedCoreMonthlyCad)
  if (coreAmount > 0) {
    actions.push({
      priority: priority++,
      bucket: 'core',
      label: 'Fund planned core investing',
      amountCad: coreAmount,
      reason: 'Maintain the planned long-term core contribution before opportunistic single-stock deployment.',
      confidence: 90,
      approvalRequired: true,
    })
    remaining -= coreAmount
  }

  const bestStrike = [...stock.strikeOpportunities].sort((a, b) => b.confidence - a.confidence)[0]
  if (bestStrike && remaining > 0 && bestStrike.confidence >= 75) {
    const cap = liquidity.deployableCashCad * (policy.maxStrikeAllocationPctOfDeployable / 100)
    const amount = Math.min(remaining, bestStrike.suggestedMaxAllocationCad, cap)
    if (amount >= 50) {
      actions.push({
        priority: priority++,
        bucket: 'strike',
        label: `Review ${bestStrike.ticker} strike`,
        amountCad: amount,
        reason: `${bestStrike.reason} Allocation is capped by Finance Manager policy; StockStream owns the investment thesis.`,
        confidence: Math.min(90, bestStrike.confidence),
        approvalRequired: true,
      })
      remaining -= amount
    }
  }

  if (remaining > 0) {
    actions.push({
      priority: priority++,
      bucket: 'cash',
      label: 'Keep remaining cash liquid',
      amountCad: remaining,
      reason: 'No higher-priority use cleared the policy gates. Liquidity preserves optionality.',
      confidence: 88,
      approvalRequired: true,
    })
  }

  const status: FinanceRecommendation['status'] =
    liquidity.reserveGapCad > 0 ? 'attention' : stock.concentrationWarnings.length > 0 ? 'watch' : 'healthy'

  return {
    status,
    headline:
      status === 'attention'
        ? 'Protect reserves before taking new risk.'
        : status === 'watch'
          ? 'Liquidity is workable, but portfolio risk deserves attention.'
          : 'Liquidity and reserves are in good shape.',
    actions,
    assumptions: [
      `FX display rate: ৳${policy.bdtPerCad.toFixed(2)} per C$1.`,
      `Emergency reserve target: C$${policy.emergencyReserveTargetCad.toLocaleString()}.`,
      'All actions are recommendations only; execution requires explicit approval.',
    ],
  }
}

export function buildFinanceReport(
  rent: RentStreamSummary,
  stock: StockStreamSummary,
  policy: FinancePolicy,
  now = new Date(),
): FinanceReport {
  const liquidity = buildLiquidity(rent, stock, policy, now)
  const recommendation = recommendAllocation(liquidity, stock, policy)
  const attention = [
    ...(liquidity.reserveGapCad > 0
      ? [`Protected reserve gap: C$${liquidity.reserveGapCad.toFixed(0)} (emergency C$${liquidity.emergencyReserveGapCad.toFixed(0)} + property C$${liquidity.propertyReserveGapCad.toFixed(0)}).`]
      : []),
    ...(rent.outstandingRent30d.amount > 0
      ? [`Outstanding rent: ${rent.outstandingRent30d.currency} ${rent.outstandingRent30d.amount.toLocaleString()}.`]
      : []),
    ...stock.concentrationWarnings,
  ]

  return {
    status: recommendation.status,
    generatedAt: now.toISOString(),
    liquidity,
    rent,
    stock,
    recommendation,
    attention,
    decisionsRequired: recommendation.actions.filter((x) => x.amountCad > 0).length,
  }
}
