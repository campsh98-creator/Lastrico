import assert from "node:assert/strict";
import test from "node:test";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import { evaluateTimedGpsReading, evaluateOffRouteReading, shouldApplyRouteResponse } from "../lib/navigation-state.ts";
import { geographicDistance } from "../lib/road-intelligence-scoring.ts";

test("Roccella GPS validation uses its own area while retaining speed and stale-fix checks", () => {
  const now = 10_000;
  const fix = { coordinate: [16.4008, 38.3224], accuracy: 5, timestamp: now, now,
    previousCoordinate: null, previousAccuracy: null, previousTimestamp: null,
    bounds: PILOT_AREAS.roccella.bounds, distanceMeters: geographicDistance, maximumSpeedMetersPerSecond: 70 };
  assert.equal(evaluateTimedGpsReading(fix).accepted, true);
  assert.equal(evaluateTimedGpsReading({ ...fix, bounds: PILOT_AREAS.milan.bounds }).accepted, false);
  assert.equal(evaluateTimedGpsReading({ ...fix, coordinate: PILOT_AREAS.milan.center }).accepted, false);
  assert.equal(evaluateTimedGpsReading({ ...fix, timestamp: now - 60_000 }).accepted, false);
  assert.equal(evaluateTimedGpsReading({ ...fix, previousCoordinate: [16.37, 38.30], previousTimestamp: now - 1000, previousAccuracy: 5 }).accepted, false);
});

test("Roccella rerouting keeps consecutive-fix and session invalidation constraints", () => {
  const input = { currentReadings: 0, offRouteMeters: 100, thresholdMeters: 55, requiredReadings: 2,
    now: 30_000, lastCalculationAt: 0, cooldownMs: 15_000, calculationInProgress: false };
  const first = evaluateOffRouteReading(input);
  assert.equal(first.shouldRecalculate, false);
  assert.equal(evaluateOffRouteReading({ ...input, currentReadings: first.readings, now: 31_000 }).shouldRecalculate, true);
  assert.equal(evaluateOffRouteReading({ ...input, currentReadings: 1, calculationInProgress: true }).shouldRecalculate, false);
  assert.equal(shouldApplyRouteResponse(1, 1, 2, 1, false), false, "terminated or switched area session cannot accept stale reroute");
});
