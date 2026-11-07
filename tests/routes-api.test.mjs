import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import bundledSurfaces from "../data/surfaces/milan-central.json" with { type: "json" };
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import { mockRoadWays } from "./helpers/road-fixtures.mjs";

const { GET } = await loadApi("app/api/routes/route.ts");
const points = [[9.29, 45.53], [9.295, 45.53]];
const detour = [points[0], [9.29, 45.531], [9.295, 45.531], points[1]];
const roughWay = { id: 900000001, tags: { highway: "residential", surface: "sett", name: "Fixture" }, geometry: points.map(([lon, lat]) => ({ lon, lat })) };
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
  mockRoadWays(t, elements);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 2_000;
    calls.push({ url: String(url), init });
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
  const calls = fixtures(t, [trip(points, 660), trip(points, 600), trip(detour, 750)], [roughWay, {
    ...roughWay, id: 900000002, tags: { highway: "residential", surface: "asphalt" },
    geometry: detour.slice(1, 3).map(([lon, lat]) => ({ lon, lat })),
  }]);
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
  const calls = fixtures(t, [trip(emptyPoints, 60)], []);
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
  const way = bundledSurfaces.find((segment) => segment.surfaceCategory === "probable_rough"
    && segment.isMotorAllowed && segment.lengthMeters > 20);
  assert.ok(way);
  const wayLon = way.coordinates[0][0];
  const wayLat = way.coordinates[0][1];
  const testStart = [wayLon + 0.005, wayLat - 0.001];
  const testEnd = [wayLon + 0.005, wayLat + 0.001];
  assert.ok(way.coordinates.every(([lon]) => lon < testStart[0] - 0.004));
  fixtures(t, [trip([testStart, ...way.coordinates, testEnd], 1800)], []);
  const response = await GET(request({ start: testStart.join(","), end: testEnd.join(",") }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.fast.paveMeters > 10);
  assert.ok(data.fast.probablePaveMeters > 10);
  assert.equal(typeof data.fast.smoothSurfaceMeters, "number");
  assert.equal(typeof data.fast.cyclewayMeters, "number");
  assert.equal(typeof data.candidateDiagnostics[0].smoothSurfaceMeters, "number");
  assert.equal(typeof data.candidateDiagnostics[0].cyclewayMeters, "number");
});

test("real handler measures smooth and cycling exposure from OSM attributes", async (t) => {
  fixtures(t, [trip(points, 60)], [{
    ...roughWay, tags: { highway: "residential", surface: "asphalt", cycleway: "lane" },
  }]);
  const response = await GET(request({ mode: "bicycle", maxExtraMinutes: "0" }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.fast.smoothSurfaceMeters > 300);
  assert.equal(data.fast.cyclewayMeters, data.fast.smoothSurfaceMeters);
  assert.equal(data.fast.unknownSurfaceMeters, 0);
  assert.equal(data.fast.surfaceCoveragePercent, 100);
  assert.equal(data.fast.paveMeters, 0);
  assert.equal(data.surfaceDataAvailable, true);
  assert.equal(data.candidateDiagnostics[0].smoothSurfaceMeters, data.fast.smoothSurfaceMeters);
});

test("handler does not classify generic paved as confirmed smooth", async (t) => {
  fixtures(t, [trip(points, 60)], [{ ...roughWay, tags: { highway: "residential", surface: "paved" } }]);
  const data = await (await GET(request())).json();
  assert.equal(data.fast.smoothSurfaceMeters, 0);
  assert.equal(data.fast.surfaceCoveragePercent, 0);
  assert.ok(data.fast.unknownSurfaceMeters > 300);
});

test("handler honors bicycle counterflow without assigning restricted cycle tracks to cars", async (t) => {
  const reversed = [...points].reverse();
  fixtures(t, [trip(reversed, 60)], [{
    ...roughWay, tags: { highway: "cycleway", surface: "asphalt", oneway: "yes", "oneway:bicycle": "no" },
  }]);
  const bicycle = await (await GET(request({ mode: "bicycle", start: reversed[0].join(","), end: reversed[1].join(",") }))).json();
  assert.ok(bicycle.fast.smoothSurfaceMeters > 300);
  // Phase 4.24: a car route lying on the cycle track's own geometry reports the surface under it.
  const carOnTrack = await (await GET(request({ start: reversed[0].join(","), end: reversed[1].join(",") }))).json();
  assert.ok(carOnTrack.fast.smoothSurfaceMeters > 300);
  // A cycle track beside the car route never lends its surface to the car.
  fixtures(t, [trip(reversed, 60)], [{
    ...roughWay, tags: { highway: "cycleway", surface: "asphalt", oneway: "yes", "oneway:bicycle": "no" },
    geometry: points.map(([lon, lat]) => ({ lon, lat: lat + 0.00005 })),
  }]);
  const car = await (await GET(request({ start: reversed[0].join(","), end: reversed[1].join(",") }))).json();
  assert.equal(car.fast.smoothSurfaceMeters, 0);
  assert.ok(car.fast.unknownSurfaceMeters > 300);
});

test("skips redundant waypoint detour requests when surface-aware Valhalla already returns an admissible distinct corridor", async (t) => {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  const smoothWay = {
    ...roughWay,
    id: 900000002,
    tags: { highway: "residential", surface: "asphalt" },
    geometry: detour.slice(1, 3).map(([lon, lat]) => ({ lon, lat })),
  };
  mockRoadWays(t, [roughWay, smoothWay]);
  const valhallaCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 2_000;
    const body = JSON.parse(init.body);
    valhallaCalls.push(body);
    if (Array.isArray(body.linear_cost_factors)) {
      // 700s is 11.66 min vs 600s (10 min) -> +1.66 min, within maxExtraMinutes 2
      return Response.json({ trip: trip(detour, 700), alternates: [] });
    }
    return Response.json({ trip: trip(points, 600), alternates: [] });
  });
  const response = await GET(request({ maxExtraMinutes: "2" }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.hasDistinctAlternative, true);
  assert.equal(valhallaCalls.length, 2, "must not fire redundant waypoint detours after an admissible surface-aware corridor");
});

