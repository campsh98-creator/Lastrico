# Lastrico — Phase 4.10 Execution Prompt: Pre-iPhone Reliability Fixes

## 1. Context and objective

An independent review of commit `1807744` (the build deployed at `https://lastrico-pilot.campsh.workers.dev`) reproduced defects that would make a first physical iPhone test misleading or impossible to diagnose.

**Objective:** make the pilot ready for a first iPhone test whose results are trustworthy and replayable.

**This phase does not validate navigation on a real device.** An agent can finish it at "ready for iPhone test", never at "navigation validated".

Line numbers refer to commit `1807744`. Re-locate each reference before editing.

## 2. Scope

| Stage | Package | Summary | Applies to |
|---|---|---|---|
| 1 | A | GPS progress guard and elapsed-time fix | Every iPhone test |
| 1 | B | Local GPS trace recorder and replay tool | Every iPhone test |
| 1 | C | Remove Overpass from the request path | Every iPhone test |
| 1 | D | Valhalla pacing without cross-request promises | Every iPhone test |
| 1 | E | Versioned pilot deployment | Every iPhone test |
| 1 | F | Honest UI: percent text, dark contrast, privacy copy | Every iPhone test |
| 1 | G | Server error logging without location data | Every iPhone test |
| 2 | H | Route equivalence based on divergent length | Tests that include Milan |
| 2 | I | Do not stop candidate search on a marginal gain | Tests that include Milan |
| 2 | J | Count unpaved surfaces in route risk | Tests that include Milan |

Execute both stages. If Stage 2 blocks, Stage 1 may be released alone for a Roccella-only test, and the final report must say so. Roccella has no confirmed rough surface in the dataset, so it can validate navigation but not anti-pavé value.

## 3. Limitations

**Out of scope for this phase:**

- corridor-wide `linear_cost_factors`, which is the proposed next phase;
- passing `heading` to Valhalla on reroute;
- `smoothness`, tram rails and calibrated unknown-surface weights;
- moving tiles out of the bundle and memory refactoring;
- per-client rate limiting and POST for route requests;
- two-stage voice prompts and per-maneuver ETA;
- HUD layout polish, iOS icons and security headers;
- report moderation;
- a full `app/page.tsx` refactor beyond the extraction required by package A;
- tile rebuilds, dependency upgrades and database schema changes;
- self-hosted routing or any new paid service.

**Non-negotiable constraints:**

- Do not change turn or access legality, the extra-time budget, or the rule that unknown surfaces are never presented as smooth.
- Do not add a control that does not change real behaviour.
- Do not send recorded traces anywhere automatically.
- Do not commit a real GPS trace. The repository is public and a trace can reveal a person's home or routine.
- FOSSGIS policy is "One request per second max. No scraping, no heavy usage." Automated tests must stub providers. Live probes stay at or below 1 request per second, with no load testing.

**Requires explicit owner approval:**

- pushing, opening a PR or merging to `main`;
- touching `lastrico-milano.cscda39.chatgpt.site` or `.openai/hosting.json`;
- creating new Cloudflare resources or paid services;
- any D1 write in production.

Local commits on the current branch are allowed, split by package. Deployment to the `lastrico-pilot` Worker is part of this phase under `AGENTS.md`.

## 4. Work packages

### A. GPS progress guard (P0)

**Problem**

- `projectOnSegment` still falls back to the nearest point on the whole route when the in-window candidate is more than `max(45, accuracy × 1.8)` metres away (`lib/route-progress.ts:108-115`).
- The Phase 4.9 test uses a 35 m offset, just under that threshold (`tests/route-progress.test.mjs:118`).
- The elapsed time is wrong. `previousJourneyTimestampRef` is overwritten at `app/page.tsx:2031` before it is read at `app/page.tsx:1843`, so "elapsed" is the age of the current fix, not the interval between fixes.
- Heading is not used in matching.

**Reproduced today**

On a route running east 1000 m, north G m, then west 1000 m (G = 80 or 100), with the app's smoothing and fix filter applied:

1. Drive at 14 m/s with 1 Hz fixes, accuracy 10 m, 3 m north of the first leg, up to x = 196 m.
2. Send raw fixes at (x = 214, y = 55) and (x = 228, y = 58), accuracy 25 m.
3. Send clean fixes at (x = 242, y = 4) and (x = 256, y = 3), accuracy 10 m.

Progress jumps from about 206 m to about 1870 m. The next instruction becomes "arrive" at 220 m. The clean fixes then report about 1.6 km off route and force a reroute.

**Required change**

