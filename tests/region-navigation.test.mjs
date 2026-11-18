import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { MILAN_COVERAGE_BOUNDS, MILAN_SERVICE_BOUNDS, PILOT_AREAS, areaForCoordinate, coordinateInArea, coordinateInCoverage } from "../lib/pilot-areas.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import { createNavigationFixState, processGpsFix } from "../lib/navigation-fix-processor.ts";

/**
 * General-purpose navigation across Milan's service area. Recorded FOSSGIS answers for public landmarks
 * (scripts/record-region-journeys.mjs); no network. The enriched road data is an extra layer: outside it a route is
 * calculated and followed like any navigator's, and the surface stays explicitly unknown.
 */
const root = new URL("../", import.meta.url);
const { journeys } = JSON.parse(await readFile(new URL("tests/fixtures/region/journeys.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");
const point = (text) => text.split(",").map(Number);
const meters = ([lon1, lat1], [lon2, lat2]) => {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(a));
};

async function calculate(journey) {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    const entry = JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/region/provider/${sha256(JSON.stringify(request))}.json.gz`, root))));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ start: journey.start, end: journey.end, mode: "car", avoid: "strong", departure: "2026-11-09T12:00" });
    if (journey.navigation) params.set("navigation", "1");
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}
const results = new Map();
for (const journey of journeys) results.set(journey.id, await calculate(journey));

test("the service area reaches the surrounding municipalities, the enriched coverage stays the city", () => {
  assert.deepEqual(PILOT_AREAS.milan.bounds, MILAN_SERVICE_BOUNDS);
  assert.deepEqual(PILOT_AREAS.milan.coverageBounds, MILAN_COVERAGE_BOUNDS);
  for (const [name, p] of Object.entries({ malpensa: [8.7281, 45.6306], linate: [9.2767, 45.4496], monza: [9.2745, 45.5845], como: [9.0852, 45.8101], bergamo: [9.6643, 45.7036] })) {
    assert.equal(areaForCoordinate(p)?.id, "milan", name);
    assert.equal(coordinateInArea(p, PILOT_AREAS.milan), true, name);
  }
  assert.equal(coordinateInCoverage([8.7281, 45.6306], PILOT_AREAS.milan), false, "Malpensa has no enriched road data");
  assert.equal(coordinateInCoverage([9.19, 45.4642], PILOT_AREAS.milan), true);
  // Roccella is untouched and far-away places are still rejected (Rome is not part of the Milan release).
  assert.equal(areaForCoordinate([16.4008, 38.3224])?.id, "roccella");
  assert.equal(areaForCoordinate([2.35, 48.85]), undefined, "Paris");
  assert.equal(areaForCoordinate([14.25, 40.85]), undefined, "Naples");
});

test("every journey inside, out of and into Milan is calculated completely, with a standard route outside the coverage", () => {
  for (const journey of journeys) {
    const { status, payload, requests } = results.get(journey.id);
    assert.equal(status, 200, `${journey.id}: ${payload.error ?? ""}`);
    assert.equal(payload.area, "milan");
    const route = payload.safe;
    assert.ok(route.coordinates.length > 50, `${journey.id}: geometry`);
    assert.ok(route.instructions.length > 3, `${journey.id}: turn-by-turn instructions`);
    assert.ok(meters(route.coordinates[0], point(journey.start)) < 300, `${journey.id}: starts at the origin`);
    assert.ok(meters(route.coordinates.at(-1), point(journey.end)) < 300, `${journey.id}: ends at the destination`);
    assert.ok(requests.length <= (journey.navigation ? 4 : 7), `${journey.id}: ${requests.length} provider requests`);
  }
});

test("surfaces outside the enriched coverage stay unknown, never smooth or absent; inside it stays measured", () => {
  const inside = results.get("milan-inside").payload.safe;
  assert.ok(inside.surfaceCoveragePercent >= 99, "the city journey is fully covered");
  for (const id of ["milan-malpensa", "milan-como", "milan-bergamo", "malpensa-reroute-outside"]) {
    const route = results.get(id).payload.safe;
    assert.ok(route.unknownSurfaceMeters > 30_000, `${id}: unknown metres ${route.unknownSurfaceMeters}`);
    assert.ok(route.surfaceCoveragePercent < 15, `${id}: coverage ${route.surfaceCoveragePercent}`);
    assert.equal(route.smoothSurfaceMeters <= route.surfaceTotalMeters - route.unknownSurfaceMeters, true, `${id}: unknown is not counted as smooth`);
  }
  // Mixed coverage: both parts are present in the same route.
  const mixed = results.get("monza-into-milan").payload.safe;
  assert.ok(mixed.unknownSurfaceMeters > 5_000 && mixed.surfaceCoveragePercent > 20 && mixed.surfaceCoveragePercent < 80, "partly covered");
  assert.equal(results.get("milan-linate").payload.safe.confirmedPaveMeters, 0, "the enriched part still avoids the stone it knows");
});

test("a route that leaves the city is followed to the end: fixes outside the coverage are accepted, the arrival is detected", () => {
  const route = results.get("milan-malpensa").payload.safe;
  const model = buildRouteProgressModel(route.coordinates, route.instructions, meters);
  for (const [label, bounds, expectOutside] of [["service bounds", MILAN_SERVICE_BOUNDS, false], ["city-only bounds (before)", MILAN_COVERAGE_BOUNDS, true]]) {
    let state = createNavigationFixState();
    let outside = 0, accepted = 0, arrived = false, previous = 0;
    const fixes = [];
    for (let i = 1; i < route.coordinates.length; i++) {
      const [a, b] = [route.coordinates[i - 1], route.coordinates[i]];
      const steps = Math.max(1, Math.round(meters(a, b) / 25));
      for (let s = 1; s <= steps; s++) fixes.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
    }
    const end = route.coordinates.at(-1);
    fixes.push(end, end, end);
    fixes.forEach((coordinate, i) => {
      const timestamp = 1_000_000 + i * 1000;
      const decision = processGpsFix(state, { coordinate, accuracy: 5, timestamp, heading: null, speed: 25 }, {
        now: timestamp, mode: "car", bounds, route: { model, minutes: route.minutes, distanceKm: route.distance }, lastCalculationAt: 0, calculationInProgress: false,
      });
      state = decision.state;
      if (decision.outcome === "outside") { outside++; return; }
      if (decision.outcome !== "accepted") return;
      accepted++;
      assert.ok(decision.progress.routeProgressMeters >= previous - 0.001, "progress never goes backwards");
      previous = decision.progress.routeProgressMeters;
      if (decision.arrived) arrived = true;
    });
    if (expectOutside) {
      assert.ok(outside > 100, `${label}: the old city-only bounds dropped ${outside} fixes (the defect this fixes)`);
    } else {
      assert.equal(outside, 0, `${label}: no fix is dropped for being outside the coverage`);
      assert.ok(accepted > 2000, `${label}: ${accepted} fixes accepted`);
      assert.equal(arrived, true, `${label}: arrival detected at Malpensa`);
    }
  }
});

test("leaving the route outside the coverage asks for a reroute, and the reroute is a bounded standard calculation", () => {
  const route = results.get("milan-malpensa").payload.safe;
  const model = buildRouteProgressModel(route.coordinates, route.instructions, meters);
  const middle = Math.floor(route.coordinates.length * 0.7);
  let state = createNavigationFixState();
  let recalculate = false;
  for (let i = 0; i < 40 && !recalculate; i++) {
    const [lon, lat] = route.coordinates[middle];
    const coordinate = [lon + 0.0016, lat + 0.0012 + i * 0.00002]; // about 200 m beside the road
    const timestamp = 5_000_000 + i * 1000;
    const decision = processGpsFix(state, { coordinate, accuracy: 5, timestamp, heading: null, speed: 20 }, {
      now: timestamp, mode: "car", bounds: MILAN_SERVICE_BOUNDS, route: { model, minutes: route.minutes, distanceKm: route.distance }, lastCalculationAt: 0, calculationInProgress: false,
    });
    state = decision.state;
    if (decision.outcome === "accepted" && decision.shouldRecalculate) recalculate = true;
  }
  assert.equal(recalculate, true, "an off-route position beyond the coverage starts a reroute");
  for (const id of ["malpensa-reroute-outside", "como-reroute-mixed"]) {
    const { status, payload, requests } = results.get(id);
    assert.equal(status, 200);
    assert.ok(requests.length <= 4, `${id}: ${requests.length} provider requests`);
    assert.ok(payload.safe.instructions.length > 3);
  }
});

test("a place beyond the service area is still refused before any network call", async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("must not contact providers"); };
  try {
    for (const [start, end] of [["9.19,45.46", "2.35,48.85"], ["9.19,45.46", "14.25,40.85"], ["12.49,41.89", "9.19,45.46"]]) {
      const response = await GET(new NextRequest(`http://localhost/api/routes?start=${start}&end=${end}&mode=car&avoid=strong`));
      assert.equal(response.status, 400, `${start} -> ${end}`);
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
