/**
 * Behaviour of the analysis on SYNTHETIC scenarios. Passing tests show that the code does what
 * it is designed to do under the generator's assumptions — not that it works on real roads.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { analyseTrace, INDEX_DESCRIPTION } from "../src/analyse.mjs";
import { evaluateTrip, truthClassForSpan } from "../src/evaluate.mjs";
import { coreScenarios, mixedSections } from "../src/scenarios.mjs";
import { generateTrip } from "../src/synthetic.mjs";

const scenarios = new Map(coreScenarios().map((scenario) => [scenario.spec.id, scenario]));
const run = (id) => evaluateTrip(scenarios.get(id));
const decidedOn = (trip, truth) => trip.confusion[truth].smooth + trip.confusion[truth]["rough-periodic"];

test("output is honest about what it is: uncalibrated, not IRI, data kind carried through", () => {
  const { trace } = generateTrip({ mode: "car", seed: 1, sections: mixedSections({ speedMs: 9, scale: 0.4 }) });
  const analysis = analyseTrace(trace);
  assert.equal(analysis.calibrated, false);
  assert.equal(analysis.dataKind, "synthetic");
  assert.match(INDEX_DESCRIPTION, /not IRI/);
  assert.ok(analysis.segments.every((segment) => ["smooth", "rough-periodic", "uncertain"].includes(segment.label)));
  assert.ok(analysis.segments.filter((segment) => segment.label === "uncertain").every((segment) => segment.reasons.length > 0));
  assert.throws(() => analyseTrace({ ...trace, schema: "other" }), TypeError);
});

test("analysis is deterministic", () => {
  const { trace } = generateTrip({ mode: "car", seed: 2, sections: mixedSections({ speedMs: 9, scale: 0.4 }) });
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(analyseTrace(trace)), hash(analyseTrace(structuredClone(trace))));
});

test("smooth asphalt is never called rough", () => {
  for (const id of ["car-asphalt-8", "car-asphalt-12"]) {
    const trip = run(id);
    assert.equal(trip.confusion.smooth["rough-periodic"], 0, id);
    assert.ok(trip.confusion.smooth.smooth / trip.segments.length >= 0.9, id);
  }
});

test("sett at several speeds and pitches is called rough-periodic, never smooth (car and bicycle)", () => {
  const ids = [...scenarios.keys()].filter((id) => /^(car|bike)-mixed-p/.test(id));
  assert.equal(ids.length, 15);
  for (const id of ids) {
    const trip = run(id);
    assert.equal(trip.confusion["rough-periodic"].smooth, 0, `${id}: sett called smooth`);
    assert.equal(trip.confusion.smooth["rough-periodic"], 0, `${id}: asphalt called rough`);
    assert.ok(trip.confusion["rough-periodic"]["rough-periodic"] >= 3, `${id}: too few sett detections`);
  }
});

test("periodicity is confirmed only where 60 Hz sampling can resolve it (low speed)", () => {
  const slow = run("bike-mixed-p0.15-v3");
  assert.ok(slow.bases["sustained-and-periodic"] >= 1);
  const fast = run("car-mixed-p0.15-v12");
  assert.equal(fast.bases["sustained-and-periodic"] ?? 0, 0);
  assert.ok(fast.bases["sustained-only-periodicity-unresolvable"] >= 1);
});

test("isolated potholes, kerbs and speed bumps are reported as events and do not make a segment rough", () => {
  const trip = run("car-asphalt-events");
  assert.equal(trip.labelCounts["rough-periodic"], 0);
  assert.equal(trip.events.byKind.pothole.detected, 3);
  assert.equal(trip.events.byKind.kerb.detected, 1);
  assert.ok(trip.events.byKind["speed-bump"].detected >= 1);
  assert.equal(trip.events.unmatchedOnAsphalt, 0);
  const { trace } = generateTrip(scenarios.get("car-asphalt-events").spec);
  const kinds = analyseTrace(trace).events.filter((event) => !event.suppressed).map((event) => event.kind);
  assert.ok(kinds.includes("sharp-impact") && kinds.includes("slow-heave"));
});

test("phone in hand: handling bursts are flagged and excluded; classes are not confused", () => {
  const trip = run("car-hand-mixed");
  assert.ok((trip.windowFlagCounts.handling ?? 0) > 10);
  assert.equal(trip.confusion.smooth["rough-periodic"], 0);
  assert.equal(trip.confusion["rough-periodic"].smooth, 0);
  assert.ok(decidedOn(trip, "rough-periodic") >= 5);
});

test("irregular sampling (iOS-like jitter, drops, repeats, 30 Hz, gaps) keeps working", () => {
  for (const id of ["car-ios-like-jitter-drops", "car-30hz", "car-60hz-gaps"]) {
    const trip = run(id);
    assert.equal(trip.confusion.smooth["rough-periodic"] + trip.confusion["rough-periodic"].smooth, 0, id);
    assert.ok(decidedOn(trip, "rough-periodic") >= 5, id);
  }
  assert.ok(run("car-60hz-gaps").sampling.runs >= 3);
});

test("GPS dropouts and missing GPS lead to explicit abstention", () => {
  const dropouts = run("car-gps-dropouts");
  assert.ok((dropouts.reasonCounts["gps-missing"] ?? 0) >= 3);
  const off = run("car-gps-off");
  assert.equal(off.labelCounts.smooth + off.labelCounts["rough-periodic"], 0);
  assert.ok(off.segments.every((segment) => segment.reasons.includes("gps-missing")));
});

test("walking pace abstains as too slow", () => {
  const trip = run("car-walking-pace");
  assert.equal(trip.labelCounts.smooth + trip.labelCounts["rough-periodic"], 0);
  assert.ok(trip.segments.every((segment) => segment.reasons.includes("too-slow")));
});

test("clipping: detected, rough calls kept as lower bounds, never used to call a road smooth", () => {
  const trip = run("bike-sett-clipping");
  assert.ok((trip.reasonCounts["clipping-lower-bound"] ?? 0) >= 1);
  assert.equal(trip.confusion["rough-periodic"].smooth, 0);
  const potholes = run("car-potholes-clipping");
  assert.equal(potholes.labelCounts["rough-periodic"], 0);
  assert.equal(potholes.events.byKind.pothole.detected, 3);
});

test("a trip entirely on sett abstains instead of calling it smooth", () => {
  const trip = run("car-all-sett");
  assert.equal(trip.labelCounts.smooth, 0);
  assert.ok(trip.reasonCounts["absolute-level-high"] >= 1);
});

test("known limitation: degraded random asphalt looks like sett at car speeds", () => {
  const car = run("car-rough-asphalt-confounder");
  // Documented false positive: 60 Hz sampling cannot see sett joints at 9 m/s.
  assert.ok(car.confusion["rough-other"]["rough-periodic"] >= 5);
  const slowBike = run("bike-rough-asphalt-slow");
  // Where periodicity is resolvable, the confounder is rejected (abstention), not called pavé.
  assert.equal(slowBike.confusion["rough-other"]["rough-periodic"], 0);
  assert.ok((slowBike.reasonCounts["rough-not-periodic"] ?? 0) >= 1);
});

test("platform variants (sign inversion, no gyro/linear, 0.1 m/s^2 rounding) do not change the outcome", () => {
  for (const id of ["car-ios-sign-inverted", "car-no-gyro-no-linear", "car-quantized-0.1"]) {
    const trip = run(id);
    assert.equal(trip.confusion.smooth["rough-periodic"] + trip.confusion["rough-periodic"].smooth, 0, id);
    assert.ok(decidedOn(trip, "rough-periodic") >= 6, id);
  }
});

test("truth mapping marks impure spans as mixed", () => {
  const truth = { spans: [{ surface: "asphalt", startMs: 0, endMs: 1000 }, { surface: "sett", startMs: 1000, endMs: 2000 }] };
  assert.equal(truthClassForSpan(truth, 0, 900), "smooth");
  assert.equal(truthClassForSpan(truth, 500, 1500), "mixed");
  assert.equal(truthClassForSpan(truth, 1050, 2000), "rough-periodic");
});