1. Extract the per-fix decision chain into a pure module, `lib/navigation-fix-processor.ts`: timed-reading evaluation, smoothing, progress, arrival and off-route decision. Inputs are the previous state, the raw fix and an injected `now`. Outputs are the next state and the decisions. Side effects (React state, speech, `calculateRoutes`, diagnostics) stay in `app/page.tsx`. Extract nothing else.
2. Compute elapsed time from the previous accepted fix inside the processor.
3. Replace the global fallback for forward jumps with a confirmation path. Starting values, which may be tuned if the acceptance criteria still hold:
   - Normal window: `max(60, min(elapsed, 10) × maxSpeed + 2 × accuracy)` ahead of the anchor.
   - A candidate beyond the window is **eligible** only if all of these hold:
     - it is clearly closer than the in-window candidate, by at least `max(15, 0.5 × accuracy)` metres;
     - it is reachable: jump ≤ `elapsed × maxSpeed + 2 × accuracy`, using uncapped elapsed time;
     - when reported heading is reliable (speed above 1 m/s), it differs from the segment bearing by at most 60°.
   - Accept the jump only after 3 consecutive eligible fixes whose candidates advance monotonically.
   - An eligible pending candidate reports its own distance as `offRouteMeters`, so a GPS gap recovery does not trigger a false reroute.
   - An ineligible candidate is rejected. The result keeps the in-window candidate and reports its true distance.
   - Inside the window, when heading is reliable, penalise candidates opposed to the direction of travel.
   - Keep monotonic progress and the existing backward and U-turn behaviour unchanged.
4. Use one source of truth. In GPS mode the HUD and voice guidance must consume the processor's result. Do not project again in the `navigationProgress` memo (`app/page.tsx:547-562`).

**Traps to handle**

- **Simulation depends on the fallback being removed.** `lastRouteProgressRef` is never advanced in simulation, so the anchor stays at 0 and progress only moves through the global fallback. Advance the anchor from the route's cumulative metres at each simulation step (`app/page.tsx:1023-1035`).
- Route replacement must use a fresh anchor (`null`), not `0`: see `app/page.tsx:621`, `1544` and `1555-1560`.
- `tests/navigation-replay-simulation.test.mjs` Scenarios 5, 6, 8, 9, 10 and 11 cover behaviour that must survive. Port them to the processor if needed. Do not weaken what they prove.

**Acceptance criteria**

- In the reproduced scenario (G = 80 and 100), progress stays below 300 m, the next instruction stays the first turn, and no reroute is triggered by these fixes or the following ones.
- An advance outside the confirmation path never exceeds the normal window.
- In an opposite-direction short loop (legs 60 m apart, 150 m long), with reliable heading and fixes pulled toward the return leg, progress stays on the first leg.
- In a same-direction case (east 300 m, north 80 m, west 300 m, north 80 m, east 300 m), two multipath fixes toward the third leg cause no jump.
- In a GPS gap of 45 s at 14 m/s, resuming on route with and without heading, progress is correct within 3 accepted fixes, with no reroute and no backward movement.
- A driver who truly leaves the route and rejoins 400 m ahead ends in a correct state within 5 fixes, either confirmed jump or reroute. The state is never stuck.
- A true U-turn and a missed turn still trigger rerouting.
- A unit test proves that a 30 s gap yields elapsed = 30 s.
- Simulation completes to arrival, including on looped geometry, with monotonic progress.

### B. GPS trace recorder and replay

**Problem:** the iPhone checklist relies on what a tester remembers. Failures cannot be reproduced.

**Required change**

- A recorder that is **off by default**, enabled by an explicit control before starting navigation. Suggested label: "Registra traccia GPS per il collaudo".
- A visible indicator while recording.
- Storage on the device only, in a versioned JSON format containing:
  - schema version, app version, area, mode and start time;
  - each route used, with coordinates, instructions and the fix index where it became active;
  - raw fixes: timestamp, lon, lat, accuracy, heading, speed;
  - processor decisions: accepted or rejection reason, progress, off-route distance, GPS state, instruction id, pending jump;
  - events: reroute start, success and failure, foreground resume, wake-lock changes, voice spoken.
- Bounded storage: at most 14,400 fixes per trace and the last 3 traces. Buffer in memory and flush every 15 fixes and on `pagehide`. Wrap all storage access in try/catch.
- If a write fails, the interface must say recording is suspended rather than imply it continues.
- Export and delete controls. Use `navigator.share` with a file where supported and fall back to the existing download approach (`components/phase43/LocalFieldFeedback.tsx:111`), because downloads in iOS standalone mode need checking on the device.
- `scripts/replay-gps-trace.mjs <trace.json>`, which re-runs `lib/navigation-fix-processor.ts` and prints fix counts by reason, largest forward jump, rejected jumps, reroutes, skipped instructions, arrival, and differences from the recorded decisions.
- A committed **synthetic** fixture for the reproduced scenario, clearly labelled as synthetic.
- Add an ignored folder for real traces, `/outputs/field-traces/`, to `.gitignore`.

