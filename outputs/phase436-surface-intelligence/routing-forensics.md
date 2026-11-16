# Phase 4.36 — Routing forensics (Agent 1)

Scope: read-only investigation of why Lastrico planned the return trip through Viale Umbria and the Piazzale Lodi roundabout, how the reroute behaved, and
what the engine can say about an outbound-like corridor. Baseline `main` at `3e31da9` (Phase 4.35), assumed identical to the deployed code (UNVERIFIED).
Nothing in `lib/ app/ worker/ components/ data/ tests/` was edited; no Git writes; no deploy.
Evidence labels: **VERIFIED** (seen in a file, response or run named here), **STRONGLY SUPPORTED**, **PLAUSIBLE**, **UNVERIFIED**.
Privacy: the origin and destination streets, the side streets next to the origin and their way/node ids are not named; only Via Friuli, Viale Umbria, Viale Isonzo,
Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Viale Filippetti, Porta Romana, Alzaia Naviglio Pavese appear. No coordinate of the trace was sent anywhere.

## 1. Verdict on the central question

Between fix 0 and the reroute the two plans differ only in the first ~0.3–0.4 km: **route 0** = origin street → Viale Umbria → Piazzale Lodi → Viale Isonzo;
**route 1** (the "Via Friuli shortcut") = origin street → right into Via Friuli → two short one-way residential side streets → Viale Isonzo.
From the Via Friuli crossing (65 m along route 0) route 0 had 4,638 m left and the shortcut ≈ 4,394 m: **≈ 244 m (5.3 %) shorter**, 0 m sett instead of 25 m,
and faster by the provider's own time (estimate −33 s; the landmark replica below measures −21.6 s for −242 m).

**The better candidate was ABSENT, not mis-ranked and not illegal.** Three facts chain together:

1. **Provider (VERIFIED live, plan-time graph STRONGLY SUPPORTED).** Valhalla optimises an internal *cost*, not the `time` it reports. From a start 200 m upstream on the same
   one-way street, the provider's best route is exactly route 0 (maneuvers 173 m / 68 m / 2,704 m, identical to the trace), although the shortcut is 242 m shorter
   and 21.6 s faster in reported time. Its two `alternates` went through Corso Lodi instead; neither is the shortcut.
2. **Lastrico's only generator that can leave the provider's cost optimum was switched off (VERIFIED).** The penalised anti-pavé search
   (`app/api/routes/route.ts:688`) targets only rough slices of at least 25 m. Route 0's single stone slice, Piazzale Lodi, measures **24.99 m** on the plan's own
   geometry, so `factors.length === 0` → `surfaceAwareNothingToTarget` (`route.ts:690`) → no request. With the production penalty (×15) on that same ring way the
   provider returns the shortcut (Section 5), 0 m sett, faster than the base route.
3. **If the shortcut had been in the pool it would have won at every avoidance level (VERIFIED, deterministic).** Reconstruction with the production handler: it
   becomes the fastest candidate and route 0 is "dominated"; even 5 s slower than route 0 it is selected as the anti-pavé alternative.

Hypotheses H1 (illegal manoeuvre), H2 (depart-edge/heading), H3 (ranking), H4 (provider/degraded mode) are **eliminated**; H5 (provider cost model) is **confirmed
as the mechanism for fact 1** (Section 4). Nothing in the engine's scoring, time budget or distinctness filter explains the miss.

## 2. Root-cause matrix

