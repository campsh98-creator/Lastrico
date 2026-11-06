import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateTrace } from "../src/schema.mjs";
import { generateTrip } from "../src/synthetic.mjs";

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const base = {
  id: "determinism", mode: "car", seed: 11,
  sections: [{ surface: "asphalt", lengthM: 120, speedMs: 10 }, { surface: "sett", lengthM: 120, speedMs: 8, pitchM: 0.15, events: [{ atM: 60, kind: "pothole" }] }],
};

test("same seed gives byte-identical synthetic traces; another seed does not", () => {
  const first = generateTrip(base);
  const second = generateTrip(base);
  assert.equal(sha(first), sha(second));
  assert.notEqual(sha(first.trace), sha(generateTrip({ ...base, seed: 12 }).trace));
});

test("synthetic traces are valid and labelled synthetic everywhere", () => {
  const { trace, truth } = generateTrip(base);
  assert.deepEqual(validateTrace(trace), []);
  assert.equal(trace.dataKind, "synthetic");
  assert.equal(truth.dataKind, "synthetic");
  assert.match(trace.meta.notice, /SYNTHETIC/);
  assert.equal(trace.meta.synthetic.seed, 11);
});

test("truth spans are contiguous and follow the section order", () => {
  const { truth } = generateTrip(base);
  assert.deepEqual(truth.spans.map((span) => span.surface), ["asphalt", "sett"]);
  assert.equal(truth.spans[0].startMs, 0);
  assert.equal(truth.spans[0].endMs, truth.spans[1].startMs);
  assert.equal(truth.spans[1].endMs, truth.durationMs);
  assert.deepEqual(truth.events.map((event) => event.kind), ["pothole"]);
});

test("sampling options shape the motion rows (rate, drops, gaps, quantisation)", () => {
  const sixty = generateTrip({ ...base, sampling: { hz: 60 } });
  const seconds = sixty.truth.durationMs / 1000;
  assert.ok(Math.abs(sixty.trace.motion.rows.length - seconds * 60) < 3);
  const thirty = generateTrip({ ...base, sampling: { hz: 30 } });
  assert.ok(Math.abs(thirty.trace.motion.rows.length - seconds * 30) < 3);
  const dropped = generateTrip({ ...base, sampling: { hz: 60, dropProbability: 0.2 } });
  assert.ok(dropped.trace.motion.rows.length < 0.85 * seconds * 60);
  const gapped = generateTrip({ ...base, sampling: { hz: 60, gaps: [{ atS: 5, durationS: 3 }] } });
  assert.ok(!gapped.trace.motion.rows.some((row) => row[0] > 5100 && row[0] < 7900));
  const quantized = generateTrip({ ...base, sampling: { quantizeMs2: 0.1 } });
  assert.ok(quantized.trace.motion.rows.slice(0, 50).every((row) => Math.abs(row[1] * 10 - Math.round(row[1] * 10)) < 1e-6));
});

test("GPS: speed-only by default, Null Island positions on request, dropouts respected", () => {
  const speedOnly = generateTrip(base).trace;
  assert.equal(speedOnly.meta.gpsMode, "speed-only");
  assert.ok(speedOnly.gps.rows.every((row) => row[1] === null && row[2] === null && row[4] >= 0));
  const withPositions = generateTrip({ ...base, gps: { positions: true, dropouts: [{ atS: 5, durationS: 6 }] } }).trace;
  assert.ok(withPositions.gps.rows.every((row) => Math.abs(row[1]) < 0.01 && Math.abs(row[2]) < 0.01));
  assert.ok(!withPositions.gps.rows.some((row) => row[0] > 5100 && row[0] < 10900));
  const off = generateTrip({ ...base, gps: { enabled: false } }).trace;
  assert.equal(off.gps.rows.length, 0);
  assert.equal(off.meta.gpsMode, "off");
});

test("platform variants: iOS-like sign inversion, missing gyro/linear, clipping", () => {
  const spec = generateTrip(base).trace.motion.rows;
  const inverted = generateTrip({ ...base, phone: { gravitySign: -1 } }).trace.motion.rows;
  const meanY = (rows) => rows.reduce((sum, row) => sum + row[2], 0) / rows.length;
  assert.ok(meanY(spec) > 8 && meanY(inverted) < -8, "gravity mostly on +y for the spec convention, -y inverted");
  const bare = generateTrip({ ...base, phone: { gyro: false, linear: false } }).trace.motion.rows;
  assert.ok(bare.every((row) => row.slice(4).every((value) => value === null)));
  const clipped = generateTrip({ ...base, phone: { clipMs2: 12 } }).trace.motion.rows;
  assert.ok(clipped.every((row) => row.slice(1, 4).every((value) => Math.abs(value) <= 12)));
});

test("handling bursts are generated for a hand-held phone", () => {
  const { truth, trace } = generateTrip({ ...base, sections: [{ surface: "asphalt", lengthM: 900, speedMs: 10 }], phone: { placement: "hand", burstEveryS: 20 } });
  assert.ok(truth.bursts.length >= 2);
  const peakRotation = Math.max(...trace.motion.rows.map((row) => Math.hypot(row[7], row[8], row[9])));
  assert.ok(peakRotation > 60, `peak rotation ${peakRotation}`);
});
