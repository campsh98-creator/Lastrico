import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MODE_SETTINGS, TRANSPORT_MODES, legalityIssue } from "../ranker.mjs";
import { PRODUCTION_MODE_POLICY, productionIsLegal, productionSelect } from "../lib/production-baseline.mjs";
import { equivalenceById } from "../lib/scenario-adapter.mjs";
import { ROOT, candidate, loadScenarios } from "./helpers.mjs";

function productionModePolicyFromSource() {
  const source = readFileSync(new URL("app/api/routes/route.ts", ROOT), "utf8");
  const start = source.indexOf("const MODE_POLICY");
  assert.ok(start > 0, "MODE_POLICY not found in route.ts");
  const open = source.indexOf("{", source.indexOf("=", start));
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}") depth -= 1;
    if (depth === 0) break;
  }
  const literal = source.slice(open, end + 1);
  assert.match(literal, /^[\s\w{}:,._\d-]+$/, "MODE_POLICY literal must contain only keys and numbers");
  return Function(`"use strict"; return (${literal});`)();
}

test("mirrored MODE_POLICY equals the production source exactly", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PRODUCTION_MODE_POLICY)), productionModePolicyFromSource());
});

test("ranker mode settings are derived from the production policy", () => {
  for (const mode of TRANSPORT_MODES) {
    const policy = PRODUCTION_MODE_POLICY[mode];
    const settings = MODE_SETTINGS[mode];
    assert.equal(settings.paveMetersPerMinute, policy.balancedPaveDivisor);
    assert.equal(settings.minKnownPaveReductionM, policy.minimumPaveReduction);
    assert.deepEqual(JSON.parse(JSON.stringify(settings.detourLimits)), policy.limits);
  }
});

test("ranker legality equals production isLegalCandidate on every corpus candidate and edge case", () => {
  let checked = 0;
  for (const scenario of loadScenarios()) {
    for (const c of scenario.candidates) {
      for (const mode of TRANSPORT_MODES) {
        assert.equal(legalityIssue(c, mode) === null, productionIsLegal(c, mode), `${scenario.id} ${c.id} ${mode}`);
        checked += 1;
      }
    }
  }
  const edge = [
    { ...candidate("osrm"), provider: "osrm-public-fallback", profile: "driving" },
    { ...candidate("blocked"), blockingRestrictionM: 1 },
    { ...candidate("confirmed-only"), confirmedRestrictionM: 2 },
    { ...candidate("terminal"), confirmedRestrictionM: 3, blockingRestrictionM: 0 },
    { ...candidate("nan"), durationS: Number.NaN },
    { ...candidate("neg"), durationS: -1 },
    { ...candidate("bike"), profile: "bicycle" },
  ];
  for (const c of edge) {
    for (const mode of TRANSPORT_MODES) {
      const withRisk = { ...c, riskM: c.confirmedPaveM + 0.65 * c.probablePaveM };
      assert.equal(legalityIssue(withRisk, mode) === null, productionIsLegal(withRisk, mode), `${c.id} ${mode}`);
    }
  }
  assert.ok(checked > 300);
});

test("adapter reproduces production unit-test vectors", () => {
  const make = (id, durationS, riskM, unknownM) => ({
    ...candidate(id, { durationS, distanceM: 2000, confirmedPaveM: riskM, probablePaveM: 0, unknownM, smoothM: 0 }),
    riskM, totalM: 2000,
  });
  const never = (a, b) => a === b;
  // tests/route-optimization.test.mjs: "Pareto front removes dominated ..." -> smoother wins (strong, 5 min).
  const pool = [make("fast", 600, 800, 200), make("worse", 610, 810, 210), make("smoother", 630, 300, 250), make("known", 650, 400, 100)];
  const result = productionSelect(pool, { mode: "car", avoidance: "strong", maxExtraMinutes: 5, equivalentById: never });
  assert.equal(result.safeId, "smoother");
  assert.deepEqual(result.frontierIds, ["fast", "smoother", "known"]);
  // "unknown-only detour cannot masquerade": blind loses, measured wins.
  const blind = [make("fast", 600, 1000, 100), make("blind", 650, 0, 1600)];
  assert.equal(productionSelect(blind, { mode: "car", avoidance: "strong", maxExtraMinutes: 5, equivalentById: never }).safeId, "fast");
  blind.push(make("measured", 650, 300, 200));
  assert.equal(productionSelect(blind, { mode: "car", avoidance: "strong", maxExtraMinutes: 5, equivalentById: never }).safeId, "measured");
  // Respect avoidance trade-off: balanced -> short, maximum -> smooth.
  const trade = [make("fast", 600, 1000, 0), make("short", 620, 650, 0), make("smooth", 760, 100, 0)];
  assert.equal(productionSelect(trade, { mode: "car", avoidance: "balanced", maxExtraMinutes: 5, equivalentById: never }).safeId, "short");
  assert.equal(productionSelect(trade, { mode: "car", avoidance: "maximum", maxExtraMinutes: 5, equivalentById: never }).safeId, "smooth");
});

test("replaying current production on live responses reproduces the recorded choice", (t) => {
  const live = loadScenarios().filter((s) => s.set === "R" && s.codeEra === "dist-2026-11-05");
  if (live.length === 0) {
    t.skip("no live capture in this corpus");
    return;
  }
  for (const scenario of live) {
    const result = productionSelect(scenario.candidates, {
      mode: scenario.mode, avoidance: scenario.requested.avoidance, maxExtraMinutes: scenario.requested.maxExtraMinutes,
      equivalentById: equivalenceById(scenario),
    });
    assert.equal(result.fastId, scenario.recorded.fastId, `${scenario.id} fast`);
    assert.equal(result.safeId, scenario.recorded.choiceId, `${scenario.id} choice`);
  }
});
