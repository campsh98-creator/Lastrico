# Independent P0 audit of the 20 November 2026 road test (Claude, 21 November 2026)

Method: the three original trace files were parsed directly (not the summaries); every number below was recomputed. Raw traces stay
in the git-ignored `private/` folder; this report keeps only counts, durations, public street names and rounded bearings, no
coordinates of any journey endpoint. Nothing here was merged or deployed; the preview still runs `c428229`.
Nothing from the parallel (Antigravity) work was read. PR #38 and #37 were read as published diffs only.

## 1. Incident inventory (from the traces)

| Trace | What it is | Facts recomputed from the file |
| --- | --- | --- |
| 15:39 (journey A) | car, to Piazzale Lodi | 709 fixes, 835 s, accuracy median 8 m, heading present in 100 % of fixes; 3 reroutes; two background gaps of 112 s and 17 s (the page was hidden, the watch re-armed on return); arrived; route 0: 3,995 m, **25 m of confirmed sett (Piazzale Lodi)**, 53 m unknown, objective "safe", antiPave status "alternative", penalised search attempted, 0 generated |
| 17:19 (journey B) | car, Piazzale Lodi area toward San Babila | 1,022 fixes, 1,023 s, no gaps; **8 reroute requests, 7 of them in 96 s (fixes 245 to 341), 13 off-route events**; 5 of those 7 new routes began with "drive south-east on Corso di Porta Romana" then a U-turn 88 to 365 m ahead that the driver never made |
| 19:09 (journey C) | car, San Babila toward home | 12 fixes in 11 s, then `page-hidden` and nothing: the page was suspended by iOS, the driver used another app. The recorded proposal: 6,674 m, 21.5 min, 69 m confirmed + 10 m probable sett, 294 m unknown. Not a defect of routing; the track simply stops |

Older file `2026-11-13-18-26` is present in the folder and was not part of this review.

## 2. Root-cause matrix

