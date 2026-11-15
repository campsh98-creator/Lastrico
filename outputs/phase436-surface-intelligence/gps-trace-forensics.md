# GPS trace forensics — return journey, 13 Nov 2026

Owner: principal agent. Scope: the single attached trace. **Outbound evidence is NOT in this file and not in the trace**
(see section 8). Everything below is computed locally from the supplied file; the raw trace is not in Git and no value
here was sent over the network. Origin and destination are redacted on purpose.

- Input: `lastrico-gps-trace-2026-11-13-18-26.json`, 317,624 bytes, SHA-256
  `2aa69324cfdb2247323917c8aebe5f99891ae98418a4776f71f57bff07e4bffa`. Access: the file sits in the user's Downloads
  folder and is readable by local tools, so no transfer was needed. The conversation attachment was only an excerpt
  (the file is too large to inline), the **whole file was parsed from disk**.
- Reproduce: `node experiments/phase436-surface-intelligence/scripts/gps-trace-forensics.mjs <trace.json> --out=<summary.json>`
  and `node scripts/replay-gps-trace.mjs <trace.json> --text` (existing Phase 4.34 tool). The redacted aggregate output is
  `evidence/gps-trace-summary.redacted.json`.
- Evidence labels: VERIFIED = computed from the file; STRONGLY SUPPORTED / PLAUSIBLE / UNVERIFIED as defined in the README.

## 1. Schema and integrity (VERIFIED)

| Item | Value |
|---|---|
| Schema | `lastrico-gps-trace` v2, app 0.5.0, area `milan`, mode `car`, not synthetic |
| Parsed with the app's own validator | `parseGpsTrace` accepts it; no unexpected fields |
| Start | 2026-11-13 18:26:50.898 UTC (19:26 local) |
| Fixes / decisions / routes / events | 951 / 951 (1:1) / 2 / 8 |
| Duration | 1013 s (16.9 min) |
| Fix cadence | median 1.0 s, p95 2.4 s, max 3.1 s; no duplicate or backwards timestamps; 32 gaps of 2.6–3.1 s |
| Delivery latency (received − fix time) | constant ≈ 2.2 s |
| Replay | `replay-gps-trace.mjs`: 930 accepted, 21 rejected, 0 outside area, 1 reroute, **0 decision differences** (the app logic reproduces its own recorded decisions) |

## 2. Timestamped event summary (relative time from first fix)

| t (s) | Fix | Event | Reading |
|---|---|---|---|
| 0 | 0 | `pave-warning-shown 391:391` | Warning for the Piazzale Lodi sett section (starts 391 m ahead) shown at departure, before any movement |
| 0 | 0 | `wake-lock true` | Screen kept awake |
| 2–35 | 2–35 | stationary (33 s, speed < 0.5 m/s) | Driver still parked / starting; GPS 11–30 m accuracy in the first 10 s |
| ~55–88 | 60–98 | car moves ≈ 60 m along the planned route | Slow progress, queue or manoeuvring (speed 0.5–3.7 m/s) |
| 88 | 98 | last fix within 15 m of route 0 (58–64 m along it) | Driver reaches the first cross street on the right |
| 90–95 | 100–105 | heading ≈ 207° (SSW), speed 4–6 m/s, offset from route 0 grows 44 → 66 m | Driver has turned into the cross street (Via Friuli); planned manoeuvre was ≈ 160 m further |
| 94 | 104 | `shouldRecalculate = true` (first time, fix index 104) | Wrong-turn evidence satisfied: net travel since the divergence passed the 35 m car threshold (34.9 m one fix earlier) |
| 95 | 105 | `off-route`, `reroute-start` (reason `wrong-turn`, deviation count 1) | Same handler call as the line above: the event counter `atFix` is the number of fixes recorded so far, i.e. fix index + 1 (Agent 1, `gps-trace.ts:484`) |
| 96 | 106 | `reroute-success`, detail `safe:no-alternative` | Request answered within ≈ 1 s on the trace clock; the objective sent was `safe` (anti-pavé) and the engine found no distinct alternative |
| 96 → 1013 | 106 → 950 | no further `off-route`, no second reroute | Route 1 followed to the end of the recording |

No `reroute-failure`, `signal-loss`, `foreground-resume`, `page-hidden`, `gps-rearm`, `voice-spoken` or
`pave-warning-spoken` event exists: the app was in the foreground, spoke nothing and did not lose the screen.

## 3. Planned route versus actual trajectory (VERIFIED)

