# LASTRICO P0 Road-Test Forensics, Root Causes, Routing Fixes & TomTom Audit Report

**Repository:** `campsh98-creator/Lastrico`  
**Branch / PR:** `fix/p0-anti-pave-fixes` (PR #38)  
**Baseline preview pin:** `c428229` vs `origin/main` (`ab6eafb`)  
**Evidence sources:** Three original private driving traces recorded November 20, 2026 (`private/gps-traces/`, never committed), historic Nov 13 baseline trace, OSM tile store (`data/surfaces/milan-central.json`), deterministic FOSSGIS Valhalla fixture replays, and offline TomTom MVT audit tests.

> Privacy guarantee: No private home street names, addresses, or raw private coordinates appear in this report or in any committed fixture. All regression fixtures use public OpenStreetMap junctions.

---

## 1. Complete Redacted Inventory of the November 20, 2026 Road Tests

| Journey | Private Trace File (excluded from Git) | Mode / Fixes / Duration | Observed Route / Events | Confirmed Failures Reproduced |
| --- | --- | --- | --- | --- |
| **1 — Piazzale Lodi / Corso Lodi (Return)** | `lastrico-gps-trace-2026-11-20-15-39.json` (sha `eae4d15da45437f6`, v3) | `car`, `709` fixes, `835 s`, `0` replay diffs | Route 0 (`atFix 0`, `obj: "safe"`, `3.995 km`, `12.29 min`, `pave: {25, 0, 53}`, `searchAttempted: true, searchGenerated: 0`). Route 1 (`atFix 418`, `obj: "safe"`, `2.079 km`, `7.19 min`, `pave: {25, 0, 0}`, `searchAttempted: false, searchGenerated: 0`). Route 2 (`atFix 460`, logged `obj: "fast"` despite `safe:no-alternative`, `pave: {128, 0, 366}`). Route 3 (`atFix 512`, `obj: "fast"`, `pave: {280, 0, 0}`). Two background gaps at fix 507 (`112 s`) and fix 609 (`17 s`). Driven corridor avoided Piazzale Lodi via Via Pompeo Leoni → Via Boselli → Via Soave → Via Carlo Vittadini (`confirmed_smooth` asphalt) → Via Giovanni Bellezza (`unknown` + `asphalt`) → Via Crema → Via Trebbia → Via Adige (`sett`). | 25 m confirmed `sett` retained; Phase 4.37 failed to prevent recurrence; navigation skipped penalised search; reroute logged `obj: "fast"` during `safe:no-alternative`; background iOS GPS gaps. |
| **2 — Porta Romana → San Babila** | `lastrico-gps-trace-2026-11-20-17-19.json` (sha `c9ece89b787de047`, v3) | `car`, `1022` fixes, `1023 s`, `0` gaps, `8` reroutes, `0` replay diffs | Routes 2–6 (`atFix 265, 280, 295, 310, 326`): vehicle moved NW on Corso di Porta Romana at `hdg = 310.6°–311.4°` (`4.0–5.8 m/s`, `acc 8–9 m`); Valhalla snapped origin to SE (`131°`) and returned 5 consecutive `"Fai un'inversione di marcia a sinistra su Piazzale Medaglie d'Oro"`. Despite 60 s U-turn penalty in `selectOptimizedRoute`, `base-2` (`563–590 s`, 1 U-turn, `249–420 m` `sett`) still outranked `base-1` (`439–488 s`, 0 U-turns, `556–825 m` `sett`) on weighted pavé. Routes 7 & 8 (`atFix 343, 986`) logged `obj: "fast"` during `safe:no-alternative`. | Missing `heading` on Valhalla origin allowed opposite-carriageway snap & repeated U-turns; objective logging mismatch (`fast` vs `safe`); localized stone sensation on smooth Via Francesco Sforza (`833 m asphalt`, `3 m unknown`, `2 m sett`) & Via Pietro Mascagni (`427 m asphalt`, `0 m` stone). |
| **3 — San Babila → home corridor** | `lastrico-gps-trace-2026-11-20-19-09.json` (sha `a3f81c3c396478fd`, v3) | `car`, `12` fixes, `11 s`, `0` replay diffs | Route 0 (`atFix 0`): `6.674 km`, `21.50 min` (`1290 s`), `confirmed: 69 m` (Viale Beatrice d'Este `32 m` + Piazzale di Porta Lodovica `38 m`), `probable: 10 m`, `unknown: 294 m`, `antiPave: "fastest-avoids-pave"`, logged `obj: "fast"` on initial plan (`activeRouteRef.current` instead of `journeyObjectiveRef.current`), and wasted 3 geometric detours (`detour-1..3`, one with a U-turn) even though `surface-aware-valhalla` was already the fastest candidate (`1290 s` vs `1330 s`). Trace stopped at fix 12 (`page-hidden`) when user switched to Waze. | Initial-plan trace objective logged `"fast"` instead of `"safe"`; wasted `detour-1..3` requests after `surface-aware-valhalla` already improved `preliminaryFast`; iOS Safari/PWA suspends background JS & geolocation upon app switch (unrecorded Waze leg is not reconstructed). |

---

## 2. Confirmed Root Causes vs Hypotheses

### Confirmed Root Causes (verified in code and replay)

1. **Corso Lodi / Piazzale Lodi — Duplicate-base refinement gate (`lib/surface-aware-routing.ts`, `app/api/routes/route.ts`)**:
   - On `piazzale-lodi-return-car`, Valhalla's base response returned `base-2` (`571 s`, `195 m sett`, 2 slices) as `preliminaryFast` and `base-1` (`595 s`, `25 m sett` on Piazzale Lodi roundabout way `287070936`) as `preliminarySafe`.
   - Phase 4.37 (`ae1a88d`) lowered slice minimum to `15 m` in Milan planner, targeting `base-2`'s 2 stone slices in the first penalised search, which returned a duplicate of `base-1` (`25 m`). Because `25 < max(20, 195 * 0.5) = 97.5`, refinement did not run unless explicit "maximum" mode was chosen, leaving the `25 m` route selected.
   - **Fix:** Added `shouldRefineDuplicateWithStone` (`lib/surface-aware-routing.ts:154-173`) and wired `refineDuplicateBaseWithStone` (`app/api/routes/route.ts:835-843, 977`) so whenever the first penalised route matches an existing base candidate and still retains `>= minimumPaveReduction` weighted pavé, all distinct rough slices from existing base alternatives and the first penalised route are combined in one bounded refinement call (`pendingRefinement`).

2. **Corso Lodi / Navigation Early-Stop & Car OSRM-Reserve Bug (`lib/surface-aware-routing.ts`, `lib/routing-providers.ts:461-465`)**:
   - Even after unifying `stopsOnlyWhenClean(areaId, navigationRequest)` to return `areaId === "milan"` (`lib/surface-aware-routing.ts:154`), offline replay of `navigation=1` showed the refined 3rd request still aborted before calling `fetch`!
   - **Root cause found:** In `lib/routing-providers.ts:464`, `runValhallaLimited` subtracted `1_500 ms` `osrmReserveMs` on **every** `mode === "car"` call — including `fetchValhallaCustomizedRoutes` and `fetchValhallaRouteExcluding`, which never fall back to OSRM. In navigation mode (`NAVIGATION_ROUTE_BUDGET_MS = 5_500 ms`, refinement budget `Date.now() + 2_500`), waiting `1_050 ms` for the Valhalla rate slot left `2500 - 1050 - 1500 = -50 < 500 ms`, mathematically throwing `"Budget routing esaurito"`!
   - **Fix:** Restricted `osrmReserveMs = 1_500` to un-customized base requests (`mode === "car" && !linearCostFactors?.length && !excludePolygons?.length ? 1_500 : 0`), preserving OSRM fallback while enabling navigation refinement inside the `<= 4` request cap.

3. **Corso di Porta Romana — Opposite-carriageway Valhalla snap & repeated U-turns (`lib/routing-providers.ts`, `app/api/routes/route.ts`)**:
   - Navigation reroutes did not forward driver compass/GPS course (`heading`) to Valhalla's origin `locations[0]`, allowing Valhalla to snap onto the SE carriageway (`131°`) while driving NW (`310.6°–311.4°`) and issue 5 consecutive Piazzale Medaglie d'Oro U-turn instructions.
   - **Fix:** Forward `heading` (`heading_tolerance: 60`) on `locations[0]` only when finite, verified across both `/api/routes` and `fetchEngineRoutes`.

4. **Objective logging mismatch in GPS traces (`app/page.tsx`)**:
   - Two distinct call sites passed visual card state instead of user intent to `traceRouteDetails`:
     * **Reroute (`app/page.tsx:2395`):** passed `nextRoute` (`"fast"` fallback display card) instead of `objective`, writing `obj: "fast"` when `event` recorded `safe:no-alternative`.
     * **Initial plan (`startNavigation`, `app/page.tsx:3013`):** passed `activeRouteRef.current` instead of `journeyObjectiveRef.current`, explaining Journey 3 Route 0 logging `obj: "fast"` despite `antiPave: "fastest-avoids-pave"`.
   - **Fix:** Updated both `traceRouteDetails` calls to record `objective` and `journeyObjectiveRef.current`.

5. **Wasted geometric detours after `surface-aware-valhalla` already improves `preliminaryFast` (`app/api/routes/route.ts:915-917`)**:
   - Added `directFastImprovesBase = directFast !== preliminaryFast && improvesEnough(directFast, preliminaryFast)` so `detour-1..3` do not run pointlessly when the penalised search already found a faster low-stone route (tested against Phase 4.31 & 4.37 gates).

### Hypotheses & Explicit Non-Changes
- **Via Francesco Sforza / Via Pietro Mascagni & Via Carlo Vittadini / Via Giovanni Bellezza:** Hypothesis that smooth streets were hardcoded as stone or unknown streets marked smooth was **refuted** by spatial tile inspection. `Via Carlo Vittadini` (way `264776934`), `Via Francesco Sforza` (`833 m` asphalt vs `2 m` sett / `3 m` unknown crossing), and `Via Pietro Mascagni` (`427 m` asphalt) retain `confirmed_smooth`, while untagged `Via Giovanni Bellezza` (way `286609081`) remains `unknown` (`confidence: 0`). No street-level hardcoding was added.
- **Unrecorded Journey 3 Waze detour:** Cannot be reconstructed empirically because Safari/PWA background suspension terminated trace capture after `11 s` (`12` fixes). Addressed structurally via interruption detection and honest iOS background limitation UX in the separate GPS Recording PR.

---

## 3. Verified Before / After Routing Metrics (Real Handler + Recorded FOSSGIS Fixtures)

### Case A — Piazzale Lodi / Corso Lodi Return (`piazzale-lodi-return-car`, public OSM junctions)

| Metric | Before (`3e31da9` / `ae1a88d`) | After (Planner, `navigation=0`) | After (Navigation, `navigation=1`) |
| --- | --- | --- | --- |
| **Selected Safe Route Source** | `base-1` (Piazzale Lodi) | `surface-aware-valhalla-refined` | `surface-aware-valhalla-refined` |
| **Distance** | `3.318 km` | `3.076 km` (`-242 m`) | `3.076 km` (`-242 m`) |
| **Travel Time (ETA)** | `595 s` (`9.92 min`) | `574 s` (`9.56 min`, `-21 s`) | `574 s` (`9.56 min`, `-21 s`) |
| **Confirmed Pavé (`sett`)** | **`25 m`** | **`0 m` (`-100%`)** | **`0 m` (`-100%`)** |
| **Probable Pavé / Unpaved** | `0 m` | `0 m` | `0 m` |
| **Unknown Surface** | `0 m` | `0 m` | `0 m` |
| **U-Turns** | `0` | `0` | `0` |
| **Route Legality (ZTL / Mode)** | Legal | Legal | Legal |
| **Provider Requests / Cap** | `1` (prev) / `2` (`ae1a88d`) | `3` (cap `<= 7`) | `3` (cap `<= 4`) |

### Case B — Corso di Porta Romana NW (`9.2015,45.4525 -> 9.1981,45.4668`, `navigation=1`, public OSM junctions)

| Metric | Without `heading` (Pre-fix) | With `heading=311` (`heading_tolerance: 60`) |
| --- | --- | --- |
| **Selected Safe Route Distance / Time** | `2.598 km` / `505 s` (`8.42 min`) | `2.887 km` / `562 s` (`9.36 min`) |
| **Fast Confirmed Pavé** | `848 m` | `848 m` |
| **Safe Confirmed Pavé / Unknown** | `247 m` / `1 m` | `307 m` / `11 m` |
| **U-Turn Count & Instruction** | **`1`** (`"Fai un'inversione di marcia a sinistra su Piazzale Medaglie d'Oro verso Piazzale Medaglie d'Oro."`) | **`0` (`-100%`)** |
| **Route Legality & Budget** | Legal, `2` requests (cap `<= 4`) | Legal, `2` requests (cap `<= 4`) |

---

## 4. Independent Offline TomTom Traffic Validation Summary

**Strict network discipline:** **0 live TomTom requests** were issued during this audit. All functional checks ran offline via deterministic synthetic Mapbox Vector Tiles (`tests/traffic-validation-audit.test.mjs` alongside existing `tests/traffic-{core,hub,route}.test.mjs`).

**User-observed live preview telemetry (recorded out-of-band before audit):** `configured: true`, `available: true`, `reason: ok`, `remainingToday: 3999`, `remainingThisMonth: 59997`, with a downloaded Traffic Flow PBF tile confirming upstream TomTom connectivity on the preview proxy.

### Verified Offline Capabilities
1. **Traffic Flow MVT decoding & geometry matching (`lib/traffic/mvt.ts`, `lib/traffic/flow.ts`):** Matches flow linework within `15 m` and `>= 0.6` directional alignment (`minAlignment`), correctly ignoring opposing-carriageway flow; scales delay share by mode (`car: 1.0`, `motorcycle: 0.5`, `bicycle: 0.0`).
2. **ETA inflation & route ranking (`GET /api/routes?traffic=live`):** Under free flow (`1.0`) and light congestion (`0.90`), statically faster `routeA` (`600 s`) retains `fast`. Under heavy congestion (`0.25`), `routeA` ETA inflates sharply, **flipping route ranking** so uncongested `routeB` (`700 s`) becomes `fast` while triggering congested slices (`traffic.search.slices >= 1`).
3. **Flow closures vs Incident-tile closures (`lib/traffic/flow.ts`, `lib/traffic/incidents.ts`):**
   - **Traffic Flow** `road_closure: true` adds `CLOSURE_PENALTY_SECONDS` (`900 s`) and feeds congested slices into route scoring and ranking.
   - **Traffic Incidents** `category: 8` (`road-closed`) parses and attaches informational alerts near the route (`incidentsNearRoute`) with **zero ETA penalty and zero ranking effect** (UI-only advisory). This distinction is intentional and explicitly documented.
4. **ZTL legality invariance & anti-pavé interaction:** Active Monday 12:00 ZTL/access restrictions remain strictly excluded even when the legal detour carries heavy congestion (`0.25`). Combined stone + traffic cost factors stay inside planner (`<= 7`) and navigation (`<= 4`) request caps, and upstream failures fall back cleanly to static Valhalla ETAs (`HTTP 200`, `traffic.status: "unavailable"`).
5. **Quota ledger, SQL persistence & circuit breakers (`worker/traffic-hub.ts`):** Cache hits within `FLOW_TTL_MS` (`90 s`) spend 0 quota; overlay/daily/monthly caps enforce deterministically and survive `TrafficHub` restarts via `SqlLedgerStorage`; circuit breakers open on `401/403` (`key-rejected`, 6 h), `429` (`provider-limit`, 15 m), and `3x 5xx` (`provider-failing`, 5 m), persist across restarts, and recover cleanly after cooldown + upstream `200`.

### Boundary Between Offline Proof and Live Runtime
Live TomTom Traffic Incidents availability on Milan tiles and live peak-hour Flow density in `lastrico-pilot` were **not** re-queried in this session (no live API quota spent). Traffic Flow is **GO** subject to normal quota limits; Traffic Incidents is **CONDITIONAL / INFORMATIONAL-ONLY** (must not be presented as closure-avoidance routing).
