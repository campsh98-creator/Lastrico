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
  const secondPassAfterCrossing = calculateRouteProgress(
    model,
    [9.189, 45.462],
    10,
    secondPassBeforeCrossing.routeProgressMeters,
  );
  assert.ok(secondPassAfterCrossing.routeProgressMeters > secondPassBeforeCrossing.routeProgressMeters);
  assert.equal(secondPassAfterCrossing.instruction.id, "arrive");
});
