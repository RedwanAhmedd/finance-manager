# Strike Radar ELITE v5.2

Finance Manager owns the user's single Radar: research, alerts and capital-allocation decisions. StockStream remains a read-only portfolio source. Radar never transacts. **Follow the money; do not chase the money.**

The outside is deliberately short: **BUY, BUY MORE, HOLD, TRIM, SELL or WAIT**, with one reason. The machinery below preserves the requested v4.1 and ELITE v5 safeguards and strengthens their evidence and operational boundaries. This document is an operating contract, not a claim that every named analytical module, live feed or notification service has been implemented.

## Implementation and inheritance boundary

The migrated deterministic v4 engine supplies its existing evidence, identity, valuation, opportunity-cost, cash, execution and portfolio gates. Its tests establish only the behavior they exercise. The broader ELITE policy requires verified module evidence and configuration before its checks can be reported as passed.

Preserve these modules: Exit Engine; Money Flow/Rotation; exact-instrument rules; portfolio provenance; market/time integrity; evidence hierarchy; three independent verdicts; 3M+ underwriting; Strike Score v2; valuation; XEQT opportunity cost; Red Team; execution/liquidity; portfolio risk/sizing; Opportunity Tournament; Regime; Bottleneck; Value Chain; catalyst/falsification/calibration; owned-position early warning; prospective journal and delivery integrity.

For each applicable module record its version, required inputs, evidence references, evidence time, evaluation time, result (`PASS`, `FAIL`, `UNKNOWN`), and reason. `UNKNOWN` is never a pass. A score cannot override a hard veto. A model statement that it checked a module is not an implementation or data-coverage proof.

No authoritative inherited definition of **3M+** or **Strike Score v2** is supplied by the current instruction. Keep their names and safeguards; recover the actual definitions, weights, thresholds and versions from verified configuration. Do not expand the acronym, invent a substitute formula, or call either module passed until that configuration and its inputs exist. Missing entry-module definitions hold an entry; they do not hide an independently verified owned-position thesis shock.

## Run priority

1. Check every latest source-backed or user-confirmed owned position for thesis/news shocks and exact-instrument price shocks.
2. Resolve instrument, portfolio and time integrity failures.
3. Scan both existing holdings and the strongest new candidates for actionable BUY/BUY MORE entries and near-action zones.
4. Evaluate XEQT opportunity cost and benchmark progress.
5. Examine meaningful Money Flow/Rotation, Regime, Bottleneck and Value-Chain changes.
6. Continue watchlist research.

A watchlist never proves ownership. Reconcile quantities and ownership changes with source timestamps, transactions and user confirmations. Conflicting records require an explicit unresolved state, not a convenient selection. A source outage cannot turn a known owned position into an unowned one; retain the last verified ownership and label its freshness.

## Evidence and exact-instrument integrity

Store the actual tradable symbol, exchange/venue, currency, security type, issuer and stable identifier when available. For a CDR, identify the underlying, issuer-published mapping/ratio, effective date, and relevant currency-hedge behavior. A US underlying quote is neither the Canadian CDR quote nor an executable CAD entry. A CAD conversion alone does not prove CDR fair value.

Every decision-critical observation needs source identity, observed/event time, publication time when available, retrieval time, market timezone/session and freshness limit appropriate to its use. Retrieval time does not make old information fresh. Future-dated observations, ambiguous identity, unsupported quotes or unresolved material contradictions cannot pass an entry gate. Closed-market data may support research; an executable entry requires the appropriate fresh session data.

Prefer direct filings, issuer/exchange information and company statements for facts; use established independent reporting to corroborate or investigate. Multiple articles reproducing one release are one source. Separate facts, model inference and scenarios. Record contradictory evidence, its decision impact, and what would resolve it. Do not count two models reading the same report as independent evidence.

## Owned-position early warning and Exit Engine

Compute a signed move only when the exact instrument has a reliable current price and comparable previous official close. Select the highest matching absolute threshold, including equality:

| Absolute move, up or down | Severity |
| --- | --- |
| At least 3%, below 5% | WARNING |
| At least 5%, below 8% | HIGH ALERT |
| At least 8% | CRITICAL REVIEW |

Use comparable sessions and corporate-action-adjusted references. Identify delayed, pre-market, regular-session, after-hours and closed-market observations explicitly; never silently mix them. Explain splits and other discontinuities before interpreting an apparent shock. Distinguish price change from dividend-inclusive total return. Do not invent an adjusted reference when the adjustment cannot be verified.

Thesis shocks can trigger below 3%. Drawdown escalation near -10%, -15% and -20% requires a verified cost-basis or high-water reference, with its type/date disclosed. These are review triggers, not mechanical stop-loss or averaging-down instructions. A large gain deserves the same review discipline as a large loss.

Investigate company events, sector/theme, macro, CDR/instrument behavior, thesis, valuation and portfolio impact. Give the cause as `UNRESOLVED` if evidence is insufficient. Exit Engine distinguishes a temporary move from thesis falsification, deteriorating economics, excess valuation, concentration risk and a better allocation. TRIM/SELL needs verified ownership and a reason supported by current evidence; the price threshold by itself is not that reason.

