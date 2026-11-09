# Road roughness sensors: Phase 4.20, Agent C (developer-only experiment)

This experiment explores whether smartphone motion sensors in the browser could tell pavé
(setts/cobblestones) from asphalt. It contains three parts:

- a pure-JS analysis library;
- a deterministic **synthetic** test suite;
- an opt-in, offline recording prototype.

It is **not integrated** into the Lastrico app, the Worker or routing. The prototype is never
linked from the app.

> All metrics in this folder come from **synthetic data** made by `src/synthetic.mjs`. They show
> that the code behaves as designed and that the classes separate *under the generator's own
> assumptions*. They are not road truth and make no claim of real-world accuracy. No physical
> iPhone, no iOS Simulator and no field recording were used.

## Commands (run from the repository root)

```sh
# All tests (57, deterministic, ~9 s; Node >= 24, no dependencies)
node --test "experiments/roughness-sensors/test/*.test.mjs"

# Synthetic evaluation + sweeps + runtime benchmark -> experiments/roughness-sensors/results.json (~18 s)
node --expose-gc experiments/roughness-sensors/scripts/run-evaluation.mjs
#   add --no-bench to skip the machine-dependent benchmark

# Benchmark only (10-minute, 60 Hz synthetic trip)
node --expose-gc experiments/roughness-sensors/scripts/benchmark.mjs

# Prototype on http://127.0.0.1:8820/ (desktop: use "Riproduci traccia sintetica"; Ctrl+C to stop)
node experiments/roughness-sensors/serve.mjs
```

`results.json` carries `provenance.deterministicSha256`, a hash of every non-runtime result.
Rerunning the evaluation on the same Node version must reproduce it. There are no external input
files: every trace comes from seeded specs in `src/scenarios.mjs`. The SHA-256 of each source
file is listed as well.

## Layout

| Path | Content |
|---|---|
| `src/prng.mjs` | Seeded PRNG (mulberry32 + Box-Muller, forkable streams) |
| `src/dsp.mjs` | Biquads, zero-phase filtfilt, radix-2 FFT, Hann power spectrum, robust stats |
| `src/regularise.mjs` | Sorting, duplicate/stale-repeat removal, gap splitting into runs, linear resampling, clipping (saturation plateau) detection, per-window sampling quality |
| `src/orientation.mjs` | Gravity estimate (low-pass, or `aig − linear` when available), projection to the gravity axis (orientation- and sign-independent) |
| `src/speed.mjs` | GPS speed model (speed field, or position-derived speed), speed normalisation, speed-bin profile, β fit |
| `src/features.mjs` | Windows (≈1.07 s, 50 % hop): RMS, peak, crest, band shares, spectra; quality flags; single-event detector; spatial periodicity |
| `src/analyse.mjs` | `analyseTrace(trace)`: per-segment LRI plus label `smooth` / `rough-periodic` / `uncertain` with reasons |
| `src/synthetic.mjs` | Synthetic trip generator (1 kHz vehicle simulation, phone orientation/handling, device timestamp sampling, GPS) |
| `src/scenarios.mjs` | 38 synthetic test trips and the robustness sweeps |
| `src/evaluate.mjs` | Truth mapping, confusion matrices, precision/recall, naive-threshold and prevalence baselines, event matching, sweeps |
| `src/recorder.mjs` | In-memory recorder used by the prototype (no DOM, no storage) |
| `src/schema.mjs` | Trace format `lastrico-roughness-trace` v1 |
| `prototype/` | `index.html` (Italian consent text, CSP `connect-src 'none'`), `app.mjs`, `style.css` |
| `serve.mjs` | Static server bound to 127.0.0.1:8820. Serves only `prototype/` (at `/`) and `src/` (at `/src/`), GET/HEAD only, security headers |
| `scripts/` | `run-evaluation.mjs`, `benchmark.mjs` |
| `test/` | `node:test` suites |
| `ios-permissions.md` | Browser permission investigation with sources and confidence markers |
| `report.md` | Not created: the agent harness blocked report files. Results, limits and the verdict (NO-GO for the app; field trial only) are in section 3 of `outputs/phase420-research-lab-report.md`, which gives only a one-line outline of the field-validation protocol |

## Trace format (v1)

```json
{ "schema": "lastrico-roughness-trace", "version": 1, "dataKind": "synthetic | field-recording",
  "meta": { "mode": "car | motorcycle | bicycle", "gpsMode": "off | speed-only | speed-and-position", "...": "..." },
  "motion": { "columns": ["t","ax","ay","az","lx","ly","lz","ra","rb","rg"], "rows": [[0.0, 0.1, 9.8, 0.2, null, null, null, null, null, null]] },
  "gps":    { "columns": ["t","lat","lon","acc","speed","heading"], "rows": [] },
  "events": [{ "t": 0, "type": "start" }] }
```

`t` is in milliseconds relative to the start of the recording; no wall-clock time is stored.
`a*` is `accelerationIncludingGravity` and `l*` is `acceleration`, both in m/s². `r*` is
`rotationRate` alpha/beta/gamma in deg/s. In speed-only mode, latitude and longitude are dropped
when the fix arrives.

