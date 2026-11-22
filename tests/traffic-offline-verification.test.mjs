import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import { mockRoadWays } from "./helpers/road-fixtures.mjs";
import { encodeMvt, fakeTransport, flowTile, incidentTile } from "./helpers/traffic-fixtures.mjs";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import { addFlowTile, createFlowIndex, routeTraffic, CLOSURE_PENALTY_SECONDS } from "../lib/traffic/flow.ts";
import { setTrafficTransport } from "../lib/traffic/client.ts";
import { distanceMeters, tileForCoordinate } from "../lib/traffic/tiles.ts";
import { DEFAULT_TRAFFIC_CAPS } from "../lib/traffic/quota.ts";
import { FLOW_TTL_MS, MemoryLedgerStorage, TrafficHub } from "../worker/traffic-hub.ts";

/**
 * Offline verification of the live-traffic layer for the audit reconciliation (21 November 2026). Everything here is a
 * fixture: flow and incident tiles are built by tests/helpers/traffic-fixtures.mjs, provider answers are either synthetic
 * Valhalla trips or the recorded public-junction responses of tests/fixtures/phase437. No request ever leaves the process,
 * and nothing here can reach TomTom. What these tests add to tests/traffic-{core,hub,route}.test.mjs:
 *  - the exact congestion level at which a statically faster route stops being the fastest (the ETA formula, pinned);
 *  - a Flow closure changes the ranking, an Incident-tile closure changes neither time nor ranking;
 *  - a ZTL / timed closure is never made legal by a free-flowing road;
 *  - what a stale or standing closure can and cannot do, and the wording around closures and incidents.
 * Live traffic together with "maximum" avoidance on recorded provider answers is in tests/traffic-maximum-interaction.test.mjs
 * (a separate file: this one mocks the road store with synthetic ways, which must not leak into runs on the real Milan tiles).
 */
const { GET } = await loadApi("app/api/routes/route.ts");
const root = new URL("../", import.meta.url);

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic corridor in the Milan periphery (no bundled ZTL or stone): A is statically faster (600 s), B slower (700 s).
// ---------------------------------------------------------------------------------------------------------------------
const routeA = [[9.288, 45.530], [9.291, 45.530], [9.294, 45.530], [9.297, 45.530]];
const routeB = [[9.288, 45.530], [9.288, 45.533], [9.297, 45.533], [9.297, 45.530]];
const STATIC_A = 600;
const STATIC_B = 700;

const asphaltWay = (id, coordinates, extraTags = {}) => ({
  id,
  tags: { highway: "residential", surface: "asphalt", name: `Via Test ${id}`, ...extraTags },
  geometry: coordinates.map(([lon, lat]) => ({ lon, lat })),
});
const valhallaTrip = (coordinates, time) => ({
  status: 0,
  summary: { length: 1, time },
  legs: [{
    shape: encodePolyline(coordinates),
    maneuvers: [
      { type: 1, instruction: "Parti", begin_shape_index: 0, length: 1 },
      { type: 4, instruction: "Arrivo", begin_shape_index: coordinates.length - 1, length: 0 },
    ],
  }],
});

/** One flow tile holding the lines of several routes (each with its own level / closure), as the provider would send them. */
function flowFor(tile, specs) {
  const layers = specs.map(({ coords, levelAt, closedAt }) => decodeMvt(flowTile(tile, coords, levelAt, { closedAt })).layers["Traffic flow"]).filter(Boolean);
  return encodeMvt({
    layers: [{ name: "Traffic flow", features: layers.flatMap((layer) => layer.features.map((f) => ({ type: 2, parts: f.parts, properties: f.properties }))) }],
  });
}

