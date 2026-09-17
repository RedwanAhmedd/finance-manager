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
5. Source credentials remain outside committed code; never commit service-role keys, database passwords or source-user passwords.
6. Every financial state item preserves source and as-of provenance.
7. Stale/failed source reads are surfaced; they are never silently converted into zero balances or current state.
8. A recommendation is not an instruction to transact.

## Implemented

- Production read-only RentStream and StockStream adapters are merged into `master`.
- The live UI keeps independent source sessions, explicitly represents unknown data, clears failed reads, and rejects non-allowlisted source writes in its transport layer.
- Live-source freshness and source issues are surfaced instead of replaced with demo assumptions.
- `src/integration/chatgptFacade.ts` defines a transport-neutral `finance-manager.chatgpt.v1` envelope for ChatGPT-facing reads.
- `src/integration/financeContextService.ts` reads both live adapters concurrently, isolates partial failures, and emits stable non-sensitive source failures.
- The facade exposes source health, source snapshots and attention items with hard-coded read-only capabilities: no money movement, no trade execution, no source writes and no autonomous approvals.
- Missing or failed sources remain unavailable; they are never interpreted as zero.

## ChatGPT-facing contract

`buildChatGptFinanceContext()` accepts snapshots produced by the existing read-only adapters and returns the narrow context a ChatGPT-facing transport may expose.

A future hosted transport can map this to operations such as:

- `getFinanceContext()` — current read-only envelope with freshness/provenance.
- `runScenario(input)` — deterministic what-if calculation; no source writes.
- `getAttention()` — material reserve, obligation, concentration, monitoring or Strike Radar alerts.
- `getSourceHealth()` — RentStream/StockStream health and as-of timestamps.

The transport must not receive database credentials merely to expose these operations.

## Strike Radar relationship

Strike Radar belongs to the StockStream investment domain. Finance Manager may read its latest qualified alerts/opportunities and portfolio-risk state. ChatGPT may explain those alerts alongside the household liquidity picture. Finance Manager must not weaken Strike Radar BUY/SELL gates, and Strike Radar must not assume deployable cash without current Finance Manager/source evidence.

## Remaining deployment boundary

The browser app now performs real source reads, but a browser-local authenticated session is not automatically a remote ChatGPT API. A persistent remote ChatGPT connection still requires an explicitly deployed/authenticated read-only transport or connector. Do not expose browser refresh tokens or privileged source keys to bridge that gap.

Until such a transport is deliberately deployed, any environment that already has separately authorized access to the same source systems may use that access for verification, but it must preserve Finance Manager's source-of-truth, freshness and no-write rules.
