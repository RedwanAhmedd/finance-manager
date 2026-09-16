# ChatGPT orchestration boundary

ChatGPT is the conversational orchestration layer above Finance Manager. It does **not** become a financial ledger and it does **not** bypass RentStream or StockStream ownership.

```text
User
  |
ChatGPT (conversation + orchestration)
  |
Finance Manager (read-only coordination + scenarios + approval-only recommendations)
  |-- RentStream adapter  -> RentStream (rental/treasury source of truth)
  `-- StockStream adapter -> StockStream (investment source of truth + Strike Radar state)
```

## Responsibilities

### RentStream
Source of truth for rental income, properties, treasury/bank cash, reserves, obligations and property expenses.

### StockStream
Source of truth for portfolio positions, brokerage cash, transactions, investment risk, Strike Radar research/signals and exact-instrument state.

### Finance Manager
Normalizes the two systems, computes liquidity, applies cross-system allocation policy, runs scenarios and returns approval-only recommendations. It must not duplicate either source ledger.

### ChatGPT
Turns user intent into read-only questions/scenarios, explains Finance Manager results in plain language, coordinates follow-up research, and can surface Strike Radar alerts. ChatGPT must not treat conversation memory as live portfolio/cash truth when Finance Manager/its source adapters can provide fresher authoritative state.

## Safety contract

1. No money movement.
2. No trade execution.
3. No autonomous approval of recommendations.
4. No source-ledger rewrites through Finance Manager.
5. Credentials and privileged keys remain server-side.
6. Every financial state item preserves source and as-of provenance.
7. Stale/failed source reads are surfaced; they are never silently converted into zero balances or current state.
8. A recommendation is not an instruction to transact.

## ChatGPT-facing contract target

Expose a small server-side, read-only interface rather than database credentials. Suggested operations:

- `getFinanceReport()` — current normalized Finance Manager report with freshness/provenance.
- `runScenario(input)` — deterministic what-if calculation; no writes to source systems.
- `getAttention()` — material reserve, obligation, concentration, monitoring or Strike Radar alerts.
- `getSourceHealth()` — RentStream/StockStream adapter health and as-of timestamps.

The interface should return the existing `FinanceReport` domain contract wherever possible. Add fields only when the source systems genuinely provide them; do not fabricate missing live data.

## Strike Radar relationship

Strike Radar belongs to the StockStream investment domain. Finance Manager may read its latest qualified alerts/opportunities and portfolio-risk state. ChatGPT may explain those alerts alongside the household liquidity picture. Finance Manager must not weaken Strike Radar BUY/SELL gates, and Strike Radar must not assume deployable cash without current Finance Manager/source evidence.

## Implementation sequence

1. Inspect the actual RentStream and StockStream schemas and existing server-side access patterns.
2. Replace fixture adapters with production **read-only** adapters implementing the existing normalized contracts.
3. Add adapter/source-health and freshness failure handling.
4. Add a server-side Finance Manager facade for ChatGPT-facing reads/scenarios.
5. Test that no integration path can mutate RentStream, StockStream, brokerage state or bank state.
6. Only after verified production reads work should ChatGPT treat Finance Manager as the preferred live financial context.