| # | Issue | Observed | Evidence | Code refs | Root cause | Label | Missing proof | Candidate fix (not implemented) |
|---|---|---|---|---|---|---|---|---|
| R1 | Plan took the roundabout route, not the shortcut | Route 0 4.703 km / 15.63 min / 25 m sett; reroute route 1 = shortcut 4.334 km / 14.71 min / 0 m | Sections 4–5; V1, V4, V5, V6, V7, replay `plan-reconstruct-*.json` | `routing-providers.ts:399-416`; `route.ts:528,688-690` | Candidate ABSENT: provider cost ≠ time (shortcut cost-worse, time-faster), alternates omit it, and the penalised search was skipped | VERIFIED (mechanism); plan-time graph STRONGLY SUPPORTED | The plan-time graph (rebuilt 2026-11-14 03:50Z, after the drive) and the plan's own candidate list were not recorded | Re-run the penalised search with a lower slice minimum (R2); add a time-optimal probe |
| R2 | Penalised search skipped on a 24.99 m stone slice | `antiPave.search.attempted=false`, status `no-better-route`, notice "nessuna deviazione migliora…" | `slice-check.json`: slices at min 25 = [], at min 24 = [24.99]; landmark route V1 also 0 slices at min 25 | `route.ts:688` (25 m) vs `route.ts:665-666` and `route-optimization.ts:127-131` (20 m); `lib/rough-sections.ts:30-31` warns from 15 m | Threshold mismatch: 20 m of stone is worth avoiding and 20 m triggers generation, but a slice must be ≥ 25 m to be targeted; the Piazzale Lodi way is 25.0 m by OSM, 24.99 m by vertex sum, so a hair under | VERIFIED | Whether the deployed build equals local `main` | Slice minimum ≤ `minimumPaveReduction` (e.g. 15 m, the warning threshold) |
| R3 | Early stop leaves a 0 m route ungenerated | Landmark replica: alternate 195 → 25 m of sett at +24 s ends the search; the 0 m shortcut exists (V4) | `live-results.json` handler-return; `live-engine-scores.json` | `route.ts:640-653,665` (`improvesCheaply` ≤ 90 s or 8 %) | "Good enough" rule from Phase 4.31 stops at any cheap improvement, not at the best reachable one | VERIFIED (replica, not the user's plan) | — | Stop only when the remaining stone is ~0 or the budget is spent |
| R4 | Detour candidates cannot reproduce a 220 m local shortcut | 3 planner detours; via points 234–994 m from the start and 234–707 m from route 0 | `plan-reconstruct-base-only.json` (via offsets 448/234/707 m from route 0) | `route.ts:746-771` (geometric offsets ±470 m, ×1.55; `through` type at `routing-providers.ts:403`) | Via points are geometric, not graph-aligned; they explore far corridors, not a 0.3 km local variant | STRONGLY SUPPORTED | Outcome of the 3 real detour requests (not stored in the trace) | Anchor detours on the graph or on the provider's own side streets |
| R5 | Reroute reacted 5 s after the turn | Divergence from fix 99, request at fix 104 (t = 94 s) | `reroute-replay.json` | `navigation-fix-processor.ts:88,554-582` | Binding rule: net travel since divergence ≥ 35 m (34.9 m at fix 103); the distance rule alone would have fired at fix 106 | VERIFIED | — | None needed (already 2 s faster than distance rule) |
| R6 | "shouldRecalculate at 104 but reroute-start at 105" | Event `atFix` 105 | `gps-trace.ts:484`, `page.tsx:2759,2832` | | Labelling: `recordFix` increments the counter before `recordEvent`, so `atFix` = fixes recorded, i.e. index + 1. Same handler call | VERIFIED | — | Document in the trace schema |
| R7 | Progress held at 63.9 m while offset grew | `pendingJump{63.9, confirmations 0}` fixes 102–105 | `reroute-replay.json` | `route-progress.ts:265-266,298-304` | By design: window match > max(45 m, 1.8×accuracy) → progress frozen at the anchor; offset still measured; the held state does not enter the wrong-turn rule | VERIFIED | — | None |
| R8 | Reroute outcome and HUD wording | `reroute-success safe:no-alternative`; status `no-pave` | `reroute-reconstruct-route1.json` (1 provider call, 0 weighted pavé) | `reroute-objective.ts:27-35` | `no-pave` falls to the last branch: "da qui nessuna alternativa con meno pavé" although the route has no known pavé | VERIFIED (logic) | Text actually shown (not recorded) | Add a `no-pave` branch |
| R9 | Questionable U-turn (outbound) | Not in this trace; no U-turn in any replica (13 provider routes, 2 handler runs) | `archive-scan.json`, `uturn-scan.json` | `routing-providers.ts:216,263`; no U-turn code elsewhere (grep) | Engine takes Valhalla's U-turn text/glyph verbatim and neither filters nor penalises it. Archived provider trips: 15.4 % contain one; **38 % of corridor via-waypoint detours** vs 2.5 % of corridor alternates; all 10 corridor trips with a U-turn on an unnamed street are via-waypoint detours | Mechanism class STRONGLY SUPPORTED; the user's event UNVERIFIED | The outbound plan, its candidate sources and the instruction text | Validate via points on the graph; reject or penalise `uturn` candidates |
| R10 | "Fastest" label can differ from the provider's own best | Replica: provider primary 595 s, its alternate 571 s becomes Lastrico's `fast` | `live-results.json` handler-return | `route.ts:820-823`; `route-optimization.ts:61-69` | Candidates sorted by reported `duration`; provider optimises cost | VERIFIED | — | Label wording only |
| R11 | Reproducibility | Provider graph changed after the drive | `/status`: tileset 2026-11-14T03:50:28Z | — | Lastrico stores neither graph version nor candidate list | VERIFIED | — | Log `tileset_last_modified` and `antiPave` summary in the trace |
| R12 | No heading/bearing to the provider | Locations carry lon/lat/type only; API has no heading parameter | `routing-providers.ts:399-404`; `page.tsx:2273-2289,2836-2846` | | On two-way streets a plan or reroute may start against the vehicle's direction; not the cause here (one-way street, one-way Via Friuli) | VERIFIED (absence); impact elsewhere PLAUSIBLE | A reroute on a two-way street in a trace | Optional `heading` pass-through |

## 3. Code paths read (summary, cited)

- **Provider calls.** `fetchEngineRoutes` (`routing-providers.ts:582-596`): Valhalla first (`auto`, `use_highways 0.7`, `use_tolls 0.2`, `alternates: 2` for the base call, lines 297-305,
  399-416), OSRM only if Valhalla returns nothing (595); so the detour calls can silently mix providers. Penalised and refined searches use `linear_cost_factors` (×15) on route-geometry slices.
  Route execution runs in a Durable Object (`worker/route-engine.ts`); it is not a candidate-generation component.
- **Candidate pipeline** (`route.ts`): base + alternates (528, pruned 535-546) → access-aware route only if the base crosses an unauthorised ZTL (605-621) → penalised search (665-736)
  → detours (745-791; 3 in planner, 1 in navigation) → planner-only refinement (793-812) → dedup (820) → legal filter → `selectOptimizedRoute` (829).
  The user's objective is **not** a server parameter: the server always returns both `fast` and `safe`; the client picks one (`reroute-objective.ts:17-24`, `page.tsx:2424-2428,2869`).
- **Selection** (`route-optimization.ts`): eligible = legal, not equivalent to the fastest, time ≤ fastest×factor+seconds (strong: ×1.42 + 420 s), extra minutes (default `null`, not binding).
  Utility = burden + Δseconds × secondsWeight, secondsWeight = 500/60 (balanced), 500/600 (strong), 0 (maximum) metres per second. At the default **strong level 1 s ≈ 0.83 m, i.e. 1 m of confirmed
  stone ≈ 1.2 s** (balanced 0.12 s, maximum: time ignored inside the limit). A candidate must also remove ≥ 20 m of weighted stone and not add > 10 m confirmed stone.
- **Distinctness** (`route-candidates.ts:167-191`): two routes are the same corridor unless more than max(60 m, 3 % of the shorter route) lies beyond 32 m of the other. The shortcut diverges ~300–400 m
  (> 134 m), so it is distinct (confirmed by the run); a micro-detour under ~134 m on a 4.4 km trip would be dropped as a duplicate (PLAUSIBLE risk).
- **Restrictions.** Lastrico checks only explicit access/ZTL/timed closure along the returned polyline (`road-intelligence-scoring.ts:50,456-490`, `route-optimization.ts:52-54`). **Turn restrictions
  and U-turn rules are left entirely to the provider**; the local extracts contain no relations (Agent 2 D1/D14, my `junction-osm-local.json`: 0 relations).
- **Maneuver mapping** (`routing-providers.ts:210-218,254-265`): Valhalla types 12/13 → `uturn`; the instruction text is Valhalla's own Italian string; types 22, 36, 37 (stay-straight, merges) all become `straight`.
- **Time budget** (`route-time-budget.ts`, `routing-providers.ts:82-83`): planner 18 s, navigation 5.5 s, car keeps a 1.5 s reserve; penalised search needs ≥ 4 s left (`route.ts:673`). Not binding
  in the trace: the reroute round trip was 1.0–2.0 s with one provider request.

## 4. Hypotheses for the return plan, tested one at a time

| H | Claim | Test | Result |
|---|---|---|---|
| H1 | The turn from the origin street into Via Friuli is illegal or unavailable | (a) Local OSM: both ways one-way in the compatible direction, plain crossing, no node tags, no access/barrier (`junction-osm-local.json`; Agent 2 `junction-via-friuli.md` agrees). (b) OSM API 2026-11-14 13:58Z: relations of the first Via Friuli way after the crossing (264363537) = **none**, so no turn restriction can name it. (c) Provider: V2 from a point upstream on the origin street (heading hint SE) to the lower end of Via Friuli returns a legal 0.379 km route that goes straight and turns right into Via Friuli | **ELIMINATED** (VERIFIED) |
| H2 | Depart-edge snapping or heading bias forced the first segment | Route 0's first vertex is on the one-way street, 32.5 m behind fix 0 (`decisions[0].progressMeters`); direction is forced by the one-way tag, but the crossing lies 65 m *downstream*, so the forced first edge does not prevent the right turn (V2). No heading is sent in the plan or in the reroute (R12). The reroute start was the fused GPS position (`page.tsx:2836-2846`), snapped by the provider onto one-way Via Friuli | **ELIMINATED** for this case (VERIFIED); no-heading risk elsewhere |
| H3 | The candidate existed but ranked lower | Production handler with a stub provider returning route 0 plus a Via-Friuli-first candidate (route 0 up to the crossing, then route 1; extra time assumed 22 s, varied 22–60 s): at +22 s the candidate is `fastest`, route 0 `dominated`, status `no-pave`; at +60 s (5 s slower than route 0) it is `selected` as anti-pavé, burden 0 vs 25. Break-even at strong level: 30 s (25 m × 1.2 s/m): `selection-sensitivity.json` shows route 0 kept only if the shortcut is ≥ 31 s slower, which the provider's numbers contradict | **ELIMINATED** (VERIFIED, deterministic) |
| H4 | Different provider or degraded mode | Both routes carry Valhalla-only strings (`type "roundabout exit"`, Valhalla Italian instructions, ids `N-turn-lon,lat`); OSRM text and types differ (`routing-providers.ts:473-511`). The penalised search was skipped by the 25 m rule, not by budget: reconstruction shows `attempted:false` with a 18 s planner budget | **ELIMINATED** (VERIFIED) |
| H5 | Provider cost model (turn costs, signals, factors) makes the shortcut cost-worse | V1 (alternates 2) = route 0; V5 (alternates 0, no factors) = same; V6 (×2) and V7 (×4 on the 25 m ring way) = same; **V4 (×15) = shortcut**, 242 m / 21.6 s shorter. So cost(shortcut) − cost(roundabout) is positive but below the ×15 penalty. With ring-edge cost ≈ 1.8 s (25 m at 50 km/h) that bounds it between ≈ 5 s and ≈ 25 s of cost while the *time* difference is −21.6 s: the shortcut carries roughly 27–47 s of non-time cost | **CONFIRMED** as mechanism (behaviour VERIFIED; magnitude PLAUSIBLE: it assumes cost ∝ time on the ring) |

Why the provider's `alternates` do not include the shortcut: it shares > 85 % of the primary route and differs by a short local variant; Valhalla alternates are meant to be materially different routes (PLAUSIBLE; V1's two alternates
are both Corso Lodi corridors).

