# Phase 4.36 - Smartphone sensing: feasibility study and field-validation protocol (Agent 6)

Feasibility and protocol only. **No sensor data was collected, no recorder was added, no production file was edited, no prototype server was started.**
Baseline `main` @ `3e31da9`, today 2026-11-14. Labels: **VERIFIED** (named file or primary document read on 2026-11-14), **STRONGLY SUPPORTED**,
**PLAUSIBLE**, **UNVERIFIED**, **SIMULATION** (computed here from stated assumptions; never a measurement). Source log (15 of 15 fetches/searches, 4 failed):
`evidence/smartphone-sensor-feasibility/source-log.md`. Claims inherited from Phase 4.20 (retrieved 2026-11-05) are marked "inherited" and count as UNVERIFIED.
Roughness is not material and is not rails. This report never claims that a phone can identify a paving material.

## 1. Verdict in four sentences

1. **Technical feasibility (STRONGLY SUPPORTED):** every phone has an accelerometer and GPS; a browser delivers motion events (about 60 Hz) and 1 Hz GPS while the page is visible and the user has granted permission.
2. **Demonstrated measurement quality (VERIFIED): none.** No real vehicle, phone, road or pass has ever been recorded. Every accuracy number in the repository is synthetic (`experiments/roughness-sensors/README.md:13-16`, `results.json` `dataKind`), and the one decisive Phase 4.20 result points the wrong way for pavé: 9 of 11 degraded-asphalt sections were called rough-periodic (`results.json` `suite.overall.metrics.roughOther.calledRoughPeriodic = 0.8182`).
3. **What could plausibly be measured:** an *ordinal sustained-roughness level* of a stretch of road, per vehicle class and speed band, with an honest interval; **not** a material, **not** a rail. Whether even that is repeatable on real Milan streets is unknown.
4. **Recommendation:** NO-GO for any recorder in the app (web or native) and for any sensor-derived input to routing; CONDITIONAL GO for a team-only Stage-1 field study (about 125 person-hours, no purchases) whose first step, the documented physical survey, is valuable for Surface Intelligence regardless of the sensor outcome (section 12).

## 2. Headline findings