let fakeNow = Date.now();
/** The routing provider answers with the given trips (the first is the primary, the others are alternates); anything else is a bug. */
function mockProvider(t, trips, ways = [asphaltWay(910001, routeA), asphaltWay(910002, routeB)]) {
  fakeNow += 100_000; // a fresh provider-answer memo window for every calculation
  t.mock.method(Date, "now", () => fakeNow);
  mockRoadWays(t, ways);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    fakeNow += 50;
    requests.push({ url: String(url), body: init?.body ?? null });
    assert.match(String(url), /valhalla/, "unexpected external call");
    return Response.json({ trip: trips[0], alternates: trips.slice(1).map((trip) => ({ trip })) });
  });
  return requests;
}
const corridorRequest = (extra = {}) => new NextRequest(`http://localhost/api/routes?${new URLSearchParams({
  start: routeA[0].join(","), end: routeA.at(-1).join(","), mode: "car", avoid: "strong", traffic: "live", ...extra,
})}`);
const seconds = (route) => Math.round(route.minutes * 60);

// ---------------------------------------------------------------------------------------------------------------------
test("congestion changes the ranking exactly where the ETA formula says: a statically faster route keeps its place in light traffic and loses it in heavy", async (t) => {
  t.after(() => setTrafficTransport(null));
  // ETA of a fully covered route at relative speed r is static / r, so A (600 s) falls behind B (700 s) below r = 600/700 = 0.857.
  for (const [level, winner, etaA] of [[1.0, "A", 600], [0.9, "A", 667], [0.88, "A", 682], [0.84, "B", 714], [0.25, "B", 2400]]) {
    mockProvider(t, [valhallaTrip(routeA, STATIC_A), valhallaTrip(routeB, STATIC_B)]);
    setTrafficTransport(fakeTransport({ flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => level }, { coords: routeB, levelAt: () => 1 }]) }));
    const payload = await (await GET(corridorRequest())).json();
    assert.equal(payload.traffic.status, "live", `level ${level}`);
    if (winner === "A") {
      assert.ok(Math.abs(seconds(payload.fast) - etaA) <= 3, `level ${level}: A ${seconds(payload.fast)} s, expected about ${etaA}`);
      assert.equal(payload.fast.traffic.delaySeconds > 0 || level === 1, true);
    } else {
      assert.equal(seconds(payload.fast), STATIC_B, `level ${level}: the free-flowing B is the fastest`);
      assert.equal(payload.fast.traffic.delaySeconds, 0);
      assert.equal(payload.antiPave.standard.seconds >= etaA - 3, true, `level ${level}: the provider's own route is shown with its live time (${payload.antiPave.standard.seconds} s)`);
      assert.ok(payload.traffic.savedVsStandardSeconds >= 1, "the card says what the switch saves");
    }
  }
});

test("a Flow closure costs a car 900 s and moves the ranking; an Incident-tile closure changes neither the time nor the ranking and is only listed", async (t) => {
  t.after(() => setTrafficTransport(null));
  const closedA = (point) => distanceMeters(point, routeA[1]) < 400;

  // 1. Flow closure on A (free flow elsewhere): the penalty is added once, A drops behind B.
  mockProvider(t, [valhallaTrip(routeA, STATIC_A), valhallaTrip(routeB, STATIC_B)]);
  setTrafficTransport(fakeTransport({ flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => 1, closedAt: closedA }, { coords: routeB, levelAt: () => 1 }]) }));
  const flowClosure = await (await GET(corridorRequest())).json();
  assert.equal(seconds(flowClosure.fast), STATIC_B, "the route with a closed stretch is not the fastest");
  assert.equal(flowClosure.antiPave.standard.seconds > STATIC_A + CLOSURE_PENALTY_SECONDS, true, "its live time carries the penalty");

  // 2. The same closure reported only by the incident tile (category 8): nothing moves, the incident is listed on the route.
  mockProvider(t, [valhallaTrip(routeA, STATIC_A), valhallaTrip(routeB, STATIC_B)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => 1 }, { coords: routeB, levelAt: () => 1 }]),
    incidents: (tile) => incidentTile(tile, [{ at: routeA[1], category: 8, magnitude: 4, delay: 0, description: "Chiusura (fixture)" }]),
  }));
  const incident = await (await GET(corridorRequest())).json();
  assert.equal(seconds(incident.fast), STATIC_A, "an incident-tile closure does not change the time");
  assert.equal(incident.fast.traffic.delaySeconds, 0);
  assert.equal(incident.fast.traffic.closedMeters, 0, "only the Flow layer can mark a stretch closed, so no 'closed by the provider' warning is raised");
  assert.deepEqual(incident.fast.traffic.incidents.map((entry) => entry.category), ["road-closed"], "it is listed as information");
  assert.equal(incident.traffic.search.slices, 0, "and it is not a slice for the penalised search");

  // 3. Bicycles do not feel motor traffic: the closure is shown, no time is added.
  mockProvider(t, [valhallaTrip(routeA, STATIC_A), valhallaTrip(routeB, STATIC_B)]);
  setTrafficTransport(fakeTransport({ flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => 1, closedAt: closedA }, { coords: routeB, levelAt: () => 1 }]) }));
  const bicycle = await (await GET(corridorRequest({ mode: "bicycle" }))).json();
  assert.equal(bicycle.fast.traffic.delaySeconds, 0);
  assert.equal(bicycle.fast.traffic.closedMeters > 0, true, "the closure is still reported");
});

