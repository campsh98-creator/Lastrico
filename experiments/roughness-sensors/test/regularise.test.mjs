import assert from "node:assert/strict";
import test from "node:test";
import { createRng } from "../src/prng.mjs";
import { regularise, samplingStats, windowSamplingQuality } from "../src/regularise.mjs";

function rows({ hz = 60, seconds = 10, jitterMs = 0, gaps = [], seed = 1 }) {
  const rng = createRng(seed);
  const out = [];
  for (let k = 0; k < hz * seconds; k += 1) {
    const t = (k * 1000) / hz + jitterMs * rng.normal();
    if (gaps.some(([from, to]) => t >= from && t < to)) continue;
    out.push([t, 0.1 * Math.sin(t / 50), 9.81 + 0.1 * rng.normal(), 0.05 * rng.normal(), 0, 0, 0, 1, 2, 3]);
  }
  return out;
}

test("jittered ~60 Hz input is resampled onto a uniform 60 Hz grid", () => {
  const result = regularise(rows({ hz: 60, jitterMs: 1.5 }));
  assert.equal(result.stats.targetHz, 60);
  assert.equal(result.runs.length, 1);
  const [run] = result.runs;
  assert.equal(run.fs, 60);
  assert.ok(Math.abs(run.n - 600) <= 2, `n ${run.n}`);
  for (let k = 1; k < run.n; k += 1) assert.ok(Math.abs(run.time[k] - run.time[k - 1] - 1000 / 60) < 1e-9);
  assert.ok(result.stats.jitterMs > 1 && result.stats.jitterMs < 4, `jitter ${result.stats.jitterMs}`);
  assert.ok(run.lin && run.rot, "optional channels kept when present");
});

test("30 Hz input keeps its native rate", () => {
  const result = regularise(rows({ hz: 30 }));
  assert.equal(result.stats.targetHz, 30);
});

test("gaps split the recording into runs and short runs are dropped", () => {
  const result = regularise(rows({ hz: 60, seconds: 20, gaps: [[5000, 7000], [9000, 10500]] }));
  // Runs: 0-5 s (kept), 7-9 s (2 s, dropped), 10.5-20 s (kept).
  assert.equal(result.runs.length, 2);
  assert.equal(result.cleaning.droppedShortRuns, 1);
  assert.equal(result.stats.gaps, 2);
});

test("unsorted rows, duplicate timestamps, stale repeats and non-finite rows are cleaned", () => {
  const input = rows({ hz: 60, seconds: 5 });
  const shuffled = [input[3], input[1], input[2], input[0], ...input.slice(4)];
  shuffled.push([...input[10]]); // duplicate timestamp
  shuffled.push([input[11][0] + 1, ...input[11].slice(1)]); // stale repeat of the values
  shuffled.push([NaN, 1, 2, 3]);
  shuffled.push([500, null, 1, 1]);
  const result = regularise(shuffled);
  assert.equal(result.cleaning.nonFinite, 2);
  assert.equal(result.cleaning.duplicateTimestamps, 1);
  assert.equal(result.cleaning.repeatedValues, 1);
  assert.equal(result.runs.length, 1);
});

test("missing linear acceleration / gyroscope channels are reported as unavailable", () => {
  const input = rows({ hz: 60, seconds: 5 }).map((row) => [...row.slice(0, 4), null, null, null, null, null, null]);
  const [run] = regularise(input).runs;
  assert.equal(run.lin, null);
  assert.equal(run.rot, null);
});

test("saturation plateaus are flagged as clipping, single peaks are not", () => {
  const input = rows({ hz: 60, seconds: 6 });
  input[100][2] = 19.6;
  input[101][2] = 19.6;
  input[102][2] = 19.6;
  const clipped = regularise(input);
  assert.ok(clipped.stats.clippedSamples >= 3);
  const peak = rows({ hz: 60, seconds: 6 });
  peak[100][2] = 25;
  assert.equal(regularise(peak).stats.clippedSamples, 0);
});

test("window sampling quality reflects holes", () => {
  const times = Float64Array.from({ length: 120 }, (_, k) => (k < 60 || k > 70 ? (k * 1000) / 60 : NaN)).filter(Number.isFinite);
  const quality = windowSamplingQuality(times, 900, 1300);
  assert.ok(quality.maxHoleMs > 150);
  const regular = windowSamplingQuality(times, 0, 900);
  assert.ok(regular.intervalCv < 0.01);
  assert.ok(Math.abs(samplingStats(Array.from(times)).medianIntervalMs - 1000 / 60) < 1e-9);
});
