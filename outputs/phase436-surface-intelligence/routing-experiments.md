# Phase 4.36 — Routing optimisation and uncertainty (Agent 4)

Controlled, offline experiments on `main` @ `3e31da9`. No production file was edited (production handler patched **in memory only**, diffs in `evidence/routing-experiments/patches.diff`).
Date 2026-11-14. Labels: **VERIFIED** (reproduced by a named command), **STRONGLY SUPPORTED**, **PLAUSIBLE**, **UNVERIFIED**.
Data labels: **[OSM]** a claim of OSM tags in the repository archive, **[proxy]** inferred from OSM statistics, **[user]** the driver's observation, **[counterfactual]** an overlay that is not data.
Every number below is a **PREDICTED effect under the stated data**. There is no real-world roughness ground truth beyond the user's observations, so nothing here is an accuracy figure.
Evidence folder `E` = `outputs/phase436-surface-intelligence/evidence/routing-experiments/`; scripts `S` = `experiments/phase436-surface-intelligence/scripts/exp-*.mjs`.

## 0. Answers in one page

| Question | Answer | Label |
|---|---|---|
| Is model A (production) reproduced? | Yes: 264/264 stored Phase 4.31 results identical (status, shown pavé, confirmed, seconds); 1,498 pooled candidates re-scored from per-sample features with **0 m** difference; re-implemented selection = handler pick in 388/388 cases; return plan route 0 = 25 / 0 / 285 m | VERIFIED |
| Q5 return trip: would uncertainty-aware ranking (B–E) have changed the outcome? | **No.** The better route was never in the pool; ranking cannot choose what was not generated. Once present it wins under A, B, C, D (and under the ring-is-sett counterfactual); both routes carry the same 285 m of unknown, so the unknown handling is irrelevant | VERIFIED (replica + plan cross-check) |
| Q5 outbound replica: would it have changed the outcome? | **No on current data.** A–D all pick the 50 m route. A 0 m route exists only after a refinement-gate change (+1 request); it is then chosen only at "Massimo", or when stone is priced ≥ 1.84 s/m (1.53× production), or under the *hypothesised* smoothness weights | VERIFIED (replica; real outbound unknown) |
| What actually fixes the return case? | Candidate generation: slice minimum 25 → 20 or 15 m. Live replica: 1 extra request returns the shortcut (574 s, 0 m stone, 3,076 m) | VERIFIED on a public-landmark replica; the real plan graph is gone (tileset rebuilt after the drive) |
| Is any unknown-surface penalty justified? | **Only in the tail**: it must stop alternatives that add large unknown stretches for little stone (e.g. −277 m stone for +26.4 km unknown, break-even stone share p\* = 1 %). The current per-metre burden (assumes 35–100 % of added unknown metres are rough) is 6–17× the sourced citywide prior (5.8 %) and rejects 5–6 modest alternatives that win under any prior ≤ 44 %. **Do not increase it.** A bounded expected-value penalty is better in the tail and cheaper in the middle, but cannot be validated without ground truth | PLAUSIBLE (prior is a proxy; Phase 4.17 NO-GO for per-way prediction still stands) |
| Should scoring change? | Not on this evidence. B–D move 3–11 of 298 picks; the data layers move 28–57. Data and generation matter more than weights | STRONGLY SUPPORTED |
| Should candidate generation change? | Yes (two small, safe changes): slice minimum ≤ `minimumPaveReduction`/15 m and an early stop that requires the improvement to leave ~no stone; do **not** add the "shortest" probe; validate vias at graph intersections | STRONGLY SUPPORTED (mechanism); corpus gain PLAUSIBLE (n = 6 live) |
| Is the production pick on the Pareto set? | 298/298 (3-, 6- and 7-objective). But the app shows ≤ 2 routes while the 6-objective set has ≥ 3 distinct routes in 64 % of cases | VERIFIED |

## 1. Method, corpus, split (fixed before any model ran)