test("a route that is illegal at the departure time never wins because it is free-flowing", async (t) => {
  t.after(() => setTrafficTransport(null));
  // A is free-flowing but closed to motor vehicles at 12:00 on a weekday; B is legal and heavily congested.
  const ways = [asphaltWay(910003, routeA, { "motor_vehicle:conditional": "no @ (08:00-18:00)" }), asphaltWay(910004, routeB)];
  mockProvider(t, [valhallaTrip(routeA, STATIC_A), valhallaTrip(routeB, STATIC_B)], ways);
  setTrafficTransport(fakeTransport({ flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => 1 }, { coords: routeB, levelAt: () => 0.25 }]) }));
  const payload = await (await GET(corridorRequest({ departure: "2026-11-09T12:00" }))).json();
  assert.equal(payload.traffic.status, "live");
  assert.ok(payload.fast.traffic.delaySeconds > 600, "the legal route carries its heavy delay");
  assert.equal(payload.candidateDiagnostics.some((entry) => entry.source === "base-1"), false, "the restricted route is not even a candidate");
  assert.equal(payload.candidateDiagnostics.every((entry) => entry.eligibleModeAndAccess === true), true);
  assert.equal(payload.fast.distance, payload.safe.distance);
});

// ---------------------------------------------------------------------------------------------------------------------
// Stale and standing closures: what protects the person, in code, and what does not.
// ---------------------------------------------------------------------------------------------------------------------
test("a closure is a penalty, not an exclusion: counted once per route, gone with the tile, and it never makes a route unavailable", () => {
  const tile = tileForCoordinate(routeA[1], 14);
  const flow = (closedAt) => {
    const index = createFlowIndex();
    addFlowTile(index, tile, flowTile(tile, routeA, () => 1, { closedAt }));
    return routeTraffic(index, routeA, STATIC_A, "car");
  };
  const one = flow((point) => distanceMeters(point, routeA[1]) < 150);
  const two = flow((point) => distanceMeters(point, routeA[1]) < 150 || distanceMeters(point, routeA[3]) < 150);
  assert.equal(one.closedMeters > 0 && two.closedMeters > one.closedMeters, true);
  // Closed stretches are read at a tenth of free speed (nine times the stretch's own time as delay); the fixed 900 s penalty is
  // added once, whatever the number of closures. So the second closure adds only its own stretch time, never another 900 s.
  const extraClosedMeters = two.closedMeters - one.closedMeters;
  const stretchDelay = (STATIC_A * extraClosedMeters * 9) / one.totalMeters;
  assert.ok(Math.abs((two.delaySeconds - one.delaySeconds) - stretchDelay) <= stretchDelay * 0.06, `second closure adds ${Math.round(two.delaySeconds - one.delaySeconds)} s, its stretch accounts for ${Math.round(stretchDelay)} s`);
  assert.ok(one.delaySeconds >= CLOSURE_PENALTY_SECONDS, "the first closure carries the 900 s penalty");
  // The next tile no longer reports it (the provider reopened the road): nothing is remembered.
  const reopened = flow(() => false);
  assert.equal(reopened.closedMeters, 0);
  assert.equal(reopened.delaySeconds, 0);
  assert.equal(reopened.congestedSlices.length, 0);
});

