/**
 * Per-segment road-roughness analysis of a motion (+ optional GPS) trace.
 *
 * Output index: LRI, "Lastrico relative roughness index" — speed-normalised vertical vibration
 * divided by the trip's own smooth-road baseline. Dimensionless, uncalibrated, device- and
 * mount-dependent. It is NOT the International Roughness Index (IRI) and must never be called so
 * unless calibrated against a reference profilometer.
 *
 * Labels: "smooth", "rough-periodic" (pavé-like) or "uncertain" (explicit abstention with reasons).
 */
import { bandpassSections, filtfilt, median, percentile } from "./dsp.mjs";
import { computeRunWindows, detectEvents, referenceSpectra, spatialPeriodicity, windowFlags } from "./features.mjs";
import { estimateGravity, projectVertical, rotationMagnitude } from "./orientation.mjs";
import { regularise } from "./regularise.mjs";
import { ANALYSIS_SCHEMA, ANALYSIS_VERSION, validateTrace } from "./schema.mjs";
import { buildSpeedModel, normaliseRms, SPEED_MODEL, speedBinProfile } from "./speed.mjs";

export const INDEX_DESCRIPTION = "LRI — Lastrico relative roughness index: speed-normalised vertical vibration RMS divided by the trip's smooth-road baseline. Uncalibrated, dimensionless, not IRI.";

const COMMON = {
  windowSeconds: 1.0,
  bandLowHz: 3,
  bandHighHz: 28,
  eventBandLowHz: 0.5,
  edgeSeconds: 0.75,
  segmentMeters: 60,
  segmentSecondsWithoutSpeed: 6,
  minLevelWindows: 3,
  minUsableFraction: 0.5,
  minSampleRateHz: 20,
  minRateFraction: 0.6,
  maxIntervalCv: 0.6,
  maxHoleMs: 120,
  smoothMaxLri: 1.4,
  smoothMaxElevatedFraction: 0.25,
  roughMinLri: 1.8,
  roughMinElevatedFraction: 0.6,
  roughMaxCrest: 5.5,
  baselinePercentile: 20,
  baselineMinWindows: 20,
  eventSigma: 7,
  eventContextSeconds: 4,
  eventMergeSeconds: 0.4,
  slowHeaveMaxHz: 4,
  slowHeaveMinSeconds: 0.15,
  pitchMinM: 0.09,
  pitchMaxM: 0.22,
  spatialStepCyclesPerM: 0.2,
  minPeriodicityCoverage: 0.6,
  minReferenceWindows: 10,
  referenceMaxLri: 1.3,
  periodicityProminenceFloor: 1.4,
  periodicityProminenceScale: 3,
  speedModel: SPEED_MODEL,
};

/**
 * Mode-specific placeholders. Priors and ceilings are NOT measured values: they are chosen to be
 * plausible (vehicle-body comfort levels of the order of ISO 2631-1 bands) and must be refitted
 * in a field phase. They only serve as a safety net when the trip itself cannot provide a
 * baseline, or when the whole trip may be rough.
 */
export const MODE_DEFAULTS = {
  car: { minSpeedMs: 2.5, handlingRotationDegS: 45, orientationShiftDeg: 10, eventMinMs2: 2.5, priorBaselineNrms: 0.18, smoothCeilingNrms: 0.45 },
  motorcycle: { minSpeedMs: 2.5, handlingRotationDegS: 60, orientationShiftDeg: 20, eventMinMs2: 3, priorBaselineNrms: 0.3, smoothCeilingNrms: 0.75 },
  bicycle: { minSpeedMs: 1.5, handlingRotationDegS: 80, orientationShiftDeg: 20, eventMinMs2: 6, priorBaselineNrms: 0.9, smoothCeilingNrms: 2.2 },
};

export function resolveOptions(mode, overrides = {}) {
  return { ...COMMON, ...(MODE_DEFAULTS[mode] ?? MODE_DEFAULTS.car), ...overrides };
}

const ROUND = (value, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value ?? null);

function countReasons(windows) {
  const counts = {};
  for (const window of windows) for (const flag of window.flags) counts[flag] = (counts[flag] ?? 0) + 1;
  return counts;
}