## 5. Candidate evidence per case

### 5.1 Return plan (fix 0), reconstructed with the production handler

Stub provider returning route 0 as the only candidate (`routing-forensics-plan-reconstruct.mjs`): the handler reproduces the recorded numbers exactly — 4.703 km, 938 s, confirmed 25 m, unknown 285 m, rough
section Piazzale Lodi `sett` 391–416 m, coverage 93.9 % — which validates the local data, scorer and handler against the plan.

| Component | Route 0 (the plan) | Via-Friuli-first (counterfactual, +22 s assumption) |
|---|---|---|
| Provider time / length | 938 s / 4,703 m | 905 s / 4,460 m |
| Confirmed / probable / unknown stone | 25 / 0 / 285 m | 0 / 0 / 285 m |
| weighted pavé = risk | 25 | 0 |
| burden / utility (strong) | 25 / 25 | 0 / 0 |
| verdict | `fastest` alone; `dominated` when the shortcut is present | `fastest`; Pareto-dominates |
| anti-pavé status | `no-better-route` (search not attempted) | `no-pave` |
| Provider requests the planner issued (stub) | base, then 3 detour requests (`via` offsets 448 / 234 / 707 m from route 0); **no penalised request** | — |

Facts about the real plan: label `fast` and journey objective `safe` imply `hasDistinctAlternative = false` at plan time (`page.tsx:2424-2428` + `reroute-objective.ts:17-19`; VERIFIED by logic). The
planner took `canGenerate` (25 ≥ 20 m) but not the penalised search; the notice shown was "…nessuna deviazione migliora il compromesso…" (VERIFIED by reconstruction), which is
true of the candidates tried but hides that the targeted search never ran.

