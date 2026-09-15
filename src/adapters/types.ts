import type { RentStreamSummary, StockStreamSummary } from '../domain/models'

export interface RentStreamAdapter {
  getSummary(): Promise<RentStreamSummary>
}

export interface StockStreamAdapter {
  getSummary(): Promise<StockStreamSummary>
}
