/**
 * sens-shock-features.mjs - Phase 4.36 / Agent 6. TOY ILLUSTRATION (synthetic, seeded) of how candidate features behave for
 * sustained roughness versus isolated shocks at 60 Hz. It does NOT show that real roads separate: the toy classes differ
 * by construction. It shows (1) how much of a short pulse a 60 Hz point-sampler can miss, (2) what each feature measures,
 * (3) why windowed kurtosis/crest need a context window larger than the shock.
 * Run:  node experiments/phase436-surface-intelligence/scripts/sens-shock-features.mjs
 * Output: evidence/smartphone-sensor-feasibility/shock-features-toy.json
 */
import { createRng, writeEvidence, round, KMH, ASOF } from "./sens-lib.mjs";
import { bandpassSections, filtfilt } from "../../roughness-sensors/src/dsp.mjs";

const SEED = 436_062; const FS = 60;
const out = { asOf: ASOF, kind: "TOY synthetic illustration, seed " + SEED + "; classes differ by construction; not evidence of real separability" };

// 1. peak capture of a half-sine pulse by a point sampler at random phase -------------------------------------------------
function capture(fs, widthMs, rng, trials = 20000) {
  const w = widthMs / 1000; const ratios = [];
  for (let i = 0; i < trials; i += 1) {
    const phase = (rng.next() - 0.5) / fs; // sampling grid offset relative to the pulse centre
    let peak = 0;
    for (let k = -40; k <= 40; k += 1) { const t = phase + k / fs; if (Math.abs(t) < w / 2) peak = Math.max(peak, Math.cos((Math.PI * t) / w)); }
    ratios.push(peak);
  }
  ratios.sort((x, y) => x - y);
  return { fs, pulseMs: widthMs, meanPeakCaptured: round(ratios.reduce((s, v) => s + v, 0) / ratios.length, 2), p05: round(ratios[Math.floor(0.05 * ratios.length)], 2), missedEntirely: round(ratios.filter((r) => r === 0).length / ratios.length, 3) };
}
out.pulseCapture = [];
for (const fs of [60, 200]) for (const w of [10, 20, 40, 80, 160]) out.pulseCapture.push(capture(fs, w, createRng(SEED).fork(`cap-${fs}-${w}`)));

// 2. toy traces, 20 s at 20 km/h --------------------------------------------------------------------------------------------
const V = 20 * KMH; const N = FS * 20;
const sections = bandpassSections(3, 27, FS);
function base(rng, sd) { const x = new Float64Array(N); for (let i = 0; i < N; i += 1) x[i] = sd * rng.normal(); return x; }
function addPulse(x, tCentre, widthS, amp) { for (let i = 0; i < N; i += 1) { const u = i / FS - tCentre; if (Math.abs(u) < widthS / 2) x[i] += amp * Math.cos((Math.PI * u) / widthS) * Math.sin(2 * Math.PI * 12 * u); } }
const traces = {};
{ const r = createRng(SEED).fork("smooth"); traces.smoothAsphalt = base(r, 0.10); }
{ const r = createRng(SEED).fork("rough"); traces.sustainedRough = base(r, 0.40); }
{ const r = createRng(SEED).fork("pothole"); const x = base(r, 0.10); addPulse(x, 10, 0.12, 4.0); traces.singlePothole = x; }
{ const r = createRng(SEED).fork("tram"); const x = base(r, 0.10); for (const dx of [0, 1.5, 2.6, 4.1]) addPulse(x, 8 + dx / V, 0.10, 2.0); traces.tramCrossingDoubleTrackPerpendicular = x; }
{ const r = createRng(SEED).fork("hump"); const x = base(r, 0.10); for (let i = 0; i < N; i += 1) { const u = i / FS - 10; x[i] += 1.5 * Math.exp(-(u * u) / (2 * 0.25 * 0.25)) * Math.sin(2 * Math.PI * 1.5 * u) ; } traces.speedHumpHeave = x; }
{ const r = createRng(SEED).fork("mixed"); const x = base(r, 0.10); for (let i = 0; i < N; i += 1) if (i / FS > 6 && i / FS < 14) x[i] += 0.35 * r.normal(); addPulse(x, 17, 0.12, 4.0); traces.roughPatchPlusPothole = x; }

const W = 64; const H = 32;
const kurt = (v) => { const m = v.reduce((s, a) => s + a, 0) / v.length; const m2 = v.reduce((s, a) => s + (a - m) ** 2, 0) / v.length; const m4 = v.reduce((s, a) => s + (a - m) ** 4, 0) / v.length; return m4 / (m2 * m2) - 3; };
out.toyFeatures = {};
const refSd = (() => { const y = filtfilt(sections, Array.from(traces.smoothAsphalt)); return Math.sqrt(y.reduce((s, a) => s + a * a, 0) / y.length); })();
for (const [name, raw] of Object.entries(traces)) {
  const y = Array.from(filtfilt(sections, Array.from(raw)));
  const win = [];
  for (let s = 0; s + W <= y.length; s += H) { const seg = y.slice(s, s + W); const rms = Math.sqrt(seg.reduce((a, b) => a + b * b, 0) / W); win.push({ rms, crest: Math.max(...seg.map(Math.abs)) / rms, kurt: kurt(seg) }); }
  const rmsS = win.map((w) => w.rms).sort((a, b) => a - b);
  const med = rmsS[Math.floor(rmsS.length / 2)];
  const thr = 7 * refSd; let events = 0; let last = -1e9;
  for (let i = 0; i < y.length; i += 1) if (Math.abs(y[i]) > thr && i - last > 0.4 * FS) { events += 1; last = i; }
  const km = (N / FS) * V / 1000;
  const frac = win.filter((w) => w.rms > 2 * refSd).length / win.length;
  out.toyFeatures[name] = {
    windows: win.length, medianWindowRmsMs2: round(med, 3), maxWindowRmsMs2: round(Math.max(...win.map((w) => w.rms)), 3),
    contrastMaxOverMedianRms: round(Math.max(...win.map((w) => w.rms)) / med, 1),
    medianCrest: round(win.map((w) => w.crest).sort((a, b) => a - b)[Math.floor(win.length / 2)], 1), maxCrest: round(Math.max(...win.map((w) => w.crest)), 1),
    maxExcessKurtosis: round(Math.max(...win.map((w) => w.kurt)), 1), medianExcessKurtosis: round(win.map((w) => w.kurt).sort((a, b) => a - b)[Math.floor(win.length / 2)], 1),
    shareOfWindowsAbove2xSmoothRms: round(frac, 2), eventsAbove7SigmaPer100m: round((events / (km * 1000)) * 100, 1),
  };
}
out.reading = "Sustained roughness: high median RMS, many elevated windows, near-Gaussian (crest ~3-4, kurtosis ~0). Isolated shock: median RMS unchanged, 1-3 windows elevated, crest and kurtosis high, contrast >> 1. Tram crossing: a short burst of 4 pulses (spacing = geometry / speed). Mixed: the patch raises the median only if the context window covers it. Thresholds must come from field data.";

const sha = writeEvidence("shock-features-toy.json", out);
console.log("sha256", sha);
for (const c of out.pulseCapture) console.log(JSON.stringify(c));
for (const [k, v] of Object.entries(out.toyFeatures)) console.log(k.padEnd(42), JSON.stringify(v));
