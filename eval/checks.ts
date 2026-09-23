// Scoring for the assistant eval. Expected values come from the live books at run
// time, so no private figure is ever written into the repo.

export type Currency = 'CAD' | 'BDT'
export interface Check { name: string; pass: boolean; detail?: string }

interface Amount { value: number; currency: Currency | null; text: string }

const MARKERS: [RegExp, Currency][] = [[/^(C\$|CAD|CA\$)$/i, 'CAD'], [/^\$$/, 'CAD'], [/^(৳|Tk\.?|BDT|taka)$/i, 'BDT']]
const currencyOf = (token: string | undefined): Currency | null => {
  if (!token) return null
  for (const [pattern, currency] of MARKERS) if (pattern.test(token.trim())) return currency
  return null
}

// Every amount in the text with the currency written beside it, if any.
// Handles lakh grouping (৳2,45,000), "2.45 lakh", "1.2k" and "C$1,234.56".
export function amounts(text: string): Amount[] {
  const found: Amount[] = []
  const pattern = /(−|-)?(C\$|CA\$|CAD|\$|৳|Tk\.?|BDT)?\s?(−|-)?(\d[\d,]*(?:\.\d+)?)\s?(lakh|crore|k\b|million|CAD|BDT|taka)?/gi
  for (const m of text.matchAll(pattern)) {
    const [raw, leadingMinus, before, innerMinus, digits, after] = m
    const minus = leadingMinus || innerMinus
    let value = Number(digits.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const unit = after?.toLowerCase()
    if (unit === 'lakh') value *= 1e5
    else if (unit === 'crore') value *= 1e7
    else if (unit === 'k') value *= 1e3
    else if (unit === 'million') value *= 1e6
    value = Math.round(value * 100) / 100
    if (minus) value = -value
    const currency = currencyOf(before) ?? currencyOf(after) ?? (unit === 'lakh' || unit === 'crore' ? 'BDT' : null)
    found.push({ value, currency, text: raw.trim() })
  }
  return found
}

const close = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(1, Math.abs(b) * 0.005)

// The expected figure appears (within 0.5% or one unit, so C$1,235 matches
// C$1,234.56) and is never labelled with the other currency.
export function mentionsAmount(text: string, expected: number, currency: Currency, name = `mentions ${currency} ${expected}`): Check[] {
  const hits = amounts(text).filter(a => close(a.value, expected))
  const mislabelled = hits.filter(a => a.currency && a.currency !== currency)
  return [
    { name, pass: hits.length > 0, detail: hits.length ? hits.map(h => h.text).join(', ') : `no amount near ${expected}` },
    { name: `${name}: currency not relabelled`, pass: mislabelled.length === 0, detail: mislabelled.map(h => h.text).join(', ') || undefined },
  ]
}

export const matches = (text: string, pattern: RegExp, name: string): Check => ({ name, pass: pattern.test(text), detail: pattern.test(text) ? undefined : `expected ${pattern}` })
export const avoids = (text: string, pattern: RegExp, name: string): Check => {
  const hit = text.match(pattern)
  return { name, pass: !hit, detail: hit ? `found "${hit[0]}"` : undefined }
}
