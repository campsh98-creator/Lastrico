/**
 * sens-segment-assign.mjs - Phase 4.36 / Agent 6. SIMULATION (deterministic Monte-Carlo + analytic cross-check).
 * Question: with REAL phone-GPS accuracy, what is the probability that a roughness event / window is assigned to the
 * right OSM segment, as a function of segment length, speed and GPS accuracy?
 *
 * Model (straight road, perfect road geometry, map matching removes cross-track error, so the ALONG-track error is
 * what is left - this is OPTIMISTIC for roundabouts, junction clusters and parallel carriageways):
 *   - reported accuracy is a 68 % radius (W3C Geolocation: "68% confidence"; Android Location.getAccuracy: 68th
 *     percentile; both read 2026-11-14). For a circular 2-D Gaussian the per-axis sigma = r68 / sqrt(-2 ln 0.32) = r68/1.5096.
 *   - accuracy mixture from the redacted trace buckets (counts only, no coordinates):
 *       <10: 433, 10-20: 328, 20-30: 95, 30-50: 28, 50-100: 13, >=100: 54 (of which 21 are >= 120 m and rejected by the app).
 *   - "calibration factor" k scales the true sigma relative to the reported one (k=1: reported accuracy is honest).
 *   - Model E (isolated event, one draw): x ~ U(0, L); x_est = x + bias + N(0, sigma^2); correct iff 0 <= x_est <= L.
 *   - Model W (sustained roughness over one pass): GPS errors are strongly autocorrelated, so one shift s ~ N(bias, sigma^2)
 *     applies to the whole pass; the share of the segment's windows that land inside the segment is (1 - |s|/L)+.
 *     Its EXPECTATION equals Model E's probability (proved analytically below); what differs is the per-pass spread.
 *   - speed enters through (a) a timestamp-alignment bias v * dt (dt = residual IMU-vs-GPS clock offset),
 *     (b) the window extent v * T_w (T_w = 1.07 s, as in the Phase 4.20 analysis) that mixes the two sides of a boundary,
 *     (c) the number of windows a pass puts inside the segment.
 * Run:  node experiments/phase436-surface-intelligence/scripts/sens-segment-assign.mjs
 * Output: evidence/smartphone-sensor-feasibility/segment-assignment-simulation.json
 */
import { createRng, writeEvidence, round, Phi, phi, KMH, ASOF } from "./sens-lib.mjs";

const SEED = 436_006;
const N = 200_000;
const R68 = Math.sqrt(-2 * Math.log(0.32)); // 1.5096
const T_WIN = 1.07; const T_HOP = 0.535; // Phase 4.20: window ~1.07 s, 50 % hop
const SEG_LEN = [10, 13.1, 20.5, 25, 31, 47, 60, 100, 200];
const SPEEDS = [10, 20, 30, 50];
const FIXED_R68 = [5, 10, 20, 30, 50];
const BUCKETS = [ // [lo, hi, count]  (redacted summary quality.accuracyBuckets; >=100 split by the app's 120 m cut-off)
  [4.8, 10, 433], [10, 20, 328], [20, 30, 95], [30, 50, 28], [50, 100, 13], [100, 120, 33], [120, 148, 21],
];
const MIXES = {
  "all-951": BUCKETS,
  "app-accepted-930": BUCKETS.slice(0, 6),
  "gate-30m-856": BUCKETS.slice(0, 3),
};

/** Analytic P(correct) for sigma, length L, bias b (b=0 closed form; otherwise numeric). */
function pCorrect(L, sigma, b = 0) {
  if (b === 0) { const z = L / sigma; return 2 * (Phi(z) + (phi(z) - phi(0)) / z) - 1; }
  const steps = 400; let acc = 0;
  for (let i = 0; i < steps; i += 1) { const x = ((i + 0.5) / steps) * L; acc += Phi((L - x - b) / sigma) - Phi((-x - b) / sigma); }
  return acc / steps;
}
/** Analytic P(|s| <= t) for s ~ N(b, sigma^2). */
const pWithin = (t, sigma, b = 0) => Phi((t - b) / sigma) - Phi((-t - b) / sigma);

