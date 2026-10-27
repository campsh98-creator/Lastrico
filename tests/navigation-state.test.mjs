import assert from "node:assert/strict";
import test from "node:test";
import {
  createNavigationDiagnostics,
  evaluateGpsSignalStall,
  evaluateOffRouteReading,
  evaluateTimedGpsReading,
  estimateArrivalTimestamp,
  formatNavigationDiagnosticsSummary,
  gpsCoordinateMoved,
  recordNavigationDiagnosticEvent,
  shouldAcceptGpsReading,
  shouldApplyRouteResponse,
  shouldBeginNavigation,
  shouldRunSimulationTimer,
  shouldUpdateNavigationCamera,
  smoothGpsCoordinate,
  smoothHeading,
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

test("navigation start is idempotent while a journey is already active", () => {
  assert.equal(shouldBeginNavigation(false), true);
  assert.equal(shouldBeginNavigation(true), false);
});

test("stationary GPS readings do not count as movement", () => {
  const point = [9.1901, 45.4642];
  assert.equal(gpsCoordinateMoved(point, [...point], planarDistance), false);
  assert.equal(gpsCoordinateMoved(point, [9.190125, 45.4642], planarDistance, 4), false);
  assert.equal(gpsCoordinateMoved(point, [9.1903, 45.4642], planarDistance), true);
});

test("GPS smoothing trusts accurate readings more than noisy readings", () => {
  const previous = [9.19, 45.46];
  const current = [9.191, 45.461];
  const accurate = smoothGpsCoordinate(previous, current, 5);
  const noisy = smoothGpsCoordinate(previous, current, 100);

  assert.ok(accurate[0] > noisy[0]);
  assert.ok(accurate[1] > noisy[1]);
  assert.deepEqual(smoothGpsCoordinate(null, current, 10), current);
});

test("heading smoothing crosses north using the shortest arc", () => {
  assert.equal(Math.round(smoothHeading(350, 10, 0.5)), 0);
  assert.equal(Math.round(smoothHeading(10, 350, 0.5)), 0);
  assert.equal(Math.round(smoothHeading(90, 180, 0.5)), 135);
});

test("arrival timestamp never moves into the past for negative remaining time", () => {
  const now = 1_000_000;
  assert.equal(estimateArrivalTimestamp(now, 12.5), now + 750_000);
  assert.equal(estimateArrivalTimestamp(now, -3), now);
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

test("timed GPS readings reject stale, duplicate and implausible fixes", () => {
  const base = {
    coordinate: [9.1902, 45.4642],
    accuracy: 8,
    timestamp: 20_000,
    now: 20_500,
    previousCoordinate: [9.19, 45.4642],
    previousTimestamp: 19_000,
    bounds,
    distanceMeters: planarDistance,
  };
  assert.deepEqual(evaluateTimedGpsReading(base), { accepted: true, reason: "accepted" });
  assert.equal(evaluateTimedGpsReading({ ...base, timestamp: 10_000 }).reason, "stale");
  assert.equal(evaluateTimedGpsReading({ ...base, timestamp: 19_000 }).reason, "duplicate");
  assert.equal(evaluateTimedGpsReading({
    ...base,
    coordinate: [9.21, 45.48],
  }).reason, "implausible");
});

test("only the latest route response from the active session may apply", () => {
  assert.equal(shouldApplyRouteResponse(7, 7, 3, null, false), true);
  assert.equal(shouldApplyRouteResponse(7, 6, 3, null, false), false);
  assert.equal(shouldApplyRouteResponse(7, 7, 3, 3, true), true);
  assert.equal(shouldApplyRouteResponse(7, 7, 4, 3, true), false);
  assert.equal(shouldApplyRouteResponse(7, 7, 3, 3, false), false);
});

test("navigation camera is throttled but recentering remains immediate", () => {
  const base = {
    mode: "navigation-following",
    now: 10_000,
    lastUpdatedAt: 9_800,
    previousCenter: [9.19, 45.4642],
    center: [9.1902, 45.4642],
    previousHeading: 359,
    heading: 2,
    distanceMeters: planarDistance,
  };
  assert.equal(shouldUpdateNavigationCamera(base), false);
  assert.equal(shouldUpdateNavigationCamera({ ...base, now: 10_500 }), true);
  assert.equal(shouldUpdateNavigationCamera({ ...base, mode: "manual-control", now: 10_500 }), false);
  assert.equal(shouldUpdateNavigationCamera({ ...base, mode: "recentering" }), true);
});

test("off-route accumulation is capped while cooldown is active", () => {
  assert.deepEqual(evaluateOffRouteReading({
    currentReadings: 3,
    offRouteMeters: 80,
    thresholdMeters: 55,
    requiredReadings: 3,
    now: 12_000,
    lastCalculationAt: 10_000,
    cooldownMs: 15_000,
    calculationInProgress: false,
  }), { readings: 3, shouldRecalculate: false });
});

test("coarse-to-fine GPS lock transition is accepted while accurate teleportation is rejected", () => {
  const coarseFix = [9.19, 45.4642];
  const fineFix = [9.1911, 45.4642]; // ~85.8m apart
  const base = {
    coordinate: fineFix,
    accuracy: 6,
    timestamp: 21_000,
    now: 21_100,
    previousCoordinate: coarseFix,
    previousTimestamp: 20_000,
    bounds,
    distanceMeters: planarDistance,
    maximumSpeedMetersPerSecond: 15,
  };

  assert.deepEqual(
    evaluateTimedGpsReading({ ...base, previousAccuracy: 95 }),
    { accepted: true, reason: "accepted" },
  );
  assert.deepEqual(
    evaluateTimedGpsReading({ ...base, previousAccuracy: 6 }),
    { accepted: false, reason: "implausible" },
  );
});

test("GPS signal stall detector distinguishes initial acquire timeout from live signal loss", () => {
  assert.deepEqual(evaluateGpsSignalStall({
    journeyActive: false,
    mode: "gps",
    now: 30_000,
    sessionStartedAt: 10_000,
    lastValidFixAt: null,
  }), { stalled: false, reason: "ok", silentDurationMs: 0 });

  assert.deepEqual(evaluateGpsSignalStall({
    journeyActive: true,
    mode: "simulation",
    now: 30_000,
    sessionStartedAt: 10_000,
    lastValidFixAt: null,
  }), { stalled: false, reason: "ok", silentDurationMs: 0 });

  assert.deepEqual(evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now: 18_000,
    sessionStartedAt: 10_000,
    lastValidFixAt: null,
  }), { stalled: false, reason: "ok", silentDurationMs: 8_000 });

  assert.deepEqual(evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now: 22_500,
    sessionStartedAt: 10_000,
    lastValidFixAt: null,
  }), { stalled: true, reason: "acquire-timeout", silentDurationMs: 12_500 });

  assert.deepEqual(evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now: 46_000,
    sessionStartedAt: 10_000,
    lastValidFixAt: 30_000,
  }), { stalled: true, reason: "signal-lost", silentDurationMs: 16_000 });
});

