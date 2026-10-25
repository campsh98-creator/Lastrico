# Lastrico — engineering audit and local stabilization

Date: 2026-10-25. Branch: `fix/mobile-navigation-stability`.
Release/review owner: primary Codex agent. Status: **READY for code review and commit**.
No commit, push, deployment, PR creation or remote mutation was performed.

## A. Baseline and evidence

The working tree was initially clean. README, architecture/development/data-model documents,
routing, scoring, budgets, geocoding, GPS/navigation state, reports, Worker entry, D1 binding,
schema and migration were inspected before implementation.

- Lint passed. `npm test` built successfully and passed **62 tests**.
- TypeScript failed with TS2688 on nine empty duplicate `node_modules/@types/* 2` directories.
  Only those empty directories were removed; no compiler checks or dependencies were changed.
- Diff whitespace check passed. The existing build warning about a client chunk over 500 kB
  was present before changes.

Verified defects, ordered by practical priority:

| Priority | Defect and reproduction | Correction |
| --- | --- | --- |
| P1 | Slower duplicate listed before the fastest was retained. A 750-second lower-exposure candidate could fit a +2-minute budget against 660 seconds, despite the real 600-second candidate. | Deduplicate fastest first; retain the 600-second reference. The 750-second candidate fails +2 minutes and passes exactly +2.5. |
| P1 | Provider casts accepted missing/invalid summaries, truncated polylines and inconsistent geometry; disconnected Valhalla legs were joined after silently dropping a point. | Validate candidates individually; reject malformed metrics/coordinates/manoeuvres, nonstationary zero metrics and disconnected legs. Valid siblings survive. |
| P1 | Valhalla and Nominatim requests could spend longer than their request budget waiting behind other calls. | Cancellation/deadline cover queue waiting; cancelled entries cannot release or overtake an active predecessor. |
| P1 | Report limit trusted Content-Length; malformed JSON, null, numeric notes or extra coordinate dimensions could cause 500 responses. | Count actual stream bytes, enforce 8,000 bytes, validate input shape and return 400/413. |
| P2 | A parallel sett way 8 m away changed 156 m of directly matched paving stones from probable to confirmed solely because its category weight was higher. | Nearest aligned supported surface wins; higher weight only breaks an equal-distance tie. |
| P2 | Zero known exposure contained no unknown-distance metric; category weights were named confidence without distinguishing reliability. | Add explicit unknown coverage and classification confidence; verification/freshness confidence remains null. Legacy fields retained. |
| P2 | Vertex-count sampling made geometrically identical routes appear different; comparison was asymmetric. | Distance-spaced samples compared to full segments in both directions, with endpoint orientation checks. |
| P2 | Local ways outside the start/end query rectangle were discarded even when a candidate travelled over them. | Score against the full bundled snapshot; restrict only the live query. Regression uses an actual bundled way outside that rectangle. |
| P2 | Zero-exposure candidates still generated useless detour calls. | Skip detour generation below the existing minimum-reduction threshold. |
| P2 | New report client keys bypassed expiry cleanup and could grow the in-memory quota map without bound. | Expire entries and cap active tracked clients without evicting existing limits. |
| P2 | Geocode response coordinates were returned without finite/bounds checks. | Filter malformed/out-of-area rows; cap query length at 300 characters. |
| P2 | Mobile empty-alternative text claimed no pavé reduction even when time constraints excluded a lower-exposure route. | State that no suitable alternative meets the chosen constraints. |

## B. Changes and compatibility

- `lib/routing-providers.ts`: cohesive extraction of existing provider adapters, normalization,
  explicit profile mapping and bounded requests. Car-only OSRM fallback preserved.
- `lib/route-candidates.ts`: independently tested equivalence/deduplication.
- `app/api/routes/route.ts`, `lib/route-time-budget.ts`: strict coordinate arity, finite budget
  inputs, full local surface coverage, validated live geometry and reduced unnecessary calls.
  Mode policy coefficients, avoidance thresholds, provider URLs and normal routing path remain
  unchanged. The order/number of diagnostics can change because equivalence is now corrected.
- `lib/cobblestone-scoring.ts`: nearest matching and additive coverage fields.
  API additions: `unknownSurfaceMeters`, `surfaceCoveragePercent`,
  `surfaceClassificationConfidence`, `surfaceDataConfidence`. `surfaceConfidence` preserves
  its numeric category-weight meaning as a documented legacy alias.
