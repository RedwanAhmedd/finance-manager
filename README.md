# Finance Manager

Finance Manager is a personal financial advisor across two countries: everyday money in Canada, the rental business in Bangladesh (**RentStream**) and investments (**StockStream**). Version 0.4 adds permanent server-side source connections, precomputed books for the assistant, a daily CAD/BDT reference rate, and personal bills, spending, balances and draws.

- **RentStream owns:** rental billing, receipts, expenses, reconciliation, Bangladesh bank/cash records with their financial roles, tenant deposit records, and treasury cash snapshots such as the owner's Canadian (TD) bank balances.
- **StockStream owns:** holdings, trades, recorded brokerage cash, quotes, and investment settings.
- **Finance Manager owns:** the combined view and advisor, plus the owner's personal records (bills, logged spending, draws, statement imports). Those are stored in `money_*` tables inside the StockStream database (the Supabase account's free projects are in use) and are reachable only by this app's local server.

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
- **Treasury accounts:** cross-border cash snapshots (the TD accounts) are read from RentStream's `treasury_accounts` with their native currency and balance date. CAD and BDT are only compared through the dated reference rate.
- **Capital allocation:** account roles in RentStream decide what is deployable: three months of recorded expenses are protected, family-restricted and unclassified accounts are set apart.
- **Deposits:** tracked per tenant. They revolve (departing tenants normally use theirs as their final two months of rent and new tenants bring new ones), so they are not deducted from available cash.
- **Rental billing:** current-calendar-month rent plus utility bills, settlements against those bills, and outstanding amounts. Actual cash receipt entries and expenses use a separate trailing 30-day window. Missing eligible tenants' bills are flagged.
- **Investments:** trade history determines remaining non-cash shares when present. Direct quotes, manual prices, issuer-derived CDR prices, and estimates retain their labels and dates. USD holdings require a dated USD/CAD rate. Missing prices/currencies withhold the portfolio total instead of substituting cost basis.
- **Brokerage cash:** comes from cash-role positions, counted once in portfolio value and shown separately as liquidity. No cash record means unknown. An old recorded zero is labeled stale.
- **Sold mementos:** a memento with zero remaining shares stays visible at zero value without an actionable sale-history warning. This does not repair missing purchase history or infer sale proceeds. Active roles and mementos with remaining shares still show incomplete-history warnings.
- **Refresh:** reads existing records; it does not trigger quote updates, create payments, or write back to either app. Failed reads clear that source's displayed figures. Signing out hides its data immediately. Requests completing after an account switch are discarded.
- **Freshness:** source record dates and fetch times are distinct. The page warns after one hour without a successful read. Separate API calls and separate projects do not form one atomic database snapshot.

## Assistant

Version 0.3 adds a briefing and a chat assistant above the figures. It reads only the normalized snapshot shown on the page (unknowns stay null, record dates included, key totals pre-computed with their formulas) and cannot write anywhere.

The AI runs behind `/api/assistant`, served by the local Vite dev/preview server, so no model credential reaches the browser. Choose the model in `.env.local` (see `.env.example`):

- **Ollama (default without a key):** local model, figures never leave the Mac. Prompts are trimmed to fit the model's context window by dropping the oldest chat turns, never the instructions or figures.
- **Anthropic (`ANTHROPIC_API_KEY`):** `claude-opus-5` with server-side refusal fallback; the snapshot is sent to Anthropic's API and prompt-cached across a conversation.

The endpoint rejects cross-origin requests and non-JSON bodies. A refresh, sign-in or sign-out starts a new briefing and clears the conversation.

## Permanent connection, books and rate

- **No sign-in:** with `RENTSTREAM_SECRET_KEY` and `STOCKSTREAM_SECRET_KEY` in `.env.local` (server-side only), the local server reads both sources through the same GET-only allowlist (`src/live/transport.ts`) and serves `/api/sources/*`; the page re-reads hourly. Without keys, the browser sign-in forms still work.
- **Books (`src/books/`):** RentStream, StockStream and personal books render every figure as text for the assistant, with guides explaining the business: collection month vs rent month, revolving tenant deposits, adjusted cost base, and no projections.
- **Rate (`/api/fx`):** a daily CAD/BDT reference from ExchangeRate-API's open feed, with a second free source as fallback; dated, cached in memory, and labelled as a reference, not a transfer rate.

## Everyday money

`/api/money` (`server/money.ts`) stores the owner's recorded bills, hand-logged spending and draws from the rental business (Canadian account balances live in RentStream's treasury accounts), with statement import endpoints. TD and Wealthsimple CSV parsers are intentionally not written until real exports are available (`src/money/parsers.ts`). Its client may only touch the `money_*` tables. Those tables have RLS on with no policies and no grants for browser roles, so the publishable key is refused. Migrations are kept in the StockStream repo (`supabase/migrations/20260917*_finance_manager_*`).

## Read-only scope

The app issues GET requests only to explicitly listed data resources, including one approved stable cash RPC. Its fetch wrapper rejects other data methods, arbitrary RPCs, Edge Functions, and unexpected origins. Authentication permits sign-in, token refresh, user verification, and local-session sign-out.

Source reads stay GET-only. This is an application behavior constraint, **not a separately provisioned read-only database role**: the signed-in source JWT retains the existing source user's permissions, enforced by that project's RLS. The wrapper is not a security boundary against someone modifying the browser code. The permanent connection uses each project's secret key on the local server, under the same GET-only allowlist. Personal records are the only writes, and only to the `money_*` tables.

## Code map

- `src/live/rentstream.ts`, `stockstream.ts`: source reads and deterministic normalization.
- `src/live/read.ts`: ordered pagination, avoiding the default API row limit.
- `src/live/client.ts`, `transport.ts`: browser sessions and the read transport allowlist.
- `src/live/useSnapshot.ts`: refresh, error, and account-switch lifecycle.
- `src/live/LiveDashboard.tsx`: real source evidence and incomplete-data states.
- `src/assistant/`: snapshot context, streaming client and the assistant panel.
- `server/`: local assistant (`assistant.ts`, `prompt.ts`, `providers.ts`), permanent source reads (`sources.ts`), CAD/BDT rate (`fx.ts`) and personal money API (`money.ts`).
- `src/books/`: RentStream, StockStream, personal and two-country overview books.
- `src/money/`: personal money types, categorisation, statement lines and the Everyday money panel.
- `src/integration/chatgptFacade.ts`: narrow read-only ChatGPT-facing context contract (see `docs/chatgpt-integration.md`).

The live snapshot types represent missing values explicitly and therefore do not silently coerce the richer source data into simpler shapes.

## Validation

```sh
npm test
npm run build
npm audit
```

Tests cover statement boundaries, future transactions, card credit exclusion, deposit liabilities, billing/receipt separation, missing bills and values, trade-derived shares, CDR/FX behavior, stale cash, data pagination, source failures, and forbidden writes. Unit tests use synthetic data only. Private source snapshots and local credentials must not be committed.
