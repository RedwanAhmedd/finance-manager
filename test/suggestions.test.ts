import { describe, expect, it } from 'vitest'
import { suggestedQuestions } from '../src/assistant/suggestions'
import type { PersonalBooks } from '../src/books/personal'
import type { RentSnapshot, StockSnapshot } from '../src/live/models'

const rent = { outstandingBdt: 160585, overdueBdt: 6000, strategicDeployableBdt: 1390686, issues: [] } as unknown as RentSnapshot
const stock = { holdings: [{ symbol: 'XEQT.TO', role: 'core', shares: 10 }, { symbol: 'MSFT.NE', role: 'satellite', shares: 5 }], issues: ['XEQT: stale quote.'] } as unknown as StockSnapshot
const personal = { recordsSince: '2026-07-01', pace: { lastMonthSameDay: 2310 }, bills: { dueNext30Days: [{ name: 'Rogers', amount: 85, date: '2026-09-28' }, { name: 'Rent', amount: 1650, date: '2026-10-01' }] } } as unknown as PersonalBooks

describe('Suggested questions', () => {
  it('picks questions from the figures on the page, most relevant first', () => {
    expect(suggestedQuestions(rent, stock, personal)).toEqual([
      'Which 2 bills are due in the next 30 days?',
      'Am I spending more than last month by this point?',
      'Who still owes rent from earlier months?',
      'How much is safe to invest, in Canadian dollars?',
    ])
  })
  it('asks about the building with most unpaid rent when nothing is overdue', () => {
    expect(suggestedQuestions({ ...rent, overdueBdt: 0 }, null, null)).toContain('Which building has the most rent still to collect?')
  })
  it('offers data problems and still has a question with no figures', () => {
    expect(suggestedQuestions(null, stock, null)).toEqual(['How concentrated is my portfolio?', 'What is the data problem I should fix?'])
    expect(suggestedQuestions(null, null, null)).toEqual(['Where do my finances stand today?'])
  })
})