test("continues waypoint fallback when surface-aware Valhalla returns a distinct but inadmissible candidate", async (t) => {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  mockRoadWays(t, [roughWay]);
  const valhallaCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    now += 2_000;
    const body = JSON.parse(init.body);
    valhallaCalls.push(body);
    if (Array.isArray(body.linear_cost_factors)) {
      // 750s is 12.5 min vs 600s (10 min) -> +2.5 min, which exceeds maxExtraMinutes: "2" (inadmissible)
      return Response.json({ trip: trip(detour, 750), alternates: [] });
    }
    return Response.json({ trip: trip(points, 600), alternates: [] });
  });
  const response = await GET(request({ maxExtraMinutes: "2" }));
  assert.equal(response.status, 200);
  assert.ok(valhallaCalls.length > 2, "must continue to waypoint detours when direct surface-aware candidate is inadmissible");
});

test("identical requests are deterministic and contact only the routing provider", async (t) => {
  const smoothDetour = {
    ...roughWay, id: 900000002, tags: { highway: "residential", surface: "asphalt" },
    geometry: detour.slice(1, 3).map(([lon, lat]) => ({ lon, lat })),
  };
  const calls = fixtures(t, [trip(points, 600), trip(detour, 750)], [roughWay, smoothDetour]);
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    for (const navigation of ["0", "1"]) {
      const scores = async () => {
        const data = await (await GET(request({ mode, navigation }))).json();
        return { fast: data.fast, safe: data.safe, candidates: data.candidateDiagnostics };
      };
      assert.deepEqual(await scores(), await scores());
    }
  }
  assert.ok(calls.length > 0);
  // The stub's own assertion would be swallowed by the provider's error handling.
  assert.deepEqual(calls.filter((call) => !call.url.includes("valhalla")).map((call) => call.url), []);
});

