# Phase 4.37 — anti-pavé candidate generation (package P0): execution prompt

Date: 14 November 2026. Base: `main` at `3e31da9` (Phase 4.35 on the pilot). Branch: `fix/phase437-anti-pave-candidates`.
Milan only. Rome untouched. Roccella preserved (identical outputs). Source of truth for every number below: Phase 4.36,
`outputs/phase436-surface-intelligence/` (start with `final-decision-report.md`; details in `routing-forensics.md` and
`routing-experiments.md`).

## 1. What Phase 4.36 proved

Return trip of 13 Nov 2026 (GPS trace, private, never committed): the plan at fix 0 went through Viale Umbria and the
Piazzale Lodi roundabout (25 m confirmed sett). The driver turned into Via Friuli after ≈ 60 m; the reroute 7 s later
produced a route that is geometrically the same after ≈ 220 m, with 0 m of confirmed sett, ≈ 244 m (5.3 %) shorter and
faster by the provider's own time.

Verified root causes (all in the candidate generator, none in data matching or scoring):

1. **The shortcut was never a candidate.** Valhalla optimises an internal cost, not the `time` it reports; its alternates
   do not contain the shortcut either (`routing-forensics.md` §4, H5).
2. **The penalised anti-pavé search did not run.** Piazzale Lodi's stone slice measures **24.99 m** on the plan's own
   geometry; the search targets slices of at least 25 m (`app/api/routes/route.ts:688`), so `factors.length === 0` and
   `surfaceAwareNothingToTarget` is set (`route.ts:690`). The same threshold appears at `route.ts:724` (refinement). The
   warnings use 15 m (`route.ts:878,880`, `lib/rough-sections.ts:30`) and the selection rule uses
   `minimumPaveReduction` (20 m car, 15 m motorcycle, 12 m bicycle; `route.ts:93,109,125`): three thresholds for one idea.
   With the production ×15 penalty on that ring way the provider returns the shortcut (live replica, 1 extra request).
3. **If the shortcut had been in the pool it would have won at every avoidance level** (deterministic reconstruction).
4. The cheap-improvement stop (`improvesCheaply`, `route.ts:640-653`) was not the blocker for the real plan (whose pool had no
   alternate with less stone), but in the public-landmark replica of the return decision it ended the search at a 25 m route
   (−170 m of stone for +24 s) while the 0 m shortcut existed (`routing-forensics.md` R3, VERIFIED on the replica only).
5. The reroute behaved as designed (35 m net-travel rule, 5 s). Its HUD line for status `no-pave`
   ("da qui nessuna alternativa con meno pavé", `lib/reroute-objective.ts:27-35`) is misleading: the route has no known pavé.
6. Lastrico has no U-turn handling. In the archive of 3,215 provider trips 38 % of corridor via-waypoint detours contain a
   U-turn vs 2.5 % of alternates; 12.4 % of production picks contain one (`routing-experiments.md` §7, §9).
7. Reproducibility gap: the provider graph (`tileset_last_modified`) and the candidate list are not recorded in the trace.

## 2. Scope (four small changes; each independently revertible)

### P0-1 Penalised-search slice minimum (first, alone)
- Replace the literal `25` at `route.ts:688` and `route.ts:724` by a policy value
  `penalisedSliceMinimumMeters = min(policy.minimumPaveReduction, 15)` (car 15, motorcycle 15, bicycle 12). Expressed as a
  new field of the per-mode policy with an explicit per-area switch: **Milan gets the new value; every other area keeps 25.**
- Do not change `buildLinearCostFactors` limits (4 and 12), the ×15 factor, the 4 s reserve, or the `canGenerate` rule.
- Expected effect (Phase 4.36): the 24.99 m case generates the shortcut (+1 request). In the benchmark corpus 6 of 297 cases
  skip the search because every slice is 16.5–19.7 m; 15 m recovers all six, 20 m none, which is why the cap is 15.

### P0-2 Early stop and redundant detours
- `improvesCheaply` may stop the penalised search only when the improvement leaves **less than `minimumPaveReduction` of
  weighted stone** on the candidate. Navigation (reroute) keeps its current gate: a reroute stays fast.
