# Strike Radar Predictive v3.7 — CALIBRATED

v3.7 separates **setup quality** from **empirical probability**.

## Core rule

A Setup Score is a ranking/evidence score. It is **not** a probability.

Every forecast carries:
- `setupScore` (0–100)
- an explicit probability status: `UNKNOWN`, `EXPERIMENTAL`, or `CALIBRATED`
- `P(positive over 5 sessions)` when supportable
- `P(outperform benchmark over 5 sessions)` when supportable
- expected excess return when supportable
- data-quality score and explicit UNKNOWN/stale feature masks
- a point-in-time feature snapshot with `availableAt` timestamps

The UI must never display `setupScore` with a percent sign.

## State ladder

- <50: NORMAL
- 50–64: WATCH
- 65–79: SETUP
- 80–89: STRIKE CANDIDATE
- 90+: ELITE STRIKE

The state ladder is based on setup quality, not claimed win probability. Decision-critical UNKNOWN evidence or failed Canadian execution confirmation caps an 80+ setup at SETUP. ELITE STRIKE additionally requires at least an experimental probability estimate so a 90+ setup can never masquerade as a 90% forecast.

## Point-in-time discipline

For every feature:
```
available_at <= forecast_cutoff
```

Known or stale features without a provable availability timestamp are invalid. Missing data is stored as UNKNOWN, not zero or neutral. This prevents retrospective leakage from current analyst estimates, later news summaries, revised datasets, or same-session closing information.

## Probability calibration

Probability estimates are scored separately from setup ranking with:
- Brier score
- log-loss
- empirical reliability buckets
- separate absolute-return and benchmark-relative probabilities

LIVE and BACKTEST cohorts stay separate. Same-date/sector signals should be clustered when interpreting effective sample size.

A probability remains UNKNOWN until a real calibration method and sample exist. A calibrated value must record:
- method
- as-of timestamp
- raw sample size
- effective sample size

## Persistent ledger

StockStream stores:
- `radar_forecasts`: immutable LIVE/BACKTEST forecasts
- `radar_feature_observations`: append-only point-in-time features
- `radar_outcomes`: append-only evaluations
- `radar_calibration_summary`: setup-score diagnostics
- `radar_model_metrics`: Brier/log-loss diagnostics
- `radar_probability_calibration`: reliability buckets

Never overwrite a frozen forecast. Model changes create a new model version.

## Canadian execution

Underlying prediction and Canadian execution quality remain separate. Exact CDR price, spread, volume/liquidity, opening gap, underlying alignment, FX/hedge effects and premium/discount are execution evidence. Missing decision-critical execution evidence can cap actionability, but it must not be silently substituted with the U.S. underlying.

## Non-negotiables

- Never auto-trade.
- User controls execution and sizing.
- Cash/ammo is not an opportunity-quality gate.
- Never present Setup Score as probability.
- Never backfill a probability after seeing the outcome.
- Never mix LIVE and BACKTEST statistics without labeling them.
- Never convert UNKNOWN into neutral.
