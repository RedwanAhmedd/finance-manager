import type { FinancePolicy, FinanceReport } from '../domain/models'

export interface ScenarioResult {
  label: string
  spendCad: number
  investCad: number
  postActionDeployableCad: number
  reserveBreached: boolean
  verdict: 'safe' | 'tight' | 'not-recommended'
  explanation: string
}

export function planScenario(
  report: FinanceReport,
  policy: FinancePolicy,
  input: { label: string; spendCad?: number; investCad?: number },
): ScenarioResult {
  const spendCad = input.spendCad ?? 0
  const investCad = input.investCad ?? 0
  const impact = spendCad + investCad
  const postActionDeployableCad = report.liquidity.deployableCashCad - impact
  const reserveBreached = postActionDeployableCad < 0

  const verdict: ScenarioResult['verdict'] = reserveBreached
    ? 'not-recommended'
    : postActionDeployableCad < policy.plannedCoreMonthlyCad
      ? 'tight'
      : 'safe'

  return {
    label: input.label,
    spendCad,
    investCad,
    postActionDeployableCad,
    reserveBreached,
    verdict,
    explanation:
      verdict === 'safe'
        ? 'The scenario stays inside the current liquidity and reserve guardrails.'
        : verdict === 'tight'
          ? 'The scenario is possible, but leaves little discretionary room after protected cash.'
          : 'The scenario uses cash that Finance Manager currently treats as protected or unavailable.',
  }
}
