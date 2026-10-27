import assert from "node:assert/strict";
import test from "node:test";
import { fastestLegalCandidate, paretoFrontier, selectOptimizedRoute } from "../lib/route-optimization.ts";
import { routesShareCorridor } from "../lib/route-candidates.ts";

const policy = { minimumPaveReduction: 20, balancedPaveDivisor: 500,
  limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } } };
const candidate = (id, duration, riskMeters, unknownMeters = 0, mode = "auto") => ({
  id, riskMeters, surfaceScore: { unknownMeters, totalMeters: 2000, confirmedRestrictionMeters: 0 },
  route: { duration, distance: 2000, coordinates: [[9.19, 45.46], [9.19 + id / 1000, 45.462], [9.20, 45.46]],
    instructions: [], provider: "valhalla-fossgis", profile: mode },
});
const equivalent = (a, b) => routesShareCorridor(a, b, 32);
const select = (routes, budget = 5, avoidance = "strong", mode = "car") => {
  const fast = fastestLegalCandidate(routes, mode);
  return selectOptimizedRoute(routes, fast, mode, avoidance, budget, policy, equivalent);
};

test("Pareto front removes dominated time/rough/unknown candidates without collapsing tradeoffs", () => {
  const fast = candidate(1, 600, 800, 200);
  const worse = candidate(2, 610, 810, 210);
  const smoother = candidate(4, 630, 300, 250);
  const known = candidate(6, 650, 400, 100);
  assert.deepEqual(paretoFrontier([worse, known, smoother, fast]).map((c) => c.id), [1, 4, 6]);
  assert.equal(select([fast, worse, smoother, known]).safe, smoother);
});

test("unknown-only detour cannot masquerade as eliminating rough exposure", () => {
  const fast = candidate(1, 600, 1000, 100);
  const blind = candidate(6, 650, 0, 1600);
  assert.equal(select([fast, blind]).safe, fast);
  const measured = candidate(4, 650, 300, 200);
  assert.equal(select([fast, blind, measured]).safe, measured);
});

test("hard extra-time boundary is evaluated against fastest valid duplicate", () => {
  const fast = candidate(1, 600, 1000);
  const slowDuplicate = { ...fast, route: { ...fast.route, duration: 660 } };
  const alternative = candidate(6, 750, 100);
  assert.equal(select([slowDuplicate, fast, alternative], 2).safe, fast);
  assert.equal(select([slowDuplicate, fast, alternative], 2.5).safe, alternative);
  assert.equal(select([fast, alternative], 0).safe, fast);
});

test("a physically identical corridor is not an alternative even with different provider metrics", () => {
  const fast = candidate(1, 600, 800);
  const duplicate = { ...candidate(6, 720, 0), route: { ...fast.route, duration: 720, distance: 4000 } };
  assert.equal(equivalent(fast.route, duplicate.route), true);
  assert.equal(select([fast, duplicate]).safe, fast);
  // A corridor-equivalent duplicate of fast must not Pareto-shadow a genuinely distinct alternative.
  const distinct = candidate(4, 730, 100);
  assert.equal(select([fast, duplicate, distinct]).safe, distinct);
});

test("candidate with lower weighted risk but higher raw paveMeters cannot become safe", () => {
  const fast = { ...candidate(1, 600, 180), paveMeters: 180 };
  const moreRawStone = { ...candidate(6, 620, 130), paveMeters: 200 };
  assert.equal(select([fast, moreRawStone]).safe, fast);
});

test("mode mismatch and confirmed access violations cannot become the fast or safe route", () => {
  for (const [mode, profile] of [["car", "auto"], ["motorcycle", "motorcycle"], ["bicycle", "bicycle"]]) {
    const fast = candidate(1, 600, 1000, 100, profile);
    const wrongMode = candidate(6, 100, 0, 0, "driving");
    const blocked = candidate(6, 500, 0, 0, profile);
    blocked.surfaceScore.confirmedRestrictionMeters = 1;
    assert.equal(fastestLegalCandidate([blocked, wrongMode, fast], mode), fast);
    assert.equal(select([blocked, wrongMode, fast], 5, "strong", mode).safe, fast);
  }
  const fallback = candidate(1, 500, 0, 0, "driving");
  fallback.route.provider = "osrm-public-fallback";
  assert.equal(fastestLegalCandidate([fallback], "car"), fallback);
  assert.equal(fastestLegalCandidate([fallback], "bicycle"), undefined);
});

test("selection is deterministic under input permutations and respects avoidance tradeoff", () => {
  const fast = candidate(1, 600, 1000);
  const short = candidate(4, 620, 650);
  const smooth = candidate(7, 760, 100);
  const original = [fast, short, smooth];
  for (const routes of [original, [...original].reverse(), [short, fast, smooth]]) {
    assert.equal(select(routes, 5, "balanced").safe, short);
    assert.equal(select(routes, 5, "maximum").safe, smooth);
  }
  assert.deepEqual(original.map((c) => c.id), [1, 4, 7]);
});

test("no candidate or negligible gain returns the actual fastest baseline", () => {
  const fast = candidate(1, 600, 100);
  assert.equal(select([fast]).safe, fast);
  assert.equal(select([fast, candidate(6, 610, 90)]).safe, fast);
});