### 5.2 Landmark replica of the return decision (live, public junctions only)

Start = Via Lazzaro Papi north junction (9.207, 45.451), 200 m upstream on the same one-way street (heading hint SE); end = an Alzaia Naviglio Pavese junction (9.176, 45.444). Provider answers (engine
scores from `live-engine-scores.json`):

| Request | Result | km / min | Engine sett | Notes |
|---|---|---|---|---|
| V1 base, alternates 2 | primary = Viale Umbria → Piazzale Lodi → Viale Isonzo (173/68/2,704 m, identical to route 0); alternates through Corso Lodi / Via Lazzaro Papi and Corso Lodi / Viale Filippetti | 3.318 / 9.92; 3.055 / 10.47; 3.701 / 11.36 | 25; 197; 286+10 | no shortcut among alternates |
| V5 same, alternates 0 | same as V1 primary | 3.318 / 9.92 | 25 | control |
| V6, V7 (×2, ×4 on the 25 m ring way) | same as V1 primary | 3.318 / 9.92 | 25 | too weak to flip |
| **V4 (×15, the production factor)** | **origin street → right into Via Friuli → … → Viale Isonzo, one maneuver "Via Friuli 2,858 m"** | **3.076 / 9.56** | **0**, legal | −242 m, −21.6 s vs V1; the engine would call it `fastest-avoids-pave` |
| V3 from the upper Via Friuli junction | primary starts on a side street and again uses Viale Umbria and the roundabout; its alternates start on Via Friuli but turn onto Corso Lodi (stone) | 3.314 / 9.72 (alternates 11.24, 12.11) | 25 (alternates 400, 489) | none is the shortcut |
| V2 turn probe | legal, 0.379 km, right turn into Via Friuli | | 0 | H1 |
| Production handler (no heading), same pair | `hasDistinctAlternative`; `safe` = the roundabout route (25 m), `fast` = Corso Lodi / Via Lazzaro Papi stone route (195 m, 571 s); **search never ran** (`improvesCheaply`: −170 m for +24 s), so V4's 0 m route was not generated | | | R3 |

