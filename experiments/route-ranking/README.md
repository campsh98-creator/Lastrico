# Phase 4.20 — Agent A: Intelligent Route Ranking (experiment)

Developer-only, offline experiment. Nothing here is imported by the app, the Worker or production
routing. Italian results and the GO/NO-GO recommendation are in [`report.md`](report.md);
machine-readable output is [`results.json`](results.json).

## What it is

`ranker.mjs` is a pure ES module (no production imports, no I/O) that ranks already scored route
candidates for `car`, `motorcycle` or `bicycle`:

1. **Hard constraints** — legality (same rule as `isLegalCandidate` in `lib/route-optimization.ts`),
   reference = fastest legal route, corridor duplicates of the reference removed, user time budget
   (`maxExtraMinutes`, inclusive, relative to the fastest legal route), per-profile detour limit
   (production `MODE_POLICY.limits`), and an evidence guard: an alternative must reduce *known*
   pavé (confirmed + probable) by the production minimum (20/15/12 m).
2. **Pareto filter** over raw criteria (duration, distance, confirmed pavé, probable pavé, unknown,
   weighted unpaved). A dominated candidate can never win.
3. **Additive cost** relative to the fastest route in *m-eq* (metres of confirmed pavé
   equivalent). Contributions: confirmed pavé, probable pavé (0.65), unknown (0.35, or 0.5 in
   `maximum`; always > 0 — unknown is never treated as smooth), an *unbacked-unknown* surcharge
   (unknown metres that replace avoided pavé without confirmed-smooth gain count like confirmed
   pavé), weighted unpaved, extra minutes, extra km and a switching threshold. The contributions
   sum exactly to the cost; the result carries the breakdown, the exclusions with reasons and an
   Italian sentence explaining why the winner beat (or did not beat) the fastest route.

Profiles: `fastest`, `balanced`, `strong`, `maximum` (time weights derived from production
`balancedPaveDivisor`: 1 min = 500/330/260 m in `balanced`, /10 in `strong`, /100 in `maximum`) and
`makeCustomProfile(mode, { base, weights, detourLevel | detourLimit, switchingCostEq, creditUnknownReduction })`.
By default an alternative with *fewer* unknown metres than the fastest route earns a credit
(symmetric uncertainty term); `creditUnknownReduction: false` reproduces production's asymmetry
(only additional unknown metres are charged). On the genuine corpus switching it off changes very few
decisions (`results.json` → `unknownCreditEffectOnGenuine`); on synthetic pools it is the main source
of divergence from production (`syntheticCrossCheck`).

```js
import { rankRoutes } from "./experiments/route-ranking/ranker.mjs";
const result = rankRoutes(candidates, { mode: "car", profile: "strong", maxExtraMinutes: 5, equivalent });
// result.winnerId, result.ranking[i].contributions, result.excluded, result.explanation
```

Candidate fields: `id, provider, profile, durationS, distanceM, confirmedPaveM, probablePaveM,
unknownM` (required) and `smoothM, unpavedWeightedM, blockingRestrictionM, confirmedRestrictionM,
corridorId` (optional). `equivalent(a, b)` answers "same corridor"; the default compares `corridorId`.

## Files

| Path | Role |
|---|---|
| `ranker.mjs` | The experimental ranker (only file a future integration would need). |
| `lib/production-baseline.mjs` | Read-only adapter that re-runs the **current** production `selectOptimizedRoute` + the `hasDistinctAlternative` post-filter of `app/api/routes/route.ts`; mirrors `MODE_POLICY` (drift-tested). |
| `lib/scenario-adapter.mjs` | Same candidate metrics and corridor-equivalence answers for both selectors. |
| `build-corpus.mjs` | Inventory (SHA-256, size, provenance) → `corpus/manifest.json`; normalised pools → `corpus/scenarios.json`. |
| `collect-live.mjs` | Optional, rate-limited live capture against a *local* server (already run once; see below). |
| `benchmark.mjs`, `lib/report.mjs` | Comparison → `results.json` and `report.md` (all numbers computed). |
| `test/` | `node:test` suites: ranker properties, production parity, corpus integrity. |
| `corpus/live-2026-11-05/` | Raw live responses with request parameters, timestamps and a request log. |

## Corpus

- **R-archived** — `candidateDiagnostics` of recorded `/api/routes` responses: `tests/e2e/fixtures/*.json`,
  `outputs/phase32-benchmark/{before,after}-*.json` (Phase 3.1/3.2 code, Oct 2026),
  `outputs/phase42-validation/*.json` (Roccella), `tests/fixtures/reproduced-porta-romana-route.json`.
  Metrics are those of the code/data of that time; the fair baseline is the *current* selector re-run
  on them (the recorded choice is reported separately).
- **G** — every archived raw Valhalla body (`outputs/phase32-benchmark/responses/`,
  `outputs/phase42-validation/responses/`, `tests/fixtures/valhalla-porta-romana-promessi-sposi.json`)
  plus recorded fast/safe geometries, decoded with production `normalizeValhallaResponse`, re-scored
  with the current `scoreRoadIntelligence` and OSM tile archive, filtered/deduplicated with production
  rules, union pool per origin/destination × mode.
- **R-live** — 2026-11-05 responses of the current code: a byte-identical copy of `dist/` (hashes
  checked; `dist/` itself untouched) served by `wrangler dev --local` from the scratch directory,
  coordinates only, Milan centre, `avoid=strong`, no budget, ≥10 s between requests, cap 40.
- `outputs/phase417/results.json` is inventoried as a derived reference only (it reuses phase32/42 fast/safe).

The confirmed/probable split of candidates without exact payload values is derived from
`weightedPaveMeters` (sett/cobblestone weight 1, paving_stones 0.65) and checked against exact
payload values (max error reported in the manifest).

## Reproduce (from the repository root)

```sh
node --test experiments/route-ranking/test/          # all suites, deterministic, < 2 s
node experiments/route-ranking/build-corpus.mjs      # rebuild corpus/manifest.json + scenarios.json (offline)
node experiments/route-ranking/benchmark.mjs         # rewrite results.json + report.md (offline)
```

Optional live capture (already done; do not repeat without a reason — it calls public providers
through the local server). Copy the build instead of running it in place so `dist/` is not written:

```sh
REPO="$PWD"; S=<scratch dir>; rsync -a --exclude /server/.wrangler dist/ "$S/dist-copy/"
(cd "$S/dist-copy/server" && WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH="$S/wrangler.log" \
  "$REPO/node_modules/.bin/wrangler" dev --config "$S/dist-copy/server/wrangler.json" --port 8799 --local --persist-to "$S/wrangler-state") &
node experiments/route-ranking/collect-live.mjs --base=http://localhost:8799 --max=36   # then stop the server
```

`collect-live.mjs` resumes from `request-log.json`, skips pairs already captured and refuses to
exceed 40 logged requests in total.

## Requirements

Node ≥ 24 (native TypeScript type stripping for the read-only production imports). No npm installs,
no build, no network for tests, corpus build or benchmark.

## Limitations

No ground truth of user satisfaction or physical roughness; few scenarios with a real pavé/time
trade-off; time-weight equivalences are inherited from production, the distance weight is an
uncalibrated assumption. See `report.md`.