function topReasons(counts, total) {
  return Object.entries(counts)
    .filter(([, value]) => value / Math.max(1, total) >= 0.2)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function labelSegment(windows, options, baseline, references) {
  const usable = windows.filter((window) => window.valid);
  const levelWindows = usable.filter((window) => !window.hasEvent);
  const reasonCounts = countReasons(windows);
  const base = {
    windows: windows.length,
    usableWindows: usable.length,
    levelWindows: levelWindows.length,
    flagCounts: reasonCounts,
  };
  if (levelWindows.length < options.minLevelWindows || usable.length / Math.max(1, windows.length) < options.minUsableFraction) {
    const reasons = topReasons(reasonCounts, windows.length);
    return { ...base, label: "uncertain", reasons: reasons.length ? reasons : ["too-few-usable-windows"], lri: null, basis: null };
  }
  const lris = levelWindows.map((window) => window.lri);
  const lri = median(lris);
  const elevatedFraction = lris.filter((value) => value >= options.roughMinLri).length / lris.length;
  const crest = median(levelWindows.map((window) => window.crest));
  const absoluteNrms = median(levelWindows.map((window) => window.normalisedRms));
  const clipped = levelWindows.some((window) => window.clippedSamples > 0);
  const stats = { ...base, lri, elevatedFraction, medianCrest: crest, medianNormalisedRms: absoluteNrms };

  if (lri < options.smoothMaxLri && elevatedFraction <= options.smoothMaxElevatedFraction) {
    if (clipped) return { ...stats, label: "uncertain", reasons: ["clipping"], basis: null };
    if (absoluteNrms > options.smoothCeilingNrms) {
      return { ...stats, label: "uncertain", reasons: ["absolute-level-high"], basis: null };
    }
    if (baseline.suspect) return { ...stats, label: "uncertain", reasons: ["baseline-suspect"], basis: null };
    return { ...stats, label: "smooth", reasons: [], basis: "low-relative-level", margin: (options.smoothMaxLri - lri) / options.smoothMaxLri };
  }
  if (lri >= options.roughMinLri && elevatedFraction >= options.roughMinElevatedFraction && crest <= options.roughMaxCrest) {
    const periodicity = spatialPeriodicity(levelWindows, options, references);
    const reasons = clipped ? ["clipping-lower-bound"] : [];
    if (periodicity.resolvable && !periodicity.detected) {
      return { ...stats, periodicity, label: "uncertain", reasons: ["rough-not-periodic"], basis: null };
    }
    return {
      ...stats,
      periodicity,
      label: "rough-periodic",
      reasons,
      basis: periodicity.detected ? "sustained-and-periodic" : "sustained-only-periodicity-unresolvable",
      margin: (lri - options.roughMinLri) / options.roughMinLri,
    };
  }
  return { ...stats, label: "uncertain", reasons: ["intermediate"], basis: null };
}

/**
 * @param trace lastrico-roughness-trace v1
 * @param overrides analysis options (mode defaults are applied from trace.meta.mode)
 */
export function analyseTrace(trace, overrides = {}) {
  const problems = validateTrace(trace);
  if (problems.length) throw new TypeError(`Invalid trace: ${problems.join("; ")}`);
  const mode = trace.meta.mode;
  const options = resolveOptions(mode, overrides);
  const regularised = regularise(trace.motion.rows, options.regularise ?? {});
  const speedModel = buildSpeedModel(trace.gps.rows);
  const targetHz = regularised.stats.targetHz;

  const windows = [];
  const events = [];
  regularised.runs.forEach((run, runIndex) => {
    const gravity = estimateGravity(run);
    const { vertical } = projectVertical(run, gravity);
    const pad = Math.min(run.n - 1, Math.round(run.fs));
    const highHz = Math.min(options.bandHighHz, 0.45 * run.fs);
    const band = filtfilt(bandpassSections(options.bandLowHz, highHz, run.fs), vertical, pad);
    const eventBand = filtfilt(bandpassSections(options.eventBandLowHz, highHz, run.fs), vertical, pad);
    const rotation = rotationMagnitude(run);
    const runWindows = computeRunWindows(run, { band, gravity, rotation, speedAt: speedModel.speedAt, options, runIndex });
    const runEvents = detectEvents(eventBand, run, options).map((event) => ({ ...event, runIndex, speed: speedModel.speedAt(event.tMs) }));
    for (const window of runWindows) {
      window.flags = windowFlags(window, options, targetHz);
      window.valid = window.flags.length === 0;
      window.hasEvent = runEvents.some((event) => event.tMs >= window.tStart && event.tMs <= window.tEnd);
      window.normalisedRms = window.speed ? normaliseRms(window.rms, window.speed, options.speedModel) : null;
    }
    for (const event of runEvents) {
      const container = runWindows.find((window) => event.tMs >= window.tStart && event.tMs <= window.tEnd);
      const suppressedBy = container ? container.flags.filter((flag) => flag !== "run-edge") : ["outside-windows"];
      event.suppressed = suppressedBy.length > 0;
      event.suppressedBy = suppressedBy;
      if (event.suppressed) {
        for (const window of runWindows) {
          if (event.tMs >= window.tStart && event.tMs <= window.tEnd) window.hasEvent = false;
        }
      }
    }
    windows.push(...runWindows);
    events.push(...runEvents);
  });

  // Trip baseline from the quietest usable windows.
  const levelPool = windows.filter((window) => window.valid && !window.hasEvent).map((window) => window.normalisedRms);
  const baseline = {
    source: levelPool.length >= options.baselineMinWindows ? "trip-percentile" : "mode-prior",
    nrms: levelPool.length >= options.baselineMinWindows ? percentile(levelPool, options.baselinePercentile) : options.priorBaselineNrms,
    poolWindows: levelPool.length,
    percentile: options.baselinePercentile,
  };
  baseline.suspect = baseline.nrms > options.smoothCeilingNrms;
  for (const window of windows) {
    window.lri = window.normalisedRms !== null && baseline.nrms > 0 ? window.normalisedRms / baseline.nrms : null;
  }

  // A single event cannot be told apart inside continuously rough road: suppress it there.
  for (const event of events) {
    if (event.suppressed) continue;
    const context = windows.filter((window) => window.runIndex === event.runIndex && window.valid && window.lri !== null
      && Math.abs(window.tCenter - event.tMs) <= options.eventContextSeconds * 1000
      && (window.tEnd < event.tMs || window.tStart > event.tMs));
    if (context.length >= 2 && median(context.map((window) => window.lri)) >= options.roughMinLri) {
      event.suppressed = true;
      event.suppressedBy = ["rough-context"];
    }
  }

  const references = referenceSpectra(
    windows.filter((window) => window.valid && !window.hasEvent && window.lri !== null && window.lri <= options.referenceMaxLri),
    options,
  );

  // Segmentation by travelled distance (speed integrated over window hops); time when speed is unknown.
  const segments = [];
  let current = null;
  const close = () => {
    if (current && current.windows.length) segments.push(current);
    current = null;
  };
  for (const window of windows) {
    const hopSeconds = window.length / 2 / window.fs;
    const hasSpeed = window.speed !== null && window.speed !== undefined;
    if (current && (current.runIndex !== window.runIndex || current.hasSpeed !== hasSpeed)) close();
    if (!current) current = { runIndex: window.runIndex, hasSpeed, windows: [], meters: 0, startMs: window.tStart };
    current.windows.push(window);
    if (hasSpeed) current.meters += window.speed * hopSeconds;
    const elapsedSeconds = (window.tEnd - current.startMs) / 1000;
    if ((hasSpeed && current.meters >= options.segmentMeters) || (!hasSpeed && elapsedSeconds >= options.segmentSecondsWithoutSpeed)) close();
  }
  close();

  let distanceSoFar = 0;
  const segmentResults = segments.map((segment, index) => {
    const result = labelSegment(segment.windows, options, baseline, references);
    const first = segment.windows[0];
    const last = segment.windows[segment.windows.length - 1];
    const startM = segment.hasSpeed ? distanceSoFar : null;
    if (segment.hasSpeed) distanceSoFar += segment.meters;
    // Windows overlap by half a window: give each event to exactly one segment.
    const next = segments[index + 1]?.windows[0];
    const eventEnd = next && next.runIndex === first.runIndex ? next.tStart : last.tEnd + 1e-9;
    const segmentEvents = events.filter((event) => event.tMs >= first.tStart && event.tMs < eventEnd);
    const speeds = segment.windows.map((window) => window.speed).filter((value) => value !== null && value !== undefined);
    return {
      index,
      startMs: ROUND(first.tStart, 1),
      endMs: ROUND(last.tEnd, 1),
      startM: startM === null ? null : ROUND(startM, 1),
      lengthM: segment.hasSpeed ? ROUND(segment.meters, 1) : null,
      medianSpeedMs: speeds.length ? ROUND(median(speeds), 2) : null,
      label: result.label,
      basis: result.basis,
      reasons: result.reasons,
      lri: ROUND(result.lri, 3),
      margin: ROUND(result.margin ?? null, 3),
      elevatedFraction: ROUND(result.elevatedFraction ?? null, 3),
      medianCrest: ROUND(result.medianCrest ?? null, 2),
      medianNormalisedRmsMs2: ROUND(result.medianNormalisedRms ?? null, 4),
      windows: result.windows,
      usableWindows: result.usableWindows,
      levelWindows: result.levelWindows,
      flagCounts: result.flagCounts,
      periodicity: result.periodicity
        ? {
            resolvable: result.periodicity.resolvable,
            detected: result.periodicity.detected,
            coverage: ROUND(result.periodicity.coverage, 2),
            prominence: ROUND(result.periodicity.prominence, 2),
            threshold: ROUND(result.periodicity.threshold, 2),
            windowsUsed: result.periodicity.windowsUsed,
            impliedPitchM: ROUND(result.periodicity.impliedPitchM, 3),
          }
        : null,
      events: segmentEvents.filter((event) => !event.suppressed).map((event) => ({
        tMs: ROUND(event.tMs, 1), kind: event.kind, peakMs2: ROUND(event.peakMs2, 2), prominence: ROUND(event.prominence, 1),
      })),
    };
  });

  const labelCounts = { smooth: 0, "rough-periodic": 0, uncertain: 0 };
  for (const segment of segmentResults) labelCounts[segment.label] += 1;
  const windowFlagCounts = countReasons(windows);

  return {
    schema: ANALYSIS_SCHEMA,
    version: ANALYSIS_VERSION,
    dataKind: trace.dataKind,
    calibrated: false,
    index: INDEX_DESCRIPTION,
    mode,
    options: { ...options, speedModel: { ...options.speedModel } },
    sampling: { ...regularised.stats, cleaning: regularised.cleaning },
    gps: speedModel.stats,
    baseline: { ...baseline, nrms: ROUND(baseline.nrms, 4) },
    summary: {
      windows: windows.length,
      usableWindows: windows.filter((window) => window.valid).length,
      windowFlagCounts,
      segments: segmentResults.length,
      labelCounts,
      abstentionRate: segmentResults.length ? ROUND(labelCounts.uncertain / segmentResults.length, 3) : null,
      events: events.filter((event) => !event.suppressed).length,
      suppressedEvents: events.filter((event) => event.suppressed).length,
    },
    speedBins: speedBinProfile(windows).map((bin) => ({
      ...bin,
      medianRms: ROUND(bin.medianRms, 4),
      medianNormalisedRms: ROUND(bin.medianNormalisedRms, 4),
      p90NormalisedRms: ROUND(bin.p90NormalisedRms, 4),
    })),
    segments: segmentResults,
    events: events.map((event) => ({
      tMs: ROUND(event.tMs, 1), kind: event.kind, peakMs2: ROUND(event.peakMs2, 2), prominence: ROUND(event.prominence, 1),
      durationSeconds: ROUND(event.durationSeconds, 3), dominantHz: ROUND(event.dominantHz, 1), speedMs: ROUND(event.speed ?? null, 2),
      clipped: event.clipped, suppressed: event.suppressed, suppressedBy: event.suppressedBy,
    })),
    /** Window-level data for diagnostics/plots; omitted by compactAnalysis(). */
    windows: windows.map((window) => ({
      tCenter: ROUND(window.tCenter, 1), speed: ROUND(window.speed ?? null, 2), rms: ROUND(window.rms, 4),
      normalisedRms: ROUND(window.normalisedRms, 4), lri: ROUND(window.lri, 3), crest: ROUND(window.crest, 2),
      rotationPeak: ROUND(window.rotationPeak, 1), gravityShiftDeg: ROUND(window.gravityShiftDeg, 1),
      flags: window.flags, valid: window.valid, hasEvent: window.hasEvent,
    })),
  };
}

export function compactAnalysis(analysis) {
  const rest = { ...analysis };
  delete rest.windows;
  delete rest.options;
  return rest;
}
