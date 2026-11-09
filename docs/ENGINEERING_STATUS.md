# Engineering status

Status on 9 November 2026, branch `fix/mobile-navigation-stability`. This page separates what
exists locally from what is online, and fixed defects from open problems. Every claim points to
the evidence in `outputs/`; the detailed phase reports there are in Italian.

## 1. Where each feature stands

**Legend**
- **Local:** implemented on this branch and covered by the 447 unit and integration tests.
- **Pilot:** included in the public pilot, version `03a6776e` (Phase 4.28 code, deployed on 7 November 2026).
- **Emulated:** passed the end-to-end suite in headless Chrome with simulated GPS.
- **iPhone:** checked on a physical iPhone.

| Feature | Local | Pilot | Emulated | iPhone |
| --- | :---: | :---: | :---: | :---: |
| Surface-aware route planning (car, motorcycle, bicycle) | ✅ | ✅ | ✅ | ✅ Phase 4.28 road test |
| Anti-pavé vs Fastest comparison, three avoidance levels, extra-minute limit | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| Confirmed, probable and unknown surface shown separately | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| Bicycle "walk this stretch" notice at pedestrian-only ends | ✅ | ✅ | ✅ | — |
| Premium UI 2.0 (light and dark, phone, landscape, desktop) | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| GPS navigation, voice, arrival detection | ✅ | ✅ (older engine) | ✅ | ✅ Phase 4.28, issues found |
| GPS fusion, smooth arrow and camera follow (Phase 4.29) | ✅ | ❌ | ✅ | ❌ |
| Upcoming-surface warnings with street name and length (4.29 and 4.31) | ✅ | ❌ | ✅ | ❌ |
| Faster wrong-turn and parallel-street detection (Phase 4.31) | ✅ | ❌ | ✅ | ❌ |
| Surface-aware search during reroutes; objective kept for the journey (Phase 4.31) | ✅ | ❌ | ✅ | ❌ |
| Traffic lights, stop and give-way signs from OSM, central Milan (Phase 4.31) | ✅ | ❌ | ✅ | ❌ |
| Milan ZTL avoidance with per-zone, per-mode authorisations (Phase 4.31) | ✅ | ❌ | ✅ | ❌ |
| Reverse A/B button (Phase 4.31) | ✅ | ❌ | ✅ | ❌ |
| Proportional confirmed-pavé tolerance in selection (Phase 4.31 review) | ✅ | ❌ | ✅ | ❌ |
| Worker CPU and memory reductions (Phase 4.30) | ✅ | ❌ | ✅ | — |
| Shared-edge scoring and other CPU cuts, routes identical (Phase 4.33) | ✅ | ❌ | ✅ | — |
| Route computation in a Durable Object, explicit 503 on failure (Phase 4.33) | ✅ | ❌ (verified on a separate Free test Worker) | ✅ local Worker runtime | — |
| Provider timers cleared after each call (Phase 4.33) | ✅ | ❌ (verified on a separate Free test Worker) | ✅ | — |
| Homepage served as a static snapshot (Phase 4.33) | ✅ | ❌ (verified on a separate Free test Worker) | ✅ | — |
| "Descrivi la tua preferenza" rule-based preference prompt | ✅ | ✅ | ✅ | — |
| Moderated community surface reports (D1) | ✅ | ✅ | ✅ | — |
| Milan coverage | ✅ citywide | ✅ | ✅ | ✅ |
| Roccella Ionica coverage | ✅ | ✅ | ✅ | — |
| Rome coverage (Phases 4.23 and 4.27) | 🧪 experimental | ❌ never deployed | ❌ (data, unit and API validation only) | ❌ |

**About the iPhone column**
- "Phase 4.28 road test" means the author drove and rode with the public pilot on 7–8 November 2026.
- No physical iPhone has run the Phase 4.29–4.31 code. All GPS figures for those phases come from
  simulation.

## 2. Fixed historical defects

