# Finance Manager

Finance Manager is the reporting layer above **RentStream** and **StockStream**. Version 0.2 adds source sign-ins, read adapters, and a live financial snapshot. The original allocation/scenario engine remains available with clearly labeled demo data.

- **RentStream owns:** bank and operating cash, rental billing, receipts, expenses, reconciliation, and tenant deposit liabilities.
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

- **Banks:** the latest statement on or before the Bangladesh business date is the anchor. Only later dated movements through that date affect its balance. Unknown balances stay unknown. Credit-card debt and card credit are excluded from liquid cash.
- **Operating cash:** read from RentStream's existing stable `reconciliation_cash_source_balances` function using GET. The physical-count date is shown separately from the calculated cash balance.
- **Deposits:** opening refundable liabilities plus receipts, minus refunds and applications. Deposit cash can remain inside operating cash, but its liability is not rental profit or free money.
- **Rental billing:** current-calendar-month rent plus utility bills, settlements against those bills, and outstanding amounts. Actual cash receipt entries and expenses use a separate trailing 30-day window. Missing eligible tenants' bills are flagged.
- **Investments:** trade history determines remaining non-cash shares when present. Direct quotes, manual prices, issuer-derived CDR prices, and estimates retain their labels and dates. USD holdings require a dated USD/CAD rate. Missing prices/currencies withhold the portfolio total instead of substituting cost basis.
- **Brokerage cash:** comes from cash-role positions, counted once in portfolio value and shown separately as liquidity. No cash record means unknown. An old recorded zero is labeled stale.
- **Refresh:** reads existing records; it does not trigger quote updates, create payments, or write back to either app. Failed reads clear that source's displayed figures. Signing out hides its data immediately. Requests completing after an account switch are discarded.
- **Freshness:** source record dates and fetch times are distinct. The page warns after one hour without a successful read. Separate API calls and separate projects do not form one atomic database snapshot.

## Why real allocations are on hold

The live source schemas do not yet supply all inputs required for a defensible deployable-cash calculation: a Canadian bank balance/currency, dated CAD/BDT rate, approved reserve targets with their funding locations, obligations and already-committed funds, current brokerage cash, and an approved allocation policy. The app identifies those gaps and withholds live affordability/BUY/STRIKE recommendations. It never substitutes demo assumptions.

The current RentStream account schema is BDT-only. The Canadian account is a planned source-system enhancement; this integration does not add or mislabel an account. The source's contribution room is not treated as an annual contribution target. STRIKE evidence is not inferred from holdings or generic assessments.

## Read-only scope

The app issues GET requests only to explicitly listed data resources, including one approved stable cash RPC. Its fetch wrapper rejects other data methods, arbitrary RPCs, Edge Functions, and unexpected origins. Authentication permits sign-in, token refresh, user verification, and local-session sign-out.

This is an application behavior constraint, **not a separately provisioned read-only database role**: the signed-in source JWT retains the existing source user's permissions, enforced by that project's RLS. The wrapper is not a security boundary against someone modifying the browser code. A future hosted integration can use separately scoped server-side read access. No database policies, credentials, migrations, or source app code are changed by this version.

## Code map

- `src/live/rentstream.ts`, `stockstream.ts`: source reads and deterministic normalization.
- `src/live/read.ts`: ordered pagination, avoiding the default API row limit.
- `src/live/client.ts`: independent sessions and the read transport allowlist.
- `src/live/useSnapshot.ts`: refresh, error, and account-switch lifecycle.
- `src/live/LiveDashboard.tsx`: real source evidence and incomplete-data states.
- `src/domain/`, `src/engine/`, `src/fixtures/`: v0.1 normalized demo contracts, allocation engine, and synthetic data.

The live snapshot types represent missing values explicitly and therefore do not silently coerce the richer source data into the original demo contracts.

## Validation

```sh
npm test
npm run build
npm audit
```

Tests cover statement boundaries, future transactions, card credit exclusion, deposit liabilities, billing/receipt separation, missing bills and values, trade-derived shares, CDR/FX behavior, stale cash, data pagination, source failures, and forbidden writes. Unit tests use synthetic data only. Private source snapshots and local credentials must not be committed.
