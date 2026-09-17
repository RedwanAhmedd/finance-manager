# Finance Manager

Finance Manager is the reporting layer above **RentStream** and **StockStream**. Version 0.3 reads live rental operations, cross-border treasury cash and investments while preserving source dates and read-only boundaries.

- **RentStream owns:** rental billing, receipts, expenses, reconciliation, Bangladesh operating bank/cash records, tenant deposit records, and treasury cash snapshots such as Canadian bank balances.
- **StockStream owns:** holdings, trades, recorded brokerage cash, quotes, and investment settings.
- **Finance Manager owns:** the combined view, source coverage/freshness checks, and future approval-only recommendations.

## Run locally

Requires Node.js 22.12+ (or a compatible newer release).

```sh
npm ci
cp .env.example .env.local
# Set the two project URLs and publishable keys in .env.local.
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:5177 and sign in to each source using its existing email/password account. The two sessions are independent. No passwords are put in environment files. Sessions use separate browser storage keys and may be disconnected separately. OAuth-only accounts and MFA are not supported by this initial sign-in form.

`VITE_*` values are public browser configuration. Use **publishable** keys only. Never add service-role keys, secret keys, database passwords, or management tokens. `.env.local` is ignored by Git.

## Live behavior

- **Bangladesh banks:** the latest statement on or before the Bangladesh business date is the anchor. Only later dated movements through that date affect its balance. Unknown balances stay unknown. Credit-card debt and card credit are excluded from liquid cash.
- **Treasury accounts:** cross-border cash snapshots are read from RentStream's `treasury_accounts` source with their native currency and balance-as-of date. CAD and BDT are never added together without an explicit FX step.
- **Operating cash:** read from RentStream's existing stable `reconciliation_cash_source_balances` function using GET. The physical-count date is shown separately from the calculated cash balance.
- **Tenant deposits:** recorded deposit balances stay visible as a separate contingent liability. They are not automatically subtracted from headline liquidity because the final refundable amount may be reduced by unpaid rent or other valid charges recorded in RentStream.
- **Rental billing:** current-calendar-month rent plus utility bills, settlements against those bills, and outstanding amounts. Actual cash receipt entries and expenses use a separate trailing 30-day window. Missing eligible tenants' bills are flagged.
- **Investments:** trade history determines remaining non-cash shares when present. Direct quotes, manual prices, issuer-derived CDR prices, and estimates retain their labels and dates. USD holdings require a dated USD/CAD rate. Missing prices/currencies withhold the portfolio total instead of substituting cost basis.
- **Brokerage cash:** comes from cash-role positions, counted once in portfolio value and shown separately as liquidity. No cash record means unknown. An old recorded zero is labeled stale.
- **Refresh:** reads existing records; it does not trigger quote updates, create payments, or write back to either app. Failed reads clear that source's displayed figures. Signing out hides its data immediately. Requests completing after an account switch are discarded.
- **Freshness:** source record dates and fetch times are distinct. The page warns after one hour without a successful read. Separate API calls and separate projects do not form one atomic database snapshot.

## Why real allocations are still on hold

The Canadian cash source is connected. A defensible deployable-cash calculation still needs a dated CAD/BDT conversion rate, approved reserve targets with their funding locations, upcoming obligations/already-committed funds, and an approved contribution/opportunistic-allocation policy. Finance Manager identifies those gaps and withholds live affordability/BUY/STRIKE recommendations rather than substituting demo assumptions.

StockStream contribution room is not treated as an annual contribution target. STRIKE evidence is not inferred from holdings or generic assessments.

## Read-only scope

The app issues GET requests only to explicitly listed data resources, including RentStream treasury snapshots and one approved stable cash RPC. Its fetch wrapper rejects other data methods, arbitrary RPCs, Edge Functions, and unexpected origins. Authentication permits sign-in, token refresh, user verification, and local-session sign-out.

This is an application behavior constraint, **not a separately provisioned read-only database role**: the signed-in source JWT retains the existing source user's permissions, enforced by that project's RLS. The wrapper is not a security boundary against someone modifying the browser code. A future hosted integration can use separately scoped server-side read access.

## Code map

- `src/live/rentstream.ts`, `stockstream.ts`: source reads and deterministic normalization.
- `src/live/read.ts`: ordered pagination, avoiding the default API row limit.
- `src/live/client.ts`: independent sessions and the read transport allowlist.
- `src/live/useSnapshot.ts`: refresh, error, and account-switch lifecycle.
- `src/live/LiveDashboard.tsx`: real source evidence and incomplete-data states.
- `src/integration/chatgptFacade.ts`: narrow read-only ChatGPT-facing context contract.
- `src/integration/financeContextService.ts`: concurrent live reads, partial-failure isolation, and public error classification.
- `src/domain/`, `src/engine/`, `src/fixtures/`: original normalized demo contracts, allocation engine, and synthetic data.

The live snapshot types represent missing values explicitly and therefore do not silently coerce the richer source data into the original demo contracts.

## Validation

```sh
npm test
npm run build
npm audit
```

Tests cover live context orchestration, partial source failures, and sanitized error classification in addition to statement boundaries, treasury reads, future transactions, card credit exclusion, deposit accounting, billing/receipt separation, missing bills and values, trade-derived shares, CDR/FX behavior, stale cash, data pagination, source failures, and forbidden writes. Unit tests use synthetic data only. Private source snapshots and local credentials must not be committed.
