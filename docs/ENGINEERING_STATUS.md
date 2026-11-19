# Engineering status

Status on 19 November 2026. `main` is at `9cd25b2` (PRs #16 to #32 merged). **Two deployments are online** and
both stay online: the pilot `lastrico-pilot` (older code, built from `54bd605`, not touched) and the isolated preview
`lastrico-preview-437` (built from `49fea24` by deploy run 44477600454 on 19 November: anti-pavé, regional navigation, road layers,
independent tram preference, exact provider cap; Surface Intelligence code with the shadow off). This page separates what exists
locally from what is online, and fixed defects from open problems. Every claim points to the evidence in `outputs/`; the
detailed phase reports there are in Italian.

## Navigator intelligence (19 November 2026)

"Implemented" is code on a branch, "tested" is automated tests, "deployed" is on the preview. Nothing here is on the pilot.

| Feature | Implemented | Tested | Deployed (preview) | Limits |
| --- | :---: | :---: | :---: | --- |
| Road layers panel (surface; rails where a local layer set exists), hidden while navigating (PR #31) | ✅ | ✅ | ✅ `49fea24` | No rail data is shipped, so the rails view says "non disponibili in questa versione" |
| Independent tram preference, rail-aware candidate generation (PRs #27, #31) | ✅ | ✅ | ✅ `49fea24`, disabled without layers | Combined stone + tram gain not measured on this machine: it needs the local layer build |
| Provider-request cap counted per real request, retries and OSRM fallback included (PR #31) | ✅ | ✅ | ✅ `49fea24` | 7 per planner calculation, 4 per reroute |
| Optional live traffic: ETA, selection, congestion penalised with stone and rails, incidents, map overlay, hard quotas (PR #33, `outputs/traffic-provider-decision.md`) | ✅ | ✅ unit and handler tests on tile fixtures | ❌ | **Not checked against the live TomTom API: no key yet.** Off without a key, and says so |
| Provider-answer memo and journey-sticky Durable Object shard (PR #33) | ✅ | ✅ | ❌ | Latency gain not yet measured on Cloudflare |
| Tap within 14 px selects the road under a fingertip in the layers panel (PR #33) | ✅ | ❌ no automated test | ❌ | To be checked on a phone-sized viewport after deployment |
| Road-observation prototype: provenance, confidence, validation, corroboration; evidence can only add caution (PR #33) | ✅ | ✅ unit | ❌ not wired to any API | Prototype |
| Street-level imagery: free-source coverage and classifier quality (`outputs/street-imagery-evaluation.md`) | desk study | — | — | NO-GO for automatic classification; imagery stays a review channel |
| OSM, DBT, ATM evidence reconciliation | ❌ not changed | — | — | Needs the local layer build (mixed licences, kept local); the layer folders on this machine are empty |
| GPS, voice, reroute and arrival validation | — | ✅ emulated suites in CI only | — | No physical device was used |

## Product direction (18 November 2026)

Lastrico is a **general-purpose navigator** with an extra, own **road intelligence layer**. Focus is Milan, its
metropolitan area and the surrounding municipalities; Rome and Roccella stay in the code and data but get no new work.
Navigation never depends on the enriched coverage: outside it a route is calculated and followed like any navigator's
and every surface stays explicitly unknown. Details of the service area change: section "Regional navigation" below.

## Phase tracker: routing forensics and Surface Intelligence (4.36 to 4.40)

| Phase | Status | What it is | Where |
| --- | --- | --- | --- |
| **4.36** | **COMPLETED, archived in `main`** (PR #17) | Forensic audit of the 13 November return trip, data audit, routing experiments, SIL design, sensing feasibility. No production code. | `outputs/phase436-surface-intelligence/`, `experiments/phase436-surface-intelligence/` |
| **4.37** | **MERGED (PR #16, PR #20), on the preview, not on the pilot** | Anti-pavé candidate generation (15 m slices, stricter early stop, U-turn cost, trace v3) and, at "Maximum" avoidance, refinement while stone is left. | `main`; `outputs/phase437-local-routing-validation.md` (local, untracked) |
| **4.38 to 4.40** | **MERGED into `main` (PR #22), on the preview with the shadow OFF; no layer active** | OSM provenance and stable identities, offline SIL (evidence ledger, resolver, rails overlay), citywide DBT, source-separated layers and a read-only shadow adapter (`diagnostics.sil`, off by default) | the branch (unchanged history, merge commit on top of `main`); reports `outputs/phase438-*`, `phase439-*`, `phase439b-*`, `phase440-*` on it |

Measured on the preview against the pilot (18 November 2026, same provider, 8 public-landmark journeys, strict request
budget): identical routes on 5 of them (no regression); Piazzale Lodi return at "Maximum" **0 m instead of 25 m of
confirmed stone, passes Via Friuli, 22 s faster**; Piazzale Lodi outbound at "Maximum" 0 m instead of 50 m (+415 m);
Brera to Darsena by bicycle 192 m instead of 922 m of confirmed stone (+1.7 min). At "Strong" the two Lodi replicas are
identical (50 m and 25 m): the shortcut of the real plan was proven live in Phase 4.37 only. Provider requests per
calculation: 1 to 6 (cap 7). These are measured on the routing engine and a public provider, **not** on a physical road
or an iPhone.

**Rail data is evidence, not measurement.** The DBT layer says where the Comune mapped tram rails in 2020. It
does not say they are physically present or rough today, and the product must not claim otherwise.

## Road intelligence layer (own enriched road data)

| Part | State |
| --- | --- |
| Sources | OSM (ODbL 1.0), Comune di Milano DBT 2020 (CC BY; version 2.5 IT or 4.0, conflicting in its own metadata), ATM scheduled lines (CC BY 4.0), derived association metadata (internal) |
| Code | in `integration/road-intelligence`: `lib/sil-layers.ts`, `lib/sil-shadow.ts`, `scripts/sil/*` (build, parity, runtime and bundle measurement, corridor report, **`sil-inspect.mjs` local map inspector**) |
| Runtime | shadow only, **off by default** (`LASTRICO_SIL_MODE=shadow`); the layer index in Git is empty; layers are generated locally into a git-ignored folder |
| Measured (4.40, Node on Windows, not Cloudflare) | 264 of 264 Milan cases identical with the shadow on; about 1.2 to 2 ms CPU per request warm; +6.1 % gzip on the bundle in the 4.40 build |
| Online (18 Nov) | Linux CI green (PR #22); preview bundle 13413 KiB, gzip 3371 KiB (+0.3 %), Worker startup 15 ms. **Activated: nothing.** No layer is shipped or enabled, because the licence questions below are open |
| Not done | Cloudflare CPU and memory per request (needs the dashboard, no credentials here), any use of rails in ranking |
| Blocked | distribution of the layers and any combined OSM/DBT/ATM file until the licence questions in `outputs/phase440-sil-runtime-shadow-report.md` section 4 are settled; the DBT licence version conflict; the share-alike effect of ODbL on a combined database |

The inspector (`node scripts/sil/sil-inspect.mjs --layers=<build>/layers`) writes one local HTML page into the ignored
`work/` folder: a segment map coloured by mapped rails, surface material, coverage state or ATM service, with source,
date and licence per source. It never colours rails as roughness. Its output mixes licences and must not be published.

## Regional navigation (Milan, metropolitan area, surrounding municipalities)

Before 18 November a journey was refused unless **both** points were inside the Milan city box (9.04 to 9.31 E, 45.38 to
45.55 N): Malpensa, Monza, Como and Bergamo could not be calculated, and the GPS processor dropped every fix outside the
box. Now `PILOT_AREAS.milan.bounds` is the **service area** (8.55 to 9.85 E, 45.10 to 45.95 N) and the enriched data has
its own `coverageBounds` (the old city box). Search, route calculation, GPS tracking, reroutes, arrival and community
reports use the service area; the surface layer returns "unknown" wherever no compiled tile exists.

Verified with recorded provider answers (`tests/region-navigation.test.mjs`, `tests/fixtures/region/`, 40 live provider
requests used once): inside Milan 100 % surface coverage; Linate 46 %, Monza 21 %, Como 7 %, Malpensa 9 %,
Bergamo 7 %, Monza into Milan 42 %; every route complete with turn-by-turn instructions; 1 to 6 provider requests;
the old city-only bounds dropped over 100 simulated fixes on the Malpensa route, the new ones none, arrival detected.
Destination search keeps a place typed after the comma ("Via Roma, Como"), falls back to the text as typed, and lists
Milan's own results first. **Measured online on the preview (18 Nov, public providers, wall time):** Milan to Malpensa 62.9 km 6.3 s, Como 6.3 s, Monza 5.9 s, Bergamo 4.8 s, reroute 2.5 s, all with complete instructions; surface coverage 7 to 24 % outside the city; Paris refused (400); search for Aeroporto Malpensa 1.2 s, Via Roma Como found (one 503 under provider throttling, then 200 in 0.2 s); the pilot still answers 400 for Malpensa and was not touched. **Not yet checked:** CPU per request on Cloudflare; voice instructions across a whole route on a device; route calculation
CPU and latency on Cloudflare (a 60 km route took 0.3 to 0.8 s of CPU on Node and about 5 s of wall time with the
provider pacing); search availability under provider throttling (the public Nominatim and Photon timed out during
repeated checks).

## Repository inventory and cleanup recommendation

Nothing is deleted. `integration/road-intelligence` is merged (PR #22), so `feat/phase438` to `feat/phase440` and their worktrees can also go once you confirm. Recommended only after you confirm, item by item.

| Item | State | Recommendation |
| --- | --- | --- |
| Branches `fix/phase437-anti-pave-candidates`, `fix/milan-refine-while-stone-left`, `fix/ci-chrome-session-timeouts`, `ci/phase437-preview-workflow`, `ci/preview-437-pin-ba65a5f`, `docs/phase436-archive-clean` | merged into `main` | safe to delete (local and remote) |
| Worktrees `wt-cihang`, `wt-preview437`, `wt-pin`, `wt-refine`, `wt-val437-base`, `wt-val437-cand`, the two `Lastrico-phase436-*` worktrees | their branches are merged, or detached validation copies | safe to remove once their logs are not needed |
| Branches `feat/phase438`, `feat/phase439`, `feat/phase439b`, `feat/phase440` and their worktrees | **unpublished**, contained in `integration/road-intelligence` | keep until the integration branch is pushed and merged |
| Untracked `experiments/phase436-surface-intelligence/` and `outputs/phase436-*` in the main worktree | local evidence and caches larger than what PR #17 archived | keep; do not publish (mixed licences, private route context) |
| `outputs/phase437-local-routing-validation.md` and its helper folder | local report on the 264 cases | commit to `main` as documentation when you decide |
| `docs/BUG_AUDIT*.md`, older `outputs/phase*` reports | historical | keep, no migration |

## 1. Where each feature stands

**Legend**
- **Local:** implemented on `main` and covered by unit and integration tests.
- **Pilot:** included in the public pilot, version `73411cc6` (Phase 4.35 release of PR #14,
  commit `54bd605`, Milan and Roccella only, deployed on 13 November 2026). The previous version
  was `fe69e630` (Phase 4.34).
- **Emulated:** passed the end-to-end suite in headless Chrome with simulated GPS.
- **iPhone:** checked on a physical iPhone.

| Feature | Local | Pilot | Emulated | iPhone |
| --- | :---: | :---: | :---: | :---: |
| Surface-aware route planning (car, motorcycle, bicycle) | ✅ | ✅ | ✅ | ✅ Phase 4.28 road test |
| Anti-pavé vs Fastest comparison, three avoidance levels, extra-minute limit | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| Confirmed, probable and unknown surface shown separately | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| Bicycle "walk this stretch" notice at pedestrian-only ends | ✅ | ✅ | ✅ | — |
| Premium UI 2.0 (light and dark, phone, landscape, desktop) | ✅ | ✅ | ✅ | ✅ Phase 4.28 |
| GPS navigation, voice, arrival detection | ✅ | ✅ | ✅ | ✅ Phase 4.28 version, issues found |
| GPS fusion, smooth arrow and camera follow (Phase 4.29) | ✅ | ✅ | ✅ | ❌ |
| Upcoming-surface warnings with street name and length (4.29 and 4.31) | ✅ | ✅ | ✅ | ❌ |
| Faster wrong-turn and parallel-street detection (Phase 4.31) | ✅ | ✅ | ✅ | ❌ |
| Surface-aware search during reroutes; objective kept for the journey (Phase 4.31) | ✅ | ✅ | ✅ | ❌ |
| Traffic lights, stop and give-way signs from OSM, central Milan (Phase 4.31) | ✅ | ✅ | ✅ | ❌ |
| Milan ZTL avoidance with per-zone, per-mode authorisations (Phase 4.31) | ✅ | ✅ | ✅ | ❌ |
| Reverse A/B button (Phase 4.31) | ✅ | ✅ | ✅ | ❌ |
| Proportional confirmed-pavé tolerance in selection (Phase 4.31 review) | ✅ | ✅ | ✅ | ❌ |
| Worker CPU and memory reductions (Phase 4.30) | ✅ | ✅ | ✅ | — |
| Shared-edge scoring and other CPU cuts, routes identical (Phase 4.33) | ✅ | ✅ | ✅ | — |
| Route computation in a Durable Object, explicit 503 on failure (Phase 4.33) | ✅ | ✅ | ✅ local Worker runtime | — |
| Provider timers cleared after each call (Phase 4.33) | ✅ | ✅ | ✅ | — |
| Homepage served as a static snapshot (Phase 4.33) | ✅ | ✅ | ✅ | — |
| Field-trace v2: route objective and pavé, warnings shown, page hidden; GPX export; 7-day retention (Phase 4.34) | ✅ | ✅ | ✅ | ❌ |
| Penalised anti-pavé search targets stone slices from 15 m (Milan); cheap improvement ends the planner search only when no stone is left; U-turn costs 60 s in the comparison (Phase 4.37; not yet on the pilot) | ✅ | ❌ | ❌ | ❌ |
| Field-trace v3: how each route was generated (anti-pavé status, candidates and verdicts, no coordinates); honest "nessun pavé noto" reroute notice (Phase 4.37; not yet on the pilot) | ✅ | ❌ | ❌ | ❌ |
| Trace triage by category, `scripts/replay-gps-trace.mjs --text` (Phase 4.34) | ✅ | — | — | — |
| Field note "wrong pavé warning", with the route's rough section attached (Phase 4.34) | ✅ | ✅ | ✅ | ❌ |
| Provider User-Agent names the project repository (Phase 4.34) | ✅ | ✅ | — | — |
| Offline audit of central-Milan signals, signs, one-ways and turn restrictions; 144 points ranked for on-site checks (Phase 4.34, `outputs/phase434/intersection-audit.md`) | ✅ | — | — | ❌ |
| Milan address search: local index of 4,668 streets, typing without Nominatim, provider breakers, honest list statuses with Riprova (Phase 4.35) | ✅ | ✅ | ✅ | ❌ |
| "Descrivi la tua preferenza" rule-based preference prompt | ✅ | ✅ | ✅ | — |
| Moderated community surface reports (D1) | ✅ | ✅ | ✅ | — |
| Milan coverage | ✅ citywide | ✅ | ✅ | ✅ |
| Roccella Ionica coverage | ✅ | ✅ | ✅ | — |
| Rome coverage (Phases 4.23 and 4.27) | 🧪 experimental | ❌ never deployed | ❌ (data, unit and API validation only) | ❌ |

**About the iPhone column**
- "Phase 4.28 road test" means the author drove and rode with the public pilot on 7–8 November
  2026, when it ran version `03a6776e`. No physical iPhone has run the Phase 4.33 release yet.
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
| **Milan address search froze after repeated edits; "Via Filippo Argelati" not found** (field report, Microsoft Edge, 12 November) | 1. The Nominatim rate limiter chained every call on one promise shared across requests. A request cancelled by Workers when its client aborted (each keystroke) never settled its link, so every later Nominatim lookup in that isolate timed out for minutes. Reproduced on the pilot with `wrangler tail`. 2. Photon, the fallback, was timing out at the same time. 3. The page swallowed every failure, so a 503 looked like "address not found". 4. Typing used Nominatim, against its usage policy. | **Pilot, Phase 4.35 (`73411cc6`, 13 November 2026).** <ul><li>Fetcher spacing kept in plain numbers, with fail-fast; provider breakers.</li><li>Typing never reaches Nominatim (`purpose=suggest`).</li><li>A local index of 4,668 Milan streets from OSM, served as a static asset.</li><li>Honest list statuses with Riprova.</li></ul> Measured: 98.1 % of the Comune's street directory found in the top 5; 50/50 browser edits under injected faults, against 17 silent failures on the pilot frontend. On the pilot after the release: the same typing burst that froze 4.34, then new searches answered 200 in 0.3–1 s; 50/50 and 10/10 (live providers) browser edits. Evidence: `outputs/phase435-address-search/`, report `outputs/phase435-milan-release-report.md`. |
| **Routing CPU and memory peaks** | A brute-force corridor comparison (59 % of CPU), and all 117 Milan tiles expanded in memory (107 MB, against a 128 MB isolate limit). | A spatial grid and per-request caching (same results), plus at most 64 expanded tiles. Median CPU per request fell from 20 to 12 ms, total CPU by 50 %, and memory to 76 MB. Report: `outputs/phase430-worker-reliability-report.md`. |

## 3. Open problems

1. **Workers Free CPU limit: mitigated on the pilot, not guaranteed.**
   - **Before:** version `03a6776e` failed route calculations intermittently. Workers Free allows
     10 ms of CPU per request, with some per-isolate tolerance, and stops requests at that limit,
     which the visitor sees as error 1102 or 503 (`outputs/phase433/`).
     - In real use there were 1 failure in 297 requests on 7 November and 7 in 128 on 8 November.
     - In a controlled burst of 14 route requests within one minute, 12 failed. Every failure was
       a CPU stop.
   - **Now:** the Phase 4.33 release (`170ac277`, 9 November) computes routes in a SQLite-backed
     Durable Object, which allows 30 s of CPU per request on Workers Free, and serves the homepage
     as a static file. Routing CPU was also cut by 39 % with identical routes.
   - **Measured on the pilot after the release** (§4, `outputs/phase433/pilot-170ac277-*`): 52 of 52
     route requests succeeded, with up to 345 ms of CPU in the Durable Object and no CPU stops.
   - **Remaining risk:** the community-report list (up to 26 ms) and address search (up to 10 ms)
     still run in the ordinary Worker; the Free quotas are not a capacity guarantee. Workers Paid
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
   - **Photon throttles the pilot's address suggestions (Phase 4.35).** On 13 November, after
     about nine suggestion requests in four seconds, Photon answered the Worker HTTP 503, while
     it answered direct calls normally. The breaker then serves the Milan street index alone for
     at least 20 s, and the list says that places and civic numbers are unavailable. Streets
     stay searchable; places need an explicit search meanwhile.
8. **Out of date outbound User-Agent: fixed on `main` and on the pilot (Phase 4.34).**
   - Up to Phase 4.33, the geocoding and routing requests named the old beta URL, which answers
     HTTP 401.
   - Phase 4.34 names the project repository through one constant (`lib/provider-identity.ts`).
     One request to each provider with it answered 200 on 10 November 2026, and it is deployed on the pilot.

## 4. Workers Free: verified behaviour (Phase 4.33)

Measured with `wrangler tail` and Cloudflare analytics on the separate test Worker
`lastrico-free-test`, Milan and Roccella only, on 9 November 2026. The same 20 route requests ran
twice: at 16:12 UTC before the final fixes, and at 19:17 UTC with them. Evidence:
`outputs/phase433/free-test-*` and `outputs/phase433/release-*`.

- **On the public pilot after the release** (`170ac277`, 9 November, 19:51–20:03 UTC,
  `outputs/phase433/pilot-170ac277-*`):
  - 52 of 52 route requests ok, including a burst of six and four in parallel; 20 of 20 benchmark
    routes identical to the test Worker run;
  - Durable Object CPU median 85 ms, maximum 345 ms; Worker in front 0–3 ms;
  - Durable Object wall time median 1.2 s, maximum 5.5 s, never longer than the response;
  - Cloudflare analytics: 141 Worker requests, 0 errors, no CPU stops, CPU p99 11.5 ms; 0 Worker
    runs for the homepage;
  - mobile end-to-end suite 81 of 81 against the pilot.
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
- **Rollback.** Cloudflare refuses a rollback past a Durable Object lifecycle change. The release
  created the class, so `wrangler rollback 03a6776e` is now refused; rollbacks between versions that
  have the class work normally.
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
- `npm test`: 477 of 477 passed (2 skipped for Rome in Milan release copy) on 11 November 2026,
  together with TypeScript, ESLint and the production build.

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
