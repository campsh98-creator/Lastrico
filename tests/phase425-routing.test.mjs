import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import { mockRoadWays } from "./helpers/road-fixtures.mjs";
import { fastestLegalCandidate, selectOptimizedRoute, CONFIRMED_PAVE_INCREASE_TOLERANCE_METERS } from "../lib/route-optimization.ts";
import { routesShareCorridor } from "../lib/route-candidates.ts";

const policy = { minimumPaveReduction: 20, balancedPaveDivisor: 500,
  limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } } };
const candidate = (id, duration, confirmed, probable, extra = {}) => ({
  id, paveMeters: confirmed + probable, riskMeters: Math.round(confirmed + probable * 0.65),
  surfaceScore: { confirmedMeters: confirmed, paveMeters: confirmed + probable, unknownMeters: 0, totalMeters: 2000, smoothMeters: 2000 - confirmed - probable, confirmedRestrictionMeters: 0, ...extra },
  route: { duration, distance: 2000, coordinates: [[9.19, 45.46], [9.19 + id / 1000, 45.462], [9.20, 45.46]], instructions: [], provider: "valhalla-fossgis", profile: "auto" },
});
const select = (routes) => selectOptimizedRoute(routes, fastestLegalCandidate(routes, "car"), "car", "strong", null, policy,
  (a, b) => routesShareCorridor(a, b, 32)).safe;

test("an anti-pavé alternative never adds confirmed stone to shed probable paving stones", () => {
  const fast = candidate(1, 600, 300, 500);
  const moreConfirmed = candidate(5, 640, 400, 0); // lower weighted risk, but +100 m of confirmed stone
  assert.equal(select([fast, moreConfirmed]), fast);
  const withinTolerance = candidate(6, 640, 300 + CONFIRMED_PAVE_INCREASE_TOLERANCE_METERS, 0);
  assert.equal(select([fast, withinTolerance]), withinTolerance);
  const lessConfirmed = candidate(7, 650, 100, 450);
  assert.equal(select([fast, moreConfirmed, lessConfirmed]), lessConfirmed);
  // Candidates without the confirmed split keep the previous behaviour.
  const legacyFast = { ...fast, surfaceScore: { ...fast.surfaceScore, confirmedMeters: undefined } };
  const legacyAlt = { ...moreConfirmed, surfaceScore: { ...moreConfirmed.surfaceScore, confirmedMeters: undefined } };
  assert.equal(select([legacyFast, legacyAlt]), legacyAlt);
});

const { GET } = await loadApi("app/api/routes/route.ts");
const points = [[9.29, 45.53], [9.295, 45.53]];
const north = [points[0], [9.29, 45.531], [9.295, 45.531], points[1]];
const south = [points[0], [9.29, 45.529], [9.295, 45.529], points[1]];
const sett = (id, line) => ({ id, tags: { highway: "residential", surface: "sett", name: `Fixture ${id}` }, geometry: line.map(([lon, lat]) => ({ lon, lat })) });
const trip = (coordinates, time) => ({ status: 0, summary: { length: 1, time }, legs: [{ shape: encodePolyline(coordinates), maneuvers: [
  { type: 1, instruction: "Parti", begin_shape_index: 0, length: 1 },
  { type: 4, instruction: "Arrivo", begin_shape_index: coordinates.length - 1, length: 0 }] }] });
const request = () => new NextRequest(`http://localhost/api/routes?${new URLSearchParams({ start: points[0].join(","), end: points[1].join(","), mode: "car", avoid: "strong" })}`);
let now = Date.now() + 10_000_000;

test("a still-rough penalised candidate triggers one refinement that also avoids stones seen on the other routes", async (t) => {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  mockRoadWays(t, [sett(900000101, points), sett(900000102, north.slice(1, 3)), sett(900000103, south.slice(1, 3))]);
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 1_500;
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (!Array.isArray(body.linear_cost_factors)) {
      return Response.json({ trip: trip(points, 600), alternates: [{ trip: trip(north, 700) }] });
    }
    // The established penalised search lands on another stone street; the refinement penalises it too.
    return Response.json({ trip: trip(body.linear_cost_factors.length < 3 ? south : north, 720), alternates: [] });
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const penalised = bodies.filter((b) => Array.isArray(b.linear_cost_factors));
  assert.ok(penalised.length >= 2, "one refinement call after a still-rough penalised candidate");
  assert.equal(penalised[0].linear_cost_factors.length, 1, "the established search penalises the fastest route only");
  assert.equal(penalised[1].linear_cost_factors.length, 3, "the refinement adds the alternate's and the first candidate's stones");
  for (const factor of penalised.flatMap((b) => b.linear_cost_factors)) assert.equal(factor.factor, 15);
  const data = await response.json();
  assert.equal(data.optimization.directCandidates, 2);
});