### 5.3 Reroute route 1

Starting on one-way Via Friuli below its last crossing, the shortcut is the natural continuation and the provider returns it as the primary. The reroute request in navigation mode issued a single provider call, found 0 weighted pavé
(`canGenerate` false) and ended with status `no-pave` (VERIFIED by reconstruction). It reflects the driver's actual road: 754 fixes ≤ 30 m accuracy stayed within 10.8 m of it.

## 6. Initial planning versus rerouting

| Item | Plan (fix 0) | Reroute (fix 104) |
|---|---|---|
| Start | geocoded / GPS point at plan time, snapped to the one-way street; first vertex 32.5 m behind fix 0 | fused GPS position, 60 m beside route 0, snapped by the provider onto Via Friuli |
| Heading to provider | none | none |
| Objective | no server parameter; client shows `safe` if a distinct alternative exists, else `fast` | `journeyObjective` = `safe` kept; request differs only by `navigation=1` |
| Budget | 18 s | 5.5 s (penalised search needs ≥ 4 s left) |
| Candidate set | base + 2 alternates, penalised search, ≤ 3 detours, refinement | base + 2 alternates, penalised search (if stone and time), 1 detour, no refinement |
| Acceptance | `improvesEnough`: ≥ 100 m and ≥ 25 % stone reduction (`route.ts:640-646`) | any reduction ≥ 20 m (`navigationRequest`) |
| Provider calls (reconstruction / trace) | base call + 3 detours; penalised search skipped | one base call, 1–2 s round trip |

