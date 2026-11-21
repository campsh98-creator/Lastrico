import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createNavigationFixState, distanceMeters, processGpsFix } from "../lib/navigation-fix-processor.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import {
  START_HEADING_TOLERANCE_DEGREES,
  fetchEngineRoutes,
  fetchValhallaCustomizedRoute,
  fetchValhallaRouteExcluding,
  normalizedHeading,
} from "../lib/routing-providers.ts";

/**
 * Field case (20 November 2026, Corso di Porta Romana, 17:19 trace): five reroutes in a row were requested from a car moving
 * north-west (course 311 degrees, 4-5 m/s) and every new route began by driving south-east (131 degrees), followed by a U-turn
 * the driver never made. `tests/fixtures/p0-reroute-heading-replay.json` keeps only numbers from that trace (no coordinates).
 */
const replay = JSON.parse(await readFile(new URL("./fixtures/p0-reroute-heading-replay.json", import.meta.url), "utf8"));

const LATITUDE = 45.465;
const LONGITUDE = 9.18;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const metersPerLat = 110_540;
const at = (x, y) => [LONGITUDE + x / metersPerLon, LATITUDE + y / metersPerLat];
const BOUNDS = { west: 9, south: 45, east: 10, north: 46 };
const angularGap = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

function eastRoute() {
  const coordinates = [];
  for (let x = 0; x <= 1_000; x += 50) coordinates.push(at(x, 0));
  const instructions = [
    { id: "depart", type: "depart", location: at(0, 0) },
    { id: "arrive", type: "arrive", location: at(1_000, 0) },
  ];
  return buildRouteProgressModel(coordinates, instructions, distanceMeters);
}

function driveWestOnEastRoute({ speed, heading }) {
  const model = eastRoute();
  let state = createNavigationFixState();
  let timestamp = 1_000_000;
  let last;
  // A vehicle on the opposite carriageway of the route's street: it sits on the line but travels against the route.
  for (let x = 600, i = 0; i < 12; x -= 8, i += 1) {
    timestamp += 1_000;
    last = processGpsFix(state, { coordinate: at(x, 3), accuracy: 8, timestamp, heading, speed }, {
      now: timestamp, mode: "car", bounds: BOUNDS, route: { model, minutes: 10, distanceKm: 1 }, lastCalculationAt: 0, calculationInProgress: false,
    });
    state = last.state;
  }
  return last;
}

test("the course sent with a reroute is the vehicle's own, not the bearing of the route it is matched to", () => {
  const decision = driveWestOnEastRoute({ speed: 8, heading: 270 });
  assert.equal(decision.outcome, "accepted");
  assert.ok(decision.travelCourse !== null && angularGap(decision.travelCourse, 270) < 10, `travel course ${decision.travelCourse}`);
  // The matched route runs east. The drawn heading follows it, which is why it must never be used to ask for a reroute.
  if (decision.display.snapped) assert.ok(angularGap(decision.display.heading, 270) > 45, "display heading follows the route, not the car");
});

test("a standstill has no travel course, so no stale heading reaches the provider", () => {
  const decision = driveWestOnEastRoute({ speed: 0, heading: 270 });
  assert.equal(decision.outcome, "accepted");
  assert.equal(decision.travelCourse, null);
});

test("without a device course, movement of the fixes still gives the travel course", () => {
  const decision = driveWestOnEastRoute({ speed: null, heading: null });
  assert.ok(decision.travelCourse !== null && angularGap(decision.travelCourse, 270) < 20, `travel course ${decision.travelCourse}`);
});

test("the trace replay: five of seven field reroutes started against the direction of travel", () => {
  const against = replay.reroutes.filter((r) => angularGap(r.courseDegrees, r.newRouteStartBearingDegrees) > 150);
  assert.equal(replay.reroutes.length, 7);
  assert.equal(against.length, 5, "the reproduced failure: new route opposite to the car");
  assert.ok(replay.reroutes.every((r) => r.speedMetersPerSecond > 1), "all were moving, so a course was available");
  // What the provider is now asked for in each of them is the car's own course, which is within a degree of the reported one.
  for (const r of replay.reroutes) assert.ok(angularGap(normalizedHeading(r.courseDegrees), r.courseDegrees) <= 0.5);
  const rejectedByTolerance = against.filter((r) => angularGap(r.courseDegrees, r.newRouteStartBearingDegrees) > START_HEADING_TOLERANCE_DEGREES);
  assert.equal(rejectedByTolerance.length, 5, "an edge facing the opposite way is outside the +-60 degree window");
});

test("normalizedHeading keeps degrees in 0-359 and drops anything that is not a number", () => {
  assert.equal(normalizedHeading(311.4), 311);
  assert.equal(normalizedHeading(-49), 311);
  assert.equal(normalizedHeading(360), 0);
  assert.equal(normalizedHeading(719.6), 0);
  for (const bad of [NaN, Infinity, null, undefined]) assert.equal(normalizedHeading(bad), undefined);
});

function capturingFetch() {
  const bodies = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response("{}", { status: 500 });
  };
  return { bodies, restore: () => { globalThis.fetch = real; } };
}

test("every kind of Valhalla request carries the heading on the first point only, and none without it", async () => {
  const capture = capturingFetch();
  const points = [[9.19, 45.464], [9.2, 45.47]];
  const deadline = () => Date.now() + 20_000;
  const signal = () => new AbortController().signal;
  try {
    const meter = { requests: 0, limit: 20, startHeading: 311 };
    await fetchEngineRoutes(points, "car", true, deadline(), signal(), meter);
    await fetchEngineRoutes([points[0], [9.195, 45.467], points[1]], "car", false, deadline(), signal(), meter);
    await fetchValhallaCustomizedRoute(points, "car", [{ shape: "abc", factor: 15 }], deadline(), signal(), meter);
    await fetchValhallaRouteExcluding(points, "car", [[[9.19, 45.46], [9.2, 45.46], [9.2, 45.47]]], deadline(), signal(), meter);
    const valhalla = capture.bodies.filter((b) => b.body && b.body.locations);
    assert.ok(valhalla.length >= 4, "one request of each kind at least");
    for (const { body } of valhalla) {
      assert.equal(body.locations[0].heading, 311);
      assert.equal(body.locations[0].heading_tolerance, START_HEADING_TOLERANCE_DEGREES);
      for (const later of body.locations.slice(1)) assert.equal("heading" in later, false, "only the vehicle's own position has a direction");
    }
    capture.bodies.length = 0;
    await fetchEngineRoutes(points, "car", true, deadline(), signal(), { requests: 0, limit: 20 });
    await fetchEngineRoutes(points, "car", true, deadline(), signal(), { requests: 0, limit: 20, startHeading: Number.NaN });
    for (const { body } of capture.bodies.filter((b) => b.body && b.body.locations)) {
      assert.equal("heading" in body.locations[0], false);
      assert.equal("heading_tolerance" in body.locations[0], false);
    }
  } finally {
    capture.restore();
  }
});