| | Route 0 (plan at fix 0) | Route 1 (after reroute at fix 106) |
|---|---|---|
| Objective label shown | `fast` | `fast` |
| Distance / time promised | 4.703 km / 15.63 min | 4.334 km / 14.71 min |
| Confirmed pavé | 25 m (`sett`, "Piazzale Lodi", 391–416 m) | 0 m |
| Probable pavé / unknown surface | 0 m / 285 m (6.1 %) | 0 m / 285 m (6.6 %) |
| Instructions | 11 | 8 |
| Start | first road of the trip, heading south-east | first cross street, heading south-west, 61 m off route 0 |
| Fixes while active | 106 | 845 |
| Lateral offset while active (fixes ≤ 30 m accuracy) | median 3.3 m, p95 37.9 m, max 65.7 m (the 66 m is the departure) | median 2.2 m, p95 6.8 m, **max 10.8 m**; 754/754 fixes ≤ 15 m |

- **The driver did not follow route 0 beyond ~60 m** and then drove route 1 almost perfectly. This is consistent with the
  user's report that they followed Waze; the trace itself shows only the turn, not the app Waze used (VERIFIED turn,
  UNVERIFIED navigation source).
- **Geometry of the two plans (VERIFIED).** 198 of route 1's 211 vertices lie within 30 m of route 0. The routes are
  *the same road* after ≈ 220 m: route 0 reaches the Viale Isonzo corridor through Viale Umbria and the Piazzale
  Lodi roundabout (second exit); route 1 reaches it through Via Friuli, 150–200 m west of the roundabout. The two
  alternatives differ only in a ≈ 0.2–0.45 km opening stretch. Route 1 never enters the roundabout.
- **Like-for-like estimate (STRONGLY SUPPORTED).** The two promises are not comparable as printed (different start
  points). Measured on geometry only: from the junction where the driver turned, route 0 had ≈ 4635 m left and route 1 is
  ≈ 4326 + 61 m ≈ 4387 m, i.e. ≈ 250 m (5 %) shorter, ≈ 0.4–0.9 min faster at the providers' own pace. This holds only if
  the manoeuvre into Via Friuli is legal and connected; that is the question Agents 1 and 2 test.
- **Recording end (VERIFIED).** The last fix is at 86.6 % of route 1 (3749 of 4326 m), 141 m in straight line from the
  destination; the route still had a 4-instruction loop (≈ 580 m) to go. `arrived` was never set. The recording stopped
  or the driver parked early; the trace cannot show which.
- **Time (VERIFIED arithmetic, interpretation PLAUSIBLE).** After the reroute 917 s (15.3 min) elapsed for 3749 m
  (14.7 km/h average). The provider estimate of 14.71 min prorated to the 86.6 % driven is ≈ 12.7 min, so the drive
  took ≈ 2.6 min longer. Four stops of ≥ 15 s on route 1 (at ≈ 2.0, 2.2, 2.7 and 2.8 km along it; 25 + 18 + 43 + 19 =
  106 s) account for most of it; they look like signals or queues. Over the whole trace 249.5 s of fixes are stationary,
  including the 33 s at departure. Nothing here shows the routing time model to be wrong.

## 4. GPS quality (VERIFIED)

