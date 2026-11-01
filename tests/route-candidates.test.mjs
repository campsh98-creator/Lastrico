import assert from "node:assert/strict";
import test from "node:test";
import { routesAreEquivalent, deduplicateRoutes, routesShareCorridor } from "../lib/route-candidates.ts";
import { routeFitsExtraMinutes } from "../lib/route-time-budget.ts";

const policy = { equivalentDistanceMeters: 120, equivalentDurationSeconds: 90, equivalentAverageMeters: 32 };
const line = [[9.19, 45.46], [9.21, 45.46]];
const route = (coordinates = line, duration = 600) => ({ coordinates, duration, distance: 1560, instructions: [], provider: "valhalla-fossgis", profile: "auto" });

test("equivalent lines are independent of vertex density and argument order", () => {
  const dense = Array.from({ length: 101 }, (_, i) => [9.19 + i * 0.0002, 45.46]);
  assert.equal(routesAreEquivalent(route(), route(dense), policy), true);
  assert.equal(routesAreEquivalent(route(dense), route(), policy), true);
});

test("equivalence is symmetric and preserves distinct parallel alternatives", () => {
  const parallel = line.map(([x, y]) => [x, y + 0.001]);
  assert.equal(routesAreEquivalent(route(), route(parallel), policy), false);
  assert.equal(routesAreEquivalent(route(parallel), route(), policy), false);
  const detour = [line[0], [9.2, 45.462], line[1]];
  assert.equal(routesAreEquivalent(route(), route(detour), policy), false);
});

test("deduplication retains fastest duplicate regardless of provider order and budget remains hard", () => {
  const candidates = [
    { route: route(line, 660), source: "slow-first" },
    { route: route(line, 600), source: "fast-second" },
    { route: route(line.map(([x, y]) => [x, y + 0.001]), 750), source: "lower-exposure" },
  ];
  const unique = deduplicateRoutes(candidates, policy);
  assert.deepEqual(unique.map((c) => c.source), ["fast-second", "lower-exposure"]);
  assert.equal(routeFitsExtraMinutes(unique[1].route.duration, unique[0].route.duration, 2), false);
  assert.equal(candidates[0].source, "slow-first", "caller array must not be mutated");
});

test("reversed route geometry is not equivalent to the requested journey", () => {
  assert.equal(routesAreEquivalent(route(line), route([...line].reverse()), policy), false);
  assert.equal(deduplicateRoutes([{ route: route(line) }, { route: route([...line].reverse(), 590) }], policy).length, 2);
});

const metersPerLon = 111_320 * Math.cos(45.465 * Math.PI / 180);
const at = (x, y) => [9.18 + x / metersPerLon, 45.465 + y / 110_540];

/** A straight route, and the same route with one stretch moved onto a parallel street. */
function withParallelDetour(routeMeters, detourMeters, offsetMeters) {
  const straight = [];
  for (let x = 0; x <= routeMeters; x += 20) straight.push(at(x, 0));
  const from = (routeMeters - detourMeters) / 2;
  const to = from + detourMeters;
  const detoured = [];
  for (let x = 0; x <= from; x += 20) detoured.push(at(x, 0));
  for (let x = from; x <= to; x += 20) detoured.push(at(x, offsetMeters));
  for (let x = to; x <= routeMeters; x += 20) detoured.push(at(x, 0));
  return [route(straight), route(detoured)];
}

test("a detour onto a parallel street stays distinct inside a long shared route", () => {
  for (const [routeMeters, detourMeters, offsetMeters] of [
    [3_000, 300, 70],
    [3_000, 600, 70],
    [3_000, 1_200, 70],
    [1_500, 300, 70],
    [6_000, 800, 100],
  ]) {
    const [straight, detoured] = withParallelDetour(routeMeters, detourMeters, offsetMeters);
    assert.equal(routesShareCorridor(straight, detoured, 32), false, `${routeMeters}/${detourMeters}/${offsetMeters}`);
    assert.equal(routesShareCorridor(detoured, straight, 32), false, `${routeMeters}/${detourMeters}/${offsetMeters}`);
  }
});

test("lateral noise within tolerance and detours under the threshold remain equivalent", () => {
  const straight = [];
  const noisy = [];
  for (let x = 0; x <= 3_000; x += 20) {
    straight.push(at(x, 0));
    noisy.push(at(x, x % 40 === 0 ? 12 : -12));
  }
  assert.equal(routesShareCorridor(route(straight), route(noisy), 32), true);
  const [base, tiny] = withParallelDetour(3_000, 40, 40);
  assert.equal(routesShareCorridor(base, tiny, 32), true);
});
