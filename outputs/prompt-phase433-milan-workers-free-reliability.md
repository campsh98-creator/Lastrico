# Phase 4.33 execution prompt — Milan reliability on Workers Free

9 November 2026. Base: `main` at `e30ccf5` (PR #9 merged; CI green).

## Facts this phase starts from

- **Official limits (Cloudflare docs, read 9 November 2026)**
  - Workers Free:
    - 10 ms of CPU per HTTP request;
    - "some built-in flexibility" per isolate for occasional overruns;
    - termination with error 1102 / outcome `exceededCpu` when overruns are consistent;
    - 128 MB of memory per isolate;
    - 50 subrequests and 6 simultaneous connections per request;
    - 1 s startup;
    - no wall-clock limit;
    - 100,000 requests per day.
  - SQLite-backed Durable Objects are available on Free, with 30 s of CPU per request (reset by each request), 100,000 requests per day and 13,000 GB-s per day.
- **Production analytics (GraphQL, read-only, 5–9 November)**
  - Version `03a6776e` completed requests with up to 985 ms of CPU.
  - Its failures (`exceededResources`, all at 10 ms) cluster in bursts:
    - field use on 7 November: 1 failure in about 290 requests;
    - field use on 8 November: 7 failures in about 110;
    - the Phase 4.30 controlled burst of 14 requests in one minute: 12 failures.
  - No `exceededMemory` outcome was seen.
- **Local CPU, Node replay of the current code**
  - Planner: median 13 ms, p90 37 ms, max 158 ms; 41 % of requests at or under 10 ms.
  - Reroutes: median 8 ms, p90 25 ms.

## Scope

1. Profile the current Milan planner and reroute requests: where CPU goes, warm and cold.
2. Implement measured optimizations whose route results are identical, or whose differences are explained and acceptable.
3. Evaluate the Free-compatible architecture of running `/api/routes` inside a Durable Object. Implement it locally if it is practical and testable with `wrangler dev`.
4. Validate quality before and after:
   - the 264 planner cases and the recorded reroutes;
   - Filippetti, Moscova → Crocetta, Promessi Sposi ↔ Vetra and San Gottardo;
   - the GPS and ZTL fixtures.
5. Check reliability locally:
   - cold and warm runs;
   - heavy routes;
   - repeated reroutes;
   - a few concurrent requests;
   - upstream failure;
   - the phone-sized end-to-end suite.
   - Also: TypeScript, lint, build and the Wrangler dry run.

## Limits

- **Rome is frozen and Roccella is unchanged.** Changes in shared code must leave both datasets byte-identical.
- **Nothing outward-facing:** no deploy, commit, push or merge; no Workers Paid and no purchase; no change to the public pilot or to the GitHub settings.
- **No load on others' services:** no load test against the pilot or the free providers. Provider calls replay the archive.
- **No loss of routing quality:** no optimization may drop alternative searches or reduce routing quality to gain CPU.

## Acceptance criteria

- **Results unchanged:** identical results on the 264 planner cases and the recorded reroutes, or every change explained.
- **Regressions held:** Filippetti and Moscova → Crocetta still pass.
- **Tests green:** all unit tests, and the focused end-to-end scenarios.
- **Measured CPU:** before and after, per optimization.
- **Honest verdict:** an Italian report with a GO/NO-GO for a Milan-only Free deployment. It separates what was measured locally from what only production can confirm.