test("privacy-safe navigation diagnostics count lifecycle events without storing coordinates", () => {
  let state = createNavigationDiagnostics();
  state = recordNavigationDiagnosticEvent(state, { type: "fix-accepted" });
  state = recordNavigationDiagnosticEvent(state, { type: "fix-rejected", reason: "stale" });
  state = recordNavigationDiagnosticEvent(state, { type: "fix-rejected", reason: "implausible" });
  state = recordNavigationDiagnosticEvent(state, { type: "signal-loss" });
  state = recordNavigationDiagnosticEvent(state, { type: "foreground-resume" });
  state = recordNavigationDiagnosticEvent(state, { type: "reroute-start" });
  state = recordNavigationDiagnosticEvent(state, { type: "reroute-failure" });
  state = recordNavigationDiagnosticEvent(state, { type: "reroute-start" });
  state = recordNavigationDiagnosticEvent(state, { type: "reroute-success" });

  assert.equal(state.acceptedFixes, 1);
  assert.equal(state.rejectedFixes.stale, 1);
  assert.equal(state.rejectedFixes.implausible, 1);
  assert.equal(state.signalLossCount, 1);
  assert.equal(state.foregroundResumes, 1);
  assert.equal(state.rerouteAttempts, 2);
  assert.equal(state.rerouteSuccesses, 1);
  assert.equal(state.rerouteFailures, 1);
  assert.equal("coordinate" in state, false);
  assert.equal(
    formatNavigationDiagnosticsSummary(state),
    "Fix GPS 1 ok (2 scartati) · Ricalcoli 1/2 · Perdite segnale 1",
  );
});