**Honesty requirement:** when recording is on, the HUD text "posizione non salvata" (`app/page.tsx:584`) must change to say the trace is being saved on this device.

**Acceptance criteria**

- With the control off, nothing is written to storage.
- With it on, a simulated journey produces a valid trace that the script replays with zero decision differences.
- Replaying the synthetic fixture demonstrates package A's result.
- Delete removes all traces.
- No trace data appears in any network request.

### C. Remove Overpass from the request path

**Problem:** `/api/routes` calls Overpass with a 650 ms timeout (`app/api/routes/route.ts:460-469`). A matching query received its first byte after 29 s, and all 6 observed production responses used only the local archive. Each planner request loads a donated service for no observed benefit, and the live cache corrected in Phase 4.9 is effectively dead code.

**Required change**

- Remove from `app/api/routes/route.ts`: the fetch, `lastOverpassSnapshot`, the live branch, the live merge in `ensureRouteCovered`, the `normalizeOsmFeature` import, and helpers and policy fields that become unused (`roughDetails`, `PaveWay`, `surfaceHighways`, the highway regexes, the bounding box variables).
- Remove the notice that promises improvement "finché Overpass non risponde" (line 741) and the "aggiornamento live" wording (line 525).
- Keep the offline `scripts/osm` pipeline. Scheduled refresh is out of scope.

**Trap: the tests use the Overpass stub to inject surface data.** Affected: `tests/routes-api.test.mjs` (9 fixture uses), `surface-aware-routing`, `mobile-product-readiness`, `surface-breakdown`, `phase44-roccella-ux-integration`, `phase46-route-quality-pilot`, `pilot-areas`, `tests/helpers/smoke-server.mjs`, `scripts/benchmark-route-optimization.mjs` and `scripts/validate-roccella-pilot.mjs`.

Add a test helper that builds fixture segments and mocks methods on the exported `spatialRoadStore` instance (`getScopedIntelligence`, `getTileKeysForCoordinates`, `getMissingTileKeys`). No production test seam is needed: a mock on that instance was confirmed to reach the handler loaded through `loadApi`.

Replace the cold/warm cache test (`tests/routes-api.test.mjs:212`) with a determinism test. Update current-behaviour statements in `docs/BUG_AUDIT.md` and `docs/COBBLESTONE_DATA_MODEL.md` where they mislead.

**Acceptance criteria**

- No route request path contacts Overpass, proven by a test that fails on any unexpected URL.
- Identical requests give identical `paveMeters`, `riskMeters` and `surfaceScore` values.
- User-facing notices remain honest that unknown surfaces stay unknown.

### D. Valhalla pacing without cross-request promises

**Problem:** `lib/routing-providers.ts:337-355` chains a module-level promise across requests. If a request's context is cancelled and its `finally` never runs, later requests in that isolate may fail until it is recycled. This risk is probable and not reproduced.

**Required change**

- Try one targeted reproduction under `wrangler dev` with a client abort mid-queue, and record the result either way.
- Replace the chain with slot reservation: each request takes `slot = max(now, nextSlot)`, then sets `nextSlot = slot + 1050`. It waits with its own timer, and refuses before reserving if the slot exceeds its remaining budget.
- This deliberately changes the guarantee from "one in flight" to "at most one start per interval". Update `tests/routing-providers.test.mjs:127` and `:153` with that reason stated in the test. Do not delete them.

**Acceptance criteria**

- Starts stay at least 1050 ms apart and in FIFO order within an isolate.
- A provider call that never settles does not block a later request.
- Aborted and over-budget requests make no network call.
- The per-isolate limitation stays documented in a comment.

### E. Versioned pilot deployment

**Problem:** the real D1 id lives only in `dist/server/wrangler.json`, which git ignores and which was edited after the build. `vite.config.ts:6` holds a placeholder. That file names the Worker `lastrico`, while the pilot is `lastrico-pilot`. `npm test` runs a build.

**First step, before any build or test:** read the D1 id from the existing `dist/server/wrangler.json`. If it is lost, recover it with `wrangler d1 list`. Do not guess.

**Required change**

