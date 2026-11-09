import assert from "node:assert/strict";
import test from "node:test";
import { analyseTrace } from "../src/analyse.mjs";
import { createRecorder } from "../src/recorder.mjs";
import { mixedSections } from "../src/scenarios.mjs";
import { validateTrace } from "../src/schema.mjs";
import { generateTrip } from "../src/synthetic.mjs";

const motionEvent = (k, interval = 1 / 60) => ({
  accelerationIncludingGravity: { x: 0.1, y: 9.8 + 0.01 * (k % 7), z: -0.2 },
  acceleration: { x: 0, y: 0.01 * (k % 7), z: 0 },
  rotationRate: { alpha: 1, beta: 2, gamma: 3 },
  interval,
});

test("nothing is recorded before start", () => {
  const recorder = createRecorder({ mode: "car", gpsMode: "off" });
  assert.equal(recorder.addMotion(motionEvent(0), 10), false);
  assert.equal(recorder.toTrace(), null);
});

test("live stats report the measured rate and the non-standard iOS interval unit", () => {
  const recorder = createRecorder({ mode: "car", gpsMode: "off" });
  recorder.start(1000);
  for (let k = 0; k < 180; k += 1) recorder.addMotion(motionEvent(k), 1000 + (k * 1000) / 60);
  const stats = recorder.liveStats(1000 + 3000);
  assert.ok(Math.abs(stats.rateHz - 60) < 1, `rate ${stats.rateHz}`);
  assert.equal(stats.intervalUnit, "seconds (non-standard)");
  assert.equal(stats.gyroscope, true);
  assert.equal(stats.linearAcceleration, true);
  assert.deepEqual(stats.issues, []);
  const android = createRecorder({ mode: "car", gpsMode: "off" });
  android.start(0);
  android.addMotion(motionEvent(0, 16), 1);
  assert.equal(android.liveStats(2).intervalUnit, "milliseconds");
  assert.ok(android.liveStats(5000).issues.includes("no-motion-events"));
});

test("speed-only GPS discards coordinates at ingestion; GPS off ignores fixes", () => {
  const position = { coords: { latitude: 45.46, longitude: 9.19, accuracy: 5, speed: 8.3, heading: 90 } };
  const speedOnly = createRecorder({ mode: "car", gpsMode: "speed-only" });
  speedOnly.start(0);
  speedOnly.addPosition(position, 100);
  assert.deepEqual(speedOnly.toTrace().gps.rows[0], [100, null, null, 5, 8.3, 90]);
  const withPosition = createRecorder({ mode: "car", gpsMode: "speed-and-position" });
  withPosition.start(0);
  withPosition.addPosition(position, 100);
  assert.equal(withPosition.toTrace().gps.rows[0][1], 45.46);
  const off = createRecorder({ mode: "car", gpsMode: "off" });
  off.start(0);
  assert.equal(off.addPosition(position, 100), false);
  assert.equal(off.toTrace().gps.rows.length, 0);
});

test("the duration cap stops recording", () => {
  const recorder = createRecorder({ mode: "car", gpsMode: "off" }, { maxMinutes: 0.01 });
  recorder.start(0);
  for (let k = 0; k < 60; k += 1) recorder.addMotion(motionEvent(k), (k * 1000) / 60);
  assert.equal(recorder.state, "full");
  assert.ok(recorder.rowCount < 60);
});

test("discard removes everything from memory", () => {
  const recorder = createRecorder({ mode: "car", gpsMode: "speed-only" });
  recorder.start(0);
  recorder.addMotion(motionEvent(0), 1);
  recorder.discard();
  assert.equal(recorder.state, "idle");
  assert.equal(recorder.rowCount, 0);
  assert.equal(recorder.toTrace(), null);
});

test("a recording fed with event-like objects produces a valid, analysable trace", () => {
  const { trace } = generateTrip({ mode: "car", seed: 4, sections: mixedSections({ speedMs: 9, scale: 0.5 }) });
  const recorder = createRecorder({ mode: "car", gpsMode: "speed-only", dataKind: "synthetic" });
  recorder.start(0);
  for (const [t, ax, ay, az, lx, ly, lz, ra, rb, rg] of trace.motion.rows) {
    recorder.addMotion({ accelerationIncludingGravity: { x: ax, y: ay, z: az }, acceleration: { x: lx, y: ly, z: lz }, rotationRate: { alpha: ra, beta: rb, gamma: rg }, interval: 1 / 60 }, t);
  }
  for (const [t, , , accuracy, speed, heading] of trace.gps.rows) recorder.addPosition({ coords: { accuracy, speed, heading } }, t);
  recorder.stop(trace.meta.durationMs);
  const recorded = recorder.toTrace();
  assert.deepEqual(validateTrace(recorded), []);
  assert.equal(recorded.dataKind, "synthetic");
  assert.equal(recorded.meta.reportedIntervalUnitGuess, "s");
  const original = analyseTrace(trace).segments.map((segment) => segment.label);
  const replayed = analyseTrace(recorded).segments.map((segment) => segment.label);
  assert.deepEqual(replayed, original);
});