## Analysis model

1. **Regularise**: sort, drop duplicates and stale repeats, split at gaps (> max(4 × median dt,
   150 ms)), and resample each run at its nominal rate. Runs shorter than 3 s are dropped.
2. **Vertical axis**: estimate gravity (zero-phase low-pass 0.3 Hz, or 1 Hz on `aig − lin`),
   then project. The result does not depend on how the phone is held or on the platform's sign
   convention.
3. **Band-pass** 3 Hz – min(28 Hz, 0.45·fs) for level features. Use 0.5 Hz – … for events.
4. **Speed normalisation**: `nRMS = RMS / (max(v,1)/10)^β` with β = 0.5. This is what a linear
   vehicle predicts on a random road with an n⁻² elevation PSD (ISO 8608 shape). On synthetic
   data the fit gives β ≈ 0.50 for asphalt (by construction) and ≈ 0.95 for setts, so sett LRI
   still rises with speed. β must be refitted on field data (`speedBinProfile`, `fitBeta`).
5. **LRI** (Lastrico relative roughness index) = nRMS / trip baseline. The baseline is the 20th
   percentile of the trip's usable windows (≥ 20 windows), or a mode prior otherwise. LRI is
   dimensionless, uncalibrated and device/mount-dependent. **It is not IRI.**
6. **Quality flags**: these make a window unusable: `gps-missing`, `too-slow`, `irregular-sampling`,
   `handling` (gyro peak above the mode limit), `orientation-change` (gravity shift), `run-edge`,
   `low-sample-rate`. Clipping is detected separately. It can support a "rough" call as a lower
   bound, but never a "smooth" call.
7. **Segments** of ~60 m of integrated speed. Without speed, segments are 6 s long and always
   `uncertain`.
   - `smooth`: median LRI < 1.4, at most 25 % elevated windows, below the absolute ceiling, no
     clipping.
   - `rough-periodic`: median LRI ≥ 1.8, at least 60 % elevated windows, crest ≤ 5.5. If
     periodicity is resolvable and absent, the segment abstains (`rough-not-periodic`).
   - everything else: `uncertain`, with reasons.
8. **Periodicity**: window spectra are whitened by the trip's quiet-road spectrum, which
   removes suspension resonances. They are then mapped to cycles per metre and averaged. A line
   is looked for in the sett pitch band (0.09–0.22 m). At 60 Hz this is resolvable only below
   ≈ 3 m/s. Above that speed the basis is reported as `sustained-only-periodicity-unresolvable`.
9. **Single events**: adaptive 7σ threshold (lower-40 % local MAD), merged within 0.4 s, typed
   `sharp-impact` (pothole/kerb-like) or `slow-heave` (speed-bump-like). Events are suppressed
   inside unusable windows or a rough context.

## Synthetic generator (assumptions you should challenge)

The generator simulates a straight 1 kHz trip with speed ramps. Road inputs:

- asphalt: √v-scaled white noise;
- setts: one velocity kick per joint, with 8 % pitch jitter, random height and amplitude ∝ v^0.6;
- degraded "rough-asphalt": 4× noise. This is the confounder.

Events are a pothole (drop + hit), a kerb (one hit) and a speed bump (v²·h″(x) heave).

The vehicle transfer is a body resonance plus a wheel-hop resonance plus a direct path (car,
motorcycle and bicycle parameter sets). The phone frame is rotated: mount, hand-held with tremor
and handling bursts, or orientation changes. Optional iOS-like sign inversion, no
gyro/linear, clipping and 0.1 m/s² quantisation.

Samples are point-sampled at jittered timestamps **without anti-alias filtering**, mirroring
WebKit's 60 Hz timer polling. GPS is 1 Hz speed (positions only on request, on a synthetic line
from (0, 0)). The sett/asphalt vibration ratio (≈ 3.5–8×) is the decisive unknown. The
`settSeverity` sweep shows that the method abstains once that ratio drops below about 1.9.

## Privacy design of the prototype

- Explicit opt-in checkbox and Start button.
- `DeviceMotionEvent.requestPermission()` is called synchronously in the click handler.
- GPS has its own opt-in and is off by default. Speed-only mode drops coordinates.
- Data is kept in memory only: no localStorage or IndexedDB. Closing the page, or "Elimina",
  deletes it.
- Export is a user-initiated local Blob download.
- CSP `connect-src 'none'` (meta and header). There are no network APIs in the code, and tests
  enforce both.
- 30-minute cap.
- `page-hidden` gaps are recorded.

Testing on a phone needs an HTTPS origin, which is deliberately not provided (see `ios-permissions.md`).

## Runtime (desktop, machine-dependent)

10-minute 60 Hz synthetic trip (36 000 samples) on Apple M1 / Node 24: about 75 ms per analysis
(≈ 7.5 ms per minute of data, ≈ 460 k samples/s, about 7 600× real time). Working set is
estimated at ≈ 7 MB. Exported JSON is ≈ 0.27 MB per minute. See `results.json → runtime`.
