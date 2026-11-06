/**
 * Aggregate metrics on the SYNTHETIC suite. Thresholds guard against regressions in code
 * behaviour; they are not claims about real-world accuracy.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { emptyConfusion, evaluateTrip, metricsFromConfusion, runCoreSuite, runSweeps } from "../src/evaluate.mjs";
import { coreScenarios, SWEEPS } from "../src/scenarios.mjs";

const suite = runCoreSuite();

test("every evaluated trip is synthetic", () => {
  assert.equal(suite.dataKind, "synthetic");
  assert.ok(suite.trips.every((trip) => trip.dataKind === "synthetic"));
});

test("overall synthetic metrics stay above regression thresholds", () => {
  const { metrics } = suite.overall;
  assert.ok(metrics.scoredSegments >= 500);
  assert.ok(metrics.coverage >= 0.9, `coverage ${metrics.coverage}`);
  assert.ok(metrics.perClass.smooth.precision >= 0.98);
  assert.ok(metrics.perClass.smooth.recall >= 0.9);
  // Rough precision includes the deliberate rough-asphalt confounder.
  assert.ok(metrics.perClass["rough-periodic"].precision >= 0.9);
  assert.ok(metrics.perClass["rough-periodic"].recall >= 0.9);
  assert.equal(suite.overall.confusion.smooth["rough-periodic"], 0);
  assert.equal(suite.overall.confusion["rough-periodic"].smooth, 0);
});

test("the pipeline beats the naive threshold and prevalence baselines on rough precision", () => {
  const ours = suite.overall.metrics.perClass["rough-periodic"].precision;
  const naive = suite.baselines.naiveThreshold.metrics.perClass["rough-periodic"].precision;
  assert.ok(ours > naive, `ours ${ours} naive ${naive}`);
  assert.equal(suite.baselines.prevalence.majority, "smooth");
  assert.equal(suite.baselines.prevalence.metrics.perClass["rough-periodic"].recall, 0);
});

test("confusion bookkeeping is consistent", () => {
  const total = suite.trips.reduce((sum, trip) => sum + trip.segments.length, 0);
  const counted = suite.trips.reduce((sum, trip) => sum + Object.values(trip.confusion).reduce((s, row) => s + Object.values(row).reduce((a, b) => a + b, 0), 0), 0);
  assert.equal(total, counted);
  const empty = metricsFromConfusion(emptyConfusion());
  assert.equal(empty.coverage, null);
});

test("evaluation is deterministic", () => {
  const scenario = coreScenarios().find((item) => item.spec.id === "car-hand-mixed");
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(evaluateTrip(scenario)), hash(evaluateTrip(scenario)));
  assert.equal(hash(evaluateTrip(scenario)), hash(suite.trips.find((trip) => trip.id === "car-hand-mixed")));
});

test("when sett is barely rougher than asphalt the method abstains rather than mislabels", () => {
  const sweep = runSweeps({ seeds: [1], sweeps: { settSeverity: SWEEPS.settSeverity.filter((point) => [0.1, 1].includes(point.value)) } });
  const [weak, strong] = sweep.results.settSeverity;
  assert.ok(weak.roughRecall < 0.5, `weak recall ${weak.roughRecall}`);
  assert.ok(weak.smoothPrecision === null || weak.smoothPrecision >= 0.98);
  assert.equal(weak.confusion["rough-periodic"].smooth, 0);
  assert.ok(strong.roughRecall >= 0.9);
  assert.ok(weak.settToAsphaltLriRatio < strong.settToAsphaltLriRatio);
});
