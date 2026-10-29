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

test("detour with confirmed smooth asphalt is not penalized for length-induced unknown meters", () => {
  const fast = { ...candidate(1, 560, 1200, 100), paveMeters: 1500, surfaceScore: { paveMeters: 1500, smoothMeters: 900, unknownMeters: 100, totalMeters: 2500, confirmedRestrictionMeters: 0 } };
  const detour = { ...candidate(4, 680, 900, 500), paveMeters: 1100, surfaceScore: { paveMeters: 1100, smoothMeters: 1500, unknownMeters: 500, totalMeters: 3100, confirmedRestrictionMeters: 0 } };
  assert.equal(select([fast, detour]).safe, detour);
});

test("safeguard rejects false-safe detour when unmapped distance exceeds 1.25x pave saved", () => {
  // fast has 400m stone, 100m unknown, 900m smooth
  const fast = { ...candidate(1, 560, 400, 100), paveMeters: 400, surfaceScore: { paveMeters: 400, smoothMeters: 900, unknownMeters: 100, totalMeters: 1400, confirmedRestrictionMeters: 0 } };
  // detour saves 100m stone (pave = 300m, smooth = 1000m), but adds 800m unknown through residential streets (unknown = 900m)
  // capped at 1.25 * 100 = 125m at 0.35x, with remaining 675m at 1.0x -> penalty = 718.75m > 100m saved!
  const falseSafeDetour = { ...candidate(4, 620, 300, 900), paveMeters: 300, surfaceScore: { paveMeters: 300, smoothMeters: 1000, unknownMeters: 900, totalMeters: 2200, confirmedRestrictionMeters: 0 } };
  assert.equal(select([fast, falseSafeDetour]).safe, fast);
});

test("safeguard prevents tiny pave savings (<= 5m) from justifying any substantial unmapped detour", () => {
  // fast has 500m stone, 100m unknown, 1000m smooth
  const fast = { ...candidate(1, 500, 500, 100), paveMeters: 500, surfaceScore: { paveMeters: 500, smoothMeters: 1000, unknownMeters: 100, totalMeters: 1600, confirmedRestrictionMeters: 0 } };
  // candidate saves 5m stone, gains 100m smooth, but adds 150m unknown
  // paveSaved = 5m -> cap = 6.25m at 0.35x, remaining 143.75m at 1.0x -> penalty = 145.9m >> 5m saved
  const tinySaving = { ...candidate(4, 520, 495, 250), paveMeters: 495, surfaceScore: { paveMeters: 495, smoothMeters: 1100, unknownMeters: 250, totalMeters: 1845, confirmedRestrictionMeters: 0 } };
  assert.equal(select([fast, tinySaving]).safe, fast);

  // candidate saves 1m stone, gains 50m smooth, but adds 30m unknown
  // paveSaved = 1m -> cap = 1.25m at 0.35x, remaining 28.75m at 1.0x -> penalty = 29.19m >> 1m saved
  const marginalSaving = { ...candidate(5, 510, 499, 130), paveMeters: 499, surfaceScore: { paveMeters: 499, smoothMeters: 1050, unknownMeters: 130, totalMeters: 1680, confirmedRestrictionMeters: 0 } };
  assert.equal(select([fast, marginalSaving]).safe, fast);
});

test("safeguard rejects massive unmapped excursions (> 1000m) even with 100% stone elimination and large smooth gain", () => {
  // fast has 400m stone, 100m unknown, 800m smooth
  const fast = { ...candidate(1, 500, 400, 100), paveMeters: 400, surfaceScore: { paveMeters: 400, smoothMeters: 800, unknownMeters: 100, totalMeters: 1300, confirmedRestrictionMeters: 0 } };
  // detour eliminates all 400m stone, adds 1000m confirmed smooth, but takes a huge 2500m unmapped detour (deltaUnk = 2400m)
  // paveSaved = 400m -> cap = 500m at 0.35x (175m), excess 1900m at 1.0x -> total burden = 2075m >> 400m
  const massiveDetour = { ...candidate(4, 620, 0, 2500), paveMeters: 0, surfaceScore: { paveMeters: 0, smoothMeters: 1800, unknownMeters: 2500, totalMeters: 4300, confirmedRestrictionMeters: 0 } };
  assert.equal(select([fast, massiveDetour]).safe, fast);
});

