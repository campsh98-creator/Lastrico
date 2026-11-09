/**
 * Windowed vibration features, single-event detection and spatial periodicity.
 */
import { median, nextPowerOfTwo, percentile, powerSpectrum, rms } from "./dsp.mjs";
import { gravityAngleDeg } from "./orientation.mjs";
import { windowSamplingQuality } from "./regularise.mjs";

/**
 * Splits a run into overlapping windows (power-of-two length, 50% hop) and computes features.
 * Speed and quality flags are attached here; level normalisation happens in analyse.mjs.
 */
export function computeRunWindows(run, context) {
  const { band, gravity, rotation, speedAt, options, runIndex } = context;
  const { fs, n, time } = run;
  const length = nextPowerOfTwo(Math.round(fs * options.windowSeconds));
  const hop = length / 2;
  const binHz = fs / length;
  const fHi = Math.min(options.bandHighHz, 0.45 * fs);
  const windows = [];
  for (let start = 0; start + length <= n; start += hop) {
    const end = start + length;
    const tStart = time[start];
    const tEnd = time[end - 1];
    const tCenter = (tStart + tEnd) / 2;
    const windowRms = rms(band, start, end);
    let peak = 0;
    let clippedSamples = 0;
    for (let k = start; k < end; k += 1) {
      peak = Math.max(peak, Math.abs(band[k]));
      clippedSamples += run.clipped[k];
    }
    const spectrum = powerSpectrum(band, start, length);
    let total = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let k = 1; k < spectrum.length; k += 1) {
      const f = k * binHz;
      if (f < options.bandLowHz || f > fHi) continue;
      total += spectrum[k];
      if (f < 8) low += spectrum[k];
      else if (f < 16) mid += spectrum[k];
      else high += spectrum[k];
    }
    let rotationPeak = null;
    if (rotation) {
      rotationPeak = 0;
      for (let k = start; k < end; k += 1) rotationPeak = Math.max(rotationPeak, rotation[k]);
    }
    const middle = start + hop;
    const gravityShiftDeg = Math.max(
      gravityAngleDeg(gravity, start, end - 1),
      gravityAngleDeg(gravity, start, middle),
      gravityAngleDeg(gravity, middle, end - 1),
    );
    const sampling = windowSamplingQuality(run.rawTimes, tStart, tEnd);
    const speed = speedAt(tCenter);
    windows.push({
      runIndex,
      start,
      end,
      tStart,
      tEnd,
      tCenter,
      fs,
      length,
      rms: windowRms,
      peak,
      crest: windowRms > 0 ? peak / windowRms : 0,
      bandPower: total,
      bandShares: total > 0 ? { low: low / total, mid: mid / total, high: high / total } : { low: 0, mid: 0, high: 0 },
      spectrum,
      rotationPeak,
      gravityShiftDeg,
      sampling,
      clippedSamples,
      edge: tCenter - run.t0 < options.edgeSeconds * 1000 || run.t1 - tCenter < options.edgeSeconds * 1000,
      speed,
    });
  }
  return windows;
}

/** Quality flags that make a window unusable for level statistics. */
export function windowFlags(window, options, targetHz) {
  const flags = [];
  if (window.speed === null || window.speed === undefined) flags.push("gps-missing");
  else if (window.speed < options.minSpeedMs) flags.push("too-slow");
  if (window.fs < options.minSampleRateHz) flags.push("low-sample-rate");
  const { sampling } = window;
  if (sampling.rateHz < options.minRateFraction * targetHz || sampling.intervalCv > options.maxIntervalCv
    || sampling.maxHoleMs > options.maxHoleMs) flags.push("irregular-sampling");
  if (window.rotationPeak !== null && window.rotationPeak > options.handlingRotationDegS) flags.push("handling");
  if (window.gravityShiftDeg > options.orientationShiftDeg) flags.push("orientation-change");
  if (window.edge) flags.push("run-edge");
  return flags;
}

/**
 * Single events (potholes, speed bumps, kerbs, joints) on the wide-band vertical signal.
 * Threshold adapts to the local vibration level, so a continuously rough surface does not
 * produce a stream of events.
 */
export function detectEvents(signal, run, options) {
  const { fs, time } = run;
  const n = signal.length;
  const block = Math.max(4, Math.round(0.5 * fs));
  const blockMedians = [];
  for (let start = 0; start < n; start += block) {
    const values = [];
    for (let k = start; k < Math.min(n, start + block); k += 1) values.push(Math.abs(signal[k]));
    blockMedians.push(median(values));
  }
  const contextBlocks = Math.max(1, Math.round(options.eventContextSeconds / 0.5));
  const sigmaPerBlock = blockMedians.map((_, index) => {
    const neighbourhood = blockMedians.slice(Math.max(0, index - contextBlocks), index + contextBlocks + 1);
    // Lower-half median: a single large event must not raise its own threshold.
    return 1.4826 * percentile(neighbourhood, 40);
  });
  const events = [];
  const mergeSamples = Math.round(options.eventMergeSeconds * fs);
  let k = 0;
  while (k < n) {
    const sigma = sigmaPerBlock[Math.floor(k / block)];
    const threshold = Math.max(options.eventSigma * sigma, options.eventMinMs2);
    if (Math.abs(signal[k]) <= threshold) {
      k += 1;
      continue;
    }
    let last = k;
    let peakIndex = k;
    let j = k;
    while (j < n && j - last <= mergeSamples) {
      const localThreshold = Math.max(options.eventSigma * sigmaPerBlock[Math.floor(j / block)], options.eventMinMs2);
      if (Math.abs(signal[j]) > localThreshold) {
        last = j;
        if (Math.abs(signal[j]) > Math.abs(signal[peakIndex])) peakIndex = j;
      }
      j += 1;
    }
    const half = Math.round(0.4 * fs);
    let crossings = 0;
    for (let m = Math.max(1, peakIndex - half); m < Math.min(n, peakIndex + half); m += 1) {
      if ((signal[m - 1] < 0) !== (signal[m] < 0)) crossings += 1;
    }
    const spanSeconds = (2 * half) / fs;
    const dominantHz = crossings / (2 * spanSeconds);
    const durationSeconds = (last - k + 1) / fs;
    events.push({
      tMs: time[peakIndex],
      peakMs2: Math.abs(signal[peakIndex]),
      localSigmaMs2: sigma,
      prominence: Math.abs(signal[peakIndex]) / Math.max(sigma, 1e-6),
      durationSeconds,
      dominantHz,
      kind: dominantHz < options.slowHeaveMaxHz && durationSeconds >= options.slowHeaveMinSeconds ? "slow-heave" : "sharp-impact",
      clipped: run.clipped[peakIndex] === 1,
    });
    k = last + mergeSamples + 1;
  }
  return events;
}