| # | Finding | Label |
|---|---|---|
| F1 | Both major browser engines cap motion events at 60 Hz: WebKit iOS `kMotionUpdateInterval = 1.0f / 60.0f`, polled by an `NSTimer`, no smoothing in that path; Chromium `kDefaultPumpFrequencyHz = 60`. At 60 Hz the Phase 4.20 limit is reproduced: sett joints are resolvable only below 10.8 km/h for a 0.10 m pitch (21.6 km/h for 0.20 m). The 0.09-0.22 m pitch band is **85 % resolvable at 10 km/h, 7 % at 20, 0 % at 30**. Bicycle speeds 8 / 12 / 18 km/h: 100 / 65 / 19 %. | VERIFIED (sources) + derived arithmetic |
| F2 | In the one real Milan drive (percentiles only), about **74 % of moving fixes are above 10.8 km/h** (26 % below); 54 % are below 20 km/h, 14 % above 30 km/h. Phase 4.20's own minimum usable speed is 2.5 m/s = 9 km/h (`src/analyse.mjs:64`), so the window where periodicity is resolvable for a car is about 9-10.8 km/h. Periodicity-based material evidence is out of reach for most driving; only amplitude (sustained roughness) remains. | PLAUSIBLE (6-knot interpolation, one trip) |
| F3 | **Segment assignment under real GPS error is the binding limit.** With the trace's accuracy mix, a 25 m way is assigned correctly with P = 0.70 (app-accepted fixes) or 0.75 (fixes <= 30 m only); a 13.1 m way 0.53-0.57; P >= 0.9 needs a way of **>= 65-102 m**, and **130-203 m** if reported accuracy is 2x too optimistic. The p90 along-track error is 19 m, so the 90 % uncertainty interval (38 m) is wider than the three ring ways of route 0 (25.0, 31.0, 13.1 m) and both Papi sett ways (20.5, 25.0 m). | SIMULATION |
| F4 | A 2.2 s IMU-vs-GPS clock misalignment (the trace's fix-delivery latency is a constant 2.2 s, `gps-trace-summary.redacted.json` `deliveryLatencySeconds`) shifts events by 6 / 12 / 18 m at 10 / 20 / 30 km/h and drops a 25 m way from P 0.75 to 0.67 / 0.49 / 0.30. Clock alignment is a first-order requirement, not a detail. | SIMULATION on a VERIFIED latency |
| F5 | **The statistical unit is the site, not the pass.** With an assumed x1.9 class effect and moderate variance, 4 sites per class give 17 % power to show AUC >= 0.85 with a lower bound >= 0.75; 8 sites 63 %; 12 sites 86 %. Going from 8 to 32 passes per site moves power from 63 to 65 %. A small team study can establish repeatability, speed behaviour and device agreement; it cannot prove that sett and asphalt separate across Milan. | SIMULATION (assumed variance) |
| F6 | One speed exponent cannot normalise two surfaces: band RMS scales as v^((w-1)/2) for an elevation PSD ~ n^-w, so two surfaces with slopes differing by 0.5 drift by 0.76x to 1.32x relative to each other between 10 and 30 km/h. The 4.20 fit (beta 0.499 asphalt, 0.949 sett) is a property of the generator, not of roads. | derived + VERIFIED (4.20 `results.json`) |
| F7 | Web sensing is structurally foreground-only: events are not fired to a non-visible document (W3C CRD 26 Oct 2026; Chrome page), Android native blocks continuous sensors for background apps from Android 9, and iOS home-screen Wake Lock works only from iOS/iPadOS 18.4. Navigation already holds a Wake Lock and GPS (`wake-lock true` event at fix 0 of the trace), so a web recorder would only ever run while the driver navigates; default background harvesting is impossible by construction. | VERIFIED |
| F8 | The contested Piazzale Lodi ring ways (111768010 = 31.0 m, 111767966 = 13.1 m) and the 20.5/25.0 m Papi sett ways are shorter than the position uncertainty. Crowd sensing cannot settle them; a photographed, measured field survey can, today, in minutes. | SIMULATION + VERIFIED lengths |

## 3. Platform constraints (what a recorder can and cannot do)

"inh." = inherited from Phase 4.20, not re-retrieved (UNVERIFIED for this phase).

| Topic | iOS Safari tab / home-screen PWA | Android Chrome tab / PWA | Native app (either OS) |
|---|---|---|---|
| Permission | `DeviceMotionEvent.requestPermission()`; without transient activation the promise rejects with NotAllowedError; secure context only (W3C CRD 2026-10-26, VERIFIED). Per-origin in-memory cache, PWA has its own store, WKWebView re-prompts (inh.) | Secure context; sensors in main frame/same-origin by Permissions Policy (Chrome page, VERIFIED). `requestPermission()` reports pre-set permission (inh.) | Android: no runtime permission up to 200 Hz (VERIFIED). iOS: raw `CMMotionManager` needs no usage string, on-device-only data is "not collected" for privacy labels (inh.) |
| Rate | **60 Hz**, NSTimer poll of Core Motion at 1/60 s (WebKit `.h` and `.mm`, VERIFIED) | **60 Hz** pump (Chromium `.h`, VERIFIED); Generic Sensor `frequency` option exists, max 60 Hz (inh.) | Android 12+: **200 Hz** cap without `HIGH_SAMPLING_RATE_SENSORS`, direct channel about 50 Hz (VERIFIED). iOS ceiling: UNVERIFIED (Apple page unreadable) |
| Anti-alias | None in WebKit's polling path (no smoothing in `.mm`, VERIFIED); upstream Core Motion filtering UNVERIFIED | UNVERIFIED | sensor-hub filtering UNVERIFIED; record ceiling and decimate offline |
| Precision | W3C asks for 0.1 m/s^2 and 0.1 deg/s rounding to limit fingerprinting (VERIFIED); WebKit iOS `.mm` applies none (VERIFIED). If rounded, quantisation floor 0.029 m/s^2 RMS (computed) | rounding UNVERIFIED | full resolution |
| Timestamps | `interval` is spec'd constant ms (VERIFIED) but WebKit passes 1/60 (inh.); use `timeStamp`. Poll jitter and stale repeats UNVERIFIED on device | same | Android: rate not queryable, use event timestamps (VERIFIED); sensor time base UNVERIFIED; `Location.getElapsedRealtimeNanos` is fix time since boot (VERIFIED) |
| GPS | `accuracy` = 68 % radius (W3C CRD 2026-11-05); `speed`, `heading` nullable, heading null when stationary; fix `timestamp` = time acquired (VERIFIED). Trace: median 10.3 m, p90 30 m, 10 % > 30 m, 21 fixes > 120 m rejected (VERIFIED) | same W3C text; native `getAccuracy()` = 68th percentile (VERIFIED) | raw GNSS measurements, dual-frequency: UNVERIFIED |
| Screen lock / background | events only when the document is visible (VERIFIED); locked screen or other app = gap; Safari/WebKit suspends updates (inh.) | "readings only accessible by a visible web page" (VERIFIED); locked-screen PWA behaviour UNVERIFIED; no documented background sensing for service workers (UNVERIFIED) | Android 9+: accelerometer/gyroscope deliver nothing to background apps; use a foreground service (VERIFIED); sensors are not stopped when the screen turns off (VERIFIED). iOS background modes UNVERIFIED |
| Wake Lock | Safari tab: 16.4+ (S, secondary). Home-screen app: **not before iOS/iPadOS 18.4** (WebKit bug 254545, VERIFIED); lock survival on screen lock UNVERIFIED | UNVERIFIED this session; the Lastrico app already logs `wake-lock true` (VERIFIED) | n/a |
| Battery, thermal | no measurement found (UNVERIFIED); Apple: interval fixed by WebKit, page can only stop listening (inh.) | none found (UNVERIFIED); left-on sensors "drain the battery in just a few hours" (VERIFIED, qualitative) | same; a dashboard phone in sun with screen, GPS and charging is a known throttling case (UNVERIFIED) |
| Cost, review | none (existing web app) | none | two stores, review, privacy labels, per-OS maintenance; Phase 4.20 estimated 4-8 weeks plus continuing device calibration; fees UNVERIFIED |

## 4. Physics: what 60 Hz and 1 Hz GPS allow

Run: `node experiments/phase436-surface-intelligence/scripts/sens-spatial.mjs` (analytic; output `spatial-resolvability.json`).

- **Re-derivation of the 11 km/h limit.** A joint of pitch p passed at speed v excites f = v/p. Nyquist at fs = 60 Hz is 30 Hz, so v_max = p x 30. For p = 0.10 m: 3.0 m/s = **10.8 km/h** (9.7 km/h with the 4.20 band edge 0.45 fs = 27 Hz). For p = 0.12: 13.0; 0.15: 16.2; 0.20: 21.6; 0.22: 23.8 km/h. Minimum resolvable wavelength 0.093 m at 10 km/h, **0.185 m at 20, 0.278 m at 30** (practical 0.103 / 0.206 / 0.309). Phase 4.20's "about 11 km/h" is the 0.10 m case; for large setts it is about 22 km/h. At 200 Hz native the 30 km/h limit would be 0.083 m, so a native ceiling recording would resolve every pitch in the band at all test speeds.
- **Aliasing without an anti-alias filter.** Joint frequency for p = 0.12 m is 23 Hz at 10 km/h (resolved), 46 Hz at 20 km/h (folds to 13.7 Hz) and 69 Hz at 30 km/h (folds to 9.4 Hz): the folded line lands in the wheel-hop band and moves with speed, so it looks like suspension response. Timer jitter of 2 ms costs only 7 % coherence at 30 Hz (an assumption; actual jitter UNVERIFIED). Sustained energy above 30 Hz folds into the band and inflates RMS (STRONGLY SUPPORTED by sampling theory).
- **Speed normalisation.** In a fixed *time* band, RMS ~ v^((w-1)/2) for road elevation PSD ~ n^-w: w = 2 gives beta 0.5 (the 4.20 assumption), w = 1.5 gives 0.25, w = 2.5 gives 0.75. Work in the spatial domain instead: report band power per cycles/m only up to n_max = 27 Hz / v (9.7 c/m at 10 km/h, 4.9 at 20, 3.2 at 30; bicycle 12.2 / 8.1 / 5.4 at 8 / 12 / 18 km/h). GPS speed error propagates directly: sd 0.5 m/s at 10 km/h is 18 % of v, i.e. 9-17 % error in normalised RMS (beta 0.5-0.95). The protocol therefore reports beta **per class**, never one global value.
- **Vehicle, tyre and placement transfer.** The phone sees road x vehicle x tyre x mount. Car: body 1-1.5 Hz, wheel hop 10-15 Hz (inh. from 4.20's illustrative parameters, UNVERIFIED for Milan cars). Motorcycle: engine harmonics at 20-100 Hz alias into the band (generator has `engine: true`; real size UNVERIFIED). Bicycle: tyre pressure and handlebar mass dominate; pocket placement adds the rider's body as a low-pass. The literature found by search (secondary; articles not read) agrees that speed, mounting, vehicle, suspension and device change the result and that smartphones are less accurate than reference profilers, though correlations with IRI exist; no systematic review or pooled accuracy was found (source-log #10). **Consequence:** an absolute index cannot be assumed; each (vehicle, device, placement) needs a same-session control on known smooth asphalt, and cross-session stability of that control is itself a test (G2).
- **Gravity, orientation, noise.** The 4.20 code projects onto the gravity axis (low-pass 0.3 Hz or `aig - lin`), independent of sign convention and mount orientation (tested on synthetic data, 56/57 tests pass on re-run; the single failure is a Windows path-separator assertion in `prototype.test.mjs:56`, unrelated, evidence `phase420-tests-rerun.txt`). Phone-in-hand and orientation changes are gated, not corrected. Sensor noise: no MEMS noise-density figure was read (UNVERIFIED); the only noise floor derived here is the 0.029 m/s^2 RMS quantisation of a 0.1 m/s^2 step, against a smooth-asphalt band RMS that 4.20 assumes around 0.1-0.28 m/s^2 (synthetic), so a rounded browser stream would leave a signal-to-quantisation ratio of only about 3-10.

## 5. Segment assignment under real GPS error (SIMULATION)

Run: `node experiments/phase436-surface-intelligence/scripts/sens-segment-assign.mjs` (seed 436006, 200,000 draws per cell, deterministic: same SHA-256 on two runs; Monte-Carlo vs closed form max |difference| 0.0016). Output `segment-assignment-simulation.json`.
Model: straight road, perfect geometry, map matching removes cross-track error, **along-track error only (optimistic)**. Reported accuracy is a 68 % radius (W3C; Android), so per-axis sigma = r68 / 1.5096. Accuracy mixtures are the trace's bucket counts (redacted summary; no coordinates): all 951 fixes; the 930 the app accepts (cut-off 120 m); the 856 with accuracy <= 30 m ("gate"). k = 2 means the true error is twice the reported one (calibration unknown, UNVERIFIED). Windows: 1.07 s, 50 % hop (Phase 4.20). Event model E (one error draw per event) and sustained-pass model W (one correlated shift per pass) have the same expectation (proved and checked); W adds the per-pass spread.

**P(event or window assigned to the correct segment), dt = 0:**

| Accuracy model \ way length (m) | 10 | 13.1 | 20.5 | 25 | 31 | 47 | 60 | 100 | 200 |
|---|---|---|---|---|---|---|---|---|---|
| fixed r68 = 5 m | 0.74 | 0.80 | 0.87 | 0.89 | 0.92 | 0.94 | 0.96 | 0.97 | 0.99 |
| fixed r68 = 10 m (about the median) | 0.51 | 0.61 | 0.74 | 0.79 | 0.83 | 0.89 | 0.91 | 0.95 | 0.97 |
| fixed r68 = 30 m (p90) | 0.20 | 0.26 | 0.38 | 0.45 | 0.52 | 0.67 | 0.74 | 0.84 | 0.92 |
| trace mix, all 951, k = 1 | 0.45 | 0.52 | 0.64 | 0.69 | 0.74 | 0.81 | 0.84 | 0.90 | 0.95 |
| trace mix, app-accepted 930, k = 1 | 0.45 | 0.54 | 0.66 | 0.70 | 0.75 | 0.82 | 0.86 | 0.91 | 0.95 |
| trace mix, gate <= 30 m (856), k = 1 | 0.48 | 0.57 | 0.70 | 0.75 | 0.79 | 0.86 | 0.89 | 0.94 | 0.97 |
| trace mix, app-accepted, k = 2 | 0.27 | 0.34 | 0.46 | 0.52 | 0.58 | 0.69 | 0.75 | 0.83 | 0.91 |
| P(>= 80 % of a pass's windows inside), gate, k = 1 | 0.24 | 0.31 | 0.46 | 0.54 | 0.62 | 0.78 | 0.85 | 0.95 | 1.00 |

- **Along-track |error| (m), p50 / p90 / p95:** gate 4.6 / 14.6 / 19.4; app-accepted 5.0 / 19.1 / 29.7; all fixes 5.1 / 21.1 / 37.0; app-accepted with k = 2: 10.1 / 38.1 / 59.2. This is the `spatialPrecisionM` the evidence record should carry.
- **Minimum way length for P(correct) >= 0.9:** 65 m (gate), 90 m (app-accepted), 102 m (all), and 130 / 179 / 203 m if k = 2. For >= 0.8: 33 / 41 / 44 m (65-88 m at k = 2). A pass puts >= 80 % of its windows in the right way in 90 % of passes only for ways >= 73 / 95 / 106 m.
- **Audit ways (app-accepted, k = 1; gate in brackets):** ring 287070936 sett, 25.0 m: **0.71 (0.75)**; ring 111768010, 31.0 m: 0.75 (0.79); ring 111767966, 13.1 m: **0.53 (0.57)**; Papi 164940302 sett, 20.5 m: 0.66 (0.70); Papi 164940303 sett, 25.0 m: 0.71 (0.75); Viale Umbria 289749136, 64.2 m: 0.87 (0.90); Papi 164940304, 97.1 m: 0.91 (0.93); Corso Lodi 36874245 sett, 138.6 m: 0.93 (0.95); Viale Isonzo 288900525, 207 m: 0.96 (0.97). Five of the nine ways are shorter than the 38 m p90 uncertainty interval.
- **Contrast dilution.** A rough way between smooth neighbours shows only the fraction P of its signal (an event or window leaks out as often as in), so a 25 m sett way reads about 70 % as rough as it is, with large pass-to-pass spread (only 50 % of passes keep >= 80 % of the windows).
- **Speed and clock.** At dt = 0 speed does not change P; it acts through clock offset and window length. Event P for a 25 / 60 / 100 m way with the gate mix at 30 km/h: dt 0.5 s -> 0.71 / 0.88 / 0.93; dt 1 s -> 0.61 / 0.83 / 0.90; **dt 2.2 s -> 0.30 / 0.69 / 0.81** (20 km/h, 2.2 s: 0.49 / 0.78 / 0.87). Window extent: a window spans 3.0 / 5.9 / 8.9 / 14.9 m at 10 / 20 / 30 / 50 km/h, so a 25 m way holds 15 / 7 / 4 / 2 windows fully inside; windows needed for 20 effective ones: about **2 / 4 / 7 / 14 passes**.
- **Not simulated (all make reality worse):** cross-track confusion between adjacent ways and carriageways, roundabout geometry (the ring is 12 ways within about 40 m radius with entries and a cycle track inside the error radius), map-matching errors, correlated GPS outage clusters (the trace has a 37-fix run at 52-141 m).
- **Mitigations to test, not assume:** speed-gated windows (>= 2.5 m/s), accuracy gate <= 30 m (costs 10 % of fixes), fix-timestamp alignment with a measured lag, HMM map matching that snaps to junctions and turns (removes the common-mode shift only near them; UNVERIFIED), and a **reportable-length rule**: record evidence for a way only if its length >= the p90 interval, otherwise mark `coverage: coarse` (section 9).

## 6. Sustained roughness versus isolated shocks: candidate features

Toy illustration only (`sens-shock-features.mjs`, seeded, output `shock-features-toy.json`; classes differ by construction, so it shows what each feature *measures*, not that real roads separate). Point-sampling at 60 Hz captures on average 38 % of a 10 ms pulse peak (41 % of such pulses are missed entirely), 74 % of a 20 ms pulse (5th percentile 32 %), 93 % of 40 ms, 98 % of 80 ms; at 200 Hz: 90 / 97 / 99 / 100 %. A 3-27 Hz band-pass removes a 1.5 Hz speed-hump heave completely (RMS, crest and events all unchanged in the toy), and an absolute 7-sigma event threshold fired 31 times per 100 m on sustained roughness (the local-adaptive threshold of 4.20 avoids this).

| Feature | Measures | What must be shown for it to separate classes | Known failure mode |
|---|---|---|---|
| nRMS: windowed RMS of high-passed (3-27 Hz) vertical acceleration, speed-normalised with per-class beta | sustained roughness level | monotone with surveyed class and with passenger comfort rating (Spearman >= 0.7); test-retest (G2); speed residual (G4); cross-device (G5) | confounded by tyre, load, mount, suspension, shocks; degraded asphalt (9 of 11 in 4.20 synthetic) |
| Share of windows above the control baseline over >= 40 m, median window RMS | sustained vs patchy | high in sustained, low with one shock | needs the window context larger than the shock |
| Band power in speed-normalised spatial bands (0.3-1, 1-3, 3-5 c/m, only where n <= n_max) | wavelength content | class-specific slope differences reproducible across speeds | bands above n_max unobservable at >= 20 km/h; aliasing |
| Crest factor, excess kurtosis per window | shock-ness | shock windows >= 6 and >> 3; sustained windows about 3-4; median-context contrast >> 1 | short pulses under-sampled at 60 Hz; hump invisible in 3-27 Hz |
| Contrast = peak-window RMS / median RMS within +-5 s | isolated vs sustained | > 3 for shocks, about 1 for sustained | long patches raise the median |
| Event rate per 100 m with a local-adaptive threshold | repeated shocks (rough patch of manholes/potholes) | rate stable per site and device | absolute thresholds confuse with sustained roughness |
| Pulse-train signature (spacing = geometry / speed; e.g. axle pairs) and gyro roll/yaw | tram or rail crossings (hypothesis) | known flush and protruding crossings give distinct, repeatable signatures; <= 1 false event per 10 km | rails along the lane produce lateral/yaw disturbance, not vertical (UNVERIFIED); needs surveyed rail type |

## 7. Experimental protocol (Stage 1, team only, no public release)

Pre-registered in a frozen file before the first pass (site list, survey forms, normalisation, feature code, thresholds, analysis script hash, stopping rules); deviations are logged, not edited. Feature code is blind to class labels; per-class beta and thresholds are fitted on half of the sites and evaluated on held-out sites.

**Ground truth is a documented physical survey, not OSM.** Two surveyors per site: photographs with a ruler (3 sett widths in the travel direction, joint width, course pattern, wear, patches), rail type (flush / protruding with height measured against a straightedge / groove width), start-end landmarks (kerb, lamp post, manhole), date, weather, photo of the vehicle's wheel track. No faces or plates in photos. Independent reference for roughness: a 1-5 comfort rating by the passenger after each pass (the product is comfort); no profiler is purchased.

**Candidate sites** (from the audits; the final list is frozen after the survey; a site fails if the survey contradicts its class):

| Class | n | Candidates (public OSM ids and audit lengths) |
|---|---|---|
| A smooth asphalt control | 3 | Viale Isonzo 288900525 (207 m), Via Lazzaro Papi 164940304 (97.1 m) and 264363555 (131.3 m); same-street control for Corso Lodi: asphalt ways 285186991 (182.4 m), 290130620 (170.2 m) |
| B small setts | 4 | Corso Lodi sett ways 290130631 (153.4 m, one carriageway), 36874245 (138.6 m, other carriageway), 290130621 (76 m), 305989915 (86.1 m, NW arm two-way); Papi 164940302 + 164940303 (45.5 m, too short for a sustained site, used for assignment tests) |
| C large / irregular stone | 2 | Corso Lodi 37036128 `paving_stones` (57.5 m, short); `paving_stones` cycle tracks 1156699187 (155 m, bicycle site); others chosen by survey (none documented in the audits) |
| D degraded asphalt (the 4.20 confounder) | 2 | none documented (only 8 ways / 243 m in Milan carry `smoothness` bad or worse on asphalt, `osm-data-audit.md` D5); chosen by survey |
| M mixed, surveyed transitions | 2 | Corso Lodi NW arm two-way carriageway (sett 456 m, asphalt 160 m interleaved) split at surveyed landmarks |
| Shock library | 10 | 3 flush and 3 protruding tram crossings (DBT 2020 tram-in-carriageway candidates: Corso Lodi NW arm, 1,040 m of axis, no scheduled tram per ATM 2026-07 so quiet to test, physical state UNVERIFIED; Via Friuli 60 m shared with ATM line 19, plus further stretches listed in `external-data-audit.md` finding 3 and section 3.A), 2 speed humps, 2 manhole covers or potholes, chosen on site |
| Survey-only | - | Piazzale Lodi ring ways 287070936, 111768010, 111767966 (contested): survey and one low-traffic pass at most; no repeated laps on a primary roundabout |

**Factors and replication.** Vehicles: Stage 1a two cars with clearly different suspension/tyre class (6 passes per site x speed x vehicle x phone pair); Stage 1b one motorcycle or scooter and one bicycle as reduced replicates (8 sustained + 6 shock sites, 4 passes). Speeds: car and motorcycle **10, 20, 30 km/h**, bicycle **8, 12, 18 km/h**, order randomised per lap, directions alternated, dry road only, tyre pressure, load and temperature recorded. Phones: one iPhone and one Android recording **simultaneously, side by side in the same placement**, so cross-device differences are not road differences; placement P1 = rigid windscreen/dash mount (handlebar mount for motorcycle and bicycle), P2 = cup-holder or centre tray (jacket pocket for two-wheelers), swapped between sessions (counterbalanced). A same-session lap on control site A at start and end of every session calibrates each (vehicle, device, placement). Logger: a native logger at the highest available rate (ceiling, >= 100 Hz) **and**, on >= 20 % of passes, the Phase 4.20 web prototype under the same conditions; the "web-achievable" dataset is produced by offline emulation (decimation to 60 Hz with jittered sample-and-hold and no anti-alias filter) and validated against the real web recordings. Nothing needs to be built for this: existing free third-party logger apps (names and versions UNVERIFIED) or the 4.20 prototype hosted on an owner-approved origin.
**Markers and clock test.** The passenger (never the driver) taps a marker as the vehicle passes surveyed landmarks, giving ground-truth along-track error at 0.2-0.3 s marker resolution (0.6-0.8 m at 10 km/h, 2 m at 30 km/h). Per session, an empty-road accelerate/brake manoeuvre gives the GPS-vs-IMU lag by cross-correlating GPS-speed derivative with forward acceleration per device.

**Passes and power (SIMULATION, assumed variance; `sens-power.mjs`, output `study-power.json`).** Totals per car: 13 sustained sites x 3 speeds x 6 passes = 234, plus 10 shock sites x 3 x 4 = 120, so 354 passes; both cars plus the two-wheeler replicates about 1,040 pass-recordings x 2 phones.
- Repeatability: 13 sites x 6 passes give df = 65 for the pass-to-pass SD (relative SE 8.8 %). Passes per site for a site-mean SE of 0.05 (log): 4 / 9 / 25 for rho = 0.10 / 0.15 / 0.25; 6 passes give SE about 0.06 at rho = 0.15.
- Speed residual: 13 pooled sites x 6 passes = 78 paired differences per speed pair, above the 36 needed to detect a 10 % residual at rho = 0.15 (11 for 20 %).
- Cross-device: 60 simultaneous pass pairs give the 95 % limits of agreement a standard error of 0.033 (log) at sd 0.15; Stage 1 has far more.
- Shock rejection: 60 known shocks per vehicle with 95 % observed rejection give a Wilson 95 % lower bound 0.86 (30 shocks: 0.83; 120: 0.90).
- **Separation across Milan is not testable in Stage 1** (F5): 3-4 sites per class give 17 % power (moderate variance, x1.9) and at most 73 % even with optimistic variance and an x2.5 effect. A first version of `sens-power.mjs` used a cluster bootstrap; with <= 4 clusters it gave non-monotone, anti-conservative power and was replaced by the site-level parametric test. Stage 1 therefore pre-registers *descriptive* separation and within-site criteria; Stage 2 (confirmatory, only after a Stage-1 GO) needs >= 12 independent sites per class on >= 4 different streets (sites on one street share age, laying and traffic, so they are not independent).

**Go / no-go criteria, fixed before any data exist** (G1-G10; "web" = web-emulated 60 Hz data, "ceiling" = native data):

| ID | Measure | GO (Stage 1) | STOP |
|---|---|---|---|
| G1 | Timing quality | effective rate >= 50 Hz and no gap > 150 ms in >= 95 % of pass windows, both devices (web) | < 80 % |
| G2 | Repeatability | pass-to-pass SD of log nRMS rho <= 0.20 at fixed site, speed, device, placement; ICC(1,1) over all sites >= 0.80 with lower bound >= 0.70 (inflated by class differences, so rho is primary); control-lap drift across sessions <= 0.15 log | rho > 0.30 |
| G3 | Separability (descriptive) | at the reference speed (20 km/h car/motorcycle, 12 km/h bicycle): pass-level AUC A vs B and A vs C >= 0.85 pooled; every A site median below every B site median on both devices; Spearman(nRMS, comfort rating) >= 0.7 | AUC < 0.70 on ceiling data |
| G4 | Speed-normalisation residual | per-class beta fitted on training sites; class means at 10 / 20 / 30 km/h within +-0.18 log (+-20 %) on held-out sites; label flips across speeds <= 15 % | residual > 0.35 log |
| G5 | Cross-device agreement | same pass, same placement: |mean log difference| <= 0.14, 95 % limits of agreement within +-0.34 log, Spearman of site means >= 0.9, after per-device control-lap gain | limits wider than +-0.6 log |
| G6 | Isolated-shock rejection | >= 90 % of >= 60 known shocks not labelled sustained (Wilson lower bound >= 0.80); >= 90 % of smooth 80 m sections with one shock stay "smooth"; rail-crossing hit rate >= 80 % with <= 1 false event per 10 km (reported only) | < 75 % |
| G7 | Segment assignment | measured p90 along-track error <= 1.3x the simulated p90 for the same accuracy mix (>= 100 landmark crossings per regime); field L_min (P >= 0.9) <= 100 m | p90 > 2x simulation |
| G8 | Battery and thermal | marginal cost of IMU logging over navigation-only (screen on, GPS) <= 3 percentage points per hour on each device; no throttling of the effective rate below 50 Hz in 60 min | not measurable or > 8 points/h |
| G9 | Clock alignment | residual GPS-vs-IMU lag <= 0.3 s after correction, both devices | > 1 s unstable |
| G10 | Safety and privacy | zero incidents; 100 % of participants consented; no raw data outside the team store | any breach |

Thresholds are planning values chosen before data; changing them after seeing data invalidates the pre-registration. Mixed (M) sites test boundary detection descriptively.

**Decision rules.** STOP sensing for roughness if G2 or G3 fails on the *ceiling* data (the signal is not there), or if G9/G10 cannot be met. CONTINUE web-only to Stage 2 if G1-G10 pass on web-emulated data. **Build a native recorder only if** web-emulated data fail G3 or G4 while ceiling data pass both with AUC >= 0.85, web-emulated AUC <= 0.75 (so the 60 Hz cap is the cause), the owner approves the purpose and maintenance load, and consent covers any background mode; otherwise never. Even after Stage 2 no output reaches routing without a separate release decision.

## 8. Output record for the Surface Intelligence layer (proposal for Agent 5)

Fits Agent 5's `Evidence` type (`evidence/surface-intelligence-design/sil-types.ts`): `topic: "physical_roughness"`, `kind: "measured"`, `claim.basis: "imu"`, `claim.measure` (`metric`, `value`, `unit`, `speedKph`, `vehicleClass`, `windowM`, `samples`), `spatialPrecisionM`, `observedAt` with precision `day`, `consent {version, aggregated, contributors}`, `modes`. Missing as first-class fields: interval, pass count, speed range, device class. Until the type is extended they go in the free-form `sourceRef`; better, add optional `measure.ci95`, `measure.nPasses`, `measure.speedKphRange`, `measure.deviceClasses`.

```json
{ "topic": "physical_roughness", "kind": "measured", "modes": ["car"],
  "refs": [{ "wayId": 0, "fromM": 0, "toM": 0, "wayVersion": 0, "wayLengthM": 0, "coverage": "exact | partial | coarse" }],
  "claim": { "level": "smooth | moderate | rough | very_rough | unknown", "basis": "imu",
             "measure": { "metric": "nrms_log_vs_device_control@20kph", "value": null, "unit": "log ratio", "speedKph": 20,
                          "vehicleClass": "car-compact", "windowM": 0, "samples": 0 } },
  "observedAt": "YYYY-MM-DD", "observedAtPrecision": "day", "spatialPrecisionM": 0,
  "verification": "machine_checked",
  "sourceRef": { "ci95": [null, null], "nPasses": 0, "nContributors": 0, "speedKphRange": [0, 0], "deviceClasses": ["ios-web", "android-web"],
                 "placementClasses": ["mount"], "metricVersion": "v1", "gates": ["G1", "G9"] },
  "consent": { "version": "v1", "aggregated": true, "contributors": 0 } }
```
Rules: never `surface_material`; rails only as a separate `rails_presence` / `rail_crossing` record after G6 and a surveyed truth; `level` thresholds come from the study, never from the 4.20 synthetic constants; `spatialPrecisionM` = measured p90 along-track error (section 5: about 15-21 m, 29-42 m if accuracy is mis-stated 2x); if way length < 2 x `spatialPrecisionM`, `coverage` must be `coarse` (can only weakly dissent, per Agent 5's rule); no individual trace, no per-device identifier, day-level dates; a record is emitted only when passes >= 10 from >= 5 distinct pseudonymous contributors on >= 3 days (section 9).

## 9. Privacy, consent and safety design

I am not giving legal advice. **The GDPR/ePrivacy article text could not be read this session** (EUR-Lex and two EDPB URLs failed, source-log #9, #13, #15); everything below is a design principle, UNVERIFIED against the primary text, for the owner's legal adviser.

**Study consent elements (team volunteers):** purpose (validate roughness sensing; no product use, no sale); exactly what is recorded (motion sensors, GPS, device model and OS, vehicle class, comfort ratings, tyre pressure) and what is not (microphone, camera, contacts, identity on the data); storage place and access list; retention (proposal: raw files 90 days then deleted, derived features without coordinates kept); right to withdraw and to deletion at any time without consequence; voluntariness stated explicitly, especially where participants are employees or colleagues (consent validity in an employment context is a legal question to confirm); vehicle insurance and traffic-law responsibility stays with the driver; safety rules below; contact point.
**Data handling, study:** local recording on the phone, export by the participant to a team-controlled store, pseudonymous participant ids, tracks trimmed to the site buffer plus 200 m, raw IMU/GPS never leave the team store, no raw data in the repository (`outputs/field-traces/` is git-ignored; the same rule applies), no public release of tracks.
**If a crowd feature is ever considered (not now):** explicit opt-in per session and revocable; purpose limited to roughness evidence; processing on the device; only per-way aggregates leave (way id + interval, level, window count, speed band, device and vehicle class, day), **no raw IMU** (the W3C text rounds values and Android rate-limits from API 31 precisely because motion data is sensitive, VERIFIED) and no raw GPS; no default or background harvesting (web cannot, native must not); retention limited, aggregates only after the minimum-contributor rule. Proposed rule for published evidence: **k >= 5 distinct contributors, >= 10 passes, >= 3 days**, owner decision. Tension to resolve: counting distinct contributors needs a pseudonym that can be linked across submissions, while unlinkability (random per-submission token) prevents counting; a daily-rotating pseudonym is a possible compromise. Submissions from one device in time order reveal a path even without a trace, so batching and random delay are required. A DPIA question for systematic location processing at scale is flagged for the owner (UNVERIFIED).
**Ethics and safety:** mount the phone securely before moving; **nobody touches a phone while the vehicle is moving**, the passenger operates recording and markers (motorcycle and bicycle: start and stop at a standstill, ratings after the lap); closed or low-traffic roads and low-traffic windows (early weekend morning); no repeated slow laps on primary roads or roundabouts; never obstruct traffic or trams, obey the speed limits (10 km/h passes only where safe and legal); dry weather; helmets and lights; stop if a participant feels unsafe; no operating the phone for ratings while moving. Photos of the surveys avoid faces and plates.

## 10. Minimal cost estimate

| Item | Estimate | Basis |
|---|---|---|
| Survey of about 25 sites (2 people, 0.75 h per site including travel) | about 35 person-hours | planning value |
| Field sessions: 2 cars about 10 h each, motorcycle and bicycle about 4 h each, 2 people | about 56 person-hours | 45 laps x about 12 min plus control laps, planning value |
| Briefing, pilot lap, consent, QA | about 10 person-hours | planning value |
| Analysis and pre-registration (developer) | about 20 hours | scripts exist (`sens-*.mjs`, 4.20 `src/`) |
| **Total** | **about 125 hours, 3-4 weekends**, consistent with the 4.20 estimate of 2-3 weeks plus outings | |
| Purchases | **0** (borrowed phones, mounts, tape measure, ruler); if no mount can be borrowed, a purchase of about 10-30 EUR needs owner approval (price UNVERIFIED) | |
| Hosting for the web prototype | needs an HTTPS origin (iOS motion permission, `ios-permissions.md`); an existing project origin might serve it unlinked, owner decision | |
| Native recorder (not recommended) | 4-8 weeks plus continuing calibration (4.20 estimate), store accounts, review, privacy labels; fees UNVERIFIED | |

## 11. Risks

1. **No signal.** Real sett and asphalt may not separate at 60 Hz and >= 11 km/h (F1, F2); mitigated by the ceiling recording, which tells whether the cause is the sensor path or the physics.
2. **False certainty.** A roughness index mistaken for a material or rail detector; mitigated by the record rules in section 8 and by never exposing material from sensors.
3. **Confounders:** tyre pressure, load, temperature, suspension, mount, driver style, lane position; the control lap and counterbalancing address some, not all.
4. **Site independence:** Corso Lodi stone shares age and laying; Stage 2 needs several streets.
5. **GPS and clock:** F3 and F4; cross-track and roundabout effects are not simulated.
6. **Platform drift:** WebKit/Chromium rate, rounding or permission behaviour can change; iOS 18.4 for home-screen Wake Lock; re-verify before any release.
7. **Privacy and consent validity** (section 9); employee-volunteer power imbalance.
8. **Safety** of slow passes and mounted phones; the study must be stoppable at any time.
9. **Thermal and season:** a November study cannot test sunny-dash summer throttling (G8 partial).
10. **Survey error:** the survey itself can be wrong (one surveyor's reading of a ruler); two surveyors and photographs.

## 12. What to deliberately NOT build, and the recommendation

**Do not build:** any recorder or sensor code in the app (web or native); background or default-on collection; raw IMU or raw GPS upload; per-user trace storage; a paving-material classifier from sensors; a rail or tram detector from the IMU; a roughness penalty in routing from sensor data; crowd leaderboards or auto-submit; a model trained on field data before G1-G10; a public host for the 4.20 prototype; any UI control for sensing that does not change real behaviour (AGENTS.md honesty rule).

**Recommendation.**
1. **NO-GO now** for a recorder in the app and for any sensor-derived evidence in routing or warnings (no measured quality exists; F1-F4).
2. **Do the physical survey first, independent of the sensors.** Photographs with a ruler of ring ways 111768010 and 111767966 and of the Corso Lodi / Papi rail type and extent settle the contested field cases directly and produce `field_verified` evidence for Surface Intelligence; sensors cannot (F8).
3. **CONDITIONAL GO for Stage 1**, team only, after the owner decides the open items below. Success is GO on G1-G10 (web-emulated); a Stage-1 GO only authorises Stage 2 (>= 12 sites per class), not any product exposure.
4. **Native recorder: not unless** the decision rule in section 7 is met.

## 13. Open decisions for the owner

1. Approve Stage 1 and the budget of about 125 hours; names of participants, vehicles (two cars, one two-wheeler each?), phones.
2. Legal review of consent (employees/volunteers), retention (90-day proposal), DPIA question, k = 5 / 10 passes / 3 days rule, pseudonym design.
3. Hosting origin for the 4.20 prototype (HTTPS), or use of third-party logger apps; whether a possible EUR 10-30 mount purchase is acceptable.
4. Road-safety approach: which roads and times, whether to request municipal permission for slow passes, insurance cover.
5. Whether survey photographs may be published (Panoramax/KartaView CC BY-SA, `external-data-audit.md`) or kept internal.

## 14. Reconcile with the other workstreams

- **Agent 5 (Surface Intelligence):** use `measure.ci95`, `nPasses`, `speedKphRange`, `deviceClasses` and my `coverage = coarse` rule (way length < 2 x p90 error); sensors can only produce `physical_roughness`, never `surface_material` or rails; the survey is the right `field_verified` source for the ring ways.
- **Agent 2/3 (data audits):** site candidates and lengths come from `osm-data-audit.md` section 4 and `external-data-audit.md` finding 3-4; DBT tram-in-carriageway and the absence of ATM tram service on Corso Lodi make those tracks candidate quiet test crossings, physical state UNVERIFIED; the 2016 KartaView photo does not identify ring ways 111768010 and 111767966.
- **GPS forensics:** the accuracy mix and 2.2 s delivery latency are used here; whether the latency is real delay or a clock offset matters for IMU alignment and should be checked in the app's timestamping (not examined).
- **Final report:** the 4.20 "protocol already written" statement is wrong (`experiments/README.md`: never saved); this report is the first complete version, and Stage 1 replaces it only if approved.

## 15. Reproduce and evidence

```
node experiments/phase436-surface-intelligence/scripts/sens-spatial.mjs          # analytic resolvability, aliasing, beta
node experiments/phase436-surface-intelligence/scripts/sens-segment-assign.mjs   # ~15 s, seed 436006
node experiments/phase436-surface-intelligence/scripts/sens-power.mjs            # ~5 s, seed 436061
node experiments/phase436-surface-intelligence/scripts/sens-shock-features.mjs   # seed 436062
node experiments/phase436-surface-intelligence/scripts/sens-hashes.mjs           # hashes.json
node --test "experiments/roughness-sensors/test/*.test.mjs"                      # read-only re-run: 56 of 57 pass (Windows path separator)
```
Scripts: `experiments/phase436-surface-intelligence/scripts/sens-*.mjs` (Node 26 built-ins; `sens-lib.mjs` reuses the 4.20 PRNG and filters). Evidence: `outputs/phase436-surface-intelligence/evidence/smartphone-sensor-feasibility/` (`source-log.md`, `spatial-resolvability.json`, `segment-assignment-simulation.json`, `study-power.json`, `shock-features-toy.json`, `phase420-tests-rerun.txt`, `hashes.json`).
