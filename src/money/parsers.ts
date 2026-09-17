import type { Account, StatementLine } from './lines'

// Statement formats are confirmed against real exports before being parsed;
// until then an import says so rather than guessing at columns.
export class UnsupportedStatement extends Error {}

export function parseStatement(account: Exclude<Account, 'manual'>, _csv: string): StatementLine[] {
  throw new UnsupportedStatement(`The ${account === 'wealthsimple' ? 'Wealthsimple' : 'TD'} statement format has not been confirmed yet. Share one real export so the importer can be built against it.`)
}