- After a legal penalised candidate with 0 weighted stone that passes `improvesEnough`, issue **no** geometric via-point
  request (saved 3 of 5 requests in the replica).
- Expected: +0.25 provider requests per case on average (+1 for ≈ 12 % of cases, up to 5), planner budget unchanged (18 s),
  navigation budget unchanged (5.5 s). The 0 m outbound-replica route stays behind the refinement gate (`route.ts:716-717,
  798-799`): that is a product choice ("Massimo" level), **not** part of this phase.
- Reference sketch: `outputs/phase436-surface-intelligence/evidence/routing-experiments/patches.diff` (in-memory patches used
  in the experiments; research code, never imported by runtime code).

### P0-3 Honest message and traceability
- `lib/reroute-objective.ts`: a branch for status `no-pave` that does not claim "no alternative with less pavé". Wording must
  say "no **known** pavé on the route" (unknown ≠ smooth), Italian, short.
- Trace v3 (`lib/gps-trace.ts`, `SUPPORTED_TRACE_VERSIONS` gains 3; v1/v2 still parse and replay): each route entry may carry a compact
  `generation` summary — `antiPave` status, whether the search was attempted, number of targeted slices, and per-candidate
  source / verdict / seconds / weighted-stone / unknown metres / U-turn count. **No coordinates, no street names.** Record the
  provider graph timestamp only if it can be read without an extra provider request per plan (e.g. a cached `/status` read at
  most once per hour per isolate); otherwise leave it out and say so in the report.
- Replaying the supplied Phase 4.36 trace (owner provides the local path) must still give 0 decision differences.

### P0-4 U-turn handling (penalty, never rejection) — plus an optional second step
- Add a **60 s** utility penalty per U-turn maneuver in the selection among alternatives (`lib/route-optimization.ts`). The
  provider's fastest route keeps its label; no candidate is removed. Expose `uTurnCount` per candidate in the diagnostics.
  Expected: 3 of 298 benchmark picks change; rejecting all U-turns would cost 8.1 km of avoided stone and is **out**.
- Optional P0-4b, only if it needs **no extra provider call**: snap geometric via points to the nearest intersection node of the
  local compiled road data (≤ 40 m). Ship only if replay on the archive shows U-turn-near-via ≤ 15 % (today 11.1 % within 15 m of
  an intersection vs 22.8 % elsewhere). Otherwise record "not shipped" with the measurement.

## 3. Limitations and explicit non-goals

- No change to scoring weights, the 1 m ≈ 1.2 s exchange rate at "strong", the unknown-surface burden (Phase 4.36: do **not** raise
  it; an expected-value ranking is a shadow experiment for a later phase), `smoothness`, rails, `surface_bike`, tiles or any OSM
  data. No Surface Intelligence layer, no DBT join, no sensors, no "shortest" probe (useless in 2 of 2 replicas), no
  heading pass-through, no Pareto UI, no D1 on the routing path.
- The provider graph of the 13 Nov drive was rebuilt on 14 Nov 03:50 UTC: the original plan cannot be reproduced exactly. Success is
  defined on fixtures, the benchmark and a public-landmark replica, not on the private trace.
- Public provider etiquette: ≥ 1.1 s between requests, honest User-Agent, cache every response, at most 25 new live requests.
- **Privacy:** never commit the GPS trace or its coordinates. Fixtures are captured only with public landmark coordinates (the
  Piazzale Lodi / Via Friuli / Viale Isonzo / Via Lazzaro Papi junctions used in Phase 4.36) and reviewed for street names of any
  private origin or destination before being committed. Tests that use the trace read it from an environment variable and skip
  when it is absent.
- This checkout has no `node_modules`; the owner approves running `npm ci` (declared devDependencies only) for this phase because
  the full suite needs it. Text files are CRLF in this Windows checkout: compare parsed data or use `git show HEAD:<path>`.

## 4. Acceptance criteria

1. **Fixture reproducing the failure.** A fixture with a 24.99 m slice. Before: `antiPave.search.attempted = false`, status
   `no-better-route`. After: `attempted = true`, a candidate with 0 m confirmed stone is generated and selected as the anti-pavé
   route, and the shortcut-like route is legal, faster than the base route and distinct.
