import { classify, normaliseDescription } from './categorise'
import type { Account, CategoryRule, Kind, Category } from './types'
export type { Account }

// One line from a bank or card statement, before it is stored.
export interface StatementLine { account: Account; date: string; description: string; amount: number; balance: number | null }

export interface PreparedLine extends StatementLine {
  import_hash: string
  kind: Kind
  category: Category | null
  flagged: boolean
}

// Identity of a line: account, date, amount and description, plus how many
// identical lines came before it in the same file. Two genuine coffees for the
// same price on the same day stay two rows; the same statement imported twice
// adds nothing.
export function prepareLines(lines: StatementLine[], rules: Pick<CategoryRule, 'pattern' | 'kind' | 'category'>[]): PreparedLine[] {
  const seen = new Map<string, number>()
  return lines.map(line => {
    const base = `${line.account}|${line.date}|${line.amount.toFixed(2)}|${normaliseDescription(line.description)}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    const c = classify(line.description, line.amount, rules)
    return { ...line, import_hash: `${base}|${occurrence}`, kind: c.kind, category: c.category, flagged: c.flagged }
  })
}

// Merchant identity for spotting repeats: drop digits, reference numbers and
// store locations so "NETFLIX.COM 866-579-7172 ON" matches every month.
export function merchantKey(description: string): string {
  return normaliseDescription(description).replace(/[#*]\S*/g, ' ').replace(/\d[\d\-./]*/g, ' ').replace(/\b(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE|CA|CAN)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface SuggestedBill { name: string; category: Category; amount: number; months: string[] }

// A merchant charged in at least two consecutive calendar months, each month
// within 20% of the one before (so a price rise still counts), looks like a
// recurring bill. It is only a suggestion: the
// owner confirms it before it becomes a bill.
export function suggestBills(transactions: { posted_date: string; description: string; amount: number; kind: Kind; category: Category | null }[], existingBillNames: string[]): SuggestedBill[] {
  const known = new Set(existingBillNames.map(merchantKey))
  const groups = new Map<string, { month: string; amount: number; category: Category }[]>()
  for (const t of transactions) {
    if (t.kind !== 'spend' || !t.category) continue
    const key = merchantKey(t.description)
    if (!key || known.has(key)) continue
    groups.set(key, [...(groups.get(key) ?? []), { month: t.posted_date.slice(0, 7), amount: -t.amount, category: t.category }])
  }
  const next = (ym: string) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7) }
  const suggestions: SuggestedBill[] = []
  for (const [name, charges] of groups) {
    const byMonth = new Map<string, number>()
    for (const c of charges) byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + c.amount)
    const months = [...byMonth.keys()].sort()
    let best: string[] = []
    for (let i = 0; i < months.length; i++) {
      const run = [months[i]]
      while (months.includes(next(run[run.length - 1]))) run.push(next(run[run.length - 1]))
      if (run.length > best.length) best = run
    }
    if (best.length < 2) continue
    const amounts = best.map(m => byMonth.get(m)!)
    const latest = amounts[amounts.length - 1]
    if (amounts.every((a, i) => i === 0 || Math.abs(a - amounts[i - 1]) <= amounts[i - 1] * 0.2)) suggestions.push({ name, category: charges[charges.length - 1].category, amount: Math.round(latest * 100) / 100, months: best })
  }
  return suggestions.sort((a, b) => b.amount - a.amount)
}