function mixtureSampler(buckets, rng) {
  const total = buckets.reduce((s, b) => s + b[2], 0);
  return () => {
    let u = rng.next() * total;
    for (const [lo, hi, c] of buckets) { if (u < c) return lo + (hi - lo) * rng.next(); u -= c; }
    const last = buckets[buckets.length - 1]; return last[1];
  };
}
const fixedSampler = (r) => () => r;

/** Monte-Carlo for one cell. Returns Model E probability, Model W mean overlap and tail probabilities. */
function simulate({ label, L, sampler, k = 1, biasM = 0 }) {
  const rng = createRng(SEED).fork(label);
  let correct = 0; let overlapSum = 0; let ge80 = 0; let ge50 = 0;
  for (let i = 0; i < N; i += 1) {
    const sigma = (k * sampler()) / R68;
    const x = rng.next() * L;
    const xe = x + biasM + sigma * rng.normal();
    if (xe >= 0 && xe <= L) correct += 1;
    const s = biasM + sigma * rng.normal();
    const overlap = Math.max(0, 1 - Math.abs(s) / L);
    overlapSum += overlap; if (overlap >= 0.8) ge80 += 1; if (overlap >= 0.5) ge50 += 1;
  }
  return { pEvent: correct / N, meanOverlap: overlapSum / N, pOverlapGe80: ge80 / N, pOverlapGe50: ge50 / N };
}

/** Analytic value of the same quantities for a mixture (midpoint integration over the accuracy buckets). */
function analyticMixture(L, buckets, k = 1, biasM = 0) {
  const total = buckets.reduce((s, b) => s + b[2], 0);
  let pe = 0; let g80 = 0; let g50 = 0;
  for (const [lo, hi, c] of buckets) {
    const m = 40; let a = 0; let b80 = 0; let b50 = 0;
    for (let j = 0; j < m; j += 1) {
      const sigma = (k * (lo + ((j + 0.5) / m) * (hi - lo))) / R68;
      a += pCorrect(L, sigma, biasM); b80 += pWithin(0.2 * L, sigma, biasM); b50 += pWithin(0.5 * L, sigma, biasM);
    }
    pe += (c / total) * (a / m); g80 += (c / total) * (b80 / m); g50 += (c / total) * (b50 / m);
  }
  return { pEvent: pe, pOverlapGe80: g80, pOverlapGe50: g50 };
}

const out = {
  asOf: ASOF, kind: "SIMULATION (deterministic Monte-Carlo, seed " + SEED + ", N=" + N + " per cell) + analytic cross-check; not a measurement",
  assumptions: {
    r68ToSigma: R68, window: { T_WIN, T_HOP }, accuracyBuckets: BUCKETS, alongTrackOnly: true, perfectRoadGeometry: true,
    note: "optimistic: no cross-track confusion between adjacent ways, no map-matching error, no parallel carriageway, no roundabout geometry",
  },
};

// T1: fixed accuracy x length, Delta t = 0 -------------------------------------------------------------------
out.fixedAccuracy = []; let maxAbsErr = 0;
for (const r of FIXED_R68) {
  const row = { r68M: r, sigmaAlongM: round(r / R68, 2), byLength: {} };
  for (const L of SEG_LEN) {
    const sim = simulate({ label: `fixed-${r}-${L}`, L, sampler: fixedSampler(r) });
    const an = pCorrect(L, r / R68);
    maxAbsErr = Math.max(maxAbsErr, Math.abs(an - sim.pEvent), Math.abs(an - sim.meanOverlap));
    row.byLength[L] = { event: round(sim.pEvent, 3), analytic: round(an, 3), overlapGe80: round(sim.pOverlapGe80, 3), overlapGe50: round(sim.pOverlapGe50, 3) };
  }
  out.fixedAccuracy.push(row);
}
out.monteCarloVsAnalyticMaxAbsDiff = round(maxAbsErr, 4);