2. **Corpus.** Re-run the Phase 4.25 / 4.31 benchmark offline from the archived responses (`outputs/phase425-benchmark/
   provider-responses.tar.gz`, SHA-256 in `PROVIDER_ARCHIVE.md`). Every changed case is listed with cause. No case may get more
   confirmed stone or more than +90 s without a written reason; the 264 stored Phase 4.31 results change only where predicted.
3. **Requests and time.** Mean provider requests per case increase by ≤ 0.35 (predicted 0.25); never above the existing per-request cap;
   planner 18 s and navigation 5.5 s budgets unchanged; the Workers Free subrequest limit (50) is never approached. Reroute
   latency in the navigation replay is unchanged within noise.
4. **Navigation.** Reroute behaviour is unchanged except for the message: `reroute-objective` tests green; the supplied trace replays with
   0 decision differences; v1/v2 traces still parse and replay.
5. **U-turns.** No candidate is rejected; ≤ 5 of the 298 benchmark picks change; every change is listed. `uTurnCount` appears in diagnostics.
6. **Message.** Status `no-pave` never says "nessuna alternativa con meno pavé"; the wording says "pavé noto".
7. **Areas.** `git diff --name-only` contains no Rome path; Roccella benchmark outputs byte-identical; `scripts/prepare-milan-release.mjs`
   still strips Rome and the release-copy tests pass.
8. **Fail-safe.** If the new path throws or times out, the handler falls back to today's behaviour; no new 5xx class in the fault-matrix tests.

## 5. Tests and release conditions

- Work as a team with one release owner: routing engineer (P0-1, P0-2, P0-4), UX/trace engineer (P0-3), QA (fixtures, corpus, E2E),
  release owner integrates and decides. Order: P0-1 alone → corpus; then P0-2; P0-3 and P0-4 in parallel.
- Add `tests/phase437-*.test.mjs` (slice threshold, early stop, via skip, U-turn penalty, `no-pave` wording, trace v3, Rome/Roccella
  invariance) and fixtures under `tests/fixtures/phase437/`.
- `tsc --noEmit`, ESLint, full `npm test`, Milan release preparation with tests in the release copy, mobile Chrome E2E
  (`scripts/e2e-mobile-chrome.mjs`, `tests/e2e/acceptance.mjs`), reroute and navigation replay benchmarks
  (`scripts/benchmark-reroutes.mjs`, `scripts/navigation-replay-bench.mjs`), before/after on the same scripts.
- Open a PR to `main`; no merge without the owner's review. Per `AGENTS.md` the feature is not complete until it has run on
  the pilot: after the owner's go for deployment (ask unless the launch message already authorises it) follow the Phase 4.35
  procedure (`outputs/phase435-milan-release-report.md`: prepare release → tests in the release copy → `npm run deploy:pilot` →
  `scripts/post-deploy-smoke.mjs` → live check on a phone). Production smoke test: plan the public-landmark replica pair and
  confirm `search.attempted = true` and a 0 m route among the candidates, logged with the live provider graph date; the exact route
  may differ with the live graph.
- **Rollback:** the per-area policy value returns to 25 and the early-stop rule to its current form (one-line revert each);
  `scripts/prepare-pilot-rollback.mjs` for the previous pilot version (record its version id before deploying). Roll back if the
  live smoke shows a 5xx, a request-count increase above the limit, or any Rome/Roccella difference.
- Final report `outputs/phase437-anti-pave-report.md`, with an Italian summary for the owner: what changed, before/after tables,
  requests per case, regressions found (even if none), what was not done, remaining uncertainty.

## 6. Decisions to confirm with the owner before starting

1. Roccella stays unchanged (default) or also gets the new slice minimum.
2. U-turn penalty 60 s (default) and whether P0-4b is attempted.
3. Deployment authority: the owner's go after the PR, or authorised in the launch message.
4. Final Italian wording of the `no-pave` message.

Out of this phase, queued: package P1 (OSM re-extraction with version/timestamp/relations, `junction=circular` direction fix, DBT rails
join, Surface Intelligence layer in shadow) and the physical survey of ring ways 111768010 and 111767966 (photos with a ruler),
see `final-decision-report.md` §G.