- A committed pilot configuration holding the Worker name, D1 name and D1 id. These ids are not credentials and contain no secrets.
- `scripts/deploy-pilot.mjs`, exposed as `npm run deploy:pilot`:
  1. build;
  2. apply the pilot configuration to the generated `wrangler.json`;
  3. fail on the placeholder id or the wrong Worker name;
  4. run a dry run;
  5. print the current version id for rollback;
  6. deploy and print the new version id.
- Leave the ChatGPT Sites path unaffected.
- Document deployment and rollback in `docs/development.md`.

**Acceptance criteria**

- A unit test covers the configuration patch and the placeholder failure, without deploying.
- From a clean build, a dry run targets `lastrico-pilot` with the correct D1 binding.

### F. Honest UI

**Defects**

- `components/phase43/RouteComparisonPanel.tsx:89` renders "-$40%", because `$` is literal in JSX.
- `components/phase43/phase43.css:137` sets a fixed light background on the selected route card while text inherits a light colour. In dark theme the title, time and values are nearly invisible. The theme is automatically dark from 19:00 to 07:00 (`app/page.tsx:1105`).
- `tests/dark-mode-contrast.test.mjs` reads only `app/globals.css`, so `phase43.css` is untested.
- `components/phase43/NavigationDiagnosticsCard.tsx:54-58` claims "Zero tracciamento" and "Nessuna coordinata GPS viene inviata a server". This is false: reroutes send the live position to the server and to routing providers (`app/page.tsx:1901-1902`), as the notice at `app/page.tsx:2860` correctly says. `tests/phase43-ux-feedback.test.mjs:386-387` pins the false text.

**Required change**

- Fix the percent text.
- Audit every hard-coded surface in `phase43.css` (lines 137, 144, 308, 318, 377, 403, 492, 558, 687, 696, 728, 977) and make it work in both themes through tokens or dark overrides.
- Extend the contrast test to cover `phase43.css`.
- Replace the banner with accurate text, and update its test. Suggested text: "I contatori restano in questa sessione e non vengono inviati. Per calcolare e ricalcolare il percorso, la posizione usata come partenza viene inviata ai servizi di routing."

**Acceptance criteria**

- The panel shows "(-40%)" for the Brera → Santa Sofia case.
- Text in selected and disabled cards reaches at least 4.5:1 in both themes.
- Screenshots at 393×852 in dark and light themes are saved under `outputs/phase410-validation/`.

### G. Server error logging

**Problem:** `app/api/routes/route.ts:827` catches everything without logging, so a coding error looks like a provider outage. Provider failures are also swallowed (`lib/routing-providers.ts:403`, `:527`).

**Required change:** log a structured line with event name, error name, truncated message, mode, area and calculation mode, plus provider and HTTP status for provider failures.

**Trap:** the OSRM URL contains coordinates, so fetch errors can leak them. Never log coordinates, URLs, query strings or request bodies. For provider exceptions log only the error name.

**Acceptance criteria**

- A test asserts that logged output contains no coordinates.
- A forced internal error and a provider failure produce distinguishable log lines.
- The 503 response body is unchanged.

### H. Route equivalence (Stage 2)

**Problem:** `routesShareCorridor` compares mean distance over 25 samples (`lib/route-candidates.ts:62-72`), and selection uses it directly (`lib/route-optimization.ts:67`). Reproduced: on a 3 km route, a detour of up to 1.2 km on a parallel street 70 m away, zero pavé against 1.2 km of pavé at +30 s, is judged equivalent and excluded. Frequency on real routes has not been measured.

**Required change:** measure divergent length, meaning the length of each route farther than the policy tolerance from the other, in both directions. Routes are equivalent only if the larger value is at most `max(60 m, 3% of the shorter route)`. Sample by distance, about every 25 m, and use early exit and scan locality to bound CPU.

**Acceptance criteria**

- These are distinct: (3 km, 300 m, 70 m), (3 km, 600 m, 70 m), (3 km, 1200 m, 70 m), (1.5 km, 300 m, 70 m), (6 km, 800 m, 100 m), written as route length, detour length, offset.
- In the 1200 m case the pavé-free candidate is selected.
- Vertex density, small lateral noise within tolerance, and detours under the threshold remain equivalent.
- All four existing tests in `tests/route-candidates.test.mjs` still pass.
- CPU is measured before and after, and stays under 5 ms per route pair on a 5 km route locally. Report the numbers.

### I. Candidate search threshold (Stage 2)

**Problem:** `baseAlreadyImproves` stops the search on a 20 m gain (`app/api/routes/route.ts:597-607`, `:88`). Cadorna → Darsena offers −33 m at +1.6 min, and the search stops there.

