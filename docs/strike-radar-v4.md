# Strike Radar v4 core reference

Finance Manager now owns Strike Radar. This document preserves the deterministic
v4 methodology and compatibility CLI migrated from StockStream. The current
user-facing operating contract is [ELITE v5.2](strike-radar-elite.md). StockStream
remains the portfolio source and retains its historical manual research records.

The core default action is **NO ACTION**. Finance Manager presents **WAIT** until
its additional ELITE, source and capital checks pass. A decision must earn its
capital against XEQT and waiting. Neither path submits an order or changes the
trade log. A v4 BUY/STRIKE or qualified paper record is not an ELITE decision or
proof of a delivered alert.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `src/radar/engine.ts` | Preserved pure, deterministic v4 input validation and evidence gates. No network, storage, React or Supabase dependencies. |
| `src/radar/elite.ts` | Additional ELITE review, source, capital and public-action checks. |
| `src/radar/RadarPanel.tsx` | Compact current decisions, with worksheet import/export and explicit save under Research & checks. |
| `server/radar.ts` | Local API, current reevaluation and checksum-linked ELITE receipts. |
| `server/radar-journal.ts` | Legacy-compatible journal validation, locking, immutable snapshots, deduplication and atomic persistence. |
| `scripts/radar-v4.ts` | Compatibility CLI that evaluates and saves v4 research and prospective paper cohorts. |
| StockStream manual records | Original assessments, frozen snapshots, reviews and legacy labels remain historical source records. |

The app and CLI can use the same `.radar/journal.json`, but their authority differs.
An app save creates a v4 research run without v4 paper signals, plus a separate
ELITE receipt containing the reviewed evidence, source snapshot and decision.
A CLI-only v4 run has no ELITE receipt and remains WAIT in the app until reviewed
and explicitly saved through the app. A downloaded worksheet is not a saved run.

Neither path silently updates the cloud ChatGPT Radar, its schedule, notification
settings, Supabase, broker data or production deployment. No database migration
is needed. Live quote/news discovery, scheduled execution and push delivery are
not connected by this migration.

## Core decision contract

The v4 output keeps four questions separate. These internal labels do not bypass
the current ELITE action contract:

- **Thesis:** INTACT / UNCERTAIN / BROKEN / UNKNOWN.
- **Opportunity:** UNSCORED / PASS / WATCH / BUY / STRIKE.
- **Allocation:** CHECK CASH / BLOCKED / READY.
- **Action:** NO ACTION / BUY / STRIKE; a permitted size appears only if every
  BUY gate passes and the full proposed amount fits the account.

A complete valuation may coexist with CHECK CASH. A broken thesis is PASS.
An unqualified dossier cannot receive an actionable label from a high score:
there is no composite STRIKE score or estimated probability of success.

BUY must pass this chain:

1. Explicit reviewed risk policy.
2. Exact Canadian instrument and separate underlying identity.
3. Business quality, intact thesis, why now and falsifiable kill conditions.
4. Normalized bear/base/bull fundamental values and owner-cash reconciliation.
5. Current issuer CDR ratio, forward FX convention and hedge evidence where relevant.
6. Precommitted, ordered CAD action zones with a reviewed mapping explanation.
7. A fresh observed exact-instrument CAD quote in an open market.
8. Acceptable spread, liquidity, participation, fees and dislocation.
9. Margin of safety at the executable **ask**.
10. Prospective CAD total-return advantage over both XEQT and waiting, after
    execution drag, concentration and model-risk premiums.
11. A red-team bear case, market counterargument, upside driver, combined
    negative growth/margin/multiple stress, addressed value-trap risk and falsifier.
12. Fresh settled cash, reserved orders, buffer and confirmation of pending orders.
13. Company and sector concentration including XEQT look-through and pending buys.

STRIKE also requires strong business quality, the stricter price/MOS/return
thresholds and a verified journal below its declared STRIKE-frequency limit.
Without journal context, the core can establish BUY eligibility but cannot issue
STRIKE. A frequency limit blocks core STRIKE; it does not change valid core BUY
rules. The app translates only a fully checked ELITE result into its simple public
action vocabulary; neither core label alone authorizes an actionable alert.

## Evidence and calculations

Every material section supplies HTTPS source URLs and explicit ISO timestamps
with timezones. Empty evidence or `null` is missing information, never a zero.
The timestamp describes the evidence's effective time; retrieving an old quote
today does not make that quote fresh. Future or stale evidence blocks action.
All supplied sources in a section must pass freshness checks; a new source
cannot conceal a stale input. Put reporting periods and accounting adjustments
in the normalization note.

The parser checks shape, supported enums, stable identifiers, URL/time formats
and finite numbers. The gates check financial ranges, consistency and readiness.
They do **not** independently authenticate a URL's contents, prove a moat,
rebuild the analyst's valuation or verify a market-open assertion. Human or
source-adapter review remains necessary. No provider integration is implied.

Fundamental fair values remain in the underlying's currency. CAD zones are a
separate reviewed model, not a mechanical FX conversion. For current CDR
dislocation only, the indicative price is:

`underlying USD quote × issuer ratio × CAD-per-USD forward rate`

