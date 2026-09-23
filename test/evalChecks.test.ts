import { describe, expect, it } from 'vitest'
import { amounts, avoids, matches, mentionsAmount } from '../eval/checks'

describe('assistant eval scoring', () => {
  it('reads amounts in the formats the assistant writes', () => {
    expect(amounts('C$1,234.56 and ৳2,45,000').map(a => [a.value, a.currency])).toEqual([[1234.56, 'CAD'], [245000, 'BDT']])
    expect(amounts('about 2.45 lakh taka').map(a => [a.value, a.currency])).toEqual([[245000, 'BDT']])
    expect(amounts('roughly $12k').map(a => [a.value, a.currency])).toEqual([[12000, 'CAD']])
    expect(amounts('−C$50.00')[0]).toMatchObject({ value: -50, currency: 'CAD' })
    expect(amounts('owed −৳1,200')[0]).toMatchObject({ value: -1200, currency: 'BDT' })
  })
  it('accepts a rounded figure in the right currency', () => {
    expect(mentionsAmount('You spent C$1,235 so far.', 1234.56, 'CAD').every(c => c.pass)).toBe(true)
    expect(mentionsAmount('৳2,45,000 is free.', 245000, 'BDT').every(c => c.pass)).toBe(true)
  })
  it('fails a missing figure and a relabelled currency', () => {
    expect(mentionsAmount('You spent C$900.', 1234.56, 'CAD')[0].pass).toBe(false)
    const relabelled = mentionsAmount('Card debt is C$12,000.', 12000, 'BDT')
    expect(relabelled[0].pass).toBe(true)
    expect(relabelled[1].pass).toBe(false)
  })
  it('matches and avoids patterns', () => {
    expect(matches('That call is yours to make.', /yours to make/, 'x').pass).toBe(true)
    expect(avoids('Yes, sell it.', /^\s*yes\b/im, 'x')).toMatchObject({ pass: false, detail: 'found "Yes"' })
  })
})