| Metric | Value |
|---|---|
| Accuracy (reported 1σ radius) | median 10.3 m; p75 16.1; p90 30.0; p95 104.9; max 148 m |
| Buckets | < 10 m: 433 · 10–20: 328 · 20–30: 95 · 30–50: 28 · 50–100: 13 · ≥ 100: 54 |
| Fixes worse than 30 m | 95 (10.0 %) |
| Speed | median 3.7 m/s, p90 8.4, max 13.1 (47 km/h); null for 58 fixes; heading null for 241 fixes |
| Stationary fixes | 295 (31 %), 249.5 s |
| Rejected by the app | 21 fixes, all `invalid` = accuracy 120–148 m (the app's cut-off is 120 m, `lib/navigation-state.ts:183`). The existing diagnosis text calls them "old, repeated or invalid"; the data shows they are low-accuracy fixes arriving 2.7–3.1 s after the previous one, interleaved with normal 1-s fixes (every 8–30 fixes) |
| Poor-accuracy clusters | (a) first 10 s at the origin, 28–34 m, stationary; (b) a 37-fix run ≈ 490 m after route 1's start on the Viale Isonzo corridor, 52–141 m (9 fixes while stopped, then 28 fixes at ≈ 6.3 m/s) |

- Cluster (b) did **not** produce an off-route or a bad match: route-1 offsets stay ≤ 10.8 m among the ≤ 30 m fixes and no
  reroute followed. Cause of the degradation: PLAUSIBLE (urban canyon or a railway/overpass structure on that stretch);
  not proven and not needed for the diagnosis. It is a candidate location for the "GPS-degraded" tag in the future
  surface layer.
- The wrong-turn rule fired 7 s after the last on-route fix (t = 88 s → 95 s), at reported accuracy 6.4–7.8 m, so GPS
  quality did **not** explain the reroute.

## 5. Reroute event explanation (VERIFIED from the trace; code reasons are Agent 1's)

1. The driver turned right at the first junction, ≈ 160 m before the instruction "turn right onto Viale Umbria".
2. For fixes 100–105 the progress model kept the progress at 63.9 m (a `pendingJump` held for 5 fixes; the projection onto
   route 0 stayed at 58.3 m because the car was moving away from the polyline) while the lateral offset grew
   44 → 66 m.
3. `shouldRecalculate` became true at fix 104 (offset 61 m, heading ≈ 207°, accuracy 6.5 m, car speed 4.9 m/s), the
   reroute request was logged as `atFix` 105 (reason `wrong-turn`) in the same handler call, and succeeded at event
   `atFix` 106. The lag after the offset first exceeded 44 m (fix 100) comes from the car's wrong-turn rule: at least 3
   divergent fixes and 35 m of net travel since the divergence, which was 34.9 m at fix 103. The held `pendingJump` is
   the designed hold state, not a fault (Agent 1, R5–R7, VERIFIED by instrumented replay). The round trip took 1.0–2.0 s.
4. The reroute used the journey objective `safe` (anti-pavé). The result `no-alternative` means the new route had no pavé to avoid: the
   handler status was `no-pave` (VERIFIED by reconstruction with the production handler). For that status the HUD falls
   through to "Nuovo percorso · da qui nessuna alternativa con meno pavé" (`lib/reroute-objective.ts:27-35`), which is
   misleading because the route has no known pavé at all. The text that was actually displayed was not recorded
   (UNVERIFIED).
5. **Therefore the return trip did exercise the anti-pavé objective at reroute time** (event detail `safe:`), but it did
   not test the anti-pavé *planning* behaviour: the plan at fix 0 offered no distinct alternative, and the 25 m sett was
   never approached. It must not be read as validation or refutation of anti-pavé routing.

## 6. Surface-warning analysis (VERIFIED)

- Route 0 carried one rough section: `sett`, "Piazzale Lodi", 391–416 m, 25 m confirmed. The roundabout traversal on that
  plan spans 390–459 m (instructions 2 and 3: 68 m), so the app flagged 25 of ≈ 69 m (36 %); the rest of the traversal is
  not flagged. Why: Agent 2's data audit.
- The warning was shown once, at fix 0, when the section was 391 m ahead. No spoken warning, no second warning: the driver
  turned away 133 m before the section, and the nearest fix to the section ever was 129.5 m away. **No fix lies within 30 m
  of the section; the driver never traversed it.**
- The 285 m of unknown surface appears unchanged on both routes (VERIFIED equality, identity of the ways is Agent 2's task):
  it must lie on the shared corridor, 6–7 % of the route. Neither route carried any probable pavé.
- No warning exists for tram rails or crossings in the trace or, as far as the trace schema goes, in the app's route
  model (`roughSections` only has `surface`): there is no field in which a rail warning could be carried
  (VERIFIED schema; code-level confirmation in `osm-data-audit.md`).

## 7. Unresolved uncertainty

1. ~~Why route 0 chose Viale Umbria/Piazzale Lodi instead of Via Friuli~~ — RESOLVED by `routing-forensics.md`: the Via
   Friuli shortcut was never a candidate (provider cost model plus a penalised anti-pavé search skipped because the stone
   slice measured 24.99 m against a 25 m minimum). Residual uncertainty: the provider graph of the drive was rebuilt on
   2026-11-14 03:50 UTC, so plan-time behaviour is STRONGLY SUPPORTED, not VERIFIED.
2. ~~Whether the Via Friuli manoeuvre is legal and connected~~ — RESOLVED by `osm-data-audit.md` (legal, connected,
   archived and current OSM) and by a live provider probe (`routing-forensics.md` H1).
3. Whether the driver followed Waze (user statement only); the trace cannot identify the other app.
4. What the HUD actually displayed after the reroute (not recorded; the logic implies the misleading "nessuna alternativa" line).
5. Why the recording ends 141 m short of the destination and whether the final loop of residential streets near the destination was driven.
6. The cause of the GPS degradation cluster at ≈ 490 m along route 1.
7. Whether the roundabout is physically sett on all lanes and entries (field observation only; no sensor or image data).

## 8. Outbound journey — what the trace can and cannot say

The attachment covers the **return** leg only. It contains: no U-turn instruction in either plan (all manoeuvres are
`depart`, `turn left/right`, `roundabout`, `roundabout exit`, `arrive`), no tram or rail data, nothing about Corso Lodi
or Via Lazzaro Papi, and no outbound fixes. Every outbound statement (anti-pavé route through Piazzale Lodi, sett across the
traversed roundabout, tram rails and rough paving at Corso Lodi / Via Lazzaro Papi, a questionable U-turn) is therefore
**UNVERIFIED by GPS** and rests on the user's screenshots and observations; it is investigated through route
reconstruction and data inspection in `routing-forensics.md` and `osm-data-audit.md`, never through this trace.
