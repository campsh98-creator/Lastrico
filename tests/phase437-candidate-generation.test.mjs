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
import { addsConfirmedPave, isLegalCandidate, selectOptimizedRoute, U_TURN_PENALTY_SECONDS, uTurnCount } from "../lib/route-optimization.ts";

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

async function run(id, { navigation = false, answerEverythingWith = null } = {}) {
  const c = cases.find((entry) => entry.id === id);
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    const key = answerEverythingWith ?? sha256(JSON.stringify(request));
    const entry = JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/phase437/provider/${key}.json.gz`, root))));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid: "strong", departure: "2026-11-09T12:00" });
    if (navigation) params.set("navigation", "1");
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

// ---- Phase 4.37 review: a penalised route must not add confirmed stone to the fastest card --------------------------

test("addsConfirmedPave is the selection's own rule: a small swap for probable stone passes, a large one does not", () => {
  const reference = candidate({ duration: 600, risk: 100, id: "reference" });
  reference.surfaceScore.confirmedMeters = 85;
  reference.surfaceScore.probableMeters = 437;
  const heavy = candidate({ duration: 580, risk: 100, id: "heavy" });
  heavy.surfaceScore.confirmedMeters = 511; // De Angeli → San Babila by motorcycle: +426 m confirmed for −388 m probable
  heavy.surfaceScore.probableMeters = 49;
  assert.equal(addsConfirmedPave(heavy, reference), true);
  const small = candidate({ duration: 580, risk: 100, id: "small" });
  small.surfaceScore.confirmedMeters = 85 + 30; // within max(10, min(50, 10 % of the 400 m of probable stone removed))
  small.surfaceScore.probableMeters = 437; // no probable stone removed: tolerance is the 10 m minimum
  assert.equal(addsConfirmedPave(small, reference), true, "+30 m with no probable stone removed is over the 10 m tolerance");
  small.surfaceScore.probableMeters = 0; // 437 m removed: tolerance min(50, 43.7) = 43.7 m
  assert.equal(addsConfirmedPave(small, reference), false, "+30 m for 437 m of probable stone removed is accepted");
  const lighter = candidate({ duration: 700, risk: 20, id: "lighter" });
  lighter.surfaceScore.confirmedMeters = 20;
  assert.equal(addsConfirmedPave(lighter, reference), false);
  assert.equal(addsConfirmedPave({ ...heavy, surfaceScore: { ...heavy.surfaceScore, confirmedMeters: undefined } }, reference), false, "unknown split: no verdict");
});

test("De Angeli → San Babila by motorcycle: the penalised route that adds 426 m of confirmed stone is dropped", async () => {
  const { c, status, payload } = await run("de-angeli-san-babila-motorcycle");
  assert.equal(status, 200);
  assert.equal(payload.antiPave.search.attempted, true);
  assert.ok(payload.antiPave.search.discarded >= 1, "the penalised candidate is discarded, and says so");
  assert.equal(payload.fast.confirmedPaveMeters, c.after.fastConfirmedMeters, "the fastest card stays the provider's own route");
  assert.equal(Math.round(payload.fast.minutes * 60), c.after.fastSeconds);
  assert.equal(payload.safe.confirmedPaveMeters, c.after.safeConfirmedMeters);
  assert.equal(payload.hasDistinctAlternative, true);
  assert.ok(!payload.candidateDiagnostics.some((d) => d.source.startsWith("surface-aware-valhalla") && d.confirmedPaveMeters > 85 + 50), "no penalised route with more confirmed stone in the pool");
});

test("every Phase 4.37 behaviour in the handler is keyed on the Milan area (Rome and Roccella keep the old rules)", async () => {
  const source = (await readFile(new URL("app/api/routes/route.ts", root), "utf8")).replace(/\r\n/g, "\n");
  for (const needle of [
    'area.id !== "milan" || !addsConfirmedPave(candidate, preliminaryFast)',
    'area.id === "milan"\n    ? { ...MODE_POLICY[mode], uTurnPenaltySeconds: U_TURN_PENALTY_SECONDS }',
    "penalisedSliceMinimumMeters(area.id, policy.minimumPaveReduction)",
    "stopsOnlyWhenClean(area.id, navigationRequest)",
  ]) assert.ok(source.includes(needle), `missing: ${needle}`);
  // The rules that decide are pure functions of the area id, tested above.
  assert.equal(penalisedSliceMinimumMeters("roccella", 12), 25);
  assert.equal(stopsOnlyWhenClean("rome", false), false);
});

// ---- Phase 4.37 review: provider requests are capped -------------------------------------------------------------------

test("a planner calculation never exceeds 7 provider requests and a reroute never exceeds 4, even if every answer says 'keep going'", async () => {
  // Answer every request with the first recorded base response: the handler sees a provider that always succeeds, the
  // worst case for a search that asks for more.
  const probe = await run("piazzale-lodi-return-car");
  const baseKey = sha256(JSON.stringify(probe.requests[0]));
  for (const id of ["piazzale-lodi-return-car", "piazzale-lodi-outbound-car", "de-angeli-san-babila-motorcycle"]) {
    const planner = await run(id, { answerEverythingWith: baseKey });
    assert.ok(planner.requests.length <= 7, `${id}: planner made ${planner.requests.length} requests`);
    assert.equal(planner.payload.antiPave.search.providerRequests, planner.requests.length, "the counter matches the real requests");
    const navigation = await run(id, { navigation: true, answerEverythingWith: baseKey });
    assert.ok(navigation.requests.length <= 4, `${id}: reroute made ${navigation.requests.length} requests`);
  }
});

test("the real fixtures report how many provider requests they used", async () => {
  for (const id of ["piazzale-lodi-return-car", "piazzale-lodi-outbound-car", "de-angeli-san-babila-motorcycle"]) {
    const { payload, requests } = await run(id);
    assert.equal(payload.antiPave.search.providerRequests, requests.length, id);
  }
});

// ---- Phase 4.37 review: the U-turn penalty cannot make routing illegal or add detours -------------------------------

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("U-turn penalty, 600 random pools: never selects an illegal or over-limit route, only ever avoids U-turns, at a bounded cost", () => {
  const random = seededRandom(437);
  const weight = { balanced: CAR.balancedPaveDivisor / 60, strong: CAR.balancedPaveDivisor / 600 };
  let differing = 0;
  for (let round = 0; round < 600; round += 1) {
    const avoidance = round % 2 === 0 ? "strong" : "balanced";
    const fastDuration = 400 + Math.floor(random() * 800);
    const fast = candidate({ duration: fastDuration, risk: 150 + Math.floor(random() * 500), unknown: Math.floor(random() * 60), uTurns: random() < 0.3 ? 1 : 0, id: "fast" });
    const pool = [fast];
    const size = 3 + Math.floor(random() * 5);
    for (let i = 0; i < size; i += 1) {
      const slower = 1 + random() * (avoidance === "strong" ? 0.7 : 0.4);
      const c = candidate({
        duration: Math.round(fastDuration * slower), risk: Math.floor(random() * 400), unknown: Math.floor(random() * 300),
        uTurns: random() < 0.3 ? 1 + Math.floor(random() * 2) : 0, id: `c${i}`,
      });
      c.route.coordinates[0][1] += (i + 1) * 0.01 + random() * 0.001; // distinct corridors
      if (random() < 0.1) c.route.provider = "osrm-public-fallback"; // wrong profile for a car ⇒ illegal
      if (random() < 0.1) c.surfaceScore.blockingRestrictionMeters = 25; // known restriction ⇒ illegal
      pool.push(c);
    }
    const plain = selectOptimizedRoute(pool, fast, "car", avoidance, null, CAR, equivalent);
    const penalised = selectOptimizedRoute(pool, fast, "car", avoidance, null, { ...CAR, uTurnPenaltySeconds: U_TURN_PENALTY_SECONDS }, equivalent);
    const chosen = penalised.safe;
    if (chosen !== fast) {
      assert.ok(isLegalCandidate(chosen, "car"), "a candidate that is not legal is never selected");
      const limit = CAR.limits[avoidance];
      assert.ok(chosen.route.duration <= fast.route.duration * limit.factor + limit.seconds, "the raw time limit is untouched by the penalty");
      assert.ok(chosen.riskMeters + CAR.minimumPaveReduction <= fast.riskMeters, "it still removes the minimum stone");
      assert.ok(!addsConfirmedPave(chosen, fast), "it still never adds confirmed stone");
    }
    if (chosen !== plain.safe) {
      differing += 1;
      const a = plain.safe;
      const utility = (selection, candidate) => selection.scores.get(candidate).utility;
      const avoided = uTurnCount(a.route) - uTurnCount(chosen.route);
      assert.ok(avoided > 0, "the pick only changes to a route with fewer U-turns");
      // Cost, in the selection's own units (metres of stone; seconds × weight): at most 60 s per U-turn avoided.
      const cost = utility(plain, chosen) - utility(plain, a);
      assert.ok(cost <= U_TURN_PENALTY_SECONDS * weight[avoidance] * avoided + 1e-9, `cost ${cost.toFixed(1)} exceeds the bound`);
      // The route that is not chosen is not removed: it is still eligible, only less attractive.
      assert.notEqual(penalised.verdicts.get(a), "illegal");
    }
  }
  assert.ok(differing > 0 && differing < 300, `the penalty changes some picks but not most of them (${differing} of 600)`);
});
