import assert from "node:assert/strict";
import test from "node:test";
import {
  createNavigationFixState,
  distanceMeters,
  processGpsFix,
  simulationProgressMeters,
  withReplacementRoute,
} from "../lib/navigation-fix-processor.ts";
import { buildRouteProgressModel, calculateRouteProgress } from "../lib/route-progress.ts";

const LATITUDE = 45.465;
const LONGITUDE = 9.18;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const metersPerLat = 110_540;
const at = (x, y) => [LONGITUDE + x / metersPerLon, LATITUDE + y / metersPerLat];
const BOUNDS = { west: 9, south: 45, east: 10, north: 46 };

/** Builds a route from east/north legs and a turn instruction at each corner. */
function buildRoute(legs) {
  const coordinates = [at(0, 0)];
  const instructions = [{ id: "depart", type: "depart", location: at(0, 0) }];
  let x = 0;
  let y = 0;
  legs.forEach(([east, north], index) => {
    const steps = Math.max(1, Math.round(Math.hypot(east, north) / 50));
    for (let step = 1; step <= steps; step += 1) {
      coordinates.push(at(x + east * step / steps, y + north * step / steps));
    }
    x += east;
    y += north;
    instructions.push({
      id: index === legs.length - 1 ? "arrive" : `turn-${index + 1}`,
      type: index === legs.length - 1 ? "arrive" : "turn",
      location: at(x, y),
    });
  });
  return buildRouteProgressModel(coordinates, instructions, distanceMeters);
}

function driver(model, mode = "car") {
  let state = createNavigationFixState();
  let timestamp = 1_000_000;
  const session = {
    reroutes: 0,
    lastCalculationAt: 0,
    decisions: [],
    get state() { return state; },
    fix(x, y, { accuracy = 10, elapsed = 1, heading = null, speed = null } = {}) {
      timestamp += elapsed * 1_000;
      const decision = processGpsFix(state, { coordinate: at(x, y), accuracy, timestamp, heading, speed }, {
        now: timestamp,
        mode,
        bounds: BOUNDS,
        route: { model, minutes: 10, distanceKm: model.totalMeters / 1_000 },
        lastCalculationAt: session.lastCalculationAt,
        calculationInProgress: false,
      });
      state = decision.state;
      if (decision.shouldRecalculate) session.reroutes += 1;
      session.decisions.push(decision);
      return decision;
    },
  };
  return session;
}

const EAST = 90;
const WEST = 270;
const moving = (heading) => ({ heading, speed: 14 });

/** The field-reproduced case: two multipath fixes near a return leg, then clean fixes. */
function driveReproducedScenario(session, headingOptions = {}) {
  for (let x = 0; x <= 196; x += 14) session.fix(x, 3, headingOptions);
  session.fix(214, 55, { accuracy: 25, ...headingOptions });
  session.fix(228, 58, { accuracy: 25, ...headingOptions });
  session.fix(242, 4, headingOptions);
  session.fix(256, 3, headingOptions);
}

for (const gap of [80, 100]) {
  for (const [label, options] of [["without heading", {}], ["with heading", moving(EAST)]]) {
    test(`multipath near a return leg ${gap} m away does not jump progress or force a reroute, ${label}`, () => {
      const session = driver(buildRoute([[1000, 0], [0, gap], [-1000, 0]]));
      driveReproducedScenario(session, options);
      const last = session.decisions.at(-1);
      assert.ok(last.progress.routeProgressMeters < 300, `progress ${last.progress.routeProgressMeters}`);
      assert.equal(last.progress.instruction.id, "turn-1");
      assert.equal(session.reroutes, 0);
    });
  }
}

test("outside the confirmation path an advance never exceeds the plausible window", () => {
  const session = driver(buildRoute([[1000, 0], [0, 100], [-1000, 0]]));
  driveReproducedScenario(session);
  let previous = 0;
  for (const decision of session.decisions) {
    const accuracy = decision.state.accuracy;
    const window = Math.max(60, Math.min(decision.elapsedSeconds, 10) * 45 + accuracy * 2);
    assert.ok(decision.progress.routeProgressMeters - previous <= window);
    previous = decision.progress.routeProgressMeters;
  }
});

test("a short opposite-direction loop stays on the leg being driven when heading is reliable", () => {
  const session = driver(buildRoute([[150, 0], [0, 60], [-150, 0]]));
  for (let x = 0; x <= 70; x += 14) session.fix(x, 2, moving(EAST));
  session.fix(84, 42, { accuracy: 15, ...moving(EAST) });
  session.fix(98, 45, { accuracy: 15, ...moving(EAST) });
  const last = session.decisions.at(-1);
  assert.ok(last.progress.routeProgressMeters < 150, `progress ${last.progress.routeProgressMeters}`);
  assert.equal(last.progress.instruction.id, "turn-1");
});

test("multipath toward a later leg running in the same direction causes no jump", () => {
  const session = driver(buildRoute([[300, 0], [0, 80], [-300, 0], [0, 80], [300, 0]]));
  for (let x = 0; x <= 196; x += 14) session.fix(x, 3, moving(EAST));
  session.fix(210, 130, { accuracy: 25, ...moving(EAST) });
  session.fix(224, 135, { accuracy: 25, ...moving(EAST) });
  assert.ok(session.state.progressMeters < 300, `progress ${session.state.progressMeters}`);
});

