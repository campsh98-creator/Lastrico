/**
 * Scoring of analysis output against SYNTHETIC truth. Every number produced here describes
 * behaviour on generated data under the generator's assumptions — not accuracy on real roads.
 */
import { analyseTrace } from "./analyse.mjs";
import { median } from "./dsp.mjs";
import { coreScenarios, sweepSpec, SWEEPS } from "./scenarios.mjs";
import { generateTrip } from "./synthetic.mjs";

export const TRUTH_CLASSES = ["smooth", "rough-periodic", "rough-other", "mixed"];
export const PREDICTED = ["smooth", "rough-periodic", "uncertain"];
const SURFACE_TO_CLASS = { asphalt: "smooth", sett: "rough-periodic", "rough-asphalt": "rough-other" };

export function truthClassForSpan(truth, startMs, endMs, purity = 0.8) {
  const share = {};
  const total = Math.max(1, endMs - startMs);
  for (const span of truth.spans) {
    const overlap = Math.min(endMs, span.endMs) - Math.max(startMs, span.startMs);
    if (overlap > 0) share[SURFACE_TO_CLASS[span.surface]] = (share[SURFACE_TO_CLASS[span.surface]] ?? 0) + overlap / total;
  }
  const [best, fraction] = Object.entries(share).sort((a, b) => b[1] - a[1])[0] ?? ["mixed", 0];
  return fraction >= purity ? best : "mixed";
}

export function emptyConfusion() {
  return Object.fromEntries(TRUTH_CLASSES.map((truth) => [truth, Object.fromEntries(PREDICTED.map((label) => [label, 0]))]));
}

export function addConfusion(target, source) {
  for (const truth of TRUTH_CLASSES) for (const label of PREDICTED) target[truth][label] += source[truth][label];
  return target;
}

const ratio = (num, den) => (den > 0 ? Number((num / den).toFixed(4)) : null);

/** Precision/recall per decided class; abstentions count against recall but not precision. */
export function metricsFromConfusion(confusion) {
  const scored = ["smooth", "rough-periodic", "rough-other"];
  const totalScored = scored.reduce((sum, truth) => sum + PREDICTED.reduce((s, label) => s + confusion[truth][label], 0), 0);
  const decided = scored.reduce((sum, truth) => sum + confusion[truth].smooth + confusion[truth]["rough-periodic"], 0);
  const perClass = {};
  for (const label of ["smooth", "rough-periodic"]) {
    const truePositive = confusion[label][label];
    const predicted = scored.reduce((sum, truth) => sum + confusion[truth][label], 0);
    const actual = PREDICTED.reduce((sum, item) => sum + confusion[label][item], 0);
    const actualDecided = confusion[label].smooth + confusion[label]["rough-periodic"];
    perClass[label] = {
      support: actual,
      predicted,
      precision: ratio(truePositive, predicted),
      recall: ratio(truePositive, actual),
      recallWhenDecided: ratio(truePositive, actualDecided),
      abstentionRate: ratio(confusion[label].uncertain, actual),
    };
  }
  const roughOther = PREDICTED.reduce((sum, item) => sum + confusion["rough-other"][item], 0);
  const balanced = [perClass.smooth.recallWhenDecided, perClass["rough-periodic"].recallWhenDecided].filter((value) => value !== null);
  return {
    scoredSegments: totalScored,
    mixedSegmentsExcluded: PREDICTED.reduce((sum, item) => sum + confusion.mixed[item], 0),
    coverage: ratio(decided, totalScored),
    balancedAccuracyWhenDecided: balanced.length ? ratio(balanced.reduce((a, b) => a + b, 0), balanced.length) : null,
    perClass,
    roughOther: {
      support: roughOther,
      calledRoughPeriodic: ratio(confusion["rough-other"]["rough-periodic"], roughOther),
      calledSmooth: ratio(confusion["rough-other"].smooth, roughOther),
      abstained: ratio(confusion["rough-other"].uncertain, roughOther),
    },
  };
}

/**
 * Naive baseline: RMS of (|accelerationIncludingGravity| - trip median) over the same segment
 * spans, fixed a-priori threshold per mode, no speed normalisation, no quality gates, no abstention.
 */
