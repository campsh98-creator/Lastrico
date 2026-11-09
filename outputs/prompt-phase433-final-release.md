# Phase 4.33 — final release: execution prompt

Date: 9 November 2026. Owner: Claude Code (release owner). Authorised by the user: a controlled
merge of PR #10 and a Milan/Roccella-only deployment to `lastrico-pilot`, each conditional on its
gates passing.

## Scope

1. **Pre-merge audit** of PR #10: target, mergeability, CI, review findings, commit content, secrets,
   personal GPS data, large files, workflows, and whether merging can deploy anything.
2. **Durable Object failure path.** Today, when the `RouteEngine` object fails, the ordinary Worker
   computes the route itself, which is the CPU-limited path the object exists to avoid. Replace it:
   - one logged retry on another shard, only when Cloudflare marks the error retryable and not
     overloaded (for example the reset that every deployment causes);
   - otherwise an explicit `503` JSON answer with an Italian message, `Retry-After` and
     `cache-control: no-store`, logged as `route_engine_unavailable`.
   The client already shows the `error` field; during navigation it keeps the current route.
3. **Pending timers.** Provider calls use `AbortSignal.timeout`, which cannot be cancelled. The
   tail evidence shows Durable Object invocations ending exactly 4, 8 or 12.2 s after they start,
   which matches those timers (4 s for navigation, 8 s for planning). Replace it with a timer that is
   cleared when the call ends, while the timeout still covers the response body.
4. **Homepage CPU.** `/` is a deterministic server render (identical bytes on every request, no
   per-request data). Serve a snapshot of it, taken from the same build, as a static asset so
   the Worker does not run for `/` at all. The snapshot is taken by requesting `/` from the built
   Worker, so it is the server render byte for byte. The client reads `?area=` itself after
   hydration.
5. **Merge, release copy, deploy, smoke tests and report.**

## Limitations

- No feature development, no Workers Paid, no purchase, no DNS, domain, visibility or account
  settings changes. Rome is never in a deployed artifact, including the test Worker.
- `lastrico-free-test` may be redeployed only to validate these fixes before the pilot, with a
  Milan/Roccella copy.
- Load is modest: a few bursts of at most 6 requests, spaced to respect FOSSGIS.
- Simulated GPS is not a physical iPhone test. A small sample is not a capacity guarantee.

## Acceptance criteria

- No path computes a route in the ordinary Worker when the binding exists; failures are a logged
  `503`, never a silent fallback.
- Timeout enforcement unchanged: a hung provider call is still aborted at its deadline, including
  while the body is read. After a completed call no timer is pending.
- Durable Object wall time on Cloudflare drops from 4–12 s towards the response time.
- `/` is served without invoking the Worker, with the same HTML as the server render.
- Routing outputs unchanged: benchmark and reroute replays byte-identical to the Phase 4.33 run;
  Filippetti, Moscova → Crocetta, rerouting, ZTL, pavement warnings, traffic lights, reverse A/B and
  Premium UI 2.0 covered by the existing suites and the E2E acceptance run.
- The deployed build contains no Rome evidence (server and client).

## Tests

- Unit: `npm test` (full suite), with new tests for the failure path, the retry rule, timer
  cleanup, timeout enforcement, the homepage snapshot and the extended Rome check.
- Replay: `scripts/benchmark-milan-routing.mjs` and `scripts/benchmark-reroutes.mjs` compared
  with `scripts/compare-benchmark-payloads.mjs`.
- E2E: `tests/e2e/acceptance.mjs` against the local Worker of the release copy.
- Cloudflare: test Worker first (tail + analytics), then the pilot.

## Release conditions

- PR CI green after the fixes; merge with a normal merge commit; post-merge CI green on `main`.
- Release copy from `main` by `scripts/prepare-milan-release.mjs`; tests and dry run inside it;
  `findRomeInBuild` empty.
- Pilot version and rollback target recorded before deploying; rollback immediately on a critical
  regression.