| Defect | Cause | Fix and evidence |
| --- | --- | --- |
| **Anti-pavé alternative missing** (Porta Romana, field cases B and E) | 1. The pilot's reroutes skipped the surface-aware search. 2. After one reroute without an alternative, the rest of the journey silently switched to "fastest". 3. A new costly base route stopped the search early. | All three fixed (`lib/reroute-objective.ts`, `app/api/routes/route.ts`). All 16 approach cases now offer an anti-pavé route, or say that the fastest route already is one. Report: `outputs/phase431-release-gate-anti-pave-report.md`. |
| **Viale Filippetti not chosen** (field case E) | Same reroute and objective loss. The Filippetti route *is* Lastrico's anti-pavé route: 493 m less confirmed pavé for 18 s. | The end-to-end test H1 plans it, selects it and navigates it. |
| **A clearly smoother route rejected** (Moscova → Crocetta) | A fixed 10 m tolerance on extra confirmed pavé. | The tolerance is now proportional (10 % of the probable stone removed, at most 50 m). Large swaps stay excluded. Report: `outputs/phase431-routing-decision-review.md`. |
| **Slow or missed wrong-turn detection** (field case C) | About 80 m of offset was needed (9–12 s). A parallel street 40–55 m away was recognised in only 38 % of simulated cases. | Heading-and-offset evidence for wrong turns, and sustained-offset evidence for parallel streets (`lib/navigation-fix-processor.ts`). Measured on 203 simulated wrong turns. |
| **False reroutes** (GPS multipath, loop-shaped starts) | Single noisy fixes counted as leaving the route; a defect introduced in 4.29 at loop starts. | Net-displacement and course-consistency checks, and progress preference at loop starts. Regression tests are in `tests/phase431-navigation.test.mjs`. |
| **Arrow lag and jumps** (field case A) | The pilot moves the marker one fix at a time, with no fusion. | GPS fusion and interpolated motion (Phases 4.29 and 4.31). The browser lag fell from 9.0 m to 2.5–3.7 m. |
| **Re-centring did not recover a stalled GPS** (field case C) | Probably a GPS watch that iOS had stopped delivering. This is unconfirmed without a trace; a failed Worker reroute is the other candidate. | The button now restarts the GPS watch when the last fix is older than 5 s. The field-test trace now records each reroute's reason and result. |
| **Routing CPU and memory peaks** | A brute-force corridor comparison (59 % of CPU), and all 117 Milan tiles expanded in memory (107 MB, against a 128 MB isolate limit). | A spatial grid and per-request caching (same results), plus at most 64 expanded tiles. Median CPU per request fell from 20 to 12 ms, total CPU by 50 %, and memory to 76 MB. Report: `outputs/phase430-worker-reliability-report.md`. |

## 3. Open problems

1. **The public pilot fails route calculations intermittently.** Measured with Cloudflare analytics
   for version `03a6776e` (`outputs/phase433/`).
   - **The limit:** Workers Free allows 10 ms of CPU per request. Each isolate tolerates
     occasional overruns, and requests of up to 985 ms succeeded.
   - **The failures:** when overruns are consistent, requests are stopped at 10 ms, which the
     visitor sees as error 1102 or 503.
     - In real use there were 1 failure in 297 requests on 7 November and 7 in 128 on 8 November.
     - In a controlled burst of 14 route requests within one minute, 12 failed.
   - **Cause:** every failure was a CPU stop; none was memory or the provider.
   - **Phase 4.33 response, local only:**
     - Routing CPU fell by 39 %, with identical routes. Warm planner requests now take a median
       of 9 ms and a p90 of 26 ms.
     - A heavy route that is the first request on a fresh isolate still takes 60–280 ms.
     - Route computation now runs in a SQLite-backed Durable Object, which allows 30 s of CPU per
       request on Workers Free.
   - **Verified on Cloudflare:** on 9 November, a separate Milan-only test Worker on Workers
     Free (`lastrico-free-test`) served 40 of 40 route requests in two runs, including bursts,
     with up to 319 ms of CPU in the Durable Object and no stops (§4).
   - **Release:** the pilot deployment is a separate, authorised step after this merge, built with
     `scripts/prepare-milan-release.mjs`. A physical iPhone test is still missing. Workers Paid
     remains only a fallback.