export const NAIVE_THRESHOLDS = { car: 0.45, motorcycle: 0.75, bicycle: 2.2 };
export function naiveBaselineLabels(trace, segments) {
  const rows = trace.motion.rows;
  const magnitudes = rows.map((row) => Math.hypot(row[1], row[2], row[3]));
  const center = median(magnitudes);
  const threshold = NAIVE_THRESHOLDS[trace.meta.mode];
  let cursor = 0;
  return segments.map((segment) => {
    let sum = 0;
    let count = 0;
    while (cursor < rows.length && rows[cursor][0] < segment.startMs) cursor += 1;
    for (let index = cursor; index < rows.length && rows[index][0] <= segment.endMs; index += 1) {
      sum += (magnitudes[index] - center) ** 2;
      count += 1;
    }
    const value = count ? Math.sqrt(sum / count) : 0;
    return value > threshold ? "rough-periodic" : "smooth";
  });
}

export function matchEvents(truth, analysis, toleranceMs = 1000) {
  const detected = analysis.events.filter((event) => !event.suppressed);
  const used = new Set();
  let matched = 0;
  const byKind = {};
  for (const event of truth.events) {
    byKind[event.kind] ??= { truth: 0, detected: 0 };
    byKind[event.kind].truth += 1;
    const index = detected.findIndex((candidate, position) => !used.has(position) && Math.abs(candidate.tMs - event.tMs) <= toleranceMs);
    if (index >= 0) {
      used.add(index);
      matched += 1;
      byKind[event.kind].detected += 1;
    }
  }
  const unmatched = detected.filter((_, position) => !used.has(position));
  const unmatchedOnAsphalt = unmatched.filter((event) => truthClassForSpan(truth, event.tMs - 1, event.tMs + 1, 1) === "smooth").length;
  return { truthEvents: truth.events.length, matched, byKind, unmatchedDetections: unmatched.length, unmatchedOnAsphalt };
}

