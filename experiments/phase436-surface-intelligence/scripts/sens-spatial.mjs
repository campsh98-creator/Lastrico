/**
 * sens-spatial.mjs - Phase 4.36 / Agent 6. ANALYTIC derivations (no random numbers, no data):
 *  1. spatial-frequency resolvability of stone-sett joints for a given sampling rate and speed
 *     (re-derives the Phase 4.20 "about 11 km/h at 60 Hz" limit with explicit numbers);
 *  2. aliasing of the joint-passing frequency at 60 Hz without an anti-alias filter;
 *  3. coherence loss from timer jitter, quantisation floor, GPS-speed error propagated to normalised RMS;
 *  4. speed exponent beta = (w-1)/2 of band RMS for a road with elevation PSD ~ n^-w;
 *  5. context: how much of the real Milan drive (redacted percentiles) sits above the resolvability limit.
 * Run:  node experiments/phase436-surface-intelligence/scripts/sens-spatial.mjs
 * Output: outputs/phase436-surface-intelligence/evidence/smartphone-sensor-feasibility/spatial-resolvability.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, writeEvidence, round, KMH, ASOF } from "./sens-lib.mjs";

const SPEEDS_KMH = [8, 10, 12, 18, 20, 30, 50];
const RATES = [
  { id: "web-60Hz", fs: 60, note: "iOS WebKit NSTimer poll 1/60 s (source read 2026-11-14); Chromium pump 60 Hz" },
  { id: "native-100Hz", fs: 100, note: "assumed native iOS ceiling; UNVERIFIED (Apple page not readable)" },
  { id: "native-200Hz", fs: 200, note: "Android registerListener cap without HIGH_SAMPLING_RATE_SENSORS (developer.android.com, 2026-11-14)" },
];
const BAND_FRACTION = 0.45; // Phase 4.20 analysis band edge: min(28 Hz, 0.45 fs)
const PITCHES_M = [0.09, 0.10, 0.12, 0.15, 0.20, 0.22]; // Phase 4.20 sett pitch band 0.09-0.22 m
const result = { asOf: ASOF, kind: "analytic derivation, no data", rates: RATES };

// 1. minimum resolvable wavelength and maximum speed -----------------------------------------------------
result.minWavelengthM = RATES.map((r) => ({
  rate: r.id,
  rows: SPEEDS_KMH.map((v) => ({
    kmh: v,
    nyquistLambdaMinM: round((2 * v * KMH) / r.fs, 3), // lambda >= 2 v / fs
    practicalLambdaMinM: round((v * KMH) / (BAND_FRACTION * r.fs), 3), // analysis band edge 0.45 fs
    nMaxCyclesPerM: round((BAND_FRACTION * r.fs) / (v * KMH), 2),
  })),
}));
result.maxSpeedForPitchKmh = RATES.map((r) => ({
  rate: r.id,
  rows: PITCHES_M.map((p) => ({
    pitchM: p,
    nyquistKmh: round((p * r.fs / 2) * 3.6, 1), // v <= p fs / 2
    practicalKmh: round((p * BAND_FRACTION * r.fs) * 3.6, 1),
  })),
}));

// fraction (in log wavenumber) of the sett pitch band that is resolvable at each speed, fs = 60 Hz, band edge 27 Hz
const nLow = 1 / 0.22; const nHigh = 1 / 0.09;
const fmax60 = BAND_FRACTION * 60;
result.settBandResolvable60Hz = SPEEDS_KMH.map((v) => {
  const nMax = fmax60 / (v * KMH);
  const frac = Math.min(1, Math.max(0, Math.log(nMax / nLow) / Math.log(nHigh / nLow)));
  return { kmh: v, nMaxCyclesPerM: round(nMax, 2), settBandFractionResolvable: round(frac, 2) };
});

// 2. aliasing ----------------------------------------------------------------------------------------------
const alias = (f, fs) => Math.abs(f - fs * Math.round(f / fs));
result.aliasing = [];
for (const r of RATES) {
  for (const p of [0.10, 0.12, 0.15, 0.20]) {
    for (const v of [10, 20, 30]) {
      const f = (v * KMH) / p;
      result.aliasing.push({ rate: r.id, pitchM: p, kmh: v, jointHz: round(f, 1), folded: f > r.fs / 2, aliasHz: round(alias(f, r.fs), 1) });
    }
  }
}

// 3. jitter, quantisation, GPS speed error --------------------------------------------------------------------
result.jitterCoherence = [1, 2, 4].flatMap((sigmaMs) => [10, 30, 60].map((hz) => ({
  jitterMs: sigmaMs, hz, coherence: round(Math.exp(-0.5 * (2 * Math.PI * hz * sigmaMs * 1e-3) ** 2), 3),
})));
const q = 0.1; // W3C spec rounding limit for acceleration, m/s^2 (Device Orientation and Motion, 2026-11-14)
result.quantisation = { stepMs2: q, uniformNoiseRmsMs2: round(q / Math.sqrt(12), 4),
  note: "WebKit iOS path read 2026-11-14 shows no rounding; Chromium/Android rounding UNVERIFIED. If rounded, floor = q/sqrt(12)." };
result.speedErrorToNormalisedRms = [0.2, 0.5].flatMap((sd) => [10, 20, 30].map((v) => ({
  gpsSpeedSdMs: sd, kmh: v, relSpeedError: round(sd / (v * KMH), 3),
  nRmsRelErrorBeta05: round(0.5 * sd / (v * KMH), 3), nRmsRelErrorBeta095: round(0.95 * sd / (v * KMH), 3),
})));

// 4. speed exponent of band RMS for road PSD ~ n^-w (fixed TIME band): S_z(f) = G0 n0^w v^(w-1) f^-w
result.betaByWaviness = [1.5, 2, 2.5, 3].map((w) => ({
  waviness: w, beta: (w - 1) / 2,
  rmsRatio30over10: round(3 ** ((w - 1) / 2), 2),
}));
result.betaNote = "RMS in a fixed temporal band scales as v^((w-1)/2); two surfaces with different w need different exponents, so one global beta cannot normalise both.";
// class ratio drift: ratio(v) = ratio(10) * (v/10)^((w_s-w_a)/2)
result.classRatioDrift = [{ wAsphalt: 2, wSett: 1.5 }, { wAsphalt: 2, wSett: 2 }, { wAsphalt: 2, wSett: 2.5 }].map((c) => ({
  ...c, ratioAt20Over10: round(2 ** ((c.wSett - c.wAsphalt) / 2), 2), ratioAt30Over10: round(3 ** ((c.wSett - c.wAsphalt) / 2), 2),
}));

// 5. context from the redacted trace percentiles (interpolated CDF, NOT trace-derived coordinates) --------------
const summary = JSON.parse(readFileSync(join(ROOT, "outputs/phase436-surface-intelligence/evidence/gps-trace-summary.redacted.json"), "utf8"));
const sp = summary.quality.speedMetersPerSecond;
const knots = [[0, 0], [sp.p25, 0.25], [sp.p25 > 0 ? sp.median : 0, 0.5], [sp.p75, 0.75], [sp.p90, 0.9], [sp.p95, 0.95], [sp.max, 1]];
const cdf = (x) => {
  for (let i = 1; i < knots.length; i += 1) if (x <= knots[i][0]) { const [x0, y0] = knots[i - 1]; const [x1, y1] = knots[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1); }
  return 1;
};
const movingBelow = (ms) => (cdf(ms) - cdf(0.5)) / (1 - cdf(0.5));
result.milanDriveContext = {
  source: "evidence/gps-trace-summary.redacted.json quality.speedMetersPerSecond (percentiles only)",
  percentilesMs: { p25: sp.p25, median: sp.median, p75: sp.p75, p90: sp.p90, p95: sp.p95, max: sp.max },
  movingFixBelow_3ms_10p8kmh: round(movingBelow(3.0), 2),
  movingFixBelow_2p5ms_9kmh: round(movingBelow(2.5), 2),
  movingFixBelow_5p56ms_20kmh: round(movingBelow(5.56), 2),
  movingFixAbove_8p33ms_30kmh: round(1 - movingBelow(8.33), 2),
  caveat: "one evening drive, one car, one route; piecewise-linear CDF from 6 knots; order of magnitude only",
};

const sha = writeEvidence("spatial-resolvability.json", result);
console.log(JSON.stringify({ sha256: sha }, null, 0));
console.log("settBandResolvable60Hz", JSON.stringify(result.settBandResolvable60Hz));
console.log("maxSpeed60", JSON.stringify(result.maxSpeedForPitchKmh[0].rows));
console.log("alias60 p=0.12", JSON.stringify(result.aliasing.filter((a) => a.rate === "web-60Hz" && a.pitchM === 0.12)));
console.log("milan", JSON.stringify(result.milanDriveContext));