- `lib/geocoding.ts`, `app/api/geocode/route.ts`: bounded/cancellable serialized geocoding and
  response validation.
- `lib/report-request.ts`, `app/api/reports/route.ts`: bounded reads, input validation and
  finite local quota state. Pending moderation, public privacy filtering and D1 schema unchanged.
- `app/page.tsx`: one explanatory sentence corrected; navigation mechanics unchanged.
- Added deterministic provider, API, geometry, coverage, budget and input regression tests.
  Existing source assertions were repointed to the extracted provider file, not weakened.
  No packages or dependencies added.

## C. Validation

Final checks passed:

- `npm run lint`.
- `npm test`: production build and **105 passing tests**, no failures or skips.
- `npx tsc --noEmit`.
- `git diff --check`.

Local real HTTP smoke checks through vinext/Workers returned 400 for malformed/null report
JSON and invalid note types, 413 for an oversized UTF-8 body, and 400 for malformed route
coordinates and an overlong geocoding query. All were rejected before database persistence.

The initial `/api/reports` read returned 503 because the local D1 database had no tables
(confirmed with a read-only schema inspection). The existing migration was applied with
Wrangler `--local` and the explicit project `.wrangler/state` path. Subsequent reads of
`/api/reports` and `/api/reports/export` returned 200, an empty report list and a valid CSV
header. No report rows or production resources were written.

Browser verification used `tests/helpers/smoke-server.mjs` in front of the normal dev server.
It runs the actual routing handler against deterministic provider fixtures; geocoding results
are labelled test locations and report writes are disabled. At 393×852, 320×568 and 568×320,
the planner, Auto/Moto/Bici changes and route comparison worked. At 320×568 document width
and scroll width both measured 320 px. Simulation showed the selected route and manoeuvres,
opened the full turn list and reached the arrival state. A UI-entered +2-minute constraint
excluded the fixture's +2.5-minute alternative. Desktop 1280×800 was inspected as well.

Evidence: [mobile constrained route](engineering-audit-artifacts/mobile-budget-393.png).
The screenshot contains synthetic routing data, not a real-world route recommendation.

The initial local server launch was blocked by sandbox port binding; it succeeded using
approved local execution. An initial proxy stylesheet forwarding issue was fixed in the
smoke harness before visual verification. Neither issue required product configuration changes.

Limits: no physical iPhone/GPS driving test, background navigation or live-provider route
comparison. No production smoke/deployment was performed, as explicitly prohibited. D1
schema/bindings were inspected and the empty local database initialized from the existing
migration, but no real report was persisted. Existing large-bundle and
vinext static route-classification warnings remain. These are not failures of required checks.

## D. Deferred work and remaining risks

- **Valhalla linear factors:** official API/source research and a minimal experiment plan are
  in [VALHALLA_CUSTOMIZATION.md](../docs/VALHALLA_CUSTOMIZATION.md). A read-only `/status`
  request observed `3.9.1-618cad5`. Effective `linear_cost_factors` matching, limits and per-mode
  behavior remain unverified; no controlled local graph/runtime is available. No POC or
  production parameter was enabled. Version alone does not prove feature behavior.
- **Parallel roads:** a lone nearby parallel way inside the tolerance is still ambiguous
  without shared road identity/topology. Thresholds were not tuned arbitrarily.
- **Surface reliability:** no evidence establishes freshness/verification; confidence remains
  unknown. The dataset contains rough categories only, so unmatched distance is not smooth.
  Geometry matching and equivalence remain estimates, not proofs of legal access or safety.
- **Public-service scale:** limits are per Worker isolate; a global quota/cache or provider
  agreement requires infrastructure decisions. No unlimited public-service assumption was added.
- **Road attributes:** provenance, dates, OSM smoothness, cycling facilities and speed zones
  should be additive independent evidence. A generalized model, ingestion pipeline and database
  migration remain out of scope. Full report aggregation/export scaling and large-client-bundle
  optimization also need separate measured work.

## E. Commit readiness

**READY** for review/commit; no known blocking failure in the executable required checks.
All task changes remain local and uncommitted. Readiness is not production release approval.
The complete diff and new files were reviewed for accidental edits, type errors, stale
comments, API compatibility and mode invariants. Only audit source/tests/docs and one browser
artifact are included; existing user work was not overwritten.

Suggested Conventional Commit (not executed):

`fix(routing): harden provider validation, route budgets and surface uncertainty`
