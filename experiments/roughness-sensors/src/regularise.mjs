/**
 * Timestamp regularisation: browser motion events arrive with jitter, repeats, drops and gaps
 * (page hidden, screen locked). This module cleans the raw rows, splits them into continuous
 * runs at gaps, and resamples each run onto a uniform grid by linear interpolation.
 */
import { lowerIndex, mad, median } from "./dsp.mjs";

const DEFAULTS = {
  targetHz: null,
  gapFactor: 4,
  minGapMs: 150,
  minRunSeconds: 3,
  optionalChannelMinCoverage: 0.9,
  clipMinMs2: 15,
  clipToleranceMs2: 0.05,
  clipLevelMs2: null,
};

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Sampling statistics of the raw timestamps, before any cleaning beyond sorting. */
export function samplingStats(times, { gapMs } = {}) {
  const n = times.length;
  if (n < 2) {
    return { samples: n, durationS: 0, medianIntervalMs: NaN, nominalRateHz: NaN, rateHz: NaN, jitterMs: NaN, intervalCv: NaN, gaps: 0, gapTotalMs: 0 };
  }
  const intervals = [];
  for (let index = 1; index < n; index += 1) intervals.push(times[index] - times[index - 1]);
  const medianInterval = median(intervals);
  const gapThreshold = gapMs ?? Math.max(DEFAULTS.gapFactor * medianInterval, DEFAULTS.minGapMs);
  const regular = intervals.filter((value) => value <= gapThreshold);
  // Typical interval: mean of the intervals near the median (excludes single drops and gaps).
  const typical = intervals.filter((value) => value >= 0.5 * medianInterval && value <= 1.5 * medianInterval);
  const typicalMean = typical.reduce((sum, value) => sum + value, 0) / Math.max(1, typical.length);
  const gaps = intervals.filter((value) => value > gapThreshold);
  const regularMean = regular.reduce((sum, value) => sum + value, 0) / Math.max(1, regular.length);
  const variance = regular.reduce((sum, value) => sum + (value - regularMean) ** 2, 0) / Math.max(1, regular.length);
  return {
    samples: n,
    durationS: (times[n - 1] - times[0]) / 1000,
    medianIntervalMs: medianInterval,
    nominalRateHz: 1000 / typicalMean,
    rateHz: 1000 / regularMean,
    jitterMs: 1.4826 * mad(regular),
    intervalCv: Math.sqrt(variance) / regularMean,
    gaps: gaps.length,
    gapTotalMs: gaps.reduce((sum, value) => sum + value, 0),
  };
}

function detectClipping(rows, options) {
  const clipped = new Uint8Array(rows.length);
  for (let axis = 1; axis <= 3; axis += 1) {
    let maxAbs = 0;
    for (const row of rows) maxAbs = Math.max(maxAbs, Math.abs(row[axis]));
    const level = options.clipLevelMs2 ?? maxAbs;
    if (level < options.clipMinMs2) continue;
    const threshold = level - options.clipToleranceMs2;
    let atLevel = 0;
    let consecutive = false;
    for (let index = 0; index < rows.length; index += 1) {
      if (Math.abs(rows[index][axis]) >= threshold) {
        atLevel += 1;
        if (index > 0 && Math.abs(rows[index - 1][axis]) >= threshold) consecutive = true;
      }
    }
    // A saturated sensor holds its full-scale value; a single genuine peak does not repeat.
    const plateau = options.clipLevelMs2 !== null ? atLevel > 0 : atLevel >= 2 && consecutive;
    if (!plateau) continue;
    for (let index = 0; index < rows.length; index += 1) {
      if (Math.abs(rows[index][axis]) >= threshold) clipped[index] = 1;
    }
  }
  return clipped;
}

function fillOptional(rows, column) {
  const values = new Float64Array(rows.length);
  let present = 0;
  let last = null;
  for (let index = 0; index < rows.length; index += 1) {
    const value = rows[index][column];
    if (finite(value)) {
      present += 1;
      last = value;
      values[index] = value;
    } else {
      values[index] = last ?? NaN;
    }
  }
  // Back-fill leading gaps.
  let next = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (Number.isNaN(values[index])) values[index] = next ?? 0;
    else next = values[index];
  }
  return { values, coverage: rows.length ? present / rows.length : 0 };
}

/**
 * @param {Array<Array<number|null>>} motionRows rows in MOTION_COLUMNS order
 * @returns {{ runs: object[], stats: object, cleaning: object }}
 */
