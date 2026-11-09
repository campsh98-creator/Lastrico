import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCURATE_FIX_METERS,
  createNavigationFixState,
  distanceMeters,
  fuseGpsPosition,
  processGpsFix,
} from "../lib/navigation-fix-processor.ts";
import { buildRouteProgressModel, pointAtProgress } from "../lib/route-progress.ts";

const LATITUDE = 45.48;
const LONGITUDE = 9.19;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const metersPerLat = 110_540;
const at = (x, y) => [LONGITUDE + x / metersPerLon, LATITUDE + y / metersPerLat];
const BOUNDS = { west: 9, south: 45, east: 10, north: 46 };

function straightRoute(meters = 3000) {
  const coordinates = [];
  for (let x = 0; x <= meters; x += 50) coordinates.push(at(x, 0));
  return buildRouteProgressModel(coordinates, [
    { id: "depart", type: "depart", location: at(0, 0) },
    { id: "arrive", type: "arrive", location: at(meters, 0) },
  ], distanceMeters);
}

function driver(model, mode = "car") {
  let state = createNavigationFixState();
  let timestamp = 2_000_000;
  const session = {
    reroutes: 0,
    decisions: [],
    get state() { return state; },
    fix(x, y, { accuracy = 9, elapsed = 1, heading = null, speed = null } = {}) {
      timestamp += elapsed * 1_000;
      const decision = processGpsFix(state, { coordinate: at(x, y), accuracy, timestamp, heading, speed }, {
        now: timestamp, mode, bounds: BOUNDS,
        route: { model, minutes: 10, distanceKm: model.totalMeters / 1_000 },
        lastCalculationAt: 0, calculationInProgress: false,
      });
      state = decision.state;
      if (decision.shouldRecalculate) session.reroutes += 1;
      session.decisions.push(decision);
      return decision;
    },
  };
  return session;
}

test("a precise fix after a poor estimate takes over almost entirely", () => {
  const fused = fuseGpsPosition({
    previous: at(0, 90), previousUncertainty: 120, velocity: null,
    measurement: at(0, 0), accuracy: 8, elapsedSeconds: 1,
    reportedSpeed: null, reportedHeading: null, maximumSpeed: 70,
  });
  assert.ok(distanceMeters(fused.position, at(0, 0)) < 5, `${distanceMeters(fused.position, at(0, 0))} m from the precise fix`);
  assert.ok(fused.uncertainty < 12);
});

test("similar fixes are averaged and a moving vehicle is predicted, not dragged behind", () => {
  const fused = fuseGpsPosition({
    previous: at(0, 0), previousUncertainty: 9, velocity: [8, 0],
    measurement: at(8, 0), accuracy: 9, elapsedSeconds: 1,
    reportedSpeed: null, reportedHeading: null, maximumSpeed: 70,
  });
  assert.ok(distanceMeters(fused.position, at(8, 0)) < 1.5, "no lag behind the measured position");
});

test("cold start: tower reflections that claim ±22 m never cause a reroute", () => {
  const session = driver(straightRoute());
  for (let second = 0; second < 10; second += 1) session.fix(second * 8, 80, { accuracy: 22 });
  for (let second = 10; second < 30; second += 1) session.fix(second * 8, 2, { accuracy: 8 });
  assert.equal(session.reroutes, 0);
  assert.equal(session.decisions.at(-1).confident, true, "on-route accurate fixes make the start trustworthy");
});

test("start-up never blocks for ever: a driver really off the route is rerouted after the grace", () => {
  const session = driver(straightRoute());
  for (let second = 0; second < 40; second += 1) session.fix(100, 300 + second * 8, { accuracy: 10 });
  assert.ok(session.reroutes >= 1);
  const first = session.decisions.findIndex((decision) => decision.shouldRecalculate);
  assert.ok(first >= 19 && first <= 25, `rerouted at fix ${first}`);
});

