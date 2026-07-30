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