2. **No physical iPhone validation of Phases 4.29–4.31.**
   - GPS fusion, the reroute timing and the surface warnings are verified only in emulation.
   - iOS may also suspend a PWA in the background or with the screen locked.
3. **Unidentified long cobblestone corridor near Porta Garibaldi** (field case A).
   - The author reported about 1 km of pavé that the app did not flag.
   - The reconstructed routes cross 252–359 m of confirmed pavé. The most likely candidate is
     Piazza XXV Aprile → Piazzale Biancamano → Via Legnano.
   - Without the real trace it cannot be located. No street was reclassified.
4. **Milan ZTL coverage is incomplete.**
   - Seven zones are modelled from OSM evidence.
   - The Corso Garibaldi and Corso di Porta Ticinese gates have no hours in OSM, so they are
     treated as always active.
   - Area C (a paid congestion charge) is not modelled.
   - Holidays and exemptions (residents, disabled permits, loading) are not modelled.
   - Road signs always take precedence.
5. **Traffic signals cover central Milan only.**
   - The data has 302 traffic signals, 54 signal-controlled crossings, 36 stop and 203 give-way
     signs, in 11 central boxes.
   - They are OSM data and were not checked one by one.
   - Turns and access restrictions have also not been verified street by street.
6. **OSM data is not road condition.**
   - "Confirmed" means an OSM `surface` tag, not a survey. Tags can be wrong or out of date.
   - Tram tracks on asphalt are deliberately not treated as pavé, as on Corso San Gottardo.
   - Missing tags are counted as unknown.
7. **Free public providers.**
   - Travel times have no live traffic.
   - FOSSGIS Valhalla, Nominatim and OpenFreeMap are rate-limited community services.
   - The reroute surface-aware search adds one provider call, about 1 s.
8. **Out of date outbound User-Agent.**
   - The geocoding and routing requests still name the old beta URL as the contact address.
   - That URL now answers HTTP 401.
   - Update it at the next release.

## 4. Workers Free: verified behaviour (Phase 4.33)

Measured with `wrangler tail` and Cloudflare analytics on the separate test Worker
`lastrico-free-test`, Milan and Roccella only, on 9 November 2026. The same 20 route requests ran
twice: at 16:12 UTC before the final fixes, and at 19:17 UTC with them. Evidence:
`outputs/phase433/free-test-*` and `outputs/phase433/release-*`.

- **Durable Object CPU**
  - Route computation in the `RouteEngine` Durable Object took a median of 127–156 ms of CPU, and
    up to 319 ms.
  - All 40 calls ended `ok`, including a burst of six requests two seconds apart and a fresh object.
  - The Worker in front of it used 0–2 ms per request.
  - The routes of the two runs are identical, and identical to the local runs.
  - This matches Cloudflare's documented 30 s of CPU per Durable Object request on the Free plan.
    It is measured behaviour, not a guarantee.
- **When the Durable Object fails**
  - With the binding present, the ordinary Worker never computes a route.
  - An error Cloudflare marks retryable and not overloaded, such as the reset every deployment
    causes, is retried once on another shard and logged as `route_engine_retry`.
  - Any other failure answers `503` with an Italian message, `Retry-After: 60` and `no-store`, and
    is logged as `route_engine_unavailable`. During navigation the app keeps the current route.
- **Homepage**
  - The server render of `/` used 6–37 ms of CPU, above the 10 ms limit.
  - It has no per-request content, so the deploy now writes it once to `dist/client/index.html`
    (`scripts/homepage-snapshot.mjs`), and Cloudflare serves it before the Worker.
  - In the second run, 7 page loads invoked the Worker 0 times.