/**
 * Trip reference spectral shape: median band-normalised spectrum of the quietest usable windows.
 * Dividing by it whitens the vehicle/mount transfer function (resonances are fixed in Hz, while
 * sett joints are fixed in cycles per metre), so a suspension resonance is not mistaken for a
 * periodic road.
 */
export function referenceSpectra(windows, options) {
  const groups = new Map();
  for (const window of windows) {
    const key = `${window.fs}:${window.length}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(window);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    if (list.length < options.minReferenceWindows) continue;
    const bins = list[0].spectrum.length;
    const reference = new Float64Array(bins);
    for (let k = 0; k < bins; k += 1) {
      reference[k] = median(list.map((window) => window.spectrum[k] / Math.max(window.bandPower, 1e-12)));
    }
    out.set(key, reference);
  }
  return out;
}

/**
 * Average of the windows' (whitened) spectra re-expressed in spatial frequency (cycles per
 * metre), where sett joints would appear as a line at 1 / pitch. Only meaningful when the band
 * that the sampling rate can see, [fLo / v, fHi / v], covers the sett pitch band; otherwise
 * reported as unresolvable rather than guessed.
 */
export function spatialPeriodicity(windows, options, references = new Map()) {
  const nLow = 1 / options.pitchMaxM;
  const nHigh = 1 / options.pitchMinM;
  const step = options.spatialStepCyclesPerM;
  const gridStart = nLow * 0.6;
  const gridEnd = nHigh * 1.3;
  const size = Math.floor((gridEnd - gridStart) / step) + 1;
  const sum = new Float64Array(size);
  const count = new Uint16Array(size);
  let used = 0;
  for (const window of windows) {
    if (!(window.speed > 0)) continue;
    const binHz = window.fs / window.length;
    const fHi = Math.min(options.bandHighHz, 0.45 * window.fs);
    let total = 0;
    for (let k = 1; k < window.spectrum.length; k += 1) {
      const f = k * binHz;
      if (f >= options.bandLowHz && f <= fHi) total += window.spectrum[k];
    }
    if (!(total > 0)) continue;
    used += 1;
    const reference = references.get(`${window.fs}:${window.length}`);
    const whitened = (k) => {
      const value = (window.spectrum[k] ?? 0) / total;
      return reference && reference[k] > 0 ? value / reference[k] : value;
    };
    for (let index = 0; index < size; index += 1) {
      const f = (gridStart + index * step) * window.speed;
      if (f < options.bandLowHz || f > fHi) continue;
      const position = f / binHz;
      const lower = Math.floor(position);
      const weight = position - lower;
      sum[index] += whitened(lower) * (1 - weight) + whitened(lower + 1) * weight;
      count[index] += 1;
    }
  }
  const minimumCount = Math.max(1, Math.ceil(used / 2));
  let inBand = 0;
  let coveredInBand = 0;
  const bandValues = [];
  let peakValue = 0;
  let peakN = null;
  for (let index = 0; index < size; index += 1) {
    const spatial = gridStart + index * step;
    if (spatial < nLow || spatial > nHigh) continue;
    inBand += 1;
    if (count[index] < minimumCount) continue;
    coveredInBand += 1;
    const value = sum[index] / count[index];
    bandValues.push(value);
    if (value > peakValue) {
      peakValue = value;
      peakN = spatial;
    }
  }
  const coverage = inBand ? coveredInBand / inBand : 0;
  const resolvable = used > 0 && coverage >= options.minPeriodicityCoverage;
  const reference = bandValues.length ? median(bandValues) : NaN;
  const prominence = resolvable && reference > 0 ? peakValue / reference : null;
  // Averaging K spectra shrinks the noise peaks roughly as 1/sqrt(K); the threshold follows.
  const threshold = Math.max(options.periodicityProminenceFloor, 1 + options.periodicityProminenceScale / Math.sqrt(Math.max(1, used)));
  return {
    resolvable,
    coverage,
    windowsUsed: used,
    prominence,
    threshold,
    peakCyclesPerM: resolvable ? peakN : null,
    impliedPitchM: resolvable && peakN ? 1 / peakN : null,
    detected: resolvable && prominence !== null && prominence >= threshold,
  };
}
