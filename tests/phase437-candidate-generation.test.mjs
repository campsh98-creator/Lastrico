import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import {
  extractRoughSlices,
  penalisedSliceMinimumMeters,
  PENALISED_SLICE_MINIMUM_METERS,
  pointDistanceMeters,
  stopsOnlyWhenClean,
} from "../lib/surface-aware-routing.ts";
import { selectOptimizedRoute, U_TURN_PENALTY_SECONDS, uTurnCount } from "../lib/route-optimization.ts";

/**
 * Phase 4.37 — anti-pavé candidate generation (package P0). Phase 4.36 found that the Piazzale Lodi stone
 * slice measures 24.99 m, so a 25 m minimum kept the penalised search from ever running, and that a cheap
 * improvement ended the planner's search with stone left. These tests pin the new thresholds, the U-turn
 * penalty, and the unchanged behaviour of every other area.
 */

test("Milan targets stone slices down to the mode's minimum reduction, capped at 15 m; other areas keep 25 m", () => {
  assert.equal(penalisedSliceMinimumMeters("milan", 20), 15, "car");
  assert.equal(penalisedSliceMinimumMeters("milan", 15), 15, "motorcycle");
  assert.equal(penalisedSliceMinimumMeters("milan", 12), 12, "bicycle");
  for (const area of ["roccella", "rome", "unknown-area"]) {
    for (const reduction of [12, 15, 20]) assert.equal(penalisedSliceMinimumMeters(area, reduction), PENALISED_SLICE_MINIMUM_METERS);
  }
  assert.equal(PENALISED_SLICE_MINIMUM_METERS, 25);
});

test("the stricter early stop is Milan planner only: navigation reroutes and other areas keep their gate", () => {
  assert.equal(stopsOnlyWhenClean("milan", false), true);
  assert.equal(stopsOnlyWhenClean("milan", true), false, "a reroute stays fast");
  assert.equal(stopsOnlyWhenClean("roccella", false), false);
  assert.equal(stopsOnlyWhenClean("rome", false), false);
});

/** A straight line at Milan's latitude with one stone stretch of exactly `stoneMeters` (vertices at its ends). */
function lineWithStone(stoneMeters) {
  const lat = 45.4477;
  const metersPerDegree = 111_320 * Math.cos((lat * Math.PI) / 180);
  const first = 80;
  const last = first + stoneMeters;
  const points = [0, 40, first, last, last + 40, last + 80].map((meters) => [9.2 + meters / metersPerDegree, lat]);
  const segmentRough = (prev, curr) => {
    const from = (prev[0] - 9.2) * metersPerDegree;
    const to = (curr[0] - 9.2) * metersPerDegree;
    return from >= first - 0.01 && to <= last + 0.01;
  };
  return { points, segmentRough };
}

test("the Piazzale Lodi case: a 24.99 m stone slice is invisible at 25 m and targeted at 15 m", () => {
  // 25 m of stone measured vertex by vertex comes out a hair short, as on the real plan (24.99 m).
  const { points, segmentRough } = lineWithStone(24.99);
  const measured = points.slice(1).reduce((sum, point, i) => sum + (segmentRough(points[i], point) ? pointDistanceMeters(points[i], point) : 0), 0);
  assert.ok(measured > 24 && measured < 25, `stone measures ${measured.toFixed(2)} m`);
  assert.equal(extractRoughSlices(points, segmentRough, 25).length, 0, "before: nothing to target, the search never ran");
  assert.equal(extractRoughSlices(points, segmentRough, penalisedSliceMinimumMeters("milan", 20)).length, 1, "after: the slice is targeted");
  assert.equal(extractRoughSlices(points, segmentRough, penalisedSliceMinimumMeters("rome", 20)).length, 0, "Rome is unchanged");
});

/** A legal Valhalla car candidate, with `uTurns` U-turn maneuvers. */
function candidate({ duration, risk, unknown = 0, uTurns = 0, id = "x" }) {
  return {
    route: {
      distance: duration * 10, duration, provider: "valhalla-fossgis", profile: "auto",
      coordinates: [[9.2, 45.45 + duration / 1e6], [9.21, 45.46 + duration / 1e6]],
      instructions: Array.from({ length: uTurns }, () => ({ direction: "uturn" })),
    },
    riskMeters: risk,
    paveMeters: risk,
    surfaceScore: { paveMeters: risk, confirmedMeters: risk, probableMeters: 0, unknownMeters: unknown, totalMeters: 3000, smoothMeters: 3000 - risk - unknown },
    id,
  };
}
const CAR = {
  minimumPaveReduction: 20,
  balancedPaveDivisor: 500,
  limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } },
};
// Two candidates are the same corridor when their routes start with the same coordinate (a stand-in for the real test).
const equivalent = (a, b) => a.coordinates[0][1] === b.coordinates[0][1];