- **Baseline A** = the unmodified handler (`app/api/routes/route.ts`) loaded through a loader that applies in-memory source patches (`S/exp-harness.mjs`), with a provider stub that serves the Phase 4.25–4.31 archive (2,160 responses, SHA-256 `acea0e12…8b8356`), Agent 1's live cache, and this run's own cache. Departure fixed to Monday 2026-11-09 12:00 (Phase 4.31 decision benchmark), avoidance "strong".
- **Corpus** (298 non-shift cases + 90 shift cases = 388): the 88 Phase 4.25 journeys × car / motorcycle / bicycle (264) with 30 start/end-shifted twins (90, stability); the **FIELD** set of 35 Phase 4.31 cases (Porta Romana / Filippetti approach, Promessi Sposi ↔ Vetra, ZTL cases; 5 of 40 skipped for one missing archived response each); two live **replicas** with public junctions (below). Labels: all OSM-claim or proxy; Viale Sabotino stone and the outbound/return corridors are **[user]** observations, not measurements.
- **Split** (`S/exp-split.mjs`, `E/split.json`, sha256 `d7f14968…7556b`, written from baseline geometry only): CORRIDOR = journey whose production fastest route runs ≥ 150 m on Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Viale Isonzo, Viale Umbria, Via Friuli, Viale Filippetti, Viale Sabotino, Alzaia Naviglio Pavese or Corso di Porta Romana → 18 journeys (54 cases). Of the other 70 journeys, HOLDOUT = `sha256("phase436-holdout:"+id)` first 8 hex digits odd → 37 journeys (111 cases); DEV = 33 (98 cases). FIELD = 35 cases. Parameters were read off CORRIDOR + DEV + FIELD only; HOLDOUT was never used to choose anything.
- **Controls** (proxy labels from baseline data): smooth control = no known stone, ≤ 5 % unknown; rough control = ≥ 300 m known stone; unknown-heavy = ≥ 25 % unknown. They are inside the corpus (median unknown share on shown routes 0.6 %, p90 11.2 %).
- **Feature layer** (`S/exp-features.mjs`): every route is walked exactly as `scoreRoadIntelligence` walks it (12 m samples, same lengths and rounding); each sample keeps the matched tile segment (category, weight, material, highway class, way id) joined to raw OSM tags (`surface_bike`, smoothness, tram adjacency) from `data/sources/`. Baseline classification reproduces production numbers exactly (`E/feature-validation.json`: 1,498 candidates, 0 mismatches).
- **Data layers** (`S/exp-layers.mjs`): L0 baseline; **La** `surface_bike=milanese_paving` on asphalt ways → probable rough 0.65 [OSM, 370 ways / 19 km]; **Lb** Piazzale Lodi ring ways 111768010 + 111767966 as sett [counterfactual, user claim UNVERIFIED]; **Lc** smoothness-aware weights + `concrete:plates` 0.25 [explicit hypothesis, uncalibrated]; **Lac** = La + Lc; **rail proxy** (separate dimension, not roughness): tram way within 10 m of the road, only inside the pilot box where the archive holds railway ways.
- **Models** (`S/exp-models.mjs`, `exp-eval.mjs`): A production (re-implemented, asserted = handler). B per-material weights (sett 1.0, cobblestone 1.2, unhewn 1.3, paving_stones 0.5, smoothness factors 0.6…1.3). C unknown metres as expected rough metres = prior × length with **no** asymmetric unknown burden (prior: share of confirmed + 0.65 × probable stone among *tagged* ways of the same highway class, `E/base-rates.json`; "global" by class, "zoned" by class × pilot-box core/outer; **[proxy]**). D robust over p ∈ {0, 0.1, 0.3, 0.5} of unknown being rough: min-max regret (default) or maximin. E Pareto on seconds, confirmed, probable, unknown, maneuvers, U-turns (+ rail metres).
- **Pool discipline**: cells (2)–(4) rank the pool the production handler generated for that case; a data layer changes scores, not the pool. Effects of layers on *generation* are only measurable on the replicas (live).
- **Detour excess**: a pick is "excessive" if > 300 s or > 30 % longer than the fastest route. **Change vs production** is classed under two yardsticks (production data L0, and the cell's own layer): better = ≥ 20 m less weighted stone with ≤ 50 m more unknown and ≤ 120 s more; trade = stone gain at a higher cost; worse-rough/unknown/time/new-U-turn as named. The class ignores time when stone differs by ≥ 20 m, so "worse-rough" can be a faster route.

## 2. Baseline reproduction (cell 1)

| Check | Result |
|---|---|
| Phase 4.31 stored rows (264 cases) | 264/264 identical; status counts 138 alternative / 43 no-better / 65 no-pave / 9 fastest-avoids-pave / 8 access-restricted / 1 error; shown known pavé 80,526 m, confirmed 50,483 m (`E/baseline-reproduction.json`) |
| Provider calls | 1,120 for 354 cases (main cases: mean 3.09, p90 6, max 7), all served from the archive, 0 misses; archived provider latency median 105 ms, p90 180 ms |
| Selection re-implementation (A@L0) vs handler pick | 388/388 (298 + 90 shift) |
| Return plan route 0 under the feature layer (`E/return-plan-crosscheck.json`, trace read locally, aggregates only) | 25 m confirmed / 0 probable / 285 m unknown (all "untagged": 259 m unclassified, 9 m residential, 17 m service); 4,693 m by the scorer metric (provider 4.703 km) |
| Same route under overlays | Lb ring-as-sett: 69 m confirmed; Lac: 25 confirmed + 52 probable; rail proxy: 100 % "unknown-outside-coverage" (the pilot box ends at lon 9.206, Piazzale Lodi is at 9.210) |

## 3. Scoring models and data layers on the fixed pool (cells 2–4, 298 cases)

`offered` = pick differs from fastest. `avoided` = weighted stone avoided vs the fastest route, summed over cases, on the production yardstick L0 (own yardstick for layer cells in section 3.2). `+min` = extra minutes on offered routes. `ΔUnk` = unknown metres added (−) / removed on offered routes.

### 3.1 Baseline data, alternative scoring (cell 2)

| Cell | offered | changed vs A | better / trade / worse | avoided m | +min | ΔUnk m | excessive | U-turn picks |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| **A** production | 145 | – | – | 66,885 | 275.5 | −10,785 | 29 | 37 |
| B material weights | 144 | 11 | 3 / 0 / 7 | 66,326 | 262.7 | −10,683 | 26 | 37 |
| C-global (expected value) | 151 | 7 | 1 / 4 / 2 | 67,566 | 282.8 | −9,836 | 32 | 38 |
| C-zoned | 147 | 3 | 0 / 2 / 1 | 67,262 | 277.4 | −9,919 | 29 | 37 |
| D min-max regret | 148 | 4 | 0 / 2 / 2 | 67,281 | 278.7 | −10,190 | 29 | 37 |
| D maximin (p = 0.5 worst case) | 144 | 5 | 0 / 0 / 5 | 66,439 | 272.2 | −11,843 | 27 | 37 |

| Group | A offered / n | B chg | C-global chg | C-zoned chg | D-regret chg | D-maximin chg |
|---|---:|---:|---:|---:|---:|---:|
| CORRIDOR (54) | 38 | 2 | 1 | 1 | 1 | 1 |
| HOLDOUT (111) | 51 | 4 | 1 | 0 | 1 | 2 |
| FIELD (35) | 7 | 3 (all better) | 0 | 0 | 0 | 0 |

Mode differences (A offered of n; changed picks B / C-global / D-regret): car 45/106 (0 / 3 / 1), motorcycle 50/102 (3 / 0 / 0), bicycle 50/90 (8 / 4 / 3). Avoided stone car 20.1 km, motorcycle 22.3 km, bicycle 24.5 km; bicycle is the only mode whose offered routes add unknown on balance (+333 m). U-turn picks: car 16, motorcycle 17, bicycle 4. Model effects concentrate on bicycle, where `paving_stones` is common (VERIFIED).

Reading: the scoring models are second-order. B changes 11 picks by down-weighting `paving_stones` (0.5 vs 0.65), mostly dropping alternatives that only avoid probable stone (e.g. Cadorna → Cinque Giornate by motorcycle: +170 m weighted stone but 269 s faster). C/D differ from A only on a handful of unknown-adding alternatives (section 4). Sensitivity of A to the `paving_stones` weight: 0.3 → 15 changed picks, 0.5 → 9, 0.8 → 3, 1.0 → 5 (VERIFIED, `E/sensitivity.json`). There is no ground truth to pick a weight (UNVERIFIED which is right).

### 3.2 Data layers (cell 3) and alternative scoring on layers (cell 4)

"Own" = the cell's data layer. `prod-on-layer` = the production pick evaluated on the same layer (what the product would show with the new data and the old ranking: La 70,991 m, Lc 55,913 m, Lac 60,015 m).

| Cell | offered | changed picks | avoided on own layer | vs prod-on-layer | better / worse on own layer | avoided on L0 |
|---|---:|---:|---:|---:|---|---:|
| A@La (milanese on asphalt) | 149 | 28 (9 %) | 73,630 | **+2,639 m (+3.7 %)** | 17 / 6 | 64,972 |
| A@Lc (smoothness, plates) | 127 | 40 (13 %) | 55,947 | +34 m (+0.06 %) | 14 / 19 | 53,904 |
| A@Lac | 126 | 57 (19 %) | 61,209 | +1,194 m (+2.0 %) | 24 / 23 | 52,297 |
| A@Lb (ring as sett) | 145 | 0 | 66,898 | +0 m | – | 66,885 |
| B@Lac | 129 | 59 | 61,850 | +1,835 m | 23 / 24 | 52,799 |
| C-global@Lac | 128 | 58 | 61,387 | +1,372 m | 24 / 23 | 52,535 |
| D-regret@Lac | 129 | 58 | 61,760 | +1,745 m | 24 / 24 | 52,896 |

- Data moves decisions ~5× more than any scoring model. **La** is the only layer with a visible own-layer gain, and it rests on a real OSM tag (VERIFIED data, UNVERIFIED physical meaning; bicycle 9, motorcycle 12, car 7 changed picks; car use is an assumption). **Lc** re-shuffles 40 picks and removes 18 offers for **no** gain on its own yardstick: its weights are hypotheses and must not ship. **Lb** never fires in the 298-case corpus (the ring ways are not on any corpus route), so it is evaluated only on the replicas.
- Holdout vs corridor: La changes 13/111 holdout picks and 4/54 corridor picks; Lac 11 and 20. The effect is not specific to the corridor (VERIFIED).
- Layers touch many candidates (La changes a pooled candidate's numbers in 215/298 cases, Lc in 233) but little of the *selected* route (mean |Δ risk| on the production pick: La 34 m, Lc 77 m).

### 3.3 Model E: Pareto sets and what the user would see (`E/pareto-summary.json`)

| Metric (298 cases) | Value |
|---|---|
| Production pick on the Pareto set | 298/298 on 3 objectives (time, weighted stone, unknown), on 6 (time, confirmed, probable, unknown, maneuvers, U-turns) and on 7 (+ tram-adjacent metres) |
| Mean pool / distinct pool / Pareto size | 4.27 / 4.26 / 3.03 (6 objectives), 2.41 (3 objectives) |
| Distinct Pareto routes (6 obj.) 1 / 2 / 3 / 4+ | 32 / 75 / 93 / 98 cases |
| Cases hiding ≥ 1 distinct Pareto route (app shows ≤ 2) | 191 (64 %); the 6-objective set is inflated because maneuver and U-turn counts rarely dominate |
| Pareto set contains a U-turn route | 72 cases (24 %); production picks with a U-turn 37 (12.4 %), of which 23 are the provider's own fastest route |

What E would show: the fastest route, the least stone, the least unknown and the simplest route as separate, labelled options; today's two cards hide one or two of them in most cases. This is a UX decision, not a measured improvement (PLAUSIBLE).

**Rails (separate dimension)**: on the 298 shown routes 799.5 km of 1,311.9 km (61 %) lie outside the only area with railway ways in the archive (unknown), 450.6 km are inside it with no tram, 52.8 km next to a mapped tram way, 8.9 km carry a tram tag. Offered alternatives have 40.5 km less tram-adjacent road than their fastest routes (−279 m per offered alternative): in the covered centre, stone streets and tram streets coincide, so anti-pavé alternatives avoid rails **incidentally** (correlation; PLAUSIBLE). For both replicas rails are 100 % unknown, so no model can say anything about Corso Lodi / Piazzale Lodi rails without new data (VERIFIED absence; rails ≠ roughness).

### 3.4 Stability (90 start/end-shifted pairs, `E/stability.json`)

A flips the "alternative offered" decision in 11 pairs (12.2 %); B 11, C-global 11, C-zoned 10, D-regret 11, D-maximin 12; layers 11–14. Mean |Δ stone saved| between a journey and its twin 57 m (max 813 m) for every model. Scoring does not change stability; the **pool** does (a few metres of shift changes which penalised or via candidates exist). Departure minute only affects ZTL checks and was not varied.

## 4. Unknown-surface penalty: calibration and regressions

**Inventory** (`E/calibration.json`): on the 298 shown routes unknown = 99.0 km (7.5 %): **71.3 km (72 %) is "no matching segment"**, concentrated in a few coverage-edge journeys (Lorenteggio → Lambrate car 10.4 km, Bovisa → Rogoredo 8.4 km, Baggio → San Siro 7.0 km), 26.3 km is untagged ways (16.0 km residential, 6.6 km unclassified, 3.2 km cycleways, 1.5 km service), 1.4 km other values. Unknown is a tail phenomenon: median 0.6 %, p90 11.2 % of a route.

**Prior (proxy, `E/base-rates.json`)**: expected weighted rough metres per unknown metre = P(confirmed stone | tagged) + 0.65 P(probable). Pooled over untagged metres: 5.8 % outer, 20.5 % in the pilot-box core, 7.8 % overall; residential 2.8 % outer vs 22.8 % core; unclassified 0.4 %; service 9.1 %. By sector the residential confirmed-stone share of tagged ways runs from 0.3 % to 5.5 % (citywide sectors) and 10–29 % (pilot sectors): a citywide constant is a poor description. Missingness is not shown to be random (UNVERIFIED) and Phase 4.17 found context cannot predict a single way's surface (NO-GO); the prior is only a population base rate.

**Calibration method = break-even stone share p\***: for every eligible, distinct alternative that saves ≥ the minimum stone and adds unknown metres, p\* = weighted stone saved / unknown metres added. The alternative beats the fastest route in expectation iff the true rough share of the added unknown is below p\*.

| Group | n | p\* p10 / median / p90 | below outer prior (5.8 %) | below core prior (20.5 %) | mean saved / added m |
|---|---:|---|---:|---:|---|
| **Offered by production** | 52 | 1.30 / 8.7 / 493 | 0 | 0 | 436 / 78 |
| Rejected by production | 100 | 0.05 / 1.9 / 48.7 | 12 | 18 | 221 / 2,222 |

- Every alternative production offers needs ≥ 71 % of its added unknown metres to be stone to be no better than the fastest route (lowest p\*: Corso Magenta → Cordusio 0.71, Sant'Agostino → Colonne 0.89). **No offered alternative is endangered by any plausible prior.**
- Production's burden (0.35–1.0 stone-metre per added unknown metre, `route-optimization.ts:104-118`) is equivalent to assuming 35–100 % of added unknown is rough: 6–17× the outer prior and 1.7–4.9× the core prior.

**Where scaling the penalty changes decisions** (`E/decision-flips.json`):

| Variant | changed picks | what happens |
|---|---:|---|
| unknown burden × 0 | 8 | +7 offers; 4 trades with p* 0.44–1.22 (Gae Aulenti → Porta Romana bicycle −300 m for +681 m, Sant'Agostino → Colonne car and bicycle, Città Studi → Duomo car); Colonne → Porta Genova car (−140 m, p* 1.05, but adds a U-turn); 2 poor swaps (−10 m / −19 m for +130 / +210 m); **Lorenteggio → Lambrate car −277 m for +26,383 m unknown (p* 1 %)**; net unknown on offered routes +17.0 km instead of −10.8 km |
| × 0.25 / × 0.5 | 6 / 4 | +5 / +3 offers, +1.2 / +1.0 km net unknown |
| × 2 | 6 | loses 4 offers (Corso Magenta → Cordusio motorcycle and bicycle, Colonne → Porta Genova and Sant'Agostino → Colonne motorcycle) and swaps 2 (Duomo → Isola bicycle to a U-turn detour, Lorenteggio → Lambrate bicycle: +174 m); stone avoided −0.7 km |
| × 4 | 11 | loses 7 offers in total, adding Rogoredo → Porta Romana bicycle (−902 m stone for +638 m unknown), Abbiategrasso → Colonne bicycle (−295 m), Via Torino → Sant'Ambrogio bicycle; 4 swaps (one +316 m); −2.3 km (−3.4 %) |
| C-global (expected value) | 7 | accepts 4 trades + 1 better; regressions: Castello → Porta Venezia bicycle (+130 m unknown for −10 m), Colonne → Porta Genova car (new U-turn); still rejects the +26 km case |
| C-zoned | 3 | accepts Gae Aulenti → Porta Romana, Città Studi → Duomo; regression: Castello → Porta Venezia |
| prior scale ×4 / ×8 (C) | 4 / 5 | converges back to A; ×8 has 4 worse picks |
| D regret / maximin | 4 / 5 | regret: 2 trades, 2 worse (Castello → Porta Venezia; Bovisa → Castello bicycle −19 m for +76 s); maximin: 5 worse (it drops alternatives that win under p ≤ 0.3) |

**Verdict.** (1) A penalty is justified for **large** additions of unknown (tail risk, e.g. +26 km for −277 m): any rule with expected rough metres = p × added unknown and p ≥ 3 % rejects it. (2) The present per-metre burden over-charges **small** additions (< ~700 m) that are good under any prior ≤ 44 %; scaling it up (×2–×4) loses 6–11 alternatives and up to 3.4 % of avoided stone with no evidence of benefit; scaling it down to 0 admits the +26 km failure. (3) The break-even is robust, the prior is not: core and outer differ 3.5×, and every p\* above is a **[proxy]** comparison. (4) Evidence is **insufficient to ship a change**: a capped expected-value rule (C with prior × 2–4, plus a hard cap on added unknown metres) should run as a silent shadow ranking first. (5) The caveat that the app shows "zero pavé noto non significa fondo liscio" stays valid; none of this treats unknown as smooth.

## 5. Sensitivity tables (baseline data, 298 cases; `E/sensitivity.json`)

Stone/time exchange: production strong = 1.2 s per metre of confirmed stone (car; 1.82 motorcycle, 2.31 bicycle); k = multiplier.

| k (car s/m) | offered | avoided m | +min | ΔUnk m | excessive | changed vs A | CORRIDOR avoided m / +min | HOLDOUT avoided m / +min |
|---|---:|---:|---:|---:|---:|---:|---|---|
| 0.1 (0.12) | 64 | 36,522 | 54.5 | −945 | 5 | 91 | 13,918 / 22.0 | 9,539 / 14.4 |
| 0.25 (0.30) | 100 | 55,551 | 144.3 | −6,457 | 13 | 53 | 22,229 / 61.5 | 15,456 / 43.7 |
| 0.5 (0.60) | 131 | 63,537 | 216.4 | −6,781 | 19 | 20 | 24,766 / 84.3 | 17,129 / 57.5 |
| **1 (1.2)** | 145 | 66,885 | 275.5 | −10,785 | 29 | 0 | 26,347 / 107.3 | 18,157 / 79.3 |
| 2 (2.4) | 155 | 67,860 | 303.3 | −10,693 | 34 | 12 | 26,515 / 111.5 | 18,493 / 90.9 |
| 4 (4.8) | 159 | 68,062 | 316.8 | −10,753 | 34 | 18 | 26,515 / 111.5 | 18,535 / 94.0 |
| 10 (12) | 164 | 68,353 | 359.8 | −10,650 | 40 | 26 | 26,606 / 123.8 | 18,563 / 98.6 |

Marginal return: 0.5 → 1: +3.3 km of stone for +59 min (57 m/min); 1 → 2: +975 m for +28 min (35 m/min); 2 → 10: +493 m for +57 min (9 m/min). **The production rate sits at the knee**; raising it buys little stone and adds 11 excessive detours; halving it loses 5 % of avoided stone. In the corridor group the curve is flat above k = 1 (VERIFIED).

| Avoidance level (car s/m) | offered | avoided m | +min | excessive |
|---|---:|---:|---:|---:|
| balanced (0.12) | 64 | 36,522 | 54.5 | 5 |
| **strong** (1.2) | 145 | 66,885 | 275.5 | 29 |
| maximum (time ignored in limit) | 164 | 68,343 | 361.7 | 40 |

| Unknown burden scale (A) | offered | avoided m | ΔUnk m | changed | | Prior scale (C-global) | offered | avoided m | ΔUnk m | changed |
|---|---:|---:|---:|---:|---|---|---:|---:|---:|---:|
| 0 | 152 | 67,852 | +17,028 | 8 | | 0 | 152 | 67,852 | +17,028 | 8 |
| 0.25 | 150 | 67,556 | −9,565 | 6 | | 0.5–2 | 151 | 67,566 | −9,836 | 7 |
| 0.5 | 148 | 67,402 | −9,785 | 4 | | 4 | 148 | 67,272 | −10,190 | 4 |
| **1** | 145 | 66,885 | −10,785 | 0 | | 8 | 144 | 66,430 | −11,843 | 5 |
| 2 | 141 | 66,212 | −11,864 | 6 | | zoned ×1 / ×2 / ×4 | 147 / 144 / 146 | 67,262 / 66,613 / 65,922 | −9,919 / −11,287 / −13,158 | 3 / 2 / 13 |
| 4 | 138 | 64,582 | −13,007 | 11 | | zoned ×8 | 143 | 64,402 | −13,921 | 21 |

D scenario sets (regret / maximin, offered, avoided m): {0}: 155 / 155, 68,017; {0, .1}: 154, 67,740; {0, .1, .3}: 153 / 148; {0, .1, .3, .5}: 148 / 144; {.3, .5}: 145 / 144; {.5}: 144 / 144. Only the degenerate set {0} (no uncertainty) admits the +17 km unknown case (net ΔUnk +17.1 km); every set containing p ≥ 0.1 keeps it out.

## 6. Candidate generation (cell 5 and variants)

### 6.1 Root-cause frequency in the corpus (exact, offline; `E/generation-triggers.json`)

| Condition (297 cases with flags) | cases | Reading |
|---|---:|---|
| Penalised search ran | 188 | of which 45 ended "no better route" |
| **Skipped by the cheap-improvement early stop** | 36 (12 %) | 33 keep ≥ 20 m weighted stone on the shown route, 32 keep ≥ 50 m |
| **Skipped because every stone slice < 25 m** (R2 class) | 6 (2 %) | slices 16.5–19.7 m; minimum 20 would target **0** of them, 15 targets all 6 |
| Nothing to avoid | 67 | |

The 24.99 m return case is not in the corpus; the hazard is the knife-edge (a 0.01 m rounding decides whether a search exists), not corpus frequency. Minimum 20 (the value `minimumPaveReduction` already uses for car) fixes the knife-edge for car; 15 (the warning threshold, `rough-sections.ts:30`) also covers the six corpus cases.

### 6.2 Patches (in memory; `E/patches.diff`): variants G0–G6

G0 production; G1 slice minimum 20 (`route.ts:688`, `:724`); G2 slice minimum 15; G3 early stop removed (`:653`); G4 early stop only if the improvement leaves < `minimumPaveReduction` weighted stone; G5 = G2 + G4; G6 = G5 + refinement while stone remains (both gates, `:716-717` and `:798-799`). P0 only exposes the pool. Anchors match once; navigation gating untouched.

### 6.3 Live replicas, public junctions only (`E/variants-results.json`, `E/replicas.json`)

Return-like replica: Via Lazzaro Papi north junction → Alzaia Naviglio Pavese junction with a SE heading hint on the first location (the real plan started on the one-way street; the bare junction is ambiguous). Outbound-like replica: the reverse. Both are **replicas**, not the drivers' plans (graph rebuilt after the drive).

| Return replica | requests | pool (s / m stone) | shown route | note |
|---|---:|---|---|---|
| **G0 production** | 4 (base + 3 vias) | base-1 595/25, base-2 628/197, base-3 682/286, detour-2 706/50, detour-1 985/56 (1 U-turn), detour-3 996/746 | base-1, 25 m, "no better route" | reproduces Agent 1's reconstruction: the three geometric detours never yield the shortcut |
| G1 / G2 (slice 20 / 15) | 5 (+1 penalised) | + **surface-aware 574 s, 0 m, 3,076 m** | shortcut, status `fastest-avoids-pave` | −21 s and −242 m vs the plan; the 3 vias are still issued (the 25 m gain is < `improvesEnough`) |
| G3 / G4 (early stop only) | 4 | = G0 | base-1 | early stop is not the blocker here |
| G5 / G6 | 5 | = G1 | shortcut | |

| Outbound replica | requests | pool (s / m stone) | shown route |
|---|---:|---|---|
| **G0 production** | 2 | base-1 544/280, surface-aware 631/50, base-2 700/265 + 138 unknown | 631 s, **50 m** (Piazzale Lodi ring 25 m + Via Lazzaro Papi 25 m) |
| G1 / G2 / G5 | 2 (the penalised body differs, same count) | = G0 | 50 m route (the penalised answer is the same route) |
| **G6** | 3 | + **surface-aware-2 723 s, 0 m, 3,813 m** | 50 m route at strong; the 0 m route is available |

No-heading return replica (Agent 1's): G4/G5 add 1 request and return the same three routes (VERIFIED: no better route reachable there). Probe `shortest` (quasi-shortest metric, 1 request each): return replica 593 s / 2,984 m with **259 m** of stone (does not find the shortcut), outbound identical to the fastest route → **not a substitute** for the penalised search (n = 2, STRONGLY SUPPORTED).

### 6.4 Early-stop variant G4 on the corpus: deterministic live sample (`E/earlystop-sample.json`)

27 corpus cases were early-stopped with ≥ 50 m weighted stone left; the first 6 by `sha256("earlystop:"+id)` were run live: **12 new requests (mean 2.0, max 5)**; 3 of 6 improved, 3 unchanged.

| Case | production → variant | requests |
|---|---|---:|
| Repubblica → Sant'Ambrogio motorcycle | 599 → 377 m stone, +97 s | 1 |
| Duomo → Isola motorcycle | 769 → 520 m confirmed, risk −50, **−65 s** (penalised route is also the fastest) | 5 |
| San Siro → Città Studi bicycle | risk −44, unknown −201 m, +1 s | 1 |
| Corso Magenta → Porta Venezia motorcycle, De Angeli → San Babila motorcycle, Cenacolo → Missori bicycle | unchanged | 2, 1, 2 |

n = 6 supports mechanism, not a rate (PLAUSIBLE). Cost: +0.25 provider calls per corpus case (12 % × 2.0), 1.05 s pacing per call; navigation keeps its 5.5 s budget and its own gate.

### 6.5 Expanded pool from the archive (matrix cell 5; `E/union-summary.json`)

Union of every archived provider route per journey and mode (penalised searches of all older generator versions, via detours, refinements), de-duplicated and legality-filtered with production code. 274 cases; 138 have ≥ 1 archived request production did not use (**+262 requests = +30 % calls**; 171 penalised, 91 via); pool 4.82 vs 4.26 candidates.

| Ranking on the union pool | changed picks | less stone ≥ 20 m (cases / m) | more stone ≥ 20 m (cases / m) | extra s on changed | ΔUnk m |
|---|---:|---|---|---:|---:|
| A | 15 (5.5 %) | 11 / 1,700 (+2.5 % of 66.9 km) | 1 / 79 (corridor) | +523 | −698 |
| B | 22 | 11 / 1,599 | 6 / 664 | −250 | −622 |
| C-global | 19 | 14 / 2,181 | 0 / 0 | +688 | +569 |
| D regret | 16 | 12 / 1,767 | 0 / 0 | +577 | −565 |
| A + reject U-turn routes | 27 | 10 / 1,592 | 14 / 8,035 | −1,692 | −917 |

CORRIDOR: A changes 4 (2 better −215 m, 1 worse +79 m); HOLDOUT: 5 (4 better −469 m). Upper bound for *archived* variants, not for slice-targeted ones; the yield is small relative to the extra requests (STRONGLY SUPPORTED).

### 6.6 U-turns (`E/uturn-analysis.json`, `E/via-analysis.json`)

- 14.2 % of pooled candidates (181/1,271) contain a Valhalla U-turn instruction: base/alternates 8.5 %, penalised 18.2 %, via detours 26.1 %. In 740 archived via responses 30.7 % contain one, 21.2 % within 120 m of the via point.
- 37 of 298 production picks (12.4 %) contain one: 23 are the provider's own fastest route (not created by Lastrico's generators), 14 are alternatives; of the 38 U-turn instructions 24 are mid-route, 14 within the first 3 % or last 150 m, 1 on an unnamed street.
- Via points are off-graph: median 36.6 m from the nearest intersection node, 62 % farther than 12 m from any way. Via within 15 m of an intersection: 11.1 % U-turn near the via vs 22.8 % otherwise; the naive "two-way street" rule points the other way (41.9 % vs 6.9 %; observational, confounded). Intersection snapping is supported; "prefer two-way" is not.
- Reject every U-turn candidate: 14 changed picks, −8.1 km avoided stone (−12 %), −40 min: too expensive and unjustified (many are legitimate). **Penalising 60 s or 180 s per U-turn: 3 changed picks, −0.3 km** (VERIFIED). The user's questionable U-turn is UNVERIFIED; the only generated U-turn in the replicas is detour-1 of the return replica.

### 6.7 Intervention ledger

| Intervention | What changed | Data / pool | Improved | Worsened | Generalises? | Evidence |
|---|---|---|---|---|---|---|
| Slice minimum 20 / 15 | search runs for 20–25 m (15–25 m) slices | return replica live; 6 corpus cases | shortcut found with 1 request; 6 knife-edge cases covered | +1 request where it fires (0 on the outbound replica, same route) | rare in corpus (2 %), fixes a silent failure | sufficient for the mechanism |
| Stop-when-clean early stop | search continues unless the improvement leaves < 20 m | 6 live corpus cases | 3/6 less stone or unknown | 12 requests, 3 wasted | 12 % of cases are eligible | insufficient for a rate |
| Refinement while stone left | refine until < 20 m | outbound replica | 0 m route generated | +1 request, +179 s if chosen | one case | mechanism only |
| `shortest` probe | extra quasi-shortest route | 2 replicas | none | +1 request each | – | enough to reject |
| Graph-aligned vias | snap via to an intersection | 740 archived vias (observational) | U-turn near via 22.8 % → 11.1 % | not tested as intervention | corpus-wide | PLAUSIBLE |
| Penalise U-turn 60 s | utility term | 298 pools | 3 picks change, −0.3 km | – | all modes | sufficient (low risk) |
| Reject U-turn | filter | 298 + union | – | −8.1 km stone | – | enough to reject |
| B, C, D, E scoring | see 3.1, 4 | 298 pools | 1–5 picks better | 1–7 worse each | holdout 0–4 changes | insufficient / no ground truth |
| La / Lc / Lac data | see 3.2 | 298 pools | La +3.7 % own-layer | Lc none | holdout yes | La only, as shadow |

## 7. Counterfactuals

**Return trip (real plan: pool = {route 0}; Agent 1 / `E/return-plan-crosscheck.json`).** Adding the counterfactual shortcut-first route (route 0 up to the Via Friuli crossing, then the route the driver followed after the reroute; extra time assumed): A, B, C-global, C-zoned, D-regret, D-maximin all choose it for +22, +40, +60 s over the provider's route-1 time; at +90 s all keep route 0 (A@Lb still chooses it up to +120 s; at +180 s everyone keeps route 0). A@L0 break-even = the shortcut may be ≤ 30 s slower than route 0 (82.8 s if the ring is sett). Both routes carry the identical 285 m unknown; under the prior it holds 2–3 m of expected stone (`unclassified` ≈ 0.4 %), so uncertainty-aware ranking is indifferent. **Would the shortcut have been generated?** Not by production (VERIFIED, Agent 1: 24.99 m < 25 m; early stop irrelevant). Under slice 20 or 15: yes on the replica (G1/G2). **Chosen?** Yes at every avoidance level once generated (replica: faster by 21 s and 0 m).

**Outbound replica.** All of A@L0, B, C-global, C-zoned, D-regret, D-maximin pick the 50 m route at strong, also under Lb (the 50 m route uses only the ring's first way). 0 m route: generated only by G6; chosen by A at "Massimo", at k ≥ 1.53 (1.84 s/m; grid: 1.5 keeps the 50 m route, 1.75 picks the 0 m route), never at "balanced"; chosen at strong under Lac (50 m route weighted 194 vs 56 for the 0 m route, hypothesised smoothness and plate weights, **[counterfactual]**). The 0 m route costs +92 s and +415 m over the 50 m route, +179 s over the fastest.

## 8. Regressions found (counts and causes; `E/scoring-regressions.json`)

| Cell | worse (L0 / own) | causes |
|---|---|---|
| B@L0 | 7 / 7 | 5 × paving-only alternatives dropped (Cadorna → Cinque Giornate +170 m, Bocconi → Brera +100 m, De Angeli → San Babila +173 m, Maciachini → Moscova +120 m, San Siro → Forlanini +99 m: each 100–270 s faster); Castello → Porta Venezia (+130 m unknown for −10 m); Duomo → Isola bicycle (new U-turn) |
| C-global@L0 | 2 / 2 | Castello → Porta Venezia bicycle (+130 m unknown); Colonne → Porta Genova car (new U-turn) |
| C-zoned@L0 | 1 / 1 | Castello → Porta Venezia |
| D-regret@L0 | 2 / 2 | Castello → Porta Venezia; Bovisa → Castello bicycle (−19 m for +76 s) |
| D-maximin@L0 | 5 / 5 | drops alternatives good for p ≤ 0.3; new U-turn at Duomo → Isola |
| A@La / Lc / Lac | 16 / 6, 33 / 19, 47 / 23 | production-yardstick "worse" is expected (the data redefined stone); own-layer worse picks are mostly faster routes that give up 20–150 m |
| Union pool, A | 1 (+79 m, corridor) | a new via candidate wins on time |
| Union pool, reject U-turn | 14 (+8,035 m) | legitimate U-turn routes lost |
| Unknown burden × 0 | 3 worse + the +26 km trade | removes the tail protection |

## 9. Recommended strategy

**Scoring (keep production; shadow-test two additions).**
1. Keep model A, strong level, the 1.2 s/m exchange rate (knee), the 20 m minimum and the confirmed-stone guard. Do **not** raise the unknown burden.
2. Shadow-rank with C (expected value, prior × 2–4, zoned prior, hard cap on added unknown metres, e.g. 500 m or 10 % of the route unless p\* > 0.5) and log disagreements; ship only if disagreements keep winning on field feedback. Treat 0 stone as "no known stone", never smooth (unchanged).
3. Add a 60 s utility penalty per U-turn maneuver; never reject outright.
4. Data: honour `surface_bike=milanese_paving` on asphalt (La) behind a shadow flag first (largest own-layer gain, a real tag); keep `smoothness` weights and `concrete:plates` (Lc) out until a field roughness trial exists; carry rails as a separate "unknown / mapped adjacent" attribute, never as stone.
5. UX: expose Pareto options (fastest / least stone / least unknown / simplest) only after a design decision; 64 % of cases hide a distinct Pareto route today.

**Candidate generation (change).**
1. Penalised-search slice minimum 25 → `minimumPaveReduction` (20 car, 15 moto, 12 bicycle), cap 15 m; `route.ts:688` and `:724`.
2. Early stop only when the improvement leaves less than `minimumPaveReduction` of weighted stone; keep the navigation gate. Expect +0.25 calls/case (+1 call for 12 % of cases, up to 5).
3. After a penalised route with 0 weighted stone, skip the three geometric vias (saved 3 of 5 requests on the return replica).
4. Replace geometric via points by points snapped to an intersection node of the provider graph; no `shortest` probe; record `tileset_last_modified`, candidate list and verdicts in the trace (Agent 1 R11).
5. Reassess the refinement gate (`:716-717`, `:798-799`) with the outbound result: it hides a 0 m route that costs +92 s; with strong it is only chosen at ≥ 1.84 s/m, so this is a product choice (offer it explicitly as "Massimo"), not a bug fix.

## 10. Limitations (read before quoting a number)

- No ground truth: every stone figure is an OSM claim; "improvement" means lower predicted exposure. The driver's Piazzale Lodi observation is **[user]**; Lb is a counterfactual, not a finding.
- Cells (2)–(4) rank the production-generated pool; layers' effect on generation is not simulated for the corpus. Cell (5) is an archive-based upper bound for old variants.
- Corpus is central-Milan weighted; CORRIDOR is defined broadly (Porta Romana / Naviglio Pavese), so only a few journeys touch Piazzale Lodi; one provider graph (FOSSGIS, archived 7–8 Nov; live replies 14 Nov from a newer graph, tileset 2026-11-14T03:50Z).
- Replicas use public junctions; the return replica needs a heading hint to emulate the one-way start; the real outbound plan is unknown.
- The prior is a proxy: tagged-only, MAR unproven, 3.5× core/outer spread; p\* comparisons inherit this. Lc weights (0.25 plates, smoothness factors) and B weights are explicit hypotheses.
- Classification ignores time when stone differs ≥ 20 m. Live samples are small (6 corpus cases, 2 replicas, 2 probes). 72 % of the unknown inventory is "no match" in coverage-edge journeys.
- Shared selection constants were copied from `MODE_POLICY`; drift would show as an A-vs-handler mismatch (0 today).
- **Pacing deviation**: 6 of the 21 live requests (log numbers 4, 11, 12, 17, 18, 19) started 0.13–0.36 s after the previous one, because each stub instance kept its own clock across cases; all returned HTTP 200, none 429. Fixed in `exp-harness.mjs` (module-level clock) after the live work; no further live requests were made.
- Rails: tram ways exist in the archive only inside the pilot box; no conclusion about Corso Lodi / Via Lazzaro Papi rails.

## 11. Requests and cost

| | |
|---|---|
| New Valhalla requests spent | **21 of 25** (valhalla1.openstreetmap.de, UTC 2026-11-14 14:47–18:42, status 200 ×21, 72–431 ms): return replica 4 (3 vias + 1 penalised), outbound 2, `shortest` probes 2, no-heading replica 1, early-stop sample 12; log `E/live-request-log.json` (labels, bodies summarised, no coordinates) |
| Coordinates sent | only public junctions (Via Lazzaro Papi north, Alzaia Naviglio Pavese) and fixture landmarks; nothing derived from the trace |
| Production calls per case | mean 3.09, p90 6, max 7 (pacing ≥ 1.05 s each: ≈ 3.2 s typical, 7.4 s worst, inside the 18 s planner budget); Workers Free 50 subrequests not exhausted by provider calls alone (tile fetches not measured) |
| Variant calls | slice minimum: +1 when it fires (2 % of cases); early stop: +2.0 avg when it fires (12 %); refinement: +1; U-turn rules and scoring models: 0 |

## 12. Reproduction (repo root, Node 26, no installs; `data/archive/` extracted per Agent 1; `data/exp-live-cache/` holds the 21 live responses and is git-ignored because maneuvers name the origin street)

```
S=experiments/phase436-surface-intelligence/scripts; TRACE="C:/Users/domenico.campanella/Downloads/lastrico-gps-trace-2026-11-13-18-26.json"
node $S/exp-waytags.mjs; node $S/exp-archive-index.mjs
node $S/exp-run-baseline.mjs; node $S/exp-run-field.mjs; node $S/exp-split.mjs          # cell 1 + corpus + fixed split
node $S/exp-validate-features.mjs; node $S/exp-run-scoring.mjs                          # cells 2-4, sensitivity, stability, Pareto
node $S/exp-run-calibration.mjs; node $S/exp-run-union.mjs; node $S/exp-run-via.mjs     # unknown, U-turn, triggers, cell 5, vias
node $S/exp-live-variants.mjs --cases=returnh,outbound,return    # add --live only with budget left (offline replay from cache)
node $S/exp-live-probes.mjs; node $S/exp-live-earlystop.mjs --n=6; node $S/exp-run-replicas.mjs
node $S/exp-crosscheck-return-plan.mjs "$TRACE"; node $S/exp-write-patches.mjs; node $S/exp-hashes.mjs
```

Key SHA-256 (LF-normalised; `E/key-hashes.json`): split `d7f14968a11ac73a05f36a8617fc192030bc26da6257e76851ffc3671e47556b`; scoring-summary `4e86e20f28675533176b212790676b04ca77caaa6f279316a1feee9ba224040d`; scoring-cases.csv `66c8e5d5728b76b2a6a19041502debcaf8dd2a32ed2f880a262903278aa0414c`; sensitivity `7659795777c4abd7b4042e40bdcee531300bfce48563ffb62cd2319fa86d7065`; calibration `1ff172be3c7d6bd2fb7fad9aab44582e1395ed24531ace92c5d0619c9caec106`; union-summary `a184417becb3e3032e3c4211a61f6c512b427565de2dbc3c69fecd354ca87840`; replicas `1eeb169371286bd636e030b46c44339a15500fb5170f4b034b5dcca0e589825c`; patches.diff `63386ba86bed6aa420f22bf6a426bf900f8e474774ad5008a74b0c73f32662b1`. Two full reruns of the scoring chain produced identical hashes.

Files: `E/{baseline-reproduction,feature-validation,split,scoring-summary,scoring-regressions,decision-flips,sensitivity,pareto-summary,stability,exposure-inventory,calibration,uturn-analysis,generation-triggers,union-summary,via-analysis,replicas,return-plan-crosscheck,variants-results,earlystop-sample,field-set,base-rates,key-hashes}.json`, `E/{scoring-cases,union-cases}.csv`, `E/patches.diff`, `E/live-request-log.json`.

## 13. To reconcile with other workstreams

- Agent 1: confirms R1–R3 and R4 (geometric detours produced a U-turn route, a 985 s route and a 746 m-stone route, never the shortcut); adds that the cheap-stop is not the blocker for the real return plan and that 3 of 5 requests are avoidable after a clean penalised route.
- Agent 2: La corresponds to D4 (370 ways, 19.0 km): worth a shadow flag; D5/D6 weights (Lc) are not evidenced; Lb needs street-level imagery before any ring-way tag change.
- Agent 3 / data: rails and ring surface need an external source (rails unobservable at Piazzale Lodi in the archive); expected-value rules get better with a verified surface layer, not with a better prior.
- Principal agent: the unknown-penalty decision is a product choice (shadow first); no production change is recommended on scoring weights; candidate-generation changes 1–3 are small and testable with the existing `phase431` gate tests plus a 24.99 m fixture.