test("after a trustworthy start, leaving the route still reroutes promptly", () => {
  const session = driver(straightRoute());
  for (let x = 0; x <= 200; x += 10) session.fix(x, 2);
  const before = session.decisions.length;
  for (let y = 60; y <= 300; y += 60) session.fix(210, y);
  const first = session.decisions.findIndex((decision, index) => index >= before && decision.shouldRecalculate);
  assert.ok(first >= before && first <= before + 3, `rerouted ${first - before} fixes after leaving`);
});

test("quality is reported honestly: approximate, accurate, then resumed after a silence", () => {
  const session = driver(straightRoute());
  assert.equal(session.fix(0, 0, { accuracy: 90 }).quality, "approximate");
  assert.equal(session.fix(8, 0, { accuracy: ACCURATE_FIX_METERS.car }).quality, "accurate");
  assert.equal(session.fix(16, 0).quality, "accurate");
  assert.equal(session.fix(120, 0, { elapsed: 12 }).quality, "resumed");
  assert.equal(session.fix(128, 0).quality, "accurate");
});

test("an approximate fix is never drawn on the road; an accurate one close to it is", () => {
  const session = driver(straightRoute());
  const rough = session.fix(40, 45, { accuracy: 80 });
  assert.equal(rough.display.snapped, false, "no fabricated precision");
  for (let x = 48; x <= 96; x += 8) session.fix(x, 6, { accuracy: 9 });
  const accurate = session.decisions.at(-1);
  assert.equal(accurate.display.snapped, true);
  assert.ok(Math.abs(accurate.display.position[1] - LATITUDE) * metersPerLat < 0.5, "on the road line");
  assert.ok(Math.abs(accurate.display.heading - 90) < 10, `course follows the road (${accurate.display.heading})`);
});

test("one stray fix stays on the road, a sustained parallel street 32 m away is not drawn on the route", () => {
  const session = driver(straightRoute());
  for (let x = 0; x <= 100; x += 8) session.fix(x, 1);
  assert.equal(session.fix(108, 32, { accuracy: 12 }).display.snapped, true, "map matching absorbs one outlier");
  let last = null;
  for (let x = 116; x <= 156; x += 8) last = session.fix(x, 32, { accuracy: 12 });
  assert.equal(last.display.snapped, false, "a persistent offset shows where the vehicle really is");
});

test("stationary at a light: the drawn arrow neither drifts nor spins", () => {
  const session = driver(straightRoute());
  for (let x = 0; x <= 120; x += 8) session.fix(x, 0, { heading: 90, speed: 8 });
  const stopped = session.decisions.at(-1).display;
  const jitter = [[3, 2], [-2, -3], [4, -1], [-3, 3], [1, -4], [-4, 1], [2, 3], [-1, -2]];
  for (const [dx, dy] of jitter) session.fix(120 + dx, dy, { accuracy: 12, speed: 0 });
  const last = session.decisions.at(-1).display;
  assert.ok(distanceMeters(stopped.position, last.position) < 6, `${distanceMeters(stopped.position, last.position)} m drift`);
  assert.ok(Math.abs(last.heading - stopped.heading) < 5, "heading kept while stopped");
});

test("pointAtProgress follows the route geometry and its course", () => {
  const model = buildRouteProgressModel([at(0, 0), at(100, 0), at(100, 100)], [], distanceMeters);
  const middle = pointAtProgress(model, 150);
  assert.ok(distanceMeters(middle.coordinate, at(100, 50)) < 1);
  assert.ok(Math.abs(middle.bearing) < 5 || Math.abs(middle.bearing - 360) < 5, "heading north on the second leg");
  assert.ok(distanceMeters(pointAtProgress(model, 9999).coordinate, at(100, 100)) < 1, "clamped to the end");
});

test("all three modes use their own accurate-fix threshold", () => {
  assert.deepEqual(ACCURATE_FIX_METERS, { car: 30, motorcycle: 30, bicycle: 25 });
  const bike = driver(straightRoute(), "bicycle");
  assert.equal(bike.fix(0, 0, { accuracy: 28 }).quality, "approximate");
  assert.equal(bike.fix(5, 0, { accuracy: 12 }).quality, "accurate");
});