Repeated failure across comparable intended checks starts a single `MONITORING DEGRADED / INSTRUMENT CHECK` episode. Record the failure count, affected instruments, last reliable check and recovery condition. Deduplicate retries, escalate only when coverage materially worsens, and close the episode on verified recovery. Never describe failed monitoring as “no change.”

## Decisions, cash and the Opportunity Tournament

Maintain three separate internal verdicts:

- **Thesis:** economic proposition and falsification state.
- **Opportunity:** entry attractiveness, including the existing PASS/WATCH/BUY/STRIKE research vocabulary.
- **Allocation:** current portfolio, cash, execution and risk readiness.

The user-facing action is a conclusion from these verdicts, not a rename of a score. A strong opportunity with blocked allocation stays WAIT. Entry requires all applicable inherited checks: configured 3M+ and Score v2, evidence hierarchy, scenarios/valuation, catalyst, Red Team, liquidity/spread, portfolio concentration, sizing and current cash. Preserve conservative `NO ACTION` behavior internally where used by the v4 engine.

Planned deposits are not settled buying power. Separate settled brokerage cash, unsettled proceeds, open-order reservations, confirmed incoming contributions and protected household/rental money. Do not treat the earlier approximately C$470 as the full available capital. Use verified deployable CAD cash and confirmed risk limits for amounts; label intended additions separately. Unknown capital leaves allocation pending and must not produce a fabricated CAD amount or quantity. Scan for research-ready entries even while capital is unresolved.

For each proposed addition compare **new candidate, adding to existing holdings, XEQT and cash** using the same capital, horizon and currency assumptions. Include fees, spreads, liquidity, FX/CDR costs, concentration/correlation and uncertainty. The new candidate must justify a credible expected risk-adjusted advantage over XEQT and the strongest existing holding; flows or recent gains alone do not establish this. If it cannot, prefer XEQT or cash. XEQT still needs its own cash, instrument, execution and sizing checks before an actionable BUY. Waiting has value when evidence or prices do not support an entry.

Money Flow, Regime, Bottleneck and Value-Chain findings are hypotheses with provenance and invalidation conditions. Distinguish observed flows from inferred flows, structural scarcity from temporary supply issues, and business benefit from an already expensive security. Do not chase a move merely because the narrative has strengthened.

## XEQT Benchmark Lab

XEQT is the permanent opportunity-cost benchmark for the individual-stock sleeve, including realized trades when reliable records exist. Keep two explicitly different levels:

| Level | Required basis | Allowed conclusion |
| --- | --- | --- |
| **ESTIMATE: cost-basis scoreboard** | Verified/reconstructed holdings, quantities, cost basis and comparable current marks; disclose missing history | Provisional sleeve cost/value/profit coverage. No exact cash-flow alpha claim. |
| **Exact same-cash-flow benchmark** | Reconciled dated cash flows, quantities, dividends/distributions, realized trades, costs, withdrawals and reliable XEQT total-return data | Matched-period, same-currency comparison with documented reinvestment/cost conventions. |

Unknown acquisition dates cannot be replaced with today's date or a guessed XEQT entry. If timing is missing, show the available cost-basis facts and the benchmark gap; do not fabricate a provisional XEQT return. Include closed positions only to the extent realized records are reliable, and identify omitted history. Do not compare raw profit percentages across different deposit schedules.

Prefer a cash-flow-matched XEQT alternative that receives the same external contributions and withdrawals on the same verified dates. If using time-weighted returns instead, require valuations around external flows and state any approximation. Model residual cash and distribution reinvestment consistently. Keep benchmark hypothetical transaction costs distinct from observed stock costs. Apply the same portfolio boundary and currency; do not silently compare a stock sleeve with an entire account or compare CAD returns with USD returns.

Freeze reliable prospective checkpoints with prices, quantities, cash, flows, methodology and data coverage. Track cumulative alpha only over supported intervals from those checkpoints. A corrected historical record is a separately versioned correction, not a rewritten old decision. Cost-basis estimates never silently graduate to exact benchmarking.

## Prospective journal, alerts and calibration

Record decisions before attempting notification: instrument/ownership identity, event and observation times, evidence links, three verdicts, module results/versions, capital state, benchmark checkpoint, action/reason and stable episode ID. Verify persistence/readback. Track delivery status separately from decision status; “generated,” “queued,” “delivered” and “user acknowledged” are distinct.

Retries and process restarts use the same episode ID. A changed timestamp or price within an unchanged state is not a new alert. Re-alert only for escalation or a material thesis, action, entry/valuation, allocation or coverage change. Preserve recovery transitions without sending routine status noise. Never backfill alerts, claim a past alert would have occurred, or create a second independent alert system. Existing delivery paths require explicit end-to-end verification before they are described as operational.

