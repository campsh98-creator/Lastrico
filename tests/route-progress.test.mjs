import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouteProgressModel,
  calculateRouteProgress,
} from "../lib/route-progress.ts";

const meters = (a, b) => Math.hypot(
  (a[0] - b[0]) * 78_000,
  (a[1] - b[1]) * 111_000,
);

test("progress advances continuously inside a long segment", () => {
  const coordinates = [[9.19, 45.46], [9.192, 45.46]];
  const model = buildRouteProgressModel(coordinates, [], meters);
  const quarter = calculateRouteProgress(model, [9.1905, 45.46], 10);
  const half = calculateRouteProgress(model, [9.191, 45.46], 10);
  assert.ok(quarter.routeProgressMeters > 30);
  assert.ok(quarter.routeProgressMeters < 50);
  assert.ok(half.routeProgressMeters > quarter.routeProgressMeters);
  assert.ok(half.remainingMeters < quarter.remainingMeters);
});

test("instruction distance uses precomputed progress and never becomes negative", () => {
  const coordinates = [[9.19, 45.46], [9.191, 45.46], [9.192, 45.46]];
  const instructions = [
    { id: "depart", type: "depart", location: coordinates[0] },
    { id: "turn", type: "turn", location: coordinates[1] },
    { id: "arrive", type: "arrive", location: coordinates[2] },
  ];
  const model = buildRouteProgressModel(coordinates, instructions, meters);
  const beforeTurn = calculateRouteProgress(model, [9.1908, 45.46], 5);
  const afterTurn = calculateRouteProgress(model, [9.1912, 45.46], 5);
  assert.equal(beforeTurn.instruction.id, "turn");
  assert.equal(afterTurn.instruction.id, "arrive");
  assert.ok(afterTurn.remainingMinutes >= 0);
  assert.ok(afterTurn.instructionDistance >= 0);
});

test("progress does not jump backwards at a self-intersection", () => {
  const coordinates = [
    [9.18, 45.46],
    [9.19, 45.47],
    [9.20, 45.46],
    [9.19, 45.47],
    [9.18, 45.48],
  ];
  const model = buildRouteProgressModel(coordinates, [], meters);
  const advanced = calculateRouteProgress(model, [9.195, 45.465], 10);
  let anchoredProgress = advanced.routeProgressMeters;
  for (let reading = 0; reading < 20; reading += 1) {
    const crossing = calculateRouteProgress(model, [9.19, 45.47], 10, anchoredProgress);
    assert.equal(crossing.routeProgressMeters, anchoredProgress);
    anchoredProgress = crossing.routeProgressMeters;
  }
  assert.equal(anchoredProgress, advanced.routeProgressMeters);
});

test("a replacement route starts with a fresh progress anchor", () => {
  const replacementCoordinates = [[9.19, 45.46], [9.191, 45.46]];
  const replacementModel = buildRouteProgressModel(replacementCoordinates, [], meters);
  const resetAnchor = 0;
  const firstFix = calculateRouteProgress(replacementModel, replacementCoordinates[0], 4, resetAnchor);
  assert.equal(firstFix.routeProgressMeters, 0);
  assert.equal(firstFix.remainingMeters, replacementModel.totalMeters);
});

test("looping route preserves monotonic instruction progress and does not jump ahead or freeze on second pass", () => {
  const loopCoordinates = [
    [9.19, 45.46],
    [9.19, 45.462], // crossing point (first pass ~222m)
    [9.192, 45.462],
    [9.192, 45.464],
    [9.19, 45.464],
    [9.19, 45.462], // crossing point (second pass ~834m)
    [9.188, 45.462],
  ];
  const instructions = [
    { id: "depart", type: "depart", location: [9.19, 45.46] },
    { id: "turn-1", type: "turn", location: [9.19, 45.462] },
    { id: "turn-2", type: "turn", location: [9.192, 45.462] },
    { id: "turn-3", type: "turn", location: [9.19, 45.462] },
    { id: "arrive", type: "arrive", location: [9.188, 45.462] },
  ];
  const model = buildRouteProgressModel(loopCoordinates, instructions, meters);

  for (let idx = 1; idx < model.instructions.length; idx += 1) {
    assert.ok(
      model.instructions[idx].progressMeters >= model.instructions[idx - 1].progressMeters,
      `Instruction ${model.instructions[idx].id} should be monotonic`,
    );
  }

  // On the first pass approaching [9.19, 45.462], a slight westward GPS jitter [9.1899, 45.462]
  // is geometrically on the final westward leg (~840m), but must stay on the first pass (~222m).
  const firstPassApproach = calculateRouteProgress(model, [9.19, 45.4615], 10, 150);
  const jitterNearCrossing = calculateRouteProgress(
    model,
    [9.1899, 45.462],
    10,
    firstPassApproach.routeProgressMeters,
  );
  assert.ok(jitterNearCrossing.routeProgressMeters < 300);

  // On the second pass approaching from [9.19, 45.464] -> [9.19, 45.462] -> [9.188, 45.462],
  // progress must advance smoothly along the final leg instead of snapping back to the first pass.
  const secondPassBeforeCrossing = calculateRouteProgress(model, [9.19, 45.4625], 10, 750);
  // These fixes are 133 m apart, so state the elapsed time that makes that distance plausible.
  const secondPassAfterCrossing = calculateRouteProgress(
    model,
    [9.189, 45.462],
    10,
    secondPassBeforeCrossing.routeProgressMeters,
    { elapsedSeconds: 8 },
  );
  assert.ok(secondPassAfterCrossing.routeProgressMeters > secondPassBeforeCrossing.routeProgressMeters);
  assert.equal(secondPassAfterCrossing.instruction.id, "arrive");
});

test("Phase 4.9: rejects implausible forward jumps to parallel or future route segments", () => {
  const coordinates = [
    [9.1800, 45.4600],
    [9.1800, 45.4650], // Leg 1: ~555m north
    [9.1900, 45.4650], // Leg 2: ~780m east
    [9.1900, 45.4600], // Leg 3: ~555m south
    [9.1804, 45.4600], // Leg 4: ~750m west
    [9.1804, 45.4650], // Leg 5: ~555m north (runs parallel to Leg 1, only ~31m away, at cumulative progress ~2640-3195m)
  ];
  const model = buildRouteProgressModel(coordinates, [], meters);

  // Vehicle is at meter 111 on Leg 1
  const anchor = 111;

  // A noisy GPS fix with 25m accuracy: slightly closer to parallel Leg 5 (3.9m away) than Leg 1 (35m away)
  const noisyGps = [9.18045, 45.4610];

  const result = calculateRouteProgress(model, noisyGps, 10, anchor, {
    accuracy: 25,
    elapsedSeconds: 1.0,
    maxSpeedMps: 20,
  });

  // Must NOT jump to Leg 5 (~2700m)! Must stay anchored locally near meter 111
  assert.ok(
    result.routeProgressMeters < 250,
    `Progress must stay within local plausible reach, got ${result.routeProgressMeters}`,
  );
  assert.ok(
    result.routeProgressMeters >= anchor,
    `Progress must maintain monotonicity (>= ${anchor})`,
  );
  // Off-route distance should accurately reflect distance from current leg (~35m), not false 3.9m from parallel leg
  assert.ok(
    result.offRouteMeters >= 30,
    `Off-route meters should report real distance from local leg, got ${result.offRouteMeters}`,
  );
});
