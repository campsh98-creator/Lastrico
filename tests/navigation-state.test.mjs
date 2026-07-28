import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOffRouteReading,
  gpsCoordinateMoved,
  shouldAcceptGpsReading,
  shouldRunSimulationTimer,
} from "../lib/navigation-state.ts";

const bounds = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
};

const planarDistance = (a, b) => Math.hypot(
  (a[0] - b[0]) * 78_000,
  (a[1] - b[1]) * 111_000,
);

test("only simulation mode is allowed to run the automatic movement timer", () => {
  assert.equal(shouldRunSimulationTimer("simulation"), true);
  assert.equal(shouldRunSimulationTimer("gps"), false);
  assert.equal(shouldRunSimulationTimer(null), false);
});

test("stationary GPS readings do not count as movement", () => {
  const point = [9.1901, 45.4642];
  assert.equal(gpsCoordinateMoved(point, [...point], planarDistance), false);
  assert.equal(gpsCoordinateMoved(point, [9.1903, 45.4642], planarDistance), true);
});

test("GPS readings must be accurate and inside the Milan beta bounds", () => {
  assert.equal(shouldAcceptGpsReading([9.1901, 45.4642], 12, bounds), true);
  assert.equal(shouldAcceptGpsReading([9.1901, 45.4642], 150, bounds), false);
  assert.equal(shouldAcceptGpsReading([12.4964, 41.9028], 8, bounds), false);
});

test("off-route recalculation triggers once after consecutive readings and cooldown", () => {
  const first = evaluateOffRouteReading({
    currentReadings: 0,
    offRouteMeters: 70,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 20_000,
    lastCalculationAt: 0,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.deepEqual(first, { readings: 1, shouldRecalculate: false });

  const second = evaluateOffRouteReading({
    currentReadings: first.readings,
    offRouteMeters: 72,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 20_500,
    lastCalculationAt: 0,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.deepEqual(second, { readings: 0, shouldRecalculate: true });

  const withinCooldown = evaluateOffRouteReading({
    currentReadings: 1,
    offRouteMeters: 75,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 25_000,
    lastCalculationAt: 20_500,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.deepEqual(withinCooldown, { readings: 2, shouldRecalculate: false });
});

test("an on-route reading clears accumulated off-route noise", () => {
  assert.deepEqual(evaluateOffRouteReading({
    currentReadings: 2,
    offRouteMeters: 10,
    thresholdMeters: 55,
    requiredReadings: 3,
    now: 50_000,
    lastCalculationAt: 0,
    cooldownMs: 15_000,
    calculationInProgress: false,
  }), { readings: 0, shouldRecalculate: false });
});