The decisive difference is positional: after the turn the shortcut is the *only* continuation, so no candidate generator is needed.

## 7. Reroute behaviour in the trace (VERIFIED, instrumented replay of the production `processGpsFix`)

| t (s) / fix | Lateral offset | Course gap vs route | Event |
|---|---|---|---|
| 86.1 / 96 | 6.7 m | 38° | still on route |
| 87.1 / 97 | 8.1 m | 63° (≥ 55° ✓) | offset < max(18 m, accuracy) → no divergence yet |
| 89.0 / 99 | 21.6 m | 99° | divergence starts (device course) |
| 91.0 / 101 | 41.8 m | 96° | 3 fixes ✓; net 21.0 m of 35 m needed |
| 92.0 / 102 | 49.3 m | 106° | offset > 45 m → progress held at 63.9 m (`pendingJump`, 0 confirmations) |
| 93.0 / 103 | 55.4 m | 98° | net 34.9 m: **0.1 m short of 35 m** |
| 94.0 / 104 | 60.8 m | 94° | wrong-turn true (`shouldRecalculate`, speed 4.9 m/s, accuracy 6.5 m) |
| 95.0 / 105 | 65.5 m | 90° | request in flight (`calculating = 1`); new episode starts (second `off-route`) |
| 96.0 / 106 | — | — | `reroute-success`; route 1 active |

- The wrong-turn rule needs, with device course: ≥ 3 divergent fixes, ≥ 35 m net travel, net bearing ≥ 50° from the route, heading within 30° of the net direction, lateral ≥ max(25 m, 1.2×accuracy) and
  offset growth ≥ max(8 m, 0.4×net) (`navigation-fix-processor.ts:554-582`). The only binding condition was net travel; GPS quality was good (6.4–7.8 m). The distance rule
  (55 m + accuracy = 61.5 m, 2 readings) would have fired at fix 106, so the course rule gained ≈ 2 s.
- Request latency: `now` of fix 104 → 105 → 106 = +1.014 s / +2.014 s with `calculating` 1 then 0, so the client-to-Worker-to-Durable-Object-to-Valhalla round trip is 1.0–2.0 s.
- The car was ≈ 66 m into Via Friuli when route 1 arrived; the HUD's first instruction after the reroute is the left turn onto Alzaia Naviglio Pavese 2,796 m ahead, because Valhalla merges the
  Via Friuli → side streets → Viale Isonzo transitions into one "continue" maneuver (UNVERIFIED reason; the instruction list is VERIFIED).

## 8. Outbound journey (no GPS): proven versus hypothesis

**Proven:** nothing about the user's outbound plan; its origin, destination, instructions and candidate list were not recorded. **Hypothesis for exploration only:** the outbound was the reverse corridor.
A replica was run with public junctions: start Alzaia Naviglio Pavese junction (9.176, 45.444) → end Via Lazzaro Papi north junction (9.207, 45.451), planner mode, default "strong".

| Candidate | km / min | Engine confirmed sett | Where | Verdict |
|---|---|---|---|---|
| `fast` (provider primary) | 2.841 / 9.06 | 280 m | three stone clusters at the approach to Via Lazzaro Papi | fastest |
| **`safe` (penalised search, selected)** | 3.398 / 10.51 (+87 s, +16 %) | **50 m** | **Piazzale Lodi ring (25 m) + Via Lazzaro Papi (25 m)**, via Corso Lodi | `selected`, utility 122 |
| alternate | 3.537 / 11.67 | 265 m + 138 m unknown | Corso Lodi corridor | `dominated` |
| **probe: all stone slices of both candidates penalised (×15)** | **3.813 / 12.04 (+178 s, +33 %)** | **0 m** (production scorer) | Viale Isonzo → ring → Viale Umbria → north side → Via Lazzaro Papi | not generated by the planner |