export function regularise(motionRows, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const cleaning = { inputRows: motionRows.length, nonFinite: 0, duplicateTimestamps: 0, repeatedValues: 0, droppedShortRuns: 0, droppedShortRunSamples: 0 };

  const valid = [];
  for (const row of motionRows) {
    if (!Array.isArray(row) || !finite(row[0]) || !finite(row[1]) || !finite(row[2]) || !finite(row[3])) {
      cleaning.nonFinite += 1;
      continue;
    }
    valid.push(row);
  }
  valid.sort((a, b) => a[0] - b[0]);

  const clippedRaw = detectClipping(valid, options);
  const rows = [];
  const clipFlags = [];
  for (let index = 0; index < valid.length; index += 1) {
    const row = valid[index];
    const previous = rows[rows.length - 1];
    if (previous && row[0] === previous[0]) {
      cleaning.duplicateTimestamps += 1;
      continue;
    }
    // Stale repeats (the browser re-delivering the last sensor value) carry no new information.
    if (previous && !clippedRaw[index] && row[1] === previous[1] && row[2] === previous[2] && row[3] === previous[3]) {
      cleaning.repeatedValues += 1;
      continue;
    }
    rows.push(row);
    clipFlags.push(clippedRaw[index]);
  }

  const times = rows.map((row) => row[0]);
  const stats = samplingStats(times);
  const medianInterval = stats.medianIntervalMs;
  const gapMs = Math.max(options.gapFactor * (medianInterval || 0), options.minGapMs);
  const fs = options.targetHz ?? Math.min(200, Math.max(10, Math.round(stats.nominalRateHz)));
  stats.gapThresholdMs = gapMs;
  stats.targetHz = fs;
  stats.repeatedValueFraction = motionRows.length ? cleaning.repeatedValues / motionRows.length : 0;
  stats.clippedSamples = clipFlags.reduce((sum, flag) => sum + flag, 0);

  // Split into continuous runs.
  const runBounds = [];
  let runStart = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    if (index === rows.length || rows[index][0] - rows[index - 1][0] > gapMs) {
      runBounds.push([runStart, index]);
      runStart = index;
    }
  }

  const runs = [];
  for (const [start, end] of runBounds) {
    const runRows = rows.slice(start, end);
    const t0 = runRows[0]?.[0];
    const t1 = runRows[runRows.length - 1]?.[0];
    if (runRows.length < 2 || (t1 - t0) / 1000 < options.minRunSeconds) {
      cleaning.droppedShortRuns += 1;
      cleaning.droppedShortRunSamples += runRows.length;
      continue;
    }
    const rawTimes = Float64Array.from(runRows, (row) => row[0]);
    const n = Math.floor(((t1 - t0) / 1000) * fs) + 1;
    const channel = () => new Float64Array(n);
    const aig = [channel(), channel(), channel()];
    const optional = [4, 5, 6, 7, 8, 9].map((column) => fillOptional(runRows, column));
    const linAvailable = optional.slice(0, 3).every((item) => item.coverage >= options.optionalChannelMinCoverage);
    const rotAvailable = optional.slice(3).every((item) => item.coverage >= options.optionalChannelMinCoverage);
    const lin = linAvailable ? [channel(), channel(), channel()] : null;
    const rot = rotAvailable ? [channel(), channel(), channel()] : null;
    const clipped = new Uint8Array(n);
    const runClip = clipFlags.slice(start, end);
    const time = new Float64Array(n);

    for (let k = 0; k < n; k += 1) {
      const t = t0 + (k * 1000) / fs;
      time[k] = t;
      let j = lowerIndex(rawTimes, t);
      if (j < 0) j = 0;
      if (j >= runRows.length - 1) j = runRows.length - 2;
      const ta = rawTimes[j];
      const tb = rawTimes[j + 1];
      const w = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
      for (let axis = 0; axis < 3; axis += 1) {
        aig[axis][k] = runRows[j][axis + 1] * (1 - w) + runRows[j + 1][axis + 1] * w;
        if (lin) lin[axis][k] = optional[axis].values[j] * (1 - w) + optional[axis].values[j + 1] * w;
        if (rot) rot[axis][k] = optional[axis + 3].values[j] * (1 - w) + optional[axis + 3].values[j + 1] * w;
      }
      clipped[k] = runClip[j] || runClip[j + 1] ? 1 : 0;
    }
    runs.push({ t0, t1, fs, n, time, aig, lin, rot, clipped, rawTimes });
  }

  stats.runs = runs.length;
  return { runs, stats, cleaning };
}

/** Raw-sample regularity inside [tStart, tEnd] of a run (uses the original timestamps). */
export function windowSamplingQuality(rawTimes, tStart, tEnd) {
  let first = lowerIndex(rawTimes, tStart);
  if (first < 0 || rawTimes[first] < tStart) first += 1;
  const last = lowerIndex(rawTimes, tEnd);
  const count = Math.max(0, last - first + 1);
  if (count < 3) return { count, rateHz: 0, intervalCv: Infinity, maxHoleMs: tEnd - tStart };
  let sum = 0;
  let sumSquares = 0;
  let maxHole = Math.max(rawTimes[first] - tStart, tEnd - rawTimes[last]);
  for (let index = first + 1; index <= last; index += 1) {
    const dt = rawTimes[index] - rawTimes[index - 1];
    sum += dt;
    sumSquares += dt * dt;
    maxHole = Math.max(maxHole, dt);
  }
  const intervals = count - 1;
  const meanDt = sum / intervals;
  const variance = Math.max(0, sumSquares / intervals - meanDt * meanDt);
  return { count, rateHz: 1000 / meanDt, intervalCv: Math.sqrt(variance) / meanDt, maxHoleMs: maxHole };
}
