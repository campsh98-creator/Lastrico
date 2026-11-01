import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { PILOT_AREAS, areaForCoordinate, coordinateInArea } from "../lib/pilot-areas.ts";
import { validAreaGeocodeResult, validMilanGeocodeResult } from "../lib/geocoding.ts";
import { getSpatialRoadStore, spatialRoadStore, SpatialRoadIntelligenceStore } from "../lib/spatial-road-store.ts";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

test("pilot bounds are disjoint; unsupported and invalid coordinates are rejected", () => {
  assert.equal(areaForCoordinate([9.19, 45.46])?.id, "milan");
  assert.equal(areaForCoordinate([16.4, 38.322])?.id, "roccella");
  for (const point of [[12.5, 41.9], [16.4, 45.46], [NaN, 38.32], [Infinity, 38.32]]) {
    assert.equal(areaForCoordinate(point), undefined);
  }
  assert.equal(coordinateInArea([16.4, 38.322], PILOT_AREAS.milan), false);
});

test("geocoding validates the selected area without changing the Milan validator", () => {
  const row = { place_id: 1, display_name: "Roccella Ionica", lon: "16.4", lat: "38.322" };
  assert.equal(validAreaGeocodeResult(row, PILOT_AREAS.roccella.bounds), true);
  assert.equal(validMilanGeocodeResult(row), false);
  assert.equal(validAreaGeocodeResult({ ...row, lon: "9.19", lat: "45.46" }, PILOT_AREAS.roccella.bounds), false);
});

test("routing rejects cross-area pairs and mismatching explicit area before networking", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not contact providers"); });
  for (const params of [
    { start: "9.19,45.46", end: "16.4,38.322" },
    { start: "16.4,38.322", end: "16.401,38.323", area: "milan" },
    { start: "9.19,45.46", end: "9.191,45.461", area: "unknown" },
  ]) assert.equal((await GET(new NextRequest(`http://localhost/api/routes?${new URLSearchParams(params)}`))).status, 400);
});

test("stores keep dictionaries and caches isolated, including overlapping segment identities", () => {
  const tuple = ["same-geometry", 1, 0, [16.4, 38.32, 16.401, 38.32], 2, 0, 0, 6, 0, 7, "residential", 87, 90, 0];
  const data = { version: "1.1.0", sourceDatasetSha256: "test-only", sourceGeneratedAt: "2026-10-29",
    totalSegments: 2, tileGrid: { resolutionDeg: 0.01 }, names: ["Test A"], surfaceVals: ["asphalt"],
    tagSets: [{ motorcar: "no" }], tiles: { "1640_3832": [tuple, [tuple[0], 2, ...tuple.slice(2)]] } };
  const first = new SpatialRoadIntelligenceStore(data);
  const second = new SpatialRoadIntelligenceStore({ ...data, names: ["Test B"], tagSets: [{ bicycle: "no" }] });
  assert.equal(first.getAllRoads().length, 2, "distinct OSM ways must survive identical 2D geometry");
  assert.equal(first.getAllRoads()[0].name, "Test A");
  assert.equal(second.getAllRoads()[0].name, "Test B");
  assert.deepEqual(second.getAllRoads()[0].rawTags, { bicycle: "no" });
  first.getScopedIntelligence([[16.4, 38.32]]);
  assert.equal(second.indexCacheSize, 0);
});

test("real Roccella archive is selected for planner/navigation and never leaks Milan", async (t) => {
  const store = await getSpatialRoadStore("roccella");
  assert.notEqual(store, spatialRoadStore);
  assert.equal(await getSpatialRoadStore("milan"), spatialRoadStore);
  assert.equal(store.getScopedIntelligence([[9.19, 45.46]], 80).roads.length, 0);
  assert.equal(spatialRoadStore.getScopedIntelligence([[16.4, 38.322]], 80).roads.length, 0);
  const road = store.getAllRoads().find((r) => r.modeAccess?.car && r.modeAccess?.bicycle
    && r.surfaceCategory === "confirmed_smooth" && r.lengthMeters > 25 && r.lengthMeters < 150);
  assert.ok(road, "an authentic shared-access smooth road must exist in the acquired data");
  const { GET } = await loadApi("app/api/routes/route.ts");
  let now = Date.now() + 100_000;
  t.mock.method(Date, "now", () => now);
  const modes = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 2_000;
    const body = JSON.parse(init.body);
    modes.push(body.costing);
    return Response.json({ trip: { status: 0, summary: { length: road.lengthMeters / 1000, time: 30 }, legs: [{
      shape: encodePolyline(road.coordinates), maneuvers: [
        { type: 1, instruction: "Parti", begin_shape_index: 0 },
        { type: 4, instruction: "Arrivo", begin_shape_index: 1 },
      ],
    }] } });
  });
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    for (const navigation of ["0", "1"]) {
      const params = new URLSearchParams({ start: road.coordinates[0].join(","), end: road.coordinates[1].join(","),
        mode, navigation, maxExtraMinutes: "0", area: "roccella" });
      const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.area, "roccella");
      assert.equal(payload.calculationMode, navigation === "1" ? "navigation" : "planner");
      assert.ok(payload.fast.smoothSurfaceMeters > 0);
      assert.equal(payload.fast.surfaceSource, "osm");
      assert.equal(payload.fast.instructions.at(-1).direction, "arrive");
      assert.ok(payload.fast.coordinates.every((point) => coordinateInArea(point, PILOT_AREAS.roccella)));
    }
  }
  assert.deepEqual(modes, ["auto", "auto", "motorcycle", "motorcycle", "bicycle", "bicycle"]);
});

test("geocoding sends selected-area viewbox and excludes responses from the other pilot", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts");
  let requestUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    requestUrl = new URL(url);
    return Response.json([
      { place_id: 1, display_name: "Via Roma, Roccella Ionica", lon: "16.4", lat: "38.322", address: { town: "Roccella Ionica", road: "Via Roma" } },
      { place_id: 2, display_name: "Via Roma, Milano", lon: "9.19", lat: "45.46", address: { city: "Milano" } },
    ]);
  });
  const response = await GET(new NextRequest("http://localhost/api/geocode?q=Via%20Roma%201&area=roccella"));
  assert.equal(response.status, 200);
  assert.equal(requestUrl.searchParams.get("city"), "Roccella Ionica");
  assert.equal(requestUrl.searchParams.get("viewbox"), "16.36,38.35,16.44,38.29");
  assert.equal((await response.json()).results.length, 1);
  assert.equal((await GET(new NextRequest("http://localhost/api/geocode?q=Roma&area=invalid"))).status, 400);
});
