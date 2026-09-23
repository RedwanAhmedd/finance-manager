import type { PersonalBooks } from '../books/personal'
import type { RentSnapshot, StockSnapshot } from '../live/models'

// Questions worth asking today, chosen from the figures on the page. Each one is
// answered directly by a quick answer or a ranked list in the books, so a small
// local model gets it right. Most relevant first; different topics before repeats.
export function suggestedQuestions(rent: RentSnapshot | null, stock: StockSnapshot | null, personal: PersonalBooks | null, limit = 4): string[] {
  const bills = personal?.bills.dueNext30Days ?? []
  const completedMonths = rent?.books ? rent.books.collections.filter(m => m.month < rent.books!.currentMonth).length : 0
  const holdings = (stock?.holdings ?? []).filter(h => h.role !== 'cash' && h.shares > 0)
  const issues = [...(rent?.issues ?? []), ...(stock?.issues ?? [])]
  const candidates: (string | false | null | undefined)[] = [
    bills.length > 0 && (bills.length === 1 ? `When is ${bills[0].name} due, and how much is it?` : `Which ${bills.length} bills are due in the next 30 days?`),
    personal?.recordsSince && personal.pace.lastMonthSameDay != null && 'Am I spending more than last month by this point?',
    rent && (rent.overdueBdt > 0 ? 'Who still owes rent from earlier months?' : rent.outstandingBdt > 0 ? 'Which building has the most rent still to collect?' : 'Is all of this month\'s rent collected?'),
    rent?.strategicDeployableBdt != null && rent.strategicDeployableBdt > 0 && 'How much is safe to invest, in Canadian dollars?',
    holdings.length > 1 && 'How concentrated is my portfolio?',
    issues.length > 0 && `What ${issues.length === 1 ? 'is the data problem' : `are the ${issues.length} data problems`} I should fix?`,
    completedMonths >= 2 && 'Which month had the best rent collection?',
    personal?.recordsSince && 'Where did my money go this month?',
  ]
  const picked = candidates.filter((q): q is string => typeof q === 'string')
  return (picked.length ? picked : ['Where do my finances stand today?']).slice(0, limit)
}
