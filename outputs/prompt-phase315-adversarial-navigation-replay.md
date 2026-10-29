# Phase 3.15 — Adversarial Navigation Replay (execution prompt)

## Scope
Extend `tests/navigation-replay-simulation.test.mjs` (Phase 3.14 harness) with seeded adversarial
GPS scenarios and navigation-state race checks. Fix only defects that are reproduced by a failing
test against production logic (`lib/navigation-state.ts`, `lib/route-progress.ts`,
`lib/navigation-instructions.ts`, journey handlers in `app/page.tsx`).

## Inputs
- Real route geometries in `outputs/phase32-benchmark/*.json` and the four expansion corridors.
- Modes: car, motorcycle, bicycle, using the production `navigationPolicy` values.

## Adversarial scenarios (seeded PRNG, realistic speed limits per mode)
1. U-turn and genuine backward movement along the route (must not be hidden by monotonic progress).
2. Missed turn continuing straight; parallel road at 15–40 m; crossings / self-intersections.
3. Urban multipath bursts; delayed, duplicated and out-of-order fixes.
4. Prolonged signal loss (30–120 s) with recovery on-route and off-route.
5. Repeated sessions: no leaked readings, counters, watchers or timers between sessions.
6. Rerouting races: stale route responses, cooldown, in-progress lock, network failure.
7. Arrival false positives: passing near destination early, loops ending near start.

## Metrics
False reroutes, missed reroutes, reroute latency (fixes/seconds), maneuver regressions/skips,
backward-movement recovery time, arrival false positives/negatives, state leaks across sessions.

## Limitations
Synthetic replay validates logic only. It does not reproduce iOS Safari/WebKit background
suspension, sensor fusion, Wake Lock or radio behavior. No real-device reliability claims.

## Acceptance criteria
- Every fix is preceded by a reproducing test that fails before and passes after.
- Backward travel produces off-route detection / reroute within a bounded number of fixes.
- No regression in routing legality, Pareto selection, time budgets, API shape or GPS filtering.
- `npm test`, `npx tsc --noEmit`, `npm run lint`, build and `git diff --check` all clean.

## Release conditions
No commit, push or deploy in this phase. Concise Italian report with before/after metrics.