**Required change:** in planner mode only, stop early only if the raw pavé reduction is at least `max(100 m, 25% of the fastest route's pavé)`. These values are provisional until field data exists; mark them so in the code.

Navigation requests keep current behaviour to protect reroute latency. The maximum of 5 Valhalla calls per planner request and all deadlines stay unchanged. Display thresholds stay unchanged.

**Acceptance criteria**

- A fixture matching Cadorna → Darsena (fastest route 464 m of pavé, candidate 431 m) continues the search.
- A strong base candidate still stops it.
- Navigation requests make the same number of calls as before.

Do not assert a specific better route here. The current generators may not find one; corridor-wide penalties are the next phase.

### J. Unpaved risk (Stage 2)

**Problem:** gravel, dirt and unpaved surfaces contribute zero risk and are not unknown, so they look as good as asphalt (`lib/road-intelligence-scoring.ts:347-359`). Weights already exist in the tiles (0.35 to 0.7), so no tile rebuild is needed.

**Required change**

- Keep `weightedPaveMeters` meaning stone only. `tests/road-intelligence-regressions.test.mjs:33` deliberately protects this.
- Add `weightedUnpavedMeters` to the score, and set `riskMeters = weightedPaveMeters + weightedUnpavedMeters` (`app/api/routes/route.ts:580`).
- Keep existing payload meanings. The `weightedPaveMeters` diagnostic at `route.ts:785` must report stone only; add a separate risk field.
- Keep `canGenerate` (`route.ts:606-607`) based on stone, so unpaved roads alone generate no extra provider calls.

**Acceptance criteria**

- A candidate with 300 m of gravel does not beat a fastest route with 200 m of sett.
- A candidate with 300 m of compacted surface can beat 300 m of sett.
- Asphalt still contributes zero.
- No additional Valhalla calls occur on an unpaved-only route.

## 5. Tests

Add or update:

- `tests/navigation-fix-processor.test.mjs`: package A criteria;
- a trace test for the recorder format and the synthetic fixture replay;
- the updated routes API suite without Overpass;
- provider pacing tests;
- the deployment configuration test;
- the extended contrast test;
- equivalence, search-threshold and unpaved tests.

Do not weaken an existing assertion to make it pass. Any changed test must state why the old expectation no longer applies.

## 6. Release conditions

All must hold, in this order. Record the evidence for each.

1. **Static and automated checks:** `npx tsc --noEmit`, `npm run lint`, `npm test` and `git diff --check` pass, with no skipped tests. Record test counts.
2. **Benchmarks:** record bundle size before and after, and route benchmark results.
3. **Mobile end-to-end, in an emulated viewport against the build:**
   - at 393×852 in dark and light themes: planner, route comparison, simulation to arrival, and the recorder on and off with export and delete;
   - at 852×393: planner and HUD, with defects recorded even if not fixed;
   - no horizontal overflow and no console errors.
4. **Deployment:** only through `npm run deploy:pilot`, only to `lastrico-pilot`. Record the previous and new version ids. Rollback uses `wrangler rollback` with the previous version id.
5. **Production smoke test, read-only:**
   - the 6 preset itineraries in `lib/pilot-areas.ts`, at no more than 1 request per second;
   - HTTP 200, the expected provider, no Overpass wording in notices;
   - production asset hashes match the build;
   - no report POST.
6. **Rollback rule:** on any smoke failure, roll back first, then diagnose. Report the outcome plainly.
7. **Service worker:** bump `CACHE` from `lastrico-v12` to `lastrico-v13` and update `tests/rendered-html.test.mjs:235`, so testers do not keep a stale offline shell.

## 7. Deliverables

- Code and tests for the packages above.
- Updated `docs/IPHONE_PHYSICAL_TEST_CHECKLIST.md`, adding:
  - enable the recorder and export the trace after each run;
  - enable voice before starting, then separately test enabling it during a stopped navigation, since iOS may block speech outside a user gesture;
  - for anti-pavé assessment in Milan, stay inside surface data coverage (longitude 9.16–9.21, latitude 45.44–45.49);
  - test a route with a parallel return leg, as a passenger or stopped;
  - save real traces only in `outputs/field-traces/`.
- `outputs/phase410-release-report.md`, stating:
  - per package: done, deviated or deferred;
  - the evidence for each release condition;
  - the result of the `wrangler dev` reproduction;
  - what remains unverified, explicitly including real iPhone GPS, Safari audio, Wake Lock and PWA behaviour.

The human iPhone test comes after this phase. Its traces decide the tuning of off-route thresholds, voice distances, smoothing, arrival tolerance and surface weights.