- The engine's anti-pavé route in this replica goes **through Piazzale Lodi, Corso Lodi and Via Lazzaro Papi**, which matches the user's description. It is chosen because the data count only 50 m of stone on it (VERIFIED for the replica).
- A route with **no mapped stone** exists (Provider response V8) but the refinement that would have asked for it is skipped once the first penalised route halves the stone (`route.ts:716-733`). Even if generated, the selection rule prefers
  the 50 m route at "strong" (utility 122 vs 148) and picks the 0 m route only at "maximum" (`selection-sensitivity.json`). One stone metre is priced at 1.2 s at "strong"; the 0 m route costs 91 s more than the 50 m route for 50 m,
  i.e. 1.8 s per metre. Whether that exchange rate suits the user is a calibration question for the scoring experiment.
- The remaining 50 m are two slices at the 25 m boundary: Via Lazzaro Papi measures 25.0 m (targetable), Piazzale Lodi 24.99 m (not). The data count only the ring way tagged `sett` (Agent 2: 25.0 m of 252.7 m); the roundabout the user
  describes as physically stone is a data question, not a routing one. **Tram rails are not in the data at all** (Agent 2: 0 `railway` ways in the extracts), so neither routing nor scoring can see them (VERIFIED absence).
- **U-turn.** No replica produced one. The only evidence is archival (R9). In the Phase 4.25–4.31 archive (2,160 provider responses, 3,215 trips): trips with at least one U-turn maneuver — base alternates 9.3 %, penalised 14.0 %, via-waypoint
  detours **30.8 %** (30 % of those at the via point, 14 % in the last 150 m). In the 215 corridor trips (Piazzale Lodi / Corso Lodi / Viale Isonzo): 20 of 53 via-waypoint trips versus 3 of 118 alternates, and all 10 corridor trips with a U-turn on an
  unnamed street are via-waypoint trips. Ring way 713165261 (no `oneway` tag, Agent 2's lead) is **one-way in the provider graph** (V9: a route against the ring flow returns the full 241 m loop), so the provider does not
  create a U-turn there; the defect stays confined to Lastrico's compiled data.

## 9. Priority locations

| Location | Finding | Label |
|---|---|---|
| Piazzale Lodi | Stone slice 24.99 m by vertex sum (25.0 m by OSM way length): exactly the penalised-search minimum; roundabout cost-favoured by Valhalla over the Via Friuli shortcut | VERIFIED |
| Corso Lodi | Provider alternates and the "fast" replica use it; engine scores 195–490 m of sett on them (stone data present, rails absent) | VERIFIED |
| Via Lazzaro Papi | Two 20–25 m sett ways; endpoint of the outbound replica; a 25.0 m slice is targetable, a 24.99 m one is not | VERIFIED |
| Via Friuli | Legal, connected, one-way in the right direction; the zero-stone shortcut; absent from alternates; generated only by the penalised search | VERIFIED |
| Viale Filippetti / Porta Romana | Phase 4.31 already established the causes (reroutes did not search anti-pavé; the early-stop defect now bounded by `improvesCheaply`, `outputs/phase431-release-gate-anti-pave-report.md` §1–2). Not re-tested. The same early-stop class reappears here (R3) | cited, not re-run |

## 10. Candidate fixes for a later, separately authorised phase

1. Penalised-search slice minimum aligned with `minimumPaveReduction` (20 m) or the warning threshold (15 m): would have generated the shortcut at fix 0 (V4 with the production factor).
2. Replace the cheap-improvement stop by "stop when remaining stone is under the reduction threshold or the budget is spent"; or run the penalised search whenever stone remains and ≥ 4 s are left.
3. Add a time-optimal probe: the provider optimises cost, so candidates ranked by `time` should include a variant with reduced maneuver/intersection penalties or a graph-aligned local detour around the single stone edge.
4. Detour via points: snap to the provider graph (locate) before use; reject candidates with a `uturn` maneuver, or penalise them in `selectOptimizedRoute`.
5. Reroute: HUD wording for `no-pave`; optional heading pass-through; record the provider `tileset_last_modified`, `antiPave.status` and candidate verdicts in the trace.
6. Scoring experiment: calibrate the stone/time exchange rate (1 m ≈ 1.2 s at strong) and test thresholds around 25 m; treat unmapped rails as an unknown layer, not as smooth.

## 11. Reconciliation with Agent 2 (data audit) and the scoring experiment

- Agent 2: junction legality (agreed, extended to the provider graph and OSM API); 25.0 m ring way (my 24.99 m is the engine's vertex-sum metric; the threshold sits on the boundary, so slice measurement rounding
  matters); ring way 713165261 is two-way only in Lastrico's compiled data, one-way at the provider (V9); no relations in the extracts (my OSM API call covers the one Via Friuli way that matters).
- Scoring experiment: replay candidates with the "strong" weights above; test minimum-slice and early-stop variants against the four archived corridor pairs plus the two replicas; keep unknown-surface rules untouched.
- Open: rails (Agent 2 external verification); the user's outbound candidate list; whether production equals `main`.

## 12. Evidence index and exact commands

Network use (all logged in `evidence/routing-forensics/live-request-log.json`, UTC, host): **16 requests** of the 20 allowed — 12 Valhalla `/route` + 1 `/status` (valhalla1.openstreetmap.de, 2026-11-14 13:56–14:05Z,
≥ 1.15 s apart), 1 OSM API (relations of way 264363537) and 2 Overpass attempts that timed out after 25 s (overpass-api.de, overpass.private.coffee; the query held no coordinates). Only public OSM junction coordinates
were sent. `/status`: version 3.9.1-8064c73, **tileset_last_modified 1794628228 = 2026-11-14T03:50:28Z, after the drive**. Provider responses are cached in
`experiments/phase436-surface-intelligence/data/live-cache/` (git-ignored; maneuvers inside name the origin street, so do not publish that folder).

```
TRACE="<local path>/lastrico-gps-trace-2026-11-13-18-26.json"   # local only
S=experiments/phase436-surface-intelligence/scripts; E=outputs/phase436-surface-intelligence/evidence/routing-forensics
node $S/routing-forensics-reroute.mjs "$TRACE" --out=$E/reroute-replay.json                       # Section 7
node $S/routing-forensics-slice-check.mjs "$TRACE" --out=$E/slice-check.json                      # 24.99 m vs 25 m
node $S/routing-forensics-plan-reconstruct.mjs "$TRACE" --scenario=base-only --out=$E/plan-reconstruct-base-only.json
node $S/routing-forensics-plan-reconstruct.mjs "$TRACE" --scenario=with-friuli-first --extra-seconds=22 --out=$E/plan-reconstruct-with-friuli-first-extra22.json   # also 60
node $S/routing-forensics-plan-reconstruct.mjs "$TRACE" --scenario=route1-only --navigation --out=$E/reroute-reconstruct-route1.json
node $S/routing-forensics-junction.mjs --out=$E/junction-osm-local.json
(cd experiments/phase436-surface-intelligence/data/archive && tar -xzf ../../../../outputs/phase425-benchmark/provider-responses.tar.gz)   # sha256 acea0e12…8b8356
node $S/routing-forensics-archive-scan.mjs --out=$E/archive-scan.json; node $S/routing-forensics-uturn-scan.mjs --out=$E/uturn-scan.json
PHASE436_REPLAY=1 node $S/routing-forensics-live.mjs --stage=osmapi|direct|handler-return|handler-outbound|controls|outbound-probe|ring-probe   # offline from the cache; without the cache it spends real requests
node $S/routing-forensics-score-live.mjs --out=$E/live-engine-scores.json; node $S/routing-forensics-selection-sensitivity.mjs --out=$E/selection-sensitivity.json
```

`routing-forensics-*.mjs` load the production handler without `node_modules` through `scripts/lib/handler-loader.mjs` (Node 26 type stripping plus a `next/server` shim; the handler source is not modified).
Files: `evidence/routing-forensics/{reroute-replay,slice-check,plan-reconstruct-*,reroute-reconstruct-route1,junction-osm-local,archive-scan,uturn-scan,live-results,live-request-log,live-engine-scores,selection-sensitivity}.json`.