The bid/ask midpoint is compared with that current indicative price. For a
native CAD security, it is compared with the observed native CAD quote. CIBC's
[CDR information](https://cdr.cibc.com/en) is the primary reference for receipt
identity and mechanics; [BlackRock's XEQT page](https://www.blackrock.com/ca/investors/en/products/309480/ishares-core-equity-etf-portfolio)
is the primary benchmark reference. No current prices, ratios, fund fees or
portfolio balances are baked into v4.

`MOS = (1 − ask / reviewed CAD fair value) × 100`

`excess = candidate base CAD annual total return − execution drag − max(XEQT, waiting) − concentration premium − model-risk premium`

`company weight after = (current direct + indirect company exposure + pending company buys + proposed amount) / (current total portfolio NAV − proposed execution fees)`

The sector calculation follows the same convention. NAV includes existing cash;
spending that cash does not create a larger portfolio denominator. Fees reduce
NAV and count against available cash. Size is the analyst's proposed amount; the engine does
not silently shrink an oversized proposal into an approved one.

Policy thresholds start **unset**. Supply a deliberate risk policy; the fictional
test fixture's values are not investment recommendations or calibrated defaults.
Technical ceilings reject effectively disabled freshness policies: at most 366
days for research, 60 minutes for quotes/execution, 7 days for issuer mapping,
and 24 hours for portfolio evidence. Quote observations must also be synchronized
within the policy's `maxQuoteSkewSeconds` (at most 300 seconds). A tighter policy
can be supplied.

## Run it locally

The compatibility CLI needs Node with TypeScript stripping (22.18+ or a newer
supported release). No additional package or paid service is required. From the
Finance Manager repository:

```bash
cd /Users/redwanahmed/finance-manager
mkdir -p .radar
npm run --silent radar -- --init MSFT.NE --underlying MSFT > .radar/msft.json
```

This produces an **unverified blank worksheet**, not a recommendation. Complete
its source evidence, model, CAD zones, risk policy and current account inputs.
The app accepts the same core dossier or an envelope containing `input` and an
ELITE `review`; the panel's starter download includes an empty review contract.
The CLI accepts the core dossier only, and evaluates only the preserved v4 gates.
The following commands intentionally exercise that compatibility path:

```bash
npm run radar -- --input .radar/msft.json --state .radar/journal.json --create-state
npm run radar -- --input .radar/msft.json --state .radar/journal.json
```

State creation is explicit. `--create-state` refuses to overwrite a journal;
a missing or corrupt existing file never silently creates a new history.
Use one journal for the research universe so STRIKE frequency is measured across
instruments. `.radar/` is gitignored because it can contain private portfolio
inputs. Back it up separately; do not commit personal research/account snapshots.

Change `researchRevision` whenever research evidence, the model, mapping or
policy changes. Previous versions stay frozen. Quote, execution and portfolio
observations can refresh under the same research revision. Change
`evidenceEpisode` only for a meaningful new event; changing timestamps alone is
not a new signal. Same episode + same opportunity/action suppresses another
prospective entry, even across process restarts. Each invocation still appends
its actual evaluation to the run history.

The runner uses a per-journal exclusive lock, same-directory temporary file,
file flush, atomic rename, exact byte readback, a hash chain and full validation
of previous input/evaluation records. Corruption or a competing writer stops the
run. A leftover lock is never stolen automatically: inspect it and confirm that
its process is no longer running before removing it. Capacity limits stop
writes at 10,000 records or 20 MB; nothing is silently truncated. This is local
file continuity, not a replicated or tamper-proof database.

## Prospective outcomes and limits

In the compatibility CLI, qualified BUY/STRIKE paper decisions and WATCH/PASS
research decisions are separate cohorts. These records are v4 research outcomes,
not ELITE alerts or broker transactions. App saves suppress these legacy paper
signals and preserve their own ELITE receipts separately. Seeds and UNSCORED
evaluations do not become trade signals.
Every prospective record fixes its model/revision, exact instrument, currency,
decision and timestamp. The journal declares entry at the next actual TSX
session close after the signal, followed by **63- and 126-session** observation
checkpoints against XEQT on the same CAD total-return basis.

Outcomes remain **PENDING**: this version does not import a verified exchange
calendar, execute fills, fetch adjusted total-return histories or claim realized
performance. A missing CDR history cannot be replaced by the USD underlying.
There is no `--now` option to backdate live journal signals. Deduplication here
proves that a second journal entry was suppressed, not OS push suppression.
This migration installs no scheduler, and a local process test is not proof that
a ChatGPT scheduled execution ran or saved anything.

## Verification

```bash
npm run check       # app, API, ELITE, benchmark, preserved core/CLI checks and types
npm run typecheck   # includes the runner and its tests
npm run build
npm run radar -- --help
```

`test/radar-fixture.ts` contains explicitly fictional inputs. Tests mutate each
critical dependency, test valid BUY/STRIKE eligibility and exercise two separate
runner processes, deduplication, immutable revisions, corrupt state, locks and
concurrent writers. Test journals are temporary and removed afterward.

The former StockStream RadarWorkbench and its fixture are retired. Finance
Manager's `test/radar-panel.test.tsx` exercises the compact panel; API and ELITE
tests cover source/review failures and current reevaluation. A local passing test
suite does not establish current market coverage, scheduler persistence or push
delivery. Use the configured Finance Manager URL (locally `http://127.0.0.1:5177/`)
for the running panel; do not import fictional test data into a personal journal.

The ELITE document preserves the names 3M+ and Strike Score v2 without inventing
their missing inherited definitions. This core reference supplies no replacement
formula, weight or threshold for either module.