export function evaluateTrip(scenario, analysisOverrides = {}) {
  const { trace, truth } = generateTrip(scenario.spec);
  const analysis = analyseTrace(trace, analysisOverrides);
  const confusion = emptyConfusion();
  const naiveConfusion = emptyConfusion();
  const naive = naiveBaselineLabels(trace, analysis.segments);
  const reasonCounts = {};
  const segments = analysis.segments.map((segment, index) => {
    const truthClass = truthClassForSpan(truth, segment.startMs, segment.endMs);
    confusion[truthClass][segment.label] += 1;
    naiveConfusion[truthClass][naive[index]] += 1;
    for (const reason of segment.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return { truth: truthClass, label: segment.label, basis: segment.basis, reasons: segment.reasons, lri: segment.lri, speed: segment.medianSpeedMs };
  });
  const bases = {};
  for (const segment of analysis.segments) if (segment.basis) bases[segment.basis] = (bases[segment.basis] ?? 0) + 1;
  const lriByTruth = {};
  for (const truthClass of ["smooth", "rough-periodic", "rough-other"]) {
    const values = segments.filter((segment) => segment.truth === truthClass && segment.lri !== null).map((segment) => segment.lri);
    if (values.length) lriByTruth[truthClass] = Number(median(values).toFixed(3));
  }
  return {
    id: scenario.spec.id,
    group: scenario.group,
    expect: scenario.expect,
    mode: trace.meta.mode,
    dataKind: trace.dataKind,
    durationS: Number((truth.durationMs / 1000).toFixed(1)),
    motionRows: trace.motion.rows.length,
    gpsRows: trace.gps.rows.length,
    sampling: { rateHz: Number(analysis.sampling.rateHz.toFixed(2)), jitterMs: Number(analysis.sampling.jitterMs.toFixed(2)), runs: analysis.sampling.runs, gaps: analysis.sampling.gaps },
    baseline: analysis.baseline,
    labelCounts: analysis.summary.labelCounts,
    windowFlagCounts: analysis.summary.windowFlagCounts,
    reasonCounts,
    bases,
    lriByTruth,
    confusion,
    naiveConfusion,
    events: matchEvents(truth, analysis),
    segments,
  };
}

function sumConfusions(trips, key = "confusion") {
  return trips.reduce((total, trip) => addConfusion(total, trip[key]), emptyConfusion());
}

/** Prevalence baseline: always predict the most frequent scored truth class. */
export function prevalenceMetrics(confusion) {
  const supports = { smooth: 0, "rough-periodic": 0 };
  for (const truth of Object.keys(supports)) supports[truth] = PREDICTED.reduce((sum, label) => sum + confusion[truth][label], 0);
  const majority = supports.smooth >= supports["rough-periodic"] ? "smooth" : "rough-periodic";
  const prevalence = emptyConfusion();
  for (const truth of ["smooth", "rough-periodic", "rough-other"]) {
    prevalence[truth][majority] = PREDICTED.reduce((sum, label) => sum + confusion[truth][label], 0);
  }
  return { majority, metrics: metricsFromConfusion(prevalence) };
}

export function runCoreSuite(analysisOverrides = {}) {
  const trips = coreScenarios().map((scenario) => evaluateTrip(scenario, analysisOverrides));
  const classifyTrips = trips.filter((trip) => trip.expect === "classify");
  const groups = {};
  for (const trip of trips) {
    groups[trip.group] ??= [];
    groups[trip.group].push(trip);
  }
  const groupMetrics = Object.fromEntries(Object.entries(groups).map(([group, list]) => {
    const confusion = sumConfusions(list);
    return [group, { trips: list.map((trip) => trip.id), confusion, metrics: metricsFromConfusion(confusion) }];
  }));
  const overall = sumConfusions(classifyTrips);
  const naive = sumConfusions(classifyTrips, "naiveConfusion");
  return {
    dataKind: "synthetic",
    trips,
    groups: groupMetrics,
    overall: { confusion: overall, metrics: metricsFromConfusion(overall) },
    baselines: {
      naiveThreshold: { thresholdsMs2: NAIVE_THRESHOLDS, confusion: naive, metrics: metricsFromConfusion(naive) },
      prevalence: prevalenceMetrics(overall),
    },
  };
}

function mergePatch(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...(base[key] ?? {}), ...value } : value;
  }
  return out;
}

export function runSweeps({ seeds = [1, 2], sweeps = SWEEPS, mode = "car" } = {}) {
  const results = {};
  for (const [name, points] of Object.entries(sweeps)) {
    results[name] = points.map(({ value, patch }) => {
      const confusion = emptyConfusion();
      const bases = {};
      const settLri = [];
      const asphaltLri = [];
      for (const seed of seeds) {
        const spec = sweepSpec(mergePatch({ id: `sweep-${name}-${value}-${seed}`, seed: 9000 + seed, mode }, patch));
        const trip = evaluateTrip({ spec, group: `sweep-${name}`, expect: "classify" });
        addConfusion(confusion, trip.confusion);
        for (const [basis, count] of Object.entries(trip.bases)) bases[basis] = (bases[basis] ?? 0) + count;
        if (trip.lriByTruth["rough-periodic"] !== undefined) settLri.push(trip.lriByTruth["rough-periodic"]);
        if (trip.lriByTruth.smooth !== undefined) asphaltLri.push(trip.lriByTruth.smooth);
      }
      const metrics = metricsFromConfusion(confusion);
      return {
        value,
        coverage: metrics.coverage,
        balancedAccuracyWhenDecided: metrics.balancedAccuracyWhenDecided,
        smoothPrecision: metrics.perClass.smooth.precision,
        smoothRecall: metrics.perClass.smooth.recall,
        roughPrecision: metrics.perClass["rough-periodic"].precision,
        roughRecall: metrics.perClass["rough-periodic"].recall,
        settToAsphaltLriRatio: settLri.length && asphaltLri.length ? Number((median(settLri) / median(asphaltLri)).toFixed(2)) : null,
        bases,
        confusion,
      };
    });
  }
  return { dataKind: "synthetic", mode, seeds, results };
}