test("a closure cannot outlive its tile: after the TTL the tile is refetched, and a failing provider yields no traffic instead of the old closure", async () => {
  const tile = tileForCoordinate(routeA[1], 14);
  const closedTile = flowTile(tile, routeA, () => 1, { closedAt: () => true });
  const reopenedTile = flowTile(tile, routeA, () => 1);
  const clock = { now: Date.UTC(2026, 10, 21, 10, 0, 0) };
  let answer = () => new Response(closedTile, { status: 200 });
  const hub = new TrafficHub({ storage: new MemoryLedgerStorage(), key: "test-key-never-real", now: () => clock.now, caps: DEFAULT_TRAFFIC_CAPS, fetch: async () => answer() });
  const closedAt = (result) => {
    const index = createFlowIndex();
    addFlowTile(index, tile, result.bytes);
    return routeTraffic(index, routeA, STATIC_A, "car").closedMeters;
  };

  const first = await hub.tile("flow", tile.z, tile.x, tile.y, "route");
  assert.equal(first.ok && closedAt(first) > 0, true, "the closure is in the first tile");
  clock.now += FLOW_TTL_MS - 1_000;
  const cached = await hub.tile("flow", tile.z, tile.x, tile.y, "route");
  assert.equal(cached.ok && cached.cached, true, "inside the TTL the same tile is reused");

  // Past the TTL the provider reopened the road: the new tile has no closure and the old one is gone.
  clock.now += 2_000;
  answer = () => new Response(reopenedTile, { status: 200 });
  const refreshed = await hub.tile("flow", tile.z, tile.x, tile.y, "route");
  assert.equal(refreshed.ok && !refreshed.cached && closedAt(refreshed) === 0, true);

  // Past the TTL again with the provider failing: no stale tile is served, so no stale closure either (the caller keeps static times).
  clock.now += FLOW_TTL_MS + 1;
  answer = () => new Response("down", { status: 502 });
  const failed = await hub.tile("flow", tile.z, tile.x, tile.y, "route");
  assert.deepEqual(failed, { ok: false, reason: "provider-failing" });
});

test("when the closed route is the only route the person still gets it, with the delay and the closure shown", async (t) => {
  t.after(() => setTrafficTransport(null));
  mockProvider(t, [valhallaTrip(routeA, STATIC_A)]);
  setTrafficTransport(fakeTransport({ flow: (tile) => flowFor(tile, [{ coords: routeA, levelAt: () => 1, closedAt: (point) => distanceMeters(point, routeA[1]) < 400 }]) }));
  const payload = await (await GET(corridorRequest())).json();
  assert.equal(payload.fast.traffic.closedMeters > 0, true);
  assert.ok(seconds(payload.fast) >= STATIC_A + CLOSURE_PENALTY_SECONDS, "the 900 s penalty is in the time shown");
  assert.equal(payload.fast.coordinates.length > 1, true, "a route is returned: the provider's closure flag never blocks navigation");
});

test("the wording never presents an incident as closure avoidance, and a provider closure is a thing to verify on site", async () => {
  const panel = await readFile(new URL("components/TrafficPanel.tsx", root), "utf8");
  const handler = await readFile(new URL("app/api/routes/route.ts", root), "utf8");
  for (const [name, text] of [["panel", panel], ["handler", handler]]) {
    assert.doesNotMatch(text, /evit\w*\s+(le\s+)?(chiusur|incident)|aggir\w*\s+(le\s+)?(chiusur|incident)/i, `${name} promises to avoid closures or incidents`);
  }
  assert.match(panel, /segnalato chiuso dal provider[^"`]*verifica sul posto/, "a closure is shown with the instruction to verify it");
});
