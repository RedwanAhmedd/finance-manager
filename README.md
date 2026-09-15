# Finance Manager

Finance Manager is the read-only coordination layer above **RentStream** and **StockStream**.

- **RentStream owns:** rental income, properties, bank accounts, cash, reserves, obligations, expenses.
- **StockStream owns:** portfolio positions, brokerage cash, trade history, investment risk, strike opportunities.
- **Finance Manager owns:** normalization, liquidity, cross-system allocation policy, scenario planning, and approval-only recommendations.

## v0.1 safety rules

1. No money movement.
2. No trade execution.
3. No duplicate transaction ledger.
4. Source balances are never rewritten by FX conversion.
5. All recommendations require explicit approval.
6. Fixture adapters are used until read-only production integrations are deliberately wired.

## Architecture

```text
RentStream -> RentStreamAdapter --\
                                FinanceEngine -> Finance Report / Scenario Planner
StockStream -> StockStreamAdapter-/
```

`src/domain/models.ts` defines the normalized contract. `src/engine/financeEngine.ts` is pure deterministic business logic, intentionally kept out of React.

## Run

```bash
npm install
npm run test
npm run build
npm run dev
```

## Next integration step

Replace `MockRentStreamAdapter` and `MockStockStreamAdapter` with read-only adapters that return the same normalized contracts. Keep credentials server-side; never place service-role keys in Vite/browser code.

The Canadian bank account belongs to RentStream/Treasury and is included in the demo fixture as CAD cash.
