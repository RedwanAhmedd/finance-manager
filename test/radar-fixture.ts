import { emptyRadarInput, type RadarInput } from '../src/radar/engine.ts'

/** Entirely fictional research for exercising the gates. Never a market signal. */
export function radarFixture(asOf = '2026-09-14T14:00:00.000Z'): RadarInput {
  const i = emptyRadarInput('TEST.NE', 'TEST')
  const evidence = [{ sourceUrl: 'https://example.com/fictional-test-evidence', asOf }]
  const prose = 'Fictional test assumption with a specific source and falsifiable reasoning.'
  i.researchRevision = 'fictional-v1'; i.evidenceEpisode = 'fictional-event-1'
  i.instrument = { symbol: 'TEST.NE', underlying: 'TEST', kind: 'cdr', exchange: 'TSX', currency: 'CAD', identityVerified: true, evidence,
    cdr: { ratio: 0.15, fxForwardCadPerUsd: 1.3326666666666667, cadHedged: true, evidence } }
  i.thesis = { status: 'intact', quality: 'strong', whyNow: prose, killConditions: [prose], evidence }
  i.valuation = { modelVersion: 'fictional-owner-cash-v1', referenceSymbol: 'TEST', currency: 'USD', normalized: true,
    ownerCashReconciled: true, normalizationNote: prose, bearFairValue: 120, baseFairValue: 150, bullFairValue: 180, evidence }
  i.zones = { symbol: 'TEST.NE', currency: 'CAD', watchBelow: 26, buyBelow: 24, strikeBelow: 21, fairValueCad: 30,
    mappingReviewed: true, mappingMethod: prose, evidence }
  i.quote = { symbol: 'TEST.NE', currency: 'CAD', price: 19.99, basis: 'fetched', marketOpen: true, evidence }
  i.underlyingQuote = { symbol: 'TEST', currency: 'USD', price: 100, evidence }
  i.benchmark = { symbol: 'XEQT.TO', currency: 'CAD', horizonYears: 5, totalReturnBasis: true,
    candidateBearPct: -5, candidateBasePct: 20, candidateBullPct: 30, xeqtAnnualReturnPct: 8, waitingAnnualReturnPct: 3,
    concentrationPremiumPct: 2, modelRiskPremiumPct: 2, executionDragPct: 0.2, whyBetterThanXeqt: prose, whyBetterThanWaiting: prose, evidence }
  i.redTeam = { strongestBearCase: prose, marketCounterargument: prose, upsideDriver: prose, growthShockPct: -30, marginShockPp: -3,
    multipleShockPct: -20, jointStressAnnualReturnPct: -8, valueTrapRisk: 'addressed', falsifier: prose, survived: true, evidence }
  i.execution = { symbol: 'TEST.NE', currency: 'CAD', bid: 19.98, ask: 20, averageDailyUnits: 100000, estimatedFeesCad: 1, evidence }
  i.portfolio = { totalValueCad: 100000, settledCashCad: 5000, reservedOrdersCad: 100, cashBufferCad: 1000, proposedAmountCad: 500,
    pendingOrdersConfirmed: true, overlapKnown: true, companyExposureCad: 5000, sectorExposureCad: 20000,
    pendingCompanyBuysCad: 0, pendingSectorBuysCad: 0, evidence }
  i.policy = { maxResearchAgeDays: 120, maxQuoteAgeMinutes: 15, maxQuoteSkewSeconds: 60, maxMappingAgeDays: 2, maxPortfolioAgeMinutes: 30,
    maxSpreadBps: 100, maxDislocationPct: 2, maxParticipationPct: 1, minMosBuyPct: 20, minMosStrikePct: 30,
    minExcessBuyPct: 3, minExcessStrikePct: 6, minJointStressReturnPct: -15, maxCompanyPct: 10, maxSectorPct: 30,
    strikeWindowDays: 30, maxStrikesPerWindow: 3 }
  return i
}