| Issue | Verdict | Evidence |
| --- | --- | --- |
| B: repeated immediate U-turns | **Confirmed, fixed (PR #39)** | At the five reroutes the car moved at 4.7 to 5.8 m/s on course 311 deg; the new route's first 25 m ran at 131 deg, exactly opposite, then a U-turn. The provider snapped the start to the opposite carriageway because no direction was sent. The 7th reroute (course 311, route 311) was correct |
| B: "safe / fast" label flips | Reporting artefact, not a routing change | The journey objective stays "safe"; when no distinct alternative exists the shown card is the fast one and the trace records the shown kind. Not changed |
| B: Corso di Porta Romana "sett" 486 m | **Unverified** | The local archive says confirmed sett for 0 to 486 m; the user reports otherwise. Needs an image or an on-site check; no data was changed. Note: PR #38's claim that Corso di Porta Romana is one-way south-east is **contradicted by trace B**: the car travelled north-west on it and the app itself proposed a north-west route |
| A: 25 m of sett kept | **Confirmed, two layers** | (i) At "strong" it is the documented trade-off: the clean route costs +51 s for 25 m of stone, more than the rule values it (selection utility 60 against 42). (ii) At "maximum" a clean route is *supposed* to be asked for; on the preview it was not: the penalised and refined searches handed back the same route. A route with **0 m of stone exists** on the same provider (1,588 m, 321 s, scored with the local surface data: 1,587 m smooth, 0 unknown), found by excluding the three stone zones. Cause: a 15x multiplier on a 25 m slice is worth about a 250 m detour; Fixed for "maximum" by PR #40 |
| A: "zero alternatives generated" | Explained | `generated 0` meant the penalised search returned a route equal to an existing candidate (deduplicated), not a provider failure (`failed: false`) |
| A: Phase 4.37 did not prevent recurrence | Partly | 4.37 made the 24.99 m slice targetable and fixed the early stop; its own fixture note says a 0 m route "stays behind the refinement gate". It never covered the case where the refinement also fails |
| A: Vittadini, Friuli | Not separately provable | The 0 m route passes Via Friuli and Via Lodovico Muratori; Via Vittadini was not on it |
| C: trace stops after 12 s | Confirmed platform limit | iOS suspended the page; the recorder persisted what it had. See section 6 |
| Heading in every provider call | Verified in code | PR #39 carries it through the provider meter, so base, penalised, refined, detour, rail, traffic and exclusion searches all send it; the OSRM fallback cannot |
| PR #38 CI failure | Cause found | `rendered-html.test.mjs` pins the literal text `fetchEngineRoutes([start, end], mode, true, deadline, request.signal, meter)`; #38 added an argument. The assertion should be updated for the new call, not removed |

## 3. Corrections (all open, none merged, none deployed)

| PR | Branch head | Change | Tests | Linux CI |
| --- | --- | --- | --- | --- |
| [#39](https://github.com/campsh98-creator/Lastrico/pull/39) | `fad7626` | Reroutes send the vehicle's own course (device course or fix movement while moving, nothing at a standstill) on the first point of every Valhalla request; one counted retry without it if no edge matches; planner ignores it | provider body tests (4 request kinds, first point only), processor tests (course is not the matched route's bearing, standstill gives null), handler tests (reroute only, invalid values, fallback), replay numbers of the trace | green |
| [#40](https://github.com/campsh98-creator/Lastrico/pull/40) | `38c7988` | At "maximum" (Milan planner), one exclusion search around the stone left after the searches; selection untouched; inside the 7-request cap; not in reroutes; "strong" unchanged | real handler on recorded provider responses: stuck refinement gives 1 exclusion request and **0 m instead of 50 m**; no route available keeps the old answer; recorded case needs no exclusion; strong and reroute unchanged | green |
| [#41](https://github.com/campsh98-creator/Lastrico/pull/41) | `cae05cd` | Recorder core (library only) | 10 unit tests (also pass locally) | green |

Replay on the preview (`c428229`, journey A from a point 2.6 km along the route to the destination, fresh request, "maximum"):
safe route 25 m of confirmed sett, 270 s, 3 provider requests, 2 penalised routes generated and equal to the base. Not yet re-run
on #40: a deploy is needed.

## 4. Mapillary

Cannot be verified here: the API needs a token and none was used. The image ids, bearings and "confidence 0.91 to 0.96" in PR #38's
`mapillary-feasibility-pilot.md` have no reproducible source (no response files, no method for a visual classification), so they
must not be treated as evidence, and nothing derived from them should enter production data. One claim is wrong (one-way Corso di
Porta Romana, above). The licence reading (CC BY-SA 4.0 images; share-alike against ODbL) is plausible and was not re-verified in
full; keep imagery as a human-review channel (`outputs/street-imagery-evaluation.md`).

## 5. TomTom

Independent check on the two tiles the user saved locally (decoded with the repository's own decoder, no provider request):
- Both are Flow tiles (`Traffic flow` layer, extent 4096, line geometry only): 28 and 21 features, `traffic_level` 0 to 1 (16 and 10
  distinct values), `traffic_road_coverage` full or one_side, `road_closure` true on 2 features in each. The "21 features" claim is reproduced.
- Per TomTom's documentation `full` is a one-way road and `one_side` one side of a two-way road: the direction-aware matching is consistent with it.
- Placed at z12 x2152 y1465 the geometry fills 9.13 to 9.24 E, 45.45 to 45.53 N, plausible for central Milan.
- Through `addFlowTile` and `routeTraffic` on the real tile: a stretch at level 0.24 raises a 12 s car time to 52 s; motorcycle 32 s (half share, an
  assumption), bicycle unchanged; the reverse direction of a one-side feature is "not covered" (unchanged); a closed stretch gives +900 s for cars only.
- Not verified: incidents (no real incident tile exists), cache and concurrency against the live provider, tile licensing for storing
  tiles (the real tiles were **not** committed). The deployed code is `c428229`; PR #36 (probe-only gate) is not merged and would
  hold ordinary traffic, so it is not deployed. Traffic-aware ranking is covered by the existing handler tests (jam, mild traffic,
  unavailable, budget) that pass on `main`.
- Open question: both tiles show the same two closures 11 minutes apart (293 m and 564 m), which suggests a standing closure. A
  route crossing one is penalised +900 s for cars; confirm on the ground before trusting the penalty.

## 6. GPS recording

- `main` records only during navigation. Its GPX export writes one `trkseg`, so the 112 s hole of trace A is drawn as a straight line;
  there is no GeoJSON export, no import, no pause. PR #37 adds foreground location following and, by its own header, stores
  no coordinates; it does not provide any of the required functions.
- PR #41 adds the tested core (pause, resume, stop, gaps with reason, GPX and GeoJSON that split at gaps, import with validation,
  recovery that returns a paused recording). **Not done:** the interface (start before a destination, entry next to ZTL, Binari and
  Anti-pavé, controls, iPhone-sized layout) and the page lifecycle wiring. A web page cannot record in the background on iOS.

## 7. Verdicts

| Subsystem | Verdict |
| --- | --- |
| Reroute start direction (#39) | GO to merge after review; GO to field-test on a phone after deploy |
| Residual stone at "maximum" (#40) | GO to merge; unproven on the real journey until deployed |
| Strong avoidance on 25 m of sett | Product decision, not a defect (see below) |
| Live traffic flow | CONDITIONAL GO: real tiles parse and match; incidents NO-GO (never seen) |
| Mapillary-derived road data | NO-GO for production |
| Independent GPS recording | NO-GO until the interface exists; core is ready |
| iPhone road test | CONDITIONAL GO after #39 and #40 are deployed and one reroute is re-driven |

Product decision needed: whether "strong" should also chase the last 25 m of stone (+51 s on a 4 min trip). Today it does not, by design.