test("a U-turn costs 60 s in the comparison, never excludes a candidate, and only in Milan's policy", () => {
  const fast = candidate({ duration: 600, risk: 100, id: "fast" });
  const lighter = candidate({ duration: 650, risk: 20, uTurns: 1, id: "lighter" });
  const without = selectOptimizedRoute([fast, lighter], fast, "car", "strong", null, CAR, equivalent);
  assert.equal(without.safe.id, "lighter", "no penalty in policy: the lighter route wins on stone and time");
  const withPenalty = selectOptimizedRoute([fast, lighter], fast, "car", "strong", null, { ...CAR, uTurnPenaltySeconds: U_TURN_PENALTY_SECONDS }, equivalent);
  assert.equal(withPenalty.safe.id, "fast", "with the 60 s penalty the U-turn route no longer pays for its extra time");
  assert.equal(withPenalty.verdicts.get(lighter), "time-cost-exceeds-saving", "still eligible, only less attractive: never rejected");
  // The same route without the U-turn still wins with the penalty on.
  const clean = candidate({ duration: 650, risk: 20, id: "clean" });
  assert.equal(selectOptimizedRoute([fast, clean], fast, "car", "strong", null, { ...CAR, uTurnPenaltySeconds: 60 }, equivalent).safe.id, "clean");
  // A route that already has a U-turn is not made worse by comparing it with a candidate that has one too.
  const fastWithTurn = candidate({ duration: 600, risk: 100, uTurns: 1, id: "fastTurn" });
  assert.equal(selectOptimizedRoute([fastWithTurn, lighter], fastWithTurn, "car", "strong", null, { ...CAR, uTurnPenaltySeconds: 60 }, equivalent).safe.id, "lighter");
});

test("without a policy value, or with routes that have no instruction list, selection is unchanged", () => {
  const fast = candidate({ duration: 600, risk: 100, id: "fast" });
  const noInstructions = candidate({ duration: 650, risk: 20, id: "noInstructions" });
  delete noInstructions.route.instructions;
  assert.equal(uTurnCount(noInstructions.route), 0);
  assert.equal(selectOptimizedRoute([fast, noInstructions], fast, "car", "strong", null, { ...CAR, uTurnPenaltySeconds: 60 }, equivalent).safe.id, "noInstructions");
});

// ---- the real handler on recorded provider responses (public OSM junctions) --------------------------------------
const root = new URL("../", import.meta.url);
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase437/cases.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");

async function run(id) {
  const c = cases.find((entry) => entry.id === id);
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    const key = sha256(JSON.stringify(request));
    const entry = JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/phase437/provider/${key}.json.gz`, root))));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid: "strong", departure: "2026-11-09T12:00" });
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { c, status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test("Piazzale Lodi, return replica: a cheap improvement with stone left no longer ends the planner's search", async () => {
  const { c, status, payload, requests } = await run("piazzale-lodi-return-car");
  assert.equal(status, 200);
  // Before (3e31da9): search.attempted false, one provider request, the 25 m Piazzale Lodi alternate accepted.
  assert.equal(c.before.antiPaveSearchAttempted, false);
  assert.equal(payload.antiPave.search.attempted, true, "the penalised search runs because 25 m of stone is left");
  assert.equal(payload.antiPave.search.slices, c.after.stoneSlicesTargeted);
  assert.equal(requests.length, c.after.providerRequests, "one extra provider request");
  assert.equal(requests.filter((r) => String(r.body).includes("linear_cost_factors")).length, 1);
  assert.equal(payload.fast.confirmedPaveMeters, c.after.fastConfirmedMeters);
  assert.equal(payload.safe.confirmedPaveMeters, c.after.safeConfirmedMeters, "never more stone than before");
  assert.ok(payload.candidateDiagnostics.every((d) => Number.isInteger(d.uTurnCount)), "every candidate reports its U-turns");
});

test("Piazzale Lodi, outbound-like replica: the outcome is unchanged and no request is added", async () => {
  const { c, payload, requests } = await run("piazzale-lodi-outbound-car");
  assert.equal(payload.antiPave.search.attempted, true);
  assert.equal(payload.antiPave.search.slices, c.after.stoneSlicesTargeted, "the 24.99 m ring slice is now targeted too");
  assert.equal(requests.length, c.before.providerRequests);
  assert.equal(payload.fast.confirmedPaveMeters, c.before.fastConfirmedMeters);
  assert.equal(payload.safe.confirmedPaveMeters, c.before.safeConfirmedMeters);
  assert.equal(payload.hasDistinctAlternative, true);
});