for (const [label, options] of [["without heading", {}], ["with heading", moving(EAST)]]) {
  test(`a 45 s GPS gap recovers within three fixes without a reroute, ${label}`, () => {
    const session = driver(buildRoute([[3000, 0]]));
    for (let x = 0; x <= 280; x += 14) session.fix(x, 2, options);
    const before = session.state.progressMeters;
    const exit = 280 + 14 * 46;
    session.fix(exit, 2, { elapsed: 46, ...options });
    assert.equal(session.state.progressMeters >= before, true);
    session.fix(exit + 14, 2, options);
    session.fix(exit + 28, 2, options);
    assert.ok(Math.abs(session.state.progressMeters - (exit + 28)) < 40, `progress ${session.state.progressMeters}`);
    assert.equal(session.reroutes, 0);
    assert.equal(session.state.offRouteReadings, 0);
    for (const decision of session.decisions) assert.equal(decision.offRouteStarted, false);
  });
}

test("the elapsed time is the real interval between accepted fixes", () => {
  const session = driver(buildRoute([[3000, 0]]));
  session.fix(0, 0);
  assert.equal(session.fix(14, 0).elapsedSeconds, 1);
  assert.equal(session.fix(434, 0, { elapsed: 30 }).elapsedSeconds, 30);
});

test("leaving the route triggers a reroute within the required readings", () => {
  const session = driver(buildRoute([[2000, 0]]));
  for (let x = 0; x <= 280; x += 14) session.fix(x, 2);
  for (let y = 60; y <= 300; y += 60) session.fix(290, y);
  assert.ok(session.reroutes >= 1);
});

test("rejoining the route ahead while a reroute is cooling down is confirmed, not stuck", () => {
  const session = driver(buildRoute([[3000, 0]]));
  for (let x = 0; x <= 280; x += 14) session.fix(x, 2);
  session.lastCalculationAt = 1_000_000 + 1_000_000;
  for (let step = 1; step <= 25; step += 1) session.fix(280 + step * 14, 120);
  const rejoin = 280 + 26 * 14;
  session.fix(rejoin, 3);
  session.fix(rejoin + 14, 3);
  session.fix(rejoin + 28, 3);
  assert.ok(Math.abs(session.state.progressMeters - (rejoin + 28)) < 40, `progress ${session.state.progressMeters}`);
});

test("multipath toward an earlier parallel leg does not read as going backwards", () => {
  const session = driver(buildRoute([[1000, 0], [0, 100], [-1000, 0]]));
  for (let x = 0; x <= 1000; x += 14) session.fix(x, 2);
  for (let y = 20; y <= 90; y += 14) session.fix(1000, y);
  for (let x = 986; x >= 800; x -= 14) session.fix(x, 98, moving(WEST));
  const before = session.state.progressMeters;
  const reroutesBefore = session.reroutes;
  session.fix(786, 49, { accuracy: 25, ...moving(WEST) });
  session.fix(772, 47, { accuracy: 25, ...moving(WEST) });
  session.fix(758, 99, moving(WEST));
  assert.ok(session.state.progressMeters >= before);
  assert.equal(session.reroutes, reroutesBefore);
});

test("a true U-turn is still reported as leaving the route", () => {
  const session = driver(buildRoute([[3000, 0]]));
  for (let x = 0; x <= 700; x += 14) session.fix(x, 2);
  for (let x = 686; x >= 300; x -= 14) session.fix(x, 2);
  assert.ok(session.reroutes >= 1);
});

test("a replacement route clears everything measured on the old one", () => {
  const state = {
    ...createNavigationFixState(),
    progressMeters: 900,
    offRouteReadings: 1,
    arrivalReadings: 1,
    pendingJump: { progressMeters: 1200, confirmations: 2, elapsedSeconds: 3 },
  };
  const replaced = withReplacementRoute(state, 12);
  assert.equal(replaced.progressMeters, 12);
  assert.equal(replaced.pendingJump, null);
  assert.equal(replaced.offRouteReadings, 0);
  assert.equal(replaced.arrivalReadings, 0);
});

test("simulation advances monotonically to the end of a looped route", () => {
  const model = buildRoute([[300, 0], [0, 200], [-150, 0], [0, -300], [-150, 0]]);
  let previous = 0;
  let last = null;
  for (let index = 0; index < model.coordinates.length; index += 3) {
    last = calculateRouteProgress(model, model.coordinates[index], 10, simulationProgressMeters(model, index), {
      accuracy: 5,
      elapsedSeconds: 1,
      maxSpeedMps: 45,
    });
    assert.ok(last.routeProgressMeters >= previous);
    previous = last.routeProgressMeters;
  }
  const end = model.coordinates.length - 1;
  last = calculateRouteProgress(model, model.coordinates[end], 10, simulationProgressMeters(model, end), {
    accuracy: 5,
    elapsedSeconds: 1,
    maxSpeedMps: 45,
  });
  assert.ok(last.remainingMeters < 1);
  assert.equal(last.instruction.id, "arrive");
});
