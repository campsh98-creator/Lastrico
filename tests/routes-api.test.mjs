import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import bundledSurfaces from "../data/milan-pave-central.json" with { type: "json" };
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

const { GET } = await loadApi("app/api/routes/route.ts");
const points = [[9.29, 45.53], [9.295, 45.53]];
const detour = [points[0], [9.29, 45.531], [9.295, 45.531], points[1]];
const roughWay = { id: 900000001, tags: { surface: "sett", name: "Fixture" }, geometry: points.map(([lon, lat]) => ({ lon, lat })) };
const trip = (coordinates, time) => ({
  status: 0, summary: { length: 1, time },
  legs: [{ shape: encodePolyline(coordinates), maneuvers: [
    { type: 1, instruction: "Parti", begin_shape_index: 0, length: 1 },
    { type: 4, instruction: "Arrivo", begin_shape_index: coordinates.length - 1, length: 0 },
  ] }],
});
const request = (extra = {}) => new NextRequest(`http://localhost/api/routes?${new URLSearchParams({ start: points[0].join(","), end: points[1].join(","), mode: "car", avoid: "strong", ...extra })}`);
let now = Date.now();
function fixtures(t, routes, elements = [roughWay]) {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 2_000;
    calls.push({ url: String(url), init });
    if (String(url).includes("overpass")) return Response.json({ elements });
    assert.match(String(url), /valhalla/, "unexpected external service");
    return Response.json({ trip: routes[0], alternates: routes.slice(1).map((item) => ({ trip: item })) });
  });
  return calls;
}

test("invalid route inputs return 400 before contacting providers", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network"); });
  for (const input of [{ start: "9.29,45.53,1" }, { end: "9.29," }, { start: "10,45.53" }, { mode: "walking" }, { maxExtraMinutes: "-1" }, { maxExtraMinutes: "NaN" }]) {
    assert.equal((await GET(request(input))).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("hard budget uses fastest duplicate even if provider lists the slower route first", async (t) => {
  fixtures(t, [trip(points, 660), trip(points, 600), trip(detour, 750)]);
  const response = await GET(request({ maxExtraMinutes: "2" }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.fast.minutes, 10);
  assert.equal(data.safe.minutes, 10);
  assert.equal(data.hasDistinctAlternative, false);
  assert.match(data.dataNotice, /limite di \+2 minuti/);
  assert.equal(data.appliedPreferences.maximumExtraMinutes, 2);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("exact budget boundary admits the lower known exposure route and reports unknown coverage", async (t) => {
  const calls = fixtures(t, [trip(points, 660), trip(points, 600), trip(detour, 750)]);
  const response = await GET(request({ maxExtraMinutes: "2.5" }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.fast.minutes, 10);
  assert.equal(data.safe.minutes, 12.5);
  assert.equal(data.hasDistinctAlternative, true);
  assert.ok(data.safe.paveMeters < data.fast.paveMeters);
  assert.ok(data.safe.unknownSurfaceMeters > 0);
  assert.equal(data.safe.surfaceDataConfidence, null);
  assert.equal(data.fast.surfaceClassificationConfidence, data.fast.surfaceConfidence);
  assert.match(data.dataNotice, /sconosciuti/);
  assert.equal(calls.filter((call) => call.url.includes("valhalla")).length, 1);
});

test("zero known exposure skips pointless detour requests and remains unknown", async (t) => {
  const emptyPoints = [[9.308, 45.549], [9.309, 45.549]];
  const calls = fixtures(t, [trip(emptyPoints, 60)], [
    { ...roughWay, geometry: [{ lon: -180, lat: -90 }, { lon: 180, lat: 90 }] },
    { ...roughWay, geometry: [{ lon: null, lat: 45.53 }, { lon: 9.3, lat: 45.53 }] },
  ]);
  const response = await GET(request({ start: emptyPoints[0].join(","), end: emptyPoints[1].join(",") }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.fast.paveMeters, 0);
  assert.ok(data.fast.unknownSurfaceMeters > 70);
  assert.equal(data.fast.surfaceCoveragePercent, 0);
  assert.equal(data.surfaceDataAvailable, false);
  assert.equal(calls.filter((call) => call.url.includes("valhalla")).length, 1);
});

test("navigation and all modes preserve profiles, preferences and usable instructions", async (t) => {
  const emptyPoints = [[9.308, 45.549], [9.309, 45.549]];
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const calls = fixtures(t, [trip(emptyPoints, 60)]);
    const response = await GET(request({ mode, navigation: "1", maxExtraMinutes: "0" }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.transportMode, mode);
    assert.equal(data.routingProfile.profile, mode === "car" ? "auto" : mode);
    assert.equal(data.appliedPreferences.maximumExtraMinutes, 0);
    assert.equal(data.calculationMode, "navigation");
    assert.equal(data.fast.instructions[1].direction, "arrive");
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).costing, mode === "car" ? "auto" : mode);
  }
});


test("known local surfaces remain scored when a candidate leaves the endpoint query rectangle", async (t) => {
  const way = bundledSurfaces[0];
  assert.ok(way.coordinates.every(([lon]) => lon < points[0][0] - 0.02));
  fixtures(t, [trip([points[0], ...way.coordinates, points[1]], 1800)], []);
  const response = await GET(request());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.fast.paveMeters > 100);
  assert.ok(data.fast.probablePaveMeters > 100);
  assert.equal(typeof data.fast.smoothSurfaceMeters, "number");
  assert.equal(typeof data.fast.cyclewayMeters, "number");
  assert.equal(typeof data.candidateDiagnostics[0].smoothSurfaceMeters, "number");
  assert.equal(typeof data.candidateDiagnostics[0].cyclewayMeters, "number");
});