- **Pending timers and Free-tier consumption**
  - Provider calls used `AbortSignal.timeout`, whose timers cannot be cleared. Each Durable
    Object invocation stayed active until they fired: exactly 4, 8 or 12.2 s, while the route was
    ready in 1–6 s.
  - The timers are now cleared when the call ends. The deadline still covers a stalled response or
    body (unit tests).
  - **Measured active time, which is the billed duration:**
    - before: 194.5 s for 20 requests, 9.7 s each, about 1.2 GB-s at 128 MB;
    - after: 74.5 s for 21 requests, 3.6 s each, about 0.44 GB-s;
    - the Free quota is 13,000 GB-s per day.
  - Invocation wall time now matches the response: median 5.3 s, maximum 5.4 s, against 12.2 s.
- **Daily capacity:** none is guaranteed. Consumption depends on provider wait times, reroutes and
  traffic, and 40 requests are not enough to estimate it.
  - If a Durable Object quota is exhausted, routes answer `503` until the quota resets. The CPU
    limit is not bypassed.
- **Rollback.** Cloudflare refuses a rollback past a Durable Object lifecycle change, so once the
  release is live `wrangler rollback 03a6776e` is refused.
  - The rollback build (`scripts/prepare-pilot-rollback.mjs`) is the `03a6776e` code with the same,
    unused `RouteEngine` class.
  - Rebuilt, it matches the deployed `03a6776e` module for module, apart from per-build ids and that
    class, and it passes its 367 tests.
  - It was deployed over an existing `RouteEngine` namespace on the test Worker: accepted, serving
    the same assets as `03a6776e`, routes computed in the Worker.

## 5. Data and backup inventory

| Data | In Git | Reproducible | Notes |
| --- | :---: | :---: | --- |
| OSM source extracts, `data/sources/*.osm.json.gz` | ✅ | ❌ | Checksummed; source of every compiled dataset |
| Compiled surface tiles: Milan, Roccella, packed Rome | ✅ | ✅ | Manifests record source checksums |
| Rome unpacked tiles, `data/surfaces/rome-tiles/*.json` | ignored | ✅ byte for byte | `scripts/osm/build-rome-pilot.mjs` |
| ZTL areas and road features, `data/features/` | ✅ | ✅ | Built from `data/sources/` by `scripts/osm/extract-*.mjs` |
| Provider-response archive | ✅ packed | ❌ | `outputs/phase425-benchmark/provider-responses.tar.gz`, see `PROVIDER_ARCHIVE.md` |
| Benchmark and reroute case outputs | ignored | ✅ | Derived from the archive; summaries are versioned |
| Test fixtures (recorded handler payloads and provider responses) | ✅ | — | `tests/fixtures/`, `tests/e2e/fixtures/` |
| Real GPS traces | never | — | `outputs/field-traces/` is ignored; none were recorded |
| Local D1 database (`.wrangler/`) | ignored | ✅ | Development data only |
| Production D1 (community reports) | ❌ | ❌ | Lives in Cloudflare; no export procedure yet |

## 6. How the current numbers were produced

**Unit and integration tests**
- `npm test`: 447 of 447 on 9 November 2026, together with TypeScript, ESLint and the production
  build.

**End-to-end, emulated**
- `npm run test:e2e` runs headless Chrome against the local Worker with simulated GPS.
- The last full run passed 81 of 81. After the final selection change, a focused run passed 8 of 8.

**Routing benchmark**
- 88 Milan journeys in car, motorcycle and bicycle (264 cases), replayed from the archive, Monday 12:00:
  - at the default Strong level, 138 cases get a distinct anti-pavé route;
  - where there is pavé to avoid (198 cases), Lastrico offers something better than the standard
    route in 74 %;
  - the routes it shows carry 80.5 km of known pavé, against 146.9 km on the standard routes.
- Reroutes: 203 simulated wrong turns.
  - Confirmed pavé on the rest of the journey fell 10.7 %, and unknown surface 44.9 %, against
    the pilot logic.
