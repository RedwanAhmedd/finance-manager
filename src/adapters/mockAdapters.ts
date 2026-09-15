import type { RentStreamAdapter, StockStreamAdapter } from './types'
import { demoRentStream, demoStockStream } from '../fixtures/demoData'

export class MockRentStreamAdapter implements RentStreamAdapter {
  async getSummary() {
    return structuredClone(demoRentStream)
  }
}

export class MockStockStreamAdapter implements StockStreamAdapter {
  async getSummary() {
    return structuredClone(demoStockStream)
  }
}
