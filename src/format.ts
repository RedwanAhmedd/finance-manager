type Amount = number | null | undefined

export const cad = (n: Amount, unknown = 'Unknown') =>
  n == null ? unknown : `${n < 0 ? '−' : ''}C$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Taka in lakh grouping (৳12,34,567), poisha only when present.
export const bdt = (n: Amount, unknown = 'Unknown') => {
  if (n == null) return unknown
  const digits = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2
  return `${n < 0 ? '−' : ''}৳${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export const pct = (n: Amount, digits = 0) => n == null ? 'Unknown' : `${n.toFixed(digits)}%`

export const dateTime = (s: string | null | undefined) => s ? new Date(s).toLocaleString() : 'Not recorded'

export function ago(s: string | null | undefined, now = new Date()): string {
  if (!s) return 'never'
  const minutes = Math.round((now.getTime() - new Date(s).getTime()) / 60_000)
  if (!Number.isFinite(minutes)) return 'unknown'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export const categoryLabel = (s: string) => s.replace('_', ' / ')