Keep forecasts and catalysts dated with horizon, probability/range where justified, contrary case and falsification conditions. Track rejected, missed and failed ideas alongside winners to expose selection bias. Calibration compares frozen predictions with later outcomes over their intended horizons; revise methodology prospectively and version it. Evidence quality and uncertainty must remain visible even when the score is high. No promise of certainty or profit.

## Simple output contract

Use only **BUY, BUY MORE, HOLD, TRIM, SELL or WAIT** as money actions. Alerts are **under 60 words**. Keep technical analysis and module tables available on request.

- **Actionable buy:** exact ticker/company; BUY or BUY MORE; verified CAD amount or allocation percentage when known and ready; current/entry price with time/source context; one short reason.
- **Owned shock:** severity; exact instrument price/move and timestamp/source; one-sentence cause or UNRESOLVED; thesis state; then BUY MORE/HOLD/TRIM/SELL/WAIT.
- **Monitoring failure:** MONITORING DEGRADED or INSTRUMENT CHECK; affected coverage; last reliable check; WAIT where the decision depends on missing data.

Notify only for a genuinely actionable buy, meaningful owned-position warning, material decision change or monitoring failure. Routine scans and unchanged watchlist items stay quiet. A manual status request may receive a concise WAIT and the single most important missing check. Never transact.

## Local implementation and limits

Finance Manager owns the running Radar panel and `/api/radar`. StockStream owns
portfolio/price records; its read transport remains GET-only. The preserved v4
engine is `src/radar/engine.ts`; its file journal and CLI accept legacy schema-4
research unchanged. The app adds explicit ELITE reviews, separate source/capital
checks, exact-instrument shock checks, and a cash-flow-matched XEQT calculator.
These validate supplied evidence and attestations; they do not authenticate the
contents of a URL or independently implement every research methodology.

The always-on preview service now performs a conservative autonomous discovery pass over exact Canadian CDRs already present in StockStream's watchlist. It checks TMX daily closes hourly and can send one deduplicated **research-candidate** alert when an exact listing moves at least 3% between traded closes. This is intentionally not called a BUY: price movement alone cannot satisfy ELITE, XEQT, catalyst, valuation, news, cash or portfolio gates. Existing reviewed ELITE BUY/BUY MORE decisions can send deduplicated ntfy alerts. A true autonomous BUY from a brand-new idea still requires a trustworthy live quote/news/fundamentals research provider; none is silently invented.
Missing inherited module definitions remain unknown. The cloud task and its
notification settings have not been changed by this code migration. Do not
report local checks as proof of cloud execution or device delivery.

The compact panel shows current decisions from saved research. Multiple entries are alternatives, not a combined allocation: choose one, then refresh and re-underwrite remaining entries against the updated portfolio. Current source reads do not renew old marks; stale, undated, estimated or unresolved FX values block new buying while independently verified exits remain available. Advanced checks,
worksheet export, import, and explicit save live under **Research & checks**.
The assistant may explain only server-verified Radar decisions. A missing,
stale, mismatched or corrupt dossier/review yields WAIT. Each successful app
save creates a v4 research run plus a checksum-linked ELITE receipt containing
the source snapshot and decision at save time. GET rechecks the decision at the
current time, without writing a retrospective signal. ELITE BUY/BUY MORE push alerts are sent only after the existing server-verified gates clear; Radar never sends a trade order. The app suppresses legacy v4 paper signals; the compatibility CLI retains
its original paper-cohort behavior. Those paper records are not ELITE alerts.

### Files and commands

Private data belongs in `.radar/` (gitignored). Preserve backups separately.
The migration found no existing `.radar` data in either repository. If restoring
an older journal, preserve its exact bytes; never reset it merely to silence an
integrity failure. A CLI-only v4 run has no ELITE receipt and remains WAIT in the
app until reviewed and explicitly saved through the app.

```sh
npm run check
npm run build
npm run radar -- --help
```

The CLI requires Node with TypeScript stripping (22.18+ or a newer supported
release). Start a worksheet in the panel, or use `npm run --silent radar --
--init MSFT.NE --underlying MSFT`. Import either the v4 dossier or a JSON envelope
`{ "input": <v4 dossier>, "review": <ELITE review> }`. The exported worksheet
includes the empty review contract. A first save must explicitly create the
journal. Existing state is validated before every append; an error never resets
history. A receipt failure after journal save reports that partial commit and
WAIT; inspect that run before retrying.

The XEQT Lab defaults to an ESTIMATE of the complete recorded individual-stock
sleeve when recent CAD marks and reconstructed cost basis are available. It
never calls current-holdings P/L alpha. An exact comparison may be supplied in
`.radar/benchmark.json` using `ExactBenchmarkInput` from
`src/radar/benchmark.ts`. It needs an opening checkpoint, closing NAV including
retained cash/realized proceeds, complete external flows, dated XEQT total-return
points at every boundary, and explicit costs. Internal stock buys/sales are not
external flows. Missing inputs withhold the comparison. The server supplies the
current clock. This file is a benchmark evidence input, not an alert history;
no historical alert or prospective checkpoint is fabricated from it.
