# Execution prompt: independent audit reconciliation and final integration

Date: 21 November 2026. Baseline: `main` at `311b7a5` (preview pin `e0d8680`, deployed preview still `8cf048d`; the deploy of `e0d8680` waits for
environment approval and is not ours to give). Work branch: `claude/audit-reconciliation`, in an isolated clone
(`Lastrico-reconcile`): the primary checkout has a damaged object database and uncommitted staged work, so it is **not touched**.
Never touch CAMPSH or `lastrico-pilot`.

## Goal

Two independent agents investigated the 20 November road test (Claude: PRs #39, #40, #41, #42, #44, #46 — merged except #41/#42;
Antigravity: PRs #36, #37, #38, #48 — all open). Reconcile them into one coherent, regression-tested change on top of `main`.
Keep what is verified and still necessary, reimplement or drop the rest, remove duplication. One reliable navigation system,
not an accumulation of overlapping features.

## Scope

1. **Routing.** Compare the deployed Corso Lodi fix (#40 + #44) with PR #38. For each PR #38 change (duplicate-base refinement,
   premature search termination in navigation, Valhalla OSRM reserve, heading-aware snapping, repeated U-turns, safe/fast objective
   logging in traces, unnecessary geometric detours) decide: still necessary on `main`? Evidence = a regression that fails on
   `main` and passes after the change, using the real handler on recorded provider responses. No weakening of existing tests.
   Strong/Maximum behaviour changes only with evidence.
2. **GPS recorder.** PR #46 (`lib/free-recording.ts`, `components/RecordingPanel.tsx`) is the baseline. Compare #48 and #37 feature by
   feature; integrate only what is missing (single watcher lifecycle, gap detection, multi-segment GPX import, state transitions,
   checkpointing). No second recorder, no second GPS watcher, no second storage key, no second panel. Recording stays in the main
   options, available before any route exists.
3. **TomTom.** Verify offline, on the existing fixtures: MVT decoding and matching, congestion penalties and ranking, interaction with
   Maximum anti-pavé, ZTL legality, quota/cache/breaker/fallback, incidents as a separate capability. **No live TomTom request.**
   Do not merge PR #36.
4. **Mapillary.** Review claims, reject unverified ones, import nothing into road data. Document facts and open questions.
5. **Original traces.** Read `private/gps-traces` locally. Reproduce the incidents with recorded provider responses and the real
   navigation processor. Report counts, durations, bearings and distances only: no raw coordinates, no home location, no private
   trajectory in any committed file, test name, log or PR text.

## Limitations

- Nothing is merged or deployed by this work. The new PR is for review only.
- No new live calls to a paid or quota-limited provider. No live TomTom call at all.
- Files are changed with Edit/Write only (no bulk-rewrite scripts). Only `node --test <file>`, `tsc` and `eslint` run locally; the full
  build and the browser suites run on the Linux CI.
- Provider responses used by tests are the recorded public-junction ones already in the repository.

## Acceptance criteria

- Corso Lodi at Maximum: 0 m confirmed stone, 0 m unknown surface, legal, bounded extra time, within the 7 (planner) / 4 (reroute)
  provider-request caps — pinned by tests that keep passing.
- Heading-aware reroute removes the reproduced U-turn (recorded provider answer with and without the vehicle's course).
- Every accepted PR #38 change has a test that fails on `main` and passes after; every rejected one is listed with the reason.
- One GPS watcher at a time (recording and navigation share it); one recorder (`free-recording`), one storage key.
- Recording starts without a route; pause/resume/stop and import/export keep working; GPX/GeoJSON valid and carrying no more than
  position and time.
- TomTom congestion changes the ranking when it should and never makes an illegal route legal.
- `npx tsc --noEmit`, `npm run lint`, all `node --test tests/*.test.mjs` green locally where they run; full Linux CI green.

## Tests

Deterministic only: handler tests on recorded fixtures, unit tests on pure libraries, source-shape tests where the page wires things.
Browser checks at 390×844 run in CI (or in the integrated browser against a deployed preview — not available for unmerged code).

## Release conditions

GO only if the gates above pass and residual issues are written down. The report `outputs/audit-reconciliation-report.md` holds the
reconciliation table, accepted/rejected fixes, final architecture, before/after metrics, test results, the PR URL and SHA, and the
GO/NO-GO.

## Work split

- Release owner (this session): routing, original-trace validation, integration, report, PR.
- GPS worker (own worktree): the recorder integration only.
- TomTom/Mapillary worker (own worktree): offline TomTom verification tests and the Mapillary reconciliation text.
