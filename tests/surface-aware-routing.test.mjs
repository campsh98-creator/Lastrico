import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import {
  encodePolyline6,
  extractRoughSlices,
  buildLinearCostFactors,
  pointDistanceMeters,
} from "../lib/surface-aware-routing.ts";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

const { GET } = await loadApi("app/api/routes/route.ts");

test("encodePolyline6 produces valid 6-digit encoded polyline", () => {
  const coords = [
    [9.1825, 45.4689],
    [9.1874, 45.4662],
  ];
  const encoded = encodePolyline6(coords);
  assert.ok(typeof encoded === "string");
  assert.ok(encoded.length > 5);
  // Re-encode identical coordinates produces deterministic output
  assert.equal(encodePolyline6(coords), encoded);
});

test("pointDistanceMeters accurately measures geographic distances", () => {
  const a = [9.1825, 45.4689];
  const b = [9.1825, 45.4698];
  const dist = pointDistanceMeters(a, b);
  assert.ok(dist > 90 && dist < 110);
});

test("extractRoughSlices returns empty array when route has zero rough exposure", () => {
  const smoothCoords = [
    [9.308, 45.549],
    [9.309, 45.549],
    [9.310, 45.549],
  ];
  // Predicate always returning false for smooth route
  const slices = extractRoughSlices(smoothCoords, () => false, 20);
  assert.equal(slices.length, 0);
});

test("extractRoughSlices extracts contiguous rough sections meeting min length", () => {
  const routeCoords = [
    [9.1830, 45.4680], // start before
    [9.1840, 45.4680], // rough start (~80m)
    [9.1845, 45.4680], // rough middle
    [9.1850, 45.4680], // rough end
    [9.1860, 45.4680], // end after
  ];

  // Predicate flagging points between 9.1835 and 9.1855 as rough
  const isRough = (_prev, curr) => curr[0] >= 9.1840 && curr[0] <= 9.1850;
  const slices = extractRoughSlices(routeCoords, isRough, 20);
  assert.equal(slices.length, 1);
  assert.ok(slices[0].length >= 3);
});

test("extractRoughSlices bridges short non-rough gaps when mergeGapMeters is specified", () => {
  const routeCoords = [
    [9.1830, 45.4680],
    [9.1835, 45.4680], // rough 1 (~39m)
    [9.1836, 45.4680], // smooth intersection (~8m)
    [9.1841, 45.4680], // rough 2 (~39m)
  ];
  const isRough = (_prev, curr) => (curr[0] >= 9.1831 && curr[0] <= 9.1835) || curr[0] >= 9.1837;
  const splitSlices = extractRoughSlices(routeCoords, isRough, 15, 0);
  assert.equal(splitSlices.length, 2);

  const mergedSlices = extractRoughSlices(routeCoords, isRough, 15, 20);
  assert.equal(mergedSlices.length, 1);
});

test("buildLinearCostFactors formats valid Valhalla request parameters", () => {
  const slices = [
    [[9.184, 45.468], [9.185, 45.468], [9.186, 45.468]],
    [[9.190, 45.470], [9.191, 45.470]],
  ];
  const { factors, totalPenalizedMeters } = buildLinearCostFactors(slices, 15.0);
  assert.equal(factors.length, 2);
  assert.equal(factors[0].factor, 15.0);
  assert.ok(typeof factors[0].shape === "string");
  assert.ok(totalPenalizedMeters > 50);

  // Empty slices return empty factors
  assert.equal(buildLinearCostFactors([]).factors.length, 0);
});

test("API route honors poc=surface-aware query parameter safely", async (t) => {
  const points = [[9.29, 45.53], [9.295, 45.53]];
  const roughWay = {
    id: 900000001,
    tags: { highway: "residential", surface: "sett", name: "Fixture" },
    geometry: points.map(([lon, lat]) => ({ lon, lat })),
  };
  const trip = (coordinates, time) => ({
    status: 0, summary: { length: 1, time },
    legs: [{ shape: encodePolyline(coordinates), maneuvers: [
      { type: 1, instruction: "Parti", begin_shape_index: 0, length: 1 },
      { type: 4, instruction: "Arrivo", begin_shape_index: coordinates.length - 1, length: 0 },
    ] }],
  });

  let now = Date.now() + 100_000;
  t.mock.method(Date, "now", () => now);

  t.mock.method(globalThis, "fetch", async (url) => {
    now += 500;
    const urlStr = String(url);
    if (urlStr.includes("overpass")) {
      return Response.json({ elements: [roughWay] });
    }
    if (urlStr.includes("valhalla") || urlStr.includes("project-osrm")) {
      return Response.json({ trip: trip(points, 120), alternates: [] });
    }
    return new Response(null, { status: 404 });
  });

  // Standard call without poc
  const defaultReq = new NextRequest(`http://localhost/api/routes?start=${points[0].join(",")}&end=${points[1].join(",")}&mode=car&avoid=strong`);
  const defaultRes = await GET(defaultReq);
  const defaultData = await defaultRes.json();
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultData.surfaceAwarePoc, undefined);

  // Opt-in call with poc=surface-aware
  const pocReq = new NextRequest(`http://localhost/api/routes?start=${points[0].join(",")}&end=${points[1].join(",")}&mode=car&avoid=strong&poc=surface-aware`);
  const pocRes = await GET(pocReq);
  const pocData = await pocRes.json();
  assert.equal(pocRes.status, 200);
  assert.ok(pocData.surfaceAwarePoc);
  assert.equal(pocData.surfaceAwarePoc.attempted, true);
});
