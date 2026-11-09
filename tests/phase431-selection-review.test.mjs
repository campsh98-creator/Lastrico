import assert from "node:assert/strict";
import test from "node:test";
import { fastestLegalCandidate, selectOptimizedRoute, CONFIRMED_PAVE_SWAP_MAX_METERS } from "../lib/route-optimization.ts";
import { routesShareCorridor } from "../lib/route-candidates.ts";

/**
 * Phase 4.31 routing decision review. Probable stone (paving_stones) weighs 0.65 of confirmed
 * stone, as in the Milan scorer; `riskMeters` is the weighted discomfort the selection compares.
 */
const policy = { minimumPaveReduction: 20, balancedPaveDivisor: 500,
  limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } } };
const candidate = (id, duration, confirmed, probable, unknown = 0) => ({
  id, paveMeters: confirmed + probable, riskMeters: Math.round(confirmed + probable * 0.65),
  surfaceScore: { confirmedMeters: confirmed, probableMeters: probable, paveMeters: confirmed + probable, unknownMeters: unknown,
    totalMeters: 5000, smoothMeters: 5000 - confirmed - probable - unknown, confirmedRestrictionMeters: 0 },
  route: { duration, distance: 5000, coordinates: [[9.19, 45.46], [9.19 + id / 1000, 45.462], [9.20, 45.46]], instructions: [], provider: "valhalla-fossgis", profile: "auto" },
});
const select = (routes, avoidance = "strong") => selectOptimizedRoute(routes, fastestLegalCandidate(routes, "car"), "car", avoidance, null, policy,
  (a, b) => routesShareCorridor(a, b, 32));

test("Moscova → Crocetta: +24 m confirmed stone for −388 m probable is now offered (−19% discomfort)", () => {
  // Measured on the Milan benchmark (car, Monday 12:00): fastest 940 m confirmed + 388 m probable.
  const fast = candidate(1, 936, 940, 388);
  const smoother = candidate(2, 1035, 964, 0);
  const { safe, verdicts } = select([fast, smoother]);
  assert.equal(safe, smoother);
  assert.equal(verdicts.get(smoother), "selected");
  assert.ok(smoother.riskMeters < fast.riskMeters * 0.85);
});

test("large confirmed-for-probable swaps stay excluded (the Phase 4.25 guard)", () => {
  const fast = candidate(1, 600, 300, 500);
  // +100 m confirmed for −500 m probable: 10% of the removal would be 50 m, the cap is 50 m.
  const largeSwap = candidate(5, 640, 400, 0);
  assert.equal(select([fast, largeSwap]).safe, fast);
  assert.equal(select([fast, largeSwap]).verdicts.get(largeSwap), "adds-confirmed-pave");
  // +45 m confirmed for −300 m probable: more than 10% of the removal.
  const disproportionate = candidate(6, 640, 345, 200);
  assert.equal(select([fast, disproportionate]).safe, fast);
  // Even with a huge probable removal the increase is capped.
  const capped = candidate(7, 640, 300 + CONFIRMED_PAVE_SWAP_MAX_METERS + 1, 0);
  assert.equal(select([candidate(1, 600, 300, 2000), capped]).verdicts.get(capped), "adds-confirmed-pave");
});

test("the time rule of the Forte level is unchanged: Massimo offers what Forte rejects for time", () => {
  // Cadorna → Cinque Giornate (car): −258 m probable for +265 s.
  const fast = candidate(1, 840, 2, 320);
  const slow = candidate(3, 1105, 0, 62);
  assert.equal(select([fast, slow]).verdicts.get(slow), "time-cost-exceeds-saving");
  assert.equal(select([fast, slow], "maximum").safe, slow);
});

test("every candidate gets the rule that decided it", () => {
  const fast = candidate(1, 600, 300, 0);
  const tooSlow = candidate(2, 600 * 1.42 + 421, 0, 0);
  const unknownDetour = candidate(3, 650, 0, 0, 900);
  const { verdicts } = select([fast, tooSlow, unknownDetour]);
  assert.equal(verdicts.get(fast), "fastest");
  assert.equal(verdicts.get(tooSlow), "over-avoidance-time-limit");
  assert.notEqual(verdicts.get(unknownDetour), "selected", "pavé swapped for 900 m of unknown surface is not offered");
});
