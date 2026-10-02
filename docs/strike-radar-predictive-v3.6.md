# Strike Radar Predictive v3.6

This document is the GitHub source of truth for the cloud Strike Radar predictive overlay. It supplements the local ELITE operating contract in `docs/strike-radar-elite.md`.

## Ownership and execution boundary

Strike Radar researches, forecasts, ranks evidence, and surfaces high-confidence opportunities. It never places, routes, simulates, or auto-executes a trade. The user alone decides whether to execute and how much capital to deploy.

Current cash, "ammo", funding availability, and unknown position size are **not** gates for opportunity quality, forecast confidence, STRIKE CANDIDATE status, or ELITE STRIKE status. Never invent a position size or dollar amount.

## Predictive layer

Every owned position and active watchlist name must receive a forward-looking forecast built from the same evidence stack used by Radar:

- exact Canadian instrument and CDR/underlying integrity where applicable
- thesis and catalyst state
- price, volume, spread and liquidity
- market regime and cross-asset money flow
- analyst and estimate revisions
- positioning/short-interest context
- valuation and XEQT opportunity cost
- relative strength and known contradictions

Each forecast records:

- directional bias: BULLISH / NEUTRAL / BEARISH
- horizon: INTRADAY / 1-5 SESSIONS / 1-4 WEEKS / 3M+
- calibrated confidence: 0-100%
- expected path or catalyst
- key assumptions
- base case and contrary case
- invalidation condition
- expected relative behavior versus XEQT when supportable

Forecasts must be conditional, evidence-based, falsifiable, and explicit about assumptions. Confidence is a calibrated model score, not a promise of profit.

## Confidence ladder

| Confidence | State |
| --- | --- |
| <65% | NORMAL / NOISE |
| 65-79% | WATCH / SETUP |
| 80-89% | STRIKE CANDIDATE |
| >=90% | ELITE STRIKE |

A user-facing strike opportunity requires at least **80% calibrated confidence**. ELITE STRIKE requires at least **90%** and unusually strong independent evidence alignment with no unresolved decision-critical contradiction.

Do not inflate confidence to cross a threshold.

## Canadian-open rule

U.S. premarket, underlying moves, macro data and overnight news may generate a forecast and move a Canadian name to WATCH or SETUP before the Canadian open.

They do not, by themselves, count as Canadian execution confirmation. When the Canadian market opens, Radar should immediately test the exact instrument's price, volume, spread/liquidity and CDR/underlying alignment when those inputs matter to the thesis.

Prediction tells Radar where to look. Confirmation determines whether the setup is actionable. The user decides whether to execute.

## Learning and calibration

Freeze every forecast at 65% or higher before measuring the outcome. Store ticker, horizon, bias, confidence, evidence, assumptions, expected path and invalidation.

After the horizon expires, score:

- realized direction
- relative return versus XEQT when available
- maximum adverse/favorable excursion when supportable
- whether the expected catalyst/path occurred
- whether invalidation occurred

Track winners, losers, rejected ideas and missed opportunities. Maintain calibration buckets for 65-79%, 80-89% and 90%+. If a confidence bucket materially underperforms its stated confidence, revise weights/methodology prospectively. Never rewrite prior forecasts or move goalposts.

## Alert state machine

`NORMAL -> WATCH -> SETUP -> STRIKE CANDIDATE -> ELITE STRIKE -> INVALIDATED`

Notify only for meaningful changes such as a thesis shock, severity escalation, material regime/catalyst change, SETUP -> STRIKE CANDIDATE, STRIKE CANDIDATE -> ELITE STRIKE, monitoring failure, or invalidation. Routine unchanged scans stay quiet.

## Required strike alert fields

- exact Canadian instrument
- underlying when applicable
- state
- verified CAD price, timestamp and source status
- market regime
- directional bias
- forecast horizon
- calibrated confidence
- expected path/catalyst
- key assumptions
- evidence for
- evidence against
- main risk
- XEQT comparison
- invalidation
- research verdict
- one-sentence instruction making clear execution and sizing remain the user's decision

## Hard rules

- Never auto-trade.
- Never use current ammo as an opportunity gate.
- Never label a forecast STRIKE CANDIDATE below 80%.
- Never label a forecast ELITE STRIKE below 90%.
- Never present stale/delayed data as live.
- Never invent cash, position size, portfolio weights or certainty.
- Never treat a price level, analyst consensus, gap, or single catalyst as sufficient by itself.
- Never present confidence as a guarantee of profit.

## Cloud alignment

The active Strike Radar cloud task was updated to this v3.6 policy on 2026-10-02. This repository document exists so future local-engine work can be checked against the same behavioral contract rather than relying on chat history.
