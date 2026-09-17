// Personal (Canada) money records. Mirrors the money_* tables in the StockStream
// database, which Finance Manager's local server owns.

export const CATEGORIES = ['housing', 'utilities', 'phone_internet', 'subscriptions', 'groceries', 'dining', 'transport', 'insurance', 'health', 'shopping', 'travel', 'gifts', 'fees', 'other'] as const
export type Category = typeof CATEGORIES[number]

// transfer: between the owner's own accounts. investing: already in StockStream.
// Neither is spending.
export const KINDS = ['spend', 'refund', 'income', 'draw', 'transfer', 'investing'] as const
export type Kind = typeof KINDS[number]

export const ACCOUNTS = ['td_chequing', 'td_card', 'wealthsimple', 'manual'] as const
export type Account = typeof ACCOUNTS[number]

export const CADENCES = ['weekly', 'biweekly', 'monthly', 'yearly'] as const
export type Cadence = typeof CADENCES[number]

export interface MoneyTransaction {
  id: string
  account: Account
  posted_date: string
  description: string
  amount: number
  amount_bdt: number | null
  kind: Kind
  category: Category | null
  flagged: boolean
  balance_after: number | null
  bill_id: string | null
  note: string | null
  source: 'td_csv' | 'ws_csv' | 'manual'
  import_hash: string
}

export interface Bill {
  id: string
  name: string
  category: Category
  amount: number
  cadence: Cadence
  due_day: number | null
  account: Account | null
  active: boolean
  note: string | null
}

export interface CategoryRule { id: string; pattern: string; kind: Kind; category: Category | null }

export interface StatedBalance { id: string; account: string; balance: number; as_of: string; note: string | null }

export interface MoneyData { transactions: MoneyTransaction[]; bills: Bill[]; rules: CategoryRule[]; balances?: StatedBalance[] }

export const spendsMoney = (kind: Kind) => kind === 'spend' || kind === 'refund'
