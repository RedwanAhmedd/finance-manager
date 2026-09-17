import { describe, expect, it } from 'vitest'
import { classify, monthlyEquivalent, normaliseDescription } from '../src/money/categorise'
import { merchantKey, prepareLines, suggestBills } from '../src/money/lines'

describe('Personal money categorisation', () => {
  it('normalises bank descriptions', () => {
    expect(normaliseDescription('  Netflix.com   866-579-7172  ON ')).toBe('NETFLIX.COM 866-579-7172 ON')
  })
  it('uses the owner rule first, then built-ins, and flags the rest', () => {
    expect(classify('NETFLIX.COM 866-579-7172', -16.99, [])).toMatchObject({ kind: 'spend', category: 'subscriptions', flagged: false, rule: 'builtin' })
    expect(classify('NETFLIX.COM 866-579-7172', -16.99, [{ pattern: 'netflix', kind: 'spend', category: 'gifts' }])).toMatchObject({ category: 'gifts', rule: 'owner' })
    expect(classify('UBER EATS TORONTO', -32.1, [])).toMatchObject({ category: 'dining' })
    expect(classify('UBER TRIP HELP.UBER.COM', -18, [])).toMatchObject({ category: 'transport' })
    expect(classify('MYSTERY SHOP 44', -9, [])).toEqual({ kind: 'spend', category: 'other', flagged: true, rule: 'none' })
    expect(classify('MYSTERY DEPOSIT', 900, [])).toEqual({ kind: 'income', category: null, flagged: true, rule: 'none' })
  })
  it('the most specific owner rule wins and signs are respected', () => {
    const rules = [{ pattern: 'TD', kind: 'transfer' as const, category: null }, { pattern: 'TD VISA PREAUTH', kind: 'transfer' as const, category: null }, { pattern: 'AMAZON', kind: 'spend' as const, category: 'shopping' as const }]
    expect(classify('TD VISA PREAUTH PYMT', -400, rules)).toMatchObject({ kind: 'transfer', rule: 'owner' })
    expect(classify('AMAZON.CA RETURN', 25, rules)).toMatchObject({ kind: 'refund', category: 'shopping' })
  })
  it('converts bill cadences to a monthly equivalent', () => {
    expect([monthlyEquivalent(100, 'weekly'), monthlyEquivalent(100, 'biweekly'), monthlyEquivalent(100, 'monthly'), monthlyEquivalent(120, 'yearly')]).toEqual([433.33, 216.67, 100, 10])
  })
})

describe('Statement lines', () => {
  it('keeps genuine repeats and makes re-imports identical', () => {
    const lines = [
      { account: 'td_card' as const, date: '2026-09-02', description: 'TIM HORTONS #123', amount: -2.5, balance: null },
      { account: 'td_card' as const, date: '2026-09-02', description: 'Tim Hortons  #123', amount: -2.5, balance: null },
    ]
    const first = prepareLines(lines, []), again = prepareLines(lines, [])
    expect(first.map(l => l.import_hash)).toEqual(['td_card|2026-09-02|-2.50|TIM HORTONS #123|0', 'td_card|2026-09-02|-2.50|TIM HORTONS #123|1'])
    expect(again.map(l => l.import_hash)).toEqual(first.map(l => l.import_hash))
    expect(first[0]).toMatchObject({ kind: 'spend', category: 'dining', flagged: false })
  })
  it('suggests recurring bills only for similar charges in consecutive months', () => {
    expect(merchantKey('NETFLIX.COM 866-579-7172 ON')).toBe('NETFLIX.COM')
    const t = (date: string, description: string, amount: number, category = 'subscriptions' as const) => ({ posted_date: date, description, amount, kind: 'spend' as const, category })
    const suggestions = suggestBills([
      t('2026-06-03', 'NETFLIX.COM 866-579-7172 ON', -16.99), t('2026-07-03', 'NETFLIX.COM 866-579-7172 ON', -16.99), t('2026-08-03', 'NETFLIX.COM 866-579-7172 ON', -18.99),
      t('2026-06-10', 'SPOTIFY P1234', -11.99), t('2026-08-10', 'SPOTIFY P5678', -11.99),
      t('2026-07-01', 'ROGERS 55', -80, 'phone_internet' as never), t('2026-08-01', 'ROGERS 55', -140, 'phone_internet' as never),
      t('2026-07-04', 'FRESHCO 12', -60, 'groceries' as never), t('2026-07-18', 'FRESHCO 12', -55, 'groceries' as never), t('2026-08-04', 'FRESHCO 12', -58, 'groceries' as never), t('2026-08-19', 'FRESHCO 12', -61, 'groceries' as never),
    ], [])
    expect(suggestions).toEqual([{ name: 'NETFLIX.COM', category: 'subscriptions', amount: 18.99, months: ['2026-06', '2026-07', '2026-08'] }])
    expect(suggestBills([t('2026-07-03', 'NETFLIX.COM', -16.99), t('2026-08-03', 'NETFLIX.COM', -16.99)], ['Netflix.com'])).toEqual([])
  })
})