// T2: empirical mixtures x length, k in {1, 2} ---------------------------------------------------------------------
out.mixtures = [];
for (const [name, buckets] of Object.entries(MIXES)) {
  for (const k of [1, 2]) {
    const row = { mixture: name, calibrationK: k, byLength: {} };
    for (const L of SEG_LEN) {
      const sim = simulate({ label: `mix-${name}-${k}-${L}`, L, sampler: mixtureSampler(buckets, createRng(SEED).fork(`s-${name}-${k}-${L}`)), k });
      const an = analyticMixture(L, buckets, k);
      row.byLength[L] = { event: round(sim.pEvent, 3), analytic: round(an.pEvent, 3), overlapGe80: round(sim.pOverlapGe80, 3), overlapGe50: round(sim.pOverlapGe50, 3) };
    }
    out.mixtures.push(row);
  }
}

// T3: speed - time-alignment bias and window purity ----------------------------------------------------------------
out.speedEffects = { lengthsM: [25, 60, 100], rows: [] };
for (const v of SPEEDS) {
  for (const dt of [0, 0.2, 0.5, 1.0, 2.2]) {
    const bias = v * KMH * dt;
    const row = { kmh: v, clockOffsetS: dt, biasM: round(bias, 1), byLength: {} };
    for (const L of out.speedEffects.lengthsM) {
      const an = analyticMixture(L, MIXES["gate-30m-856"], 1, bias);
      row.byLength[L] = { event: round(an.pEvent, 3), overlapGe80: round(an.pOverlapGe80, 3) };
    }
    out.speedEffects.rows.push(row);
  }
}
out.windowYield = SPEEDS.map((v) => {
  const winM = v * KMH * T_WIN; const hopM = v * KMH * T_HOP;
  const rows = {};
  for (const L of [13.1, 25, 31, 60, 100]) {
    const inside = L >= winM ? Math.floor((L - winM) / hopM) + 1 : 0;
    const an = analyticMixture(L, MIXES["gate-30m-856"], 1, 0);
    const eff = inside * an.pEvent;
    rows[L] = { windowsFullyInside: inside, purity: round(Math.max(0, (L - winM) / L), 2), effectiveWindowsPerPass: round(eff, 1), passesFor20: eff > 0 ? Math.ceil(20 / eff) : null };
  }
  return { kmh: v, windowLengthM: round(winM, 1), hopM: round(hopM, 1), byLength: rows };
});

// T4: documented ways from the audits (public OSM ids and lengths) ----------------------------------------------------
const WAYS = [
  ["Piazzale Lodi ring 287070936 (sett)", 25.0], ["Piazzale Lodi ring 111768010", 31.0], ["Piazzale Lodi ring 111767966", 13.1],
  ["Via Lazzaro Papi 164940302 (sett)", 20.5], ["Via Lazzaro Papi 164940303 (sett)", 25.0], ["Via Lazzaro Papi 164940304", 97.1],
  ["Corso Lodi 36874245 (sett)", 138.6], ["Viale Umbria 289749136", 64.2], ["Viale Isonzo 288900525", 207.0],
];
out.documentedWays = WAYS.map(([name, L]) => {
  const g = analyticMixture(L, MIXES["gate-30m-856"], 1, 0);
  const a = analyticMixture(L, MIXES["app-accepted-930"], 1, 0);
  const a2 = analyticMixture(L, MIXES["app-accepted-930"], 2, 0);
  return { way: name, lengthM: L, gate30: round(g.pEvent, 2), gate30Ge80: round(g.pOverlapGe80, 2), appAccepted: round(a.pEvent, 2), appAcceptedGe80: round(a.pOverlapGe80, 2), appAcceptedK2: round(a2.pEvent, 2) };
});