test("private access beside the destination stays routable with an explicit warning", async (t) => {
  const longRoute = [[9.28, 45.53], [9.2942, 45.53], [9.295, 45.53]];
  const privateEnd = {
    id: 900000003, tags: { highway: "service", vehicle: "private" },
    geometry: longRoute.slice(1).map(([lon, lat]) => ({ lon, lat })),
  };
  fixtures(t, [trip(longRoute, 120)], [privateEnd]);
  const response = await GET(request({ start: longRoute[0].join(","), end: longRoute[2].join(",") }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.fast.terminalPrivateAccessMeters > 0);
  assert.equal(data.candidateDiagnostics[0].blockingRestrictionMeters, 0);
  assert.match(data.dataNotice, /tratto privato/);
});

test("access restrictions that retrying cannot solve report 422, not a provider outage", async (t) => {
  const longRoute = [[9.28, 45.53], [9.285, 45.53], [9.286, 45.53], [9.2942, 45.53], [9.295, 45.53]];
  const stretch = ([from, to], tags) => ({
    id: 900000004, tags: { highway: "service", ...tags },
    geometry: [from, to].map(([lon, lat]) => ({ lon, lat })),
  });
  const cases = [
    ["private mid-route", stretch([longRoute[1], longRoute[2]], { vehicle: "private" })],
    ["prohibited at the destination", stretch([longRoute[3], longRoute[4]], { vehicle: "no" })],
    ["wrong way at the destination", stretch([longRoute[4], longRoute[3]], { oneway: "yes" })],
  ];
  for (const [label, way] of cases) {
    fixtures(t, [trip(longRoute, 120)], [way]);
    const response = await GET(request({ start: longRoute[0].join(","), end: longRoute[4].join(",") }));
    assert.equal(response.status, 422, label);
    assert.match((await response.json()).error, /tratti vietati/);
  }
});

const over = (coordinates, surface, id) => ({
  id, tags: { highway: "residential", surface },
  geometry: coordinates.map(([lon, lat]) => ({ lon, lat })),
});
// The detour's connecting streets are known smooth, so only the surfaces under test differ.
const detourConnectors = [
  over([points[0], detour[1]], "asphalt", 900000010),
  over([detour[2], points[1]], "asphalt", 900000011),
];

test("a marginal base alternative does not stop the planner searching, but a strong one does", async (t) => {
  const ways = (surface) => [roughWay, ...detourConnectors, over(detour.slice(1, 3), surface, 900000005)];
  // Same raw pave as the fastest route, with lower weighted risk: the shape of a -33 m "alternative".
  const marginal = fixtures(t, [trip(points, 600), trip(detour, 650)], ways("paving_stones"));
  assert.equal((await GET(request({ maxExtraMinutes: "5" }))).status, 200);
  assert.ok(marginal.length > 1, "the planner must keep looking after a marginal gain");

  const strong = fixtures(t, [trip(points, 600), trip(detour, 650)], ways("asphalt"));
  assert.equal((await GET(request({ maxExtraMinutes: "5" }))).status, 200);
  assert.equal(strong.length, 1, "a strong alternative needs no further provider calls");

  const navigation = fixtures(t, [trip(points, 600), trip(detour, 650)], ways("paving_stones"));
  assert.equal((await GET(request({ maxExtraMinutes: "5", navigation: "1" }))).status, 200);
  assert.equal(navigation.length, 1, "a reroute must stay fast");
});

test("unpaved surfaces count as route risk without triggering extra provider calls", async (t) => {
  const select = async (ways) => {
    fixtures(t, [trip(points, 600), trip(detour, 650)], [...detourConnectors, ...ways]);
    return (await GET(request({ maxExtraMinutes: "5", navigation: "1" }))).json();
  };

  // About 200 m of sett against about 300 m of gravel (weight 0.7), the rest known smooth.
  const gravelAgainstSett = await select([
    over([points[0], [9.2926, 45.53]], "sett", 900000006),
    over([[9.2926, 45.53], points[1]], "asphalt", 900000007),
    over([detour[1], [9.2938, 45.531]], "gravel", 900000008),
    over([[9.2938, 45.531], detour[2]], "asphalt", 900000009),
  ]);
  assert.equal(gravelAgainstSett.hasDistinctAlternative, false, "gravel must not beat less stone");

  const compactedAgainstSett = await select([
    over(points, "sett", 900000006),
    over(detour.slice(1, 3), "compacted", 900000008),
  ]);
  assert.equal(compactedAgainstSett.hasDistinctAlternative, true);
  const detourDiagnostics = compactedAgainstSett.candidateDiagnostics.find((candidate) => candidate.distinctFromFast);
  assert.equal(detourDiagnostics.weightedPaveMeters, 0, "the stone metric stays stone only");
  assert.ok(detourDiagnostics.riskMeters > 0);

  const unpavedOnly = fixtures(t, [trip(points, 600)], [over(points, "gravel", 900000012)]);
  const data = await (await GET(request({ maxExtraMinutes: "5" }))).json();
  assert.ok(data.fast.unpavedSurfaceMeters > 300);
  assert.equal(data.fast.paveMeters, 0);
  assert.equal(unpavedOnly.length, 1, "unpaved roads alone must not generate more provider calls");
});