test("directional restrictions, access limits, and invalid numbers cannot pass through surface optimization", () => {
  const fast = candidate(1, 500, 600, 50, "auto");
  // Candidate with 0 rough meters and 0 unknown meters, but 5m of confirmed restriction violation
  const contraflow = { ...candidate(4, 510, 0, 0, "auto"), surfaceScore: { ...candidate(4, 510, 0, 0, "auto").surfaceScore, confirmedRestrictionMeters: 5 } };
  // Candidate with NaN or negative duration
  const nanDuration = { ...candidate(6, NaN, 0, 0, "auto") };
  const negativeDuration = { ...candidate(7, -10, 0, 0, "auto") };
  // Candidate with mismatched profile (e.g. bicycle instead of auto for car)
  const wrongProfile = candidate(8, 450, 0, 0, "bicycle");

  const candidates = [contraflow, nanDuration, negativeDuration, wrongProfile, fast];
  assert.equal(fastestLegalCandidate(candidates, "car"), fast);
  assert.equal(select(candidates, 5, "strong", "car").safe, fast);
});

test("route overlap and corridor duplicate alternatives preserve Pareto diversity without ghost alternatives", () => {
  const fast = candidate(1, 500, 800, 50);
  // Real alternative detour A (distinct corridor)
  const detourA = candidate(4, 550, 200, 80);
  // Near-duplicate of detour A that shares the corridor (>90% overlap) but takes slightly longer (+10s)
  const detourADup = { ...candidate(5, 560, 200, 80), route: { ...detourA.route, duration: 560 } };
  // Real alternative detour B (different corridor, lower risk, longer duration)
  const detourB = candidate(7, 600, 50, 100);

  // Under balanced avoidance, detourA is preferred over fast and over detourB (which takes too long)
  const resultBalanced = select([fast, detourA, detourADup, detourB], 5, "balanced");
  assert.equal(resultBalanced.safe, detourA);

  // Under strong avoidance, detourB with much lower rough exposure is preferred
  const resultStrong = select([fast, detourA, detourADup, detourB], 5, "strong");
  assert.equal(resultStrong.safe, detourB);

  // Result must be invariant under reverse or shuffled order
  const shuffled = select([detourADup, detourB, fast, detourA], 5, "balanced");
  assert.equal(shuffled.safe, detourA);
});

test("mathematical continuity and monotonicity of the 1.25x cap across the threshold", () => {
  // fast has 200m stone, 0m unknown, 1000m smooth, duration 500
  const fast = { ...candidate(1, 500, 200, 0), paveMeters: 200, surfaceScore: { paveMeters: 200, smoothMeters: 1000, unknownMeters: 0, totalMeters: 1200, confirmedRestrictionMeters: 0 } };

  // Helper to test burden of candidate saving 100m stone with variable unknown meters (using distinct corridor id=4)
  const candidateWithUnknown = (unkMeters) => ({
    ...candidate(4, 510, 100, unkMeters),
    paveMeters: 100,
    surfaceScore: { paveMeters: 100, smoothMeters: 1100, unknownMeters: unkMeters, totalMeters: 1200 + unkMeters, confirmedRestrictionMeters: 0 },
  });

  // At deltaUnk = 125m (exactly at cap: 100 * 1.25):
  // burden = 100 + 125 * 0.35 = 143.75m. Net savings vs fast (200m) = 56.25m.
  // 143.75 + minReduction (20) = 163.75 <= 200 -> selected!
  assert.equal(select([fast, candidateWithUnknown(125)]).safe.id, 4);

  // At deltaUnk = 126m (1m past cap):
  // burden = 100 + 125 * 0.35 + 1 * 1.0 = 144.75m. Net savings = 55.25m -> still selected.
  assert.equal(select([fast, candidateWithUnknown(126)]).safe.id, 4);

  // Breakeven calculation:
  // We need burden + minReduction (20) <= 200, so burden <= 180.
  // In strong avoidance: secondsWeight = 500 / 600 = 0.8333333.
  // Duration penalty = (510 - 500) * 0.83333 = 8.333m.
  // Total utility condition: utility(cand) < utility(fast) and burden + 20 <= 200.
  // utility(fast) = 200.
  // utility(cand) = burden + 8.3333 < 200 => burden < 191.666m.
  // But condition in selectOptimizedRoute requires both:
  // 1) burden(cand) + 20 <= 200 => burden(cand) <= 180m.
  // 2) utility(cand) < utility(fast) => burden(cand) + 8.333 < 200 => burden(cand) < 191.67m.
  // The tighter bound is burden <= 180m!
  // burden = 100 + 125 * 0.35 + (deltaUnk - 125) * 1.0 = 143.75 + deltaUnk - 125 = deltaUnk + 18.75.
  // deltaUnk + 18.75 <= 180 => deltaUnk <= 161.25m.
  // At deltaUnk = 161m: burden = 179.75 <= 180 -> selected!
  assert.equal(select([fast, candidateWithUnknown(161)]).safe.id, 4);

  // At deltaUnk = 162m: burden = 180.75 > 180 -> burden + 20 = 200.75 > 200 -> rejected, fast wins!
  assert.equal(select([fast, candidateWithUnknown(162)]).safe, fast);
});