// T5: minimum segment length for a target correct-assignment probability --------------------------------------------
function minLength(target, fn) { for (let L = 5; L <= 1000; L += 1) if (fn(L) >= target) return L; return null; }
out.minimumLengthM = [];
for (const [name, buckets] of Object.entries(MIXES)) {
  for (const k of [1, 2]) {
    out.minimumLengthM.push({
      mixture: name, calibrationK: k,
      L_event_ge_0p8: minLength(0.8, (L) => analyticMixture(L, buckets, k).pEvent),
      L_event_ge_0p9: minLength(0.9, (L) => analyticMixture(L, buckets, k).pEvent),
      L_passOverlapGe80_in_90pct_of_passes: minLength(0.9, (L) => analyticMixture(L, buckets, k).pOverlapGe80),
    });
  }
}
for (const r of FIXED_R68) {
  const s = r / R68;
  out.minimumLengthM.push({
    mixture: `fixed r68=${r} m`, calibrationK: 1,
    L_event_ge_0p8: minLength(0.8, (L) => pCorrect(L, s)), L_event_ge_0p9: minLength(0.9, (L) => pCorrect(L, s)),
    L_passOverlapGe80_in_90pct_of_passes: minLength(0.9, (L) => pWithin(0.2 * L, s)),
  });
}
// along-track error quantiles of the mixtures (what to record as spatialPrecisionM)
out.alongTrackErrorQuantilesM = [];
for (const [name, buckets] of Object.entries(MIXES)) {
  for (const k of [1, 2]) {
    const rng = createRng(SEED).fork(`q-${name}-${k}`); const sampler = mixtureSampler(buckets, createRng(SEED).fork(`qs-${name}-${k}`)); const errs = [];
    for (let i = 0; i < N; i += 1) errs.push(Math.abs(((k * sampler()) / R68) * rng.normal()));
    errs.sort((a, b) => a - b);
    out.alongTrackErrorQuantilesM.push({ mixture: name, calibrationK: k, p50: round(errs[Math.floor(0.5 * N)], 1), p90: round(errs[Math.floor(0.9 * N)], 1), p95: round(errs[Math.floor(0.95 * N)], 1) });
  }
}
for (const r of FIXED_R68) out.alongTrackErrorQuantilesM.push({ mixture: `fixed r68=${r} m`, calibrationK: 1, p50: round(0.6745 * r / R68, 1), p90: round(1.645 * r / R68, 1), p95: round(1.96 * r / R68, 1) });
// documented ways versus the along-track uncertainty of the app-accepted mixture (k=1)
{ const q = out.alongTrackErrorQuantilesM.find((x) => x.mixture === "app-accepted-930" && x.calibrationK === 1);
  out.waysVersusUncertainty = { p90AlongTrackErrorM: q.p90, intervalWidth90M: round(2 * q.p90, 1),
    shorterThanP90Radius: WAYS.filter((w) => w[1] < q.p90).map((w) => w[0]), shorterThanP90IntervalWidth: WAYS.filter((w) => w[1] < 2 * q.p90).map((w) => w[0]) }; }

const sha = writeEvidence("segment-assignment-simulation.json", out);
const pad = (s, n) => String(s).padStart(n);
console.log("sha256", sha, " max|MC-analytic| =", out.monteCarloVsAnalyticMaxAbsDiff);
console.log("\nFixed accuracy, P(correct segment), dt=0:  L(m) ->", SEG_LEN.map((l) => pad(l, 6)).join(""));
for (const r of out.fixedAccuracy) console.log(pad(`r68=${r.r68M}`, 9), SEG_LEN.map((l) => pad(r.byLength[l].event.toFixed(2), 6)).join(""));
for (const m of out.mixtures) console.log(pad(`${m.mixture} k=${m.calibrationK}`, 24), SEG_LEN.map((l) => pad(m.byLength[l].event.toFixed(2), 6)).join(""));
console.log("\nP(overlap>=0.8 in a pass), gate-30 k=1 / app k=1:");
for (const m of out.mixtures.filter((x) => x.calibrationK === 1)) console.log(pad(m.mixture, 20), SEG_LEN.map((l) => pad(m.byLength[l].overlapGe80.toFixed(2), 6)).join(""));
console.log("\nSpeed effects (gate-30, event P) L=25/60/100:");
for (const r of out.speedEffects.rows) console.log(pad(r.kmh, 3), "dt", pad(r.clockOffsetS, 4), "bias", pad(r.biasM, 5), [25, 60, 100].map((L) => r.byLength[L].event).join(" "));
console.log("\nWindow yield:", JSON.stringify(out.windowYield.map((w) => ({ kmh: w.kmh, win: w.windowLengthM, L25: w.byLength[25], L60: w.byLength[60] }))));
console.log("\nDocumented ways:"); for (const w of out.documentedWays) console.log(JSON.stringify(w));
console.log("\nMinimum length:"); for (const m of out.minimumLengthM) console.log(JSON.stringify(m));
