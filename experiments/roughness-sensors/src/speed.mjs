/**
 * GPS speed model and speed normalisation.
 *
 * Vibration grows with speed even on a perfect road, so raw RMS cannot be compared across
 * speeds. Model (documented, uncalibrated):
 *
 *   nRMS = RMS_vertical / (max(v, vFloor) / v0) ^ beta        v0 = 10 m/s, beta = 0.5
 *
 * beta = 0.5 is what a linear vehicle model predicts for a random road whose elevation PSD falls
 * as n^-2 (ISO 8608 class shape): the input velocity PSD is flat in space, so in time its level
 * scales with v and RMS with sqrt(v). Periodic sett impacts do not follow this law exactly; the
 * residual speed dependence is measured on synthetic data and must be refitted on field data
 * (see speedBinProfile).
 */
import { lowerIndex, median, percentile } from "./dsp.mjs";

export const SPEED_MODEL = { v0: 10, beta: 0.5, vFloor: 1 };

const DEFAULTS = {
  maxInterpolationGapMs: 4000,
  maxExtrapolationMs: 1500,
  maxPositionAccuracyM: 25,
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Builds speedAt(t) from GPS rows [t, lat, lon, acc, speed, heading]. */
export function buildSpeedModel(gpsRows, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const fixes = gpsRows
    .filter((row) => Array.isArray(row) && Number.isFinite(row[0]))
    .slice()
    .sort((a, b) => a[0] - b[0]);
  const points = [];
  let previous = null;
  let derived = 0;
  for (const row of fixes) {
    const [t, lat, lon, accuracy, speed] = row;
    let value = Number.isFinite(speed) && speed >= 0 ? speed : null;
    if (value === null && previous && Number.isFinite(lat) && Number.isFinite(lon)
      && Number.isFinite(previous[1]) && Number.isFinite(previous[2])) {
      const dt = (t - previous[0]) / 1000;
      const goodAccuracy = (accuracy ?? Infinity) <= options.maxPositionAccuracyM
        && (previous[3] ?? Infinity) <= options.maxPositionAccuracyM;
      if (dt >= 0.5 && dt <= 5 && goodAccuracy) {
        value = haversineMeters(previous[1], previous[2], lat, lon) / dt;
        derived += 1;
      }
    }
    if (value !== null) points.push([t, value]);
    previous = row;
  }
  // Median-of-three smoothing of GPS speed noise.
  const smoothed = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    return [point[0], median([points[index - 1][1], point[1], points[index + 1][1]])];
  });
  const times = smoothed.map((point) => point[0]);

  function speedAt(t) {
    if (!smoothed.length) return null;
    const index = lowerIndex(times, t);
    if (index < 0) return times[0] - t <= options.maxExtrapolationMs ? smoothed[0][1] : null;
    if (index === smoothed.length - 1) return t - times[index] <= options.maxExtrapolationMs ? smoothed[index][1] : null;
    const [ta, va] = smoothed[index];
    const [tb, vb] = smoothed[index + 1];
    if (tb - ta > options.maxInterpolationGapMs) {
      if (t - ta <= options.maxExtrapolationMs) return va;
      if (tb - t <= options.maxExtrapolationMs) return vb;
      return null;
    }
    return va + ((vb - va) * (t - ta)) / (tb - ta);
  }

  return {
    speedAt,
    stats: {
      fixes: fixes.length,
      fixesWithSpeed: points.length,
      speedsDerivedFromPositions: derived,
      firstFixMs: fixes[0]?.[0] ?? null,
      lastFixMs: fixes[fixes.length - 1]?.[0] ?? null,
    },
  };
}

export function speedNormalisationFactor(speed, model = SPEED_MODEL) {
  return (Math.max(speed, model.vFloor) / model.v0) ** model.beta;
}

export function normaliseRms(rmsValue, speed, model = SPEED_MODEL) {
  return rmsValue / speedNormalisationFactor(speed, model);
}

/**
 * Median raw and normalised RMS per speed bin, for checking (and later refitting) beta.
 * A well-chosen beta makes the normalised column flat on a single surface.
 */
export function speedBinProfile(windows, edges = [0, 2, 4, 6, 8, 10, 12, 14, 17, 20, 25, 35]) {
  const bins = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const inBin = windows.filter((window) => window.valid && window.speed >= edges[index] && window.speed < edges[index + 1]);
    if (!inBin.length) continue;
    bins.push({
      speedFromMs: edges[index],
      speedToMs: edges[index + 1],
      windows: inBin.length,
      medianRms: median(inBin.map((window) => window.rms)),
      medianNormalisedRms: median(inBin.map((window) => window.normalisedRms)),
      p90NormalisedRms: percentile(inBin.map((window) => window.normalisedRms), 90),
    });
  }
  return bins;
}

/** Least-squares slope of log(rms) on log(speed): an empirical beta for one surface. */
export function fitBeta(pairs) {
  const usable = pairs.filter(([speed, value]) => speed > 0 && value > 0);
  if (usable.length < 3) return NaN;
  const xs = usable.map(([speed]) => Math.log(speed));
  const ys = usable.map(([, value]) => Math.log(value));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let index = 0; index < xs.length; index += 1) {
    num += (xs[index] - mx) * (ys[index] - my);
    den += (xs[index] - mx) ** 2;
  }
  return den > 0 ? num / den : NaN;
}
