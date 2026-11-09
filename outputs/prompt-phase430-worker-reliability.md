# Lastrico — Phase 4.30 Execution Prompt: Cloudflare Worker reliability

> Written after the first measurements and the first optimisation, because the production
> evidence had to be gathered before the cause could be stated. The scope below is what remains.

## 1. Evidence (2026-11-08)

- **Production controlled test.** On the pilot `03a6776e` I sent 14 read-only requests, spaced 4 s apart:
  - 12 ended `exceededCpu` ("Worker exceeded CPU time limit"), HTTP 503: 10 heavy route requests and 2 of the 3 home-page requests.
  - The cut-off was at **10 ms of CPU** (two at 16 ms). That is the Workers Free per-request limit.
  - No `exceededMemory`, no exceptions in the app, no errors from the routing provider.
  - Autocomplete (3 ms) and one warm home page (6 ms) succeeded.
- **Earlier.** On 2026-11-07, requests of 70–500 ms CPU still succeeded, with one `exceededCpu` at 96 ms. The Free-plan leniency is no longer applied, so the limit is now strict.
- **Local CPU, Node replay of the Milan benchmark (263 valid cases):**
  - median 20 ms, p90 93 ms, max 557 ms;
  - only 26% at or under 10 ms;
  - a cold first request costs 139 ms.
- **Profile.** 59% of the CPU is `routesShareCorridor` → `divergentMeters` (`lib/route-candidates.ts`), a brute-force point-to-segment scan between candidate routes. Surface scoring takes 22%.

## 2. Scope

1. Optimisations that preserve results exactly:
   - a conservative segment grid for corridor divergence, with the exact distance test unchanged;
   - memoisation keyed on the immutable route geometries.
2. A proof of identity:
   - every benchmark case payload compared field by field (`scripts/compare-benchmark-payloads.mjs`);
   - a randomised test against the brute-force reference.
3. Measurements:
   - CPU before and after;
   - cold and warm requests;
   - concurrent requests;
   - repeated reroutes;
   - the home page;
   - memory of a fully loaded Milan store.
4. An honest fit assessment for Workers Free, and a comparison between the smallest architectural change and Workers Paid.

## 3. Limits

- No commits, pushes, merges or deployments; the pilot stays `03a6776e`.
- No retries that hide failures.
- No routing, classification, legality or pavé change.
- Phase 4.29, 4.22 autocomplete, Roccella and Rome are preserved.

## 4. Acceptance

- The benchmark payloads are identical (354/354).
- CPU drops on the expensive requests.
- `tsc`, lint, `npm test`, the browser suite, the build and the dry run all pass.
- An Italian report with root cause, measurements and GO/NO-GO.
