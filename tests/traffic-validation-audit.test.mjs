import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import { mockRoadWays } from "./helpers/road-fixtures.mjs";
import { encodeMvt, fakeTransport, flowTile, incidentTile } from "./helpers/traffic-fixtures.mjs";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import {
  CLOSURE_PENALTY_SECONDS,
  addFlowTile,
  createFlowIndex,
  routeTraffic,
} from "../lib/traffic/flow.ts";
import { incidentsNearRoute, parseIncidentTile } from "../lib/traffic/incidents.ts";
import { setTrafficTransport } from "../lib/traffic/client.ts";
import { tileForCoordinate } from "../lib/traffic/tiles.ts";
import { FLOW_TTL_MS, SqlLedgerStorage, TrafficHub } from "../worker/traffic-hub.ts";

const { GET } = await loadApi("app/api/routes/route.ts");

// East-west test corridor in Milan periphery (clean of bundled ZTL/stone):
// South corridor (routeA, statically faster 600 s) and North corridor (routeB, statically slower 700 s).
const routeA = [
  [9.288, 45.530],
  [9.291, 45.530],
  [9.294, 45.530],
  [9.297, 45.530],
];
const routeB = [
  [9.288, 45.530],
  [9.288, 45.533],
  [9.297, 45.533],
  [9.297, 45.530],
];
const ztlStart = routeA[0];
const ztlEnd = routeA[routeA.length - 1];

const asphaltWay = (id, coords, extraTags = {}) => ({
  id,
  tags: { highway: "residential", surface: "asphalt", name: `Via Test ${id}`, ...extraTags },
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
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

function combineFlowTiles(tile, specs) {
  const layers = specs
    .map(({ coords, levelAt, closedAt }) =>
      decodeMvt(flowTile(tile, coords, levelAt, { closedAt })).layers["Traffic flow"])
    .filter(Boolean);
  return encodeMvt({
    layers: [{
      name: "Traffic flow",
      features: layers.flatMap((layer) => layer.features.map((f) => ({
        type: 2,
        parts: f.parts,
        properties: f.properties,
      }))),
    }],
  });
}

function createPersistentSqlStub() {
  const stateTable = new Map();
  const tilesTable = new Map();
  return {
    exec(query, ...bindings) {
      if (query.startsWith("CREATE TABLE")) return { toArray: () => [] };
      if (query.startsWith("SELECT v FROM traffic_state")) {
        const val = stateTable.get(String(bindings[0]));
        return { toArray: () => (val === undefined ? [] : [{ v: val }]) };
      }
      if (query.startsWith("INSERT INTO traffic_state")) {
        stateTable.set(String(bindings[0]), String(bindings[1]));
        return { toArray: () => [] };
      }
      if (query.startsWith("SELECT fetched_at, bytes FROM traffic_tiles")) {
        const row = tilesTable.get(String(bindings[0]));
        return { toArray: () => (row ? [row] : []) };
      }
      if (query.startsWith("INSERT INTO traffic_tiles")) {
        tilesTable.set(String(bindings[0]), { fetched_at: Number(bindings[1]), bytes: bindings[2] });
        return { toArray: () => [] };
      }
      if (query.startsWith("DELETE FROM traffic_tiles")) {
        const before = Number(bindings[0]);
        for (const [k, row] of tilesTable.entries()) {
          if (row.fetched_at < before) tilesTable.delete(k);
        }
        return { toArray: () => [] };
      }
      throw new Error(`Unsupported SQL in stub: ${query}`);
    },
  };
}

let fakeNow = Date.now();

function mockValhallaRoutes(t, routes, ways = [asphaltWay(910001, routeA), asphaltWay(910002, routeB)]) {
  fakeNow += 100_000;
  t.mock.method(Date, "now", () => fakeNow);
  mockRoadWays(t, ways);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    fakeNow += 50;
    requests.push({ url: String(url), body: init?.body ?? null });
    assert.match(String(url), /valhalla/, "unexpected live external call");
    return Response.json({
      trip: routes[0],
      alternates: routes.slice(1).map((item) => ({ trip: item })),
    });
  });
  return requests;
}

function routeRequest(extra = {}) {
  return new NextRequest(
    `http://localhost/api/routes?${new URLSearchParams({
      start: ztlStart.join(","),
      end: ztlEnd.join(","),
      mode: "car",
      avoid: "strong",
      traffic: "live",
      ...extra,
    })}`,
  );
}

test("TomTom Audit 1: MVT flow decode, geometry alignment, light vs heavy congestion ETA & ranking flip", async (t) => {
  t.after(() => setTrafficTransport(null));

  // Verify mode delay sharing directly via flow decoder + matcher
  const z14 = tileForCoordinate(routeA[1], 14);
  const heavyBytes = flowTile(z14, routeA, () => 0.25);
  const index = createFlowIndex();
  addFlowTile(index, z14, heavyBytes);
  const carTraffic = routeTraffic(index, routeA, 600, "car");
  const motoTraffic = routeTraffic(index, routeA, 600, "motorcycle");
  const bikeTraffic = routeTraffic(index, routeA, 600, "bicycle");
  assert.ok(carTraffic.coveragePercent > 80, `high coverage expected (got ${carTraffic.coveragePercent})`);
  assert.ok(carTraffic.delaySeconds > 600, `heavy congestion delay expected (got ${carTraffic.delaySeconds})`);
  assert.equal(Math.round(motoTraffic.delaySeconds), Math.round(carTraffic.delaySeconds * 0.5), "motorcycle receives 0.5x delay share");
  assert.equal(bikeTraffic.delaySeconds, 0, "bicycle ignores motor traffic delay");
  assert.ok(carTraffic.congestedSlices.length >= 1, "ratio 0.25 < 0.6 emits congestedSlice");

  // Case A: No traffic / free flow (level 1.0) -> statically faster routeA (600s = 10m) stays fast
  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [
      { coords: routeA, levelAt: () => 1.0 },
      { coords: routeB, levelAt: () => 1.0 },
    ]),
  }));
  const freeRes = await (await GET(routeRequest())).json();
  assert.equal(freeRes.traffic.status, "live");
  assert.equal(Math.round(freeRes.fast.minutes * 60), 600);
  assert.equal(freeRes.fast.traffic.delaySeconds, 0);

  // Case B: Light traffic on routeA (0.85) -> routeA slows to ~706s, above routeB 700s threshold! Wait test 0.90 (~667s) vs 700s so light keeps rank:
  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [
      { coords: routeA, levelAt: () => 0.90 },
      { coords: routeB, levelAt: () => 1.0 },
    ]),
  }));
  const lightRes = await (await GET(routeRequest())).json();
  assert.equal(lightRes.traffic.status, "live");
  assert.ok(lightRes.fast.traffic.delaySeconds > 40 && lightRes.fast.traffic.delaySeconds < 90,
    `light traffic increases ETA modestly (delay=${lightRes.fast.traffic.delaySeconds}s)`);
  assert.ok(lightRes.fast.minutes * 60 < 700, "routeA stays faster under light traffic");

  // Case C: Heavy traffic on routeA (0.25) -> ETA inflates heavily, flipping ranking so routeB (700s) wins `fast`
  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [
      { coords: routeA, levelAt: () => 0.25 },
      { coords: routeB, levelAt: () => 1.0 },
    ]),
  }));
  const heavyRes = await (await GET(routeRequest())).json();
  assert.equal(heavyRes.traffic.status, "live");
  assert.equal(Math.round(heavyRes.fast.minutes * 60), 700, "uncongested routeB wins fast over congested routeA");
  assert.equal(heavyRes.fast.traffic.delaySeconds, 0);
  assert.equal(heavyRes.traffic.search.attempted, false, "uncongested routeB already flipped fast so no extra traffic search needed");
});

test("TomTom Audit 2: Flow road_closure (+900s penalty & slice) vs Incident-tile road-closed (UI-only)", async (t) => {
  t.after(() => setTrafficTransport(null));

  // Direct Flow closure check: road_closure forces 0 speed ratio plus fixed CLOSURE_PENALTY_SECONDS (900 s)
  const z14 = tileForCoordinate(routeA[1], 14);
  const standstillIndex = createFlowIndex();
  addFlowTile(standstillIndex, z14, flowTile(z14, routeA, () => 0.0, { closedAt: () => false }));
  const standstillTraffic = routeTraffic(standstillIndex, routeA, 600, "car");

  const closedIndex = createFlowIndex();
  addFlowTile(closedIndex, z14, flowTile(z14, routeA, () => 1.0, { closedAt: () => true }));
  const closureTraffic = routeTraffic(closedIndex, routeA, 600, "car");
  assert.ok(closureTraffic.closedMeters > 400);
  assert.equal(
    Math.round(closureTraffic.delaySeconds - standstillTraffic.delaySeconds),
    CLOSURE_PENALTY_SECONDS,
    "Flow road_closure adds fixed 900s closure penalty on top of standstill delay",
  );
  assert.ok(closureTraffic.congestedSlices.length >= 1, "closed flow segment generates congested slice");

  // Incident-tile road-closed (category 8) with free-flowing Flow tiles: UI-only, zero ETA/ranking impact
  const z12 = tileForCoordinate(routeA[1], 12);
  const parsedInc = parseIncidentTile(z12, incidentTile(z12, [
    { at: routeA[1], category: 8, magnitude: 4, delay: 0, description: "Chiusura cantiere (test)" },
  ]));
  assert.equal(parsedInc[0].category, "road-closed");
  assert.equal(incidentsNearRoute(parsedInc, routeA).length, 1);

  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [
      { coords: routeA, levelAt: () => 1.0 },
      { coords: routeB, levelAt: () => 1.0 },
    ]),
    incidents: (tile) => incidentTile(tile, [
      { at: routeA[1], category: 8, magnitude: 4, delay: 0, description: "Chiusura cantiere (test)" },
    ]),
  }));
  const res = await (await GET(routeRequest())).json();
  assert.equal(res.traffic.status, "live");
  assert.equal(Math.round(res.fast.minutes * 60), 600, "incident-tile road-closed does NOT alter ETA or ranking");
  assert.equal(res.fast.traffic.delaySeconds, 0);
  assert.equal(res.fast.traffic.incidents[0].category, "road-closed");
});

test("TomTom Audit 3: ZTL / access restrictions stay non-negotiable under heavy traffic on the legal alternative", async (t) => {
  t.after(() => setTrafficTransport(null));

  const ztlWay = asphaltWay(910003, routeA, {
    "motor_vehicle:conditional": "no @ (08:00-18:00)",
  });
  const legalWay = asphaltWay(910004, routeB);

  // routeA is free-flow (600s) but ZTL/access-restricted at 12:00; routeB is legal with heavy congestion (level 0.25)
  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)], [ztlWay, legalWay]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [
      { coords: routeA, levelAt: () => 1.0 },
      { coords: routeB, levelAt: () => 0.25 },
    ]),
  }));

  const res = await (await GET(routeRequest({ departure: "2026-11-09T12:00" }))).json();
  assert.equal(res.traffic.status, "live");
  assert.ok(res.fast.traffic.delaySeconds > 600, `legal routeB carries heavy traffic delay (got ${res.fast.traffic?.delaySeconds}s)`);
  assert.equal(res.fast.distance, res.safe.distance);
  assert.equal(res.candidateDiagnostics.some((d) => d.source === "base-1"), false,
    "ZTL-restricted routeA is filtered out before selection regardless of free-flow speed");
  assert.equal(res.candidateDiagnostics.every((d) => d.eligibleModeAndAccess === true), true);
  assert.equal(res.candidateDiagnostics.some((d) => d.source === "base-2" && d.eligibleModeAndAccess === true), true,
    "legal routeB is selected even under heavy traffic");
});

test("TomTom Audit 4: Anti-pavé + congestion interaction stays within provider caps and falls back cleanly on outage", async (t) => {
  t.after(() => setTrafficTransport(null));

  // Sett street + heavy congestion -> stone & traffic factors sent together inside <= 4 nav / <= 7 planner requests
  const stoneWay = {
    id: 910005,
    tags: { highway: "residential", surface: "sett", name: "Via Pietra Test" },
    geometry: routeA.map(([lon, lat]) => ({ lon, lat })),
  };
  const requests = mockValhallaRoutes(t, [valhallaTrip(routeA, 600)], [stoneWay, asphaltWay(910006, routeB)]);
  setTrafficTransport(fakeTransport({
    flow: (tile) => combineFlowTiles(tile, [{ coords: routeA, levelAt: () => 0.25 }]),
  }));

  const combinedRes = await (await GET(routeRequest({ navigation: "1" }))).json();
  assert.equal(combinedRes.traffic.status, "live");
  assert.ok(requests.length <= 4, `navigation request cap respected (${requests.length})`);
  assert.ok(combinedRes.antiPave.search.attempted, "anti-pavé search ran alongside live traffic");

  // Traffic provider outage falls back silently to static Valhalla times (HTTP 200)
  mockValhallaRoutes(t, [valhallaTrip(routeA, 600), valhallaTrip(routeB, 700)]);
  setTrafficTransport(fakeTransport({ failWith: "provider-failing" }));
  const fallbackRes = await (await GET(routeRequest())).json();
  assert.equal(fallbackRes.traffic.status, "unavailable");
  assert.equal(fallbackRes.traffic.reason, "provider-failing");
  assert.equal(Math.round(fallbackRes.fast.minutes * 60), 600, "static provider ETA preserved cleanly");
  assert.equal(fallbackRes.fast.traffic, undefined);
});

test("TomTom Audit 5: Cache freshness, quota caps, SQL ledger restart persistence, and circuit-breaker recovery", async () => {
  const sql = createPersistentSqlStub();
  let now = Date.UTC(2026, 10, 20, 12, 0, 0);
  let upstreamStatus = 200;
  let upstreamFetches = 0;

  const makeHub = (caps) => new TrafficHub({
    storage: new SqlLedgerStorage(sql),
    key: "test-key-never-real",
    now: () => now,
    caps,
    fetch: async () => {
      upstreamFetches += 1;
      if (upstreamStatus !== 200) return new Response("err", { status: upstreamStatus });
      return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 });
    },
  });

  // 1. Cache freshness within FLOW_TTL_MS (90s) vs refresh past TTL, persisted across restart
  const hub1 = makeHub({ dailyTiles: 5, monthlyTiles: 8, dailyOverlayTiles: 2 });
  const first = await hub1.tile("flow", 14, 8611, 5862, "route");
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(upstreamFetches, 1);

  now += FLOW_TTL_MS - 5_000;
  const hub2Restarted = makeHub({ dailyTiles: 5, monthlyTiles: 8, dailyOverlayTiles: 2 });
  const cachedHit = await hub2Restarted.tile("flow", 14, 8611, 5862, "route");
  assert.equal(cachedHit.ok, true);
  assert.equal(cachedHit.cached, true);
  assert.equal(upstreamFetches, 1, "SQL-backed cache survives TrafficHub restart and saves quota");

  now += 10_000;
  const refreshed = await hub2Restarted.tile("flow", 14, 8611, 5862, "route");
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.cached, false);
  assert.equal(upstreamFetches, 2, "refreshes after FLOW_TTL_MS expires");

  // 2. Overlay cap (2) and daily cap (5) persist across restart
  const ov1 = await hub2Restarted.tile("flow", 14, 8612, 5862, "overlay");
  const ov2 = await hub2Restarted.tile("flow", 14, 8613, 5862, "overlay");
  assert.equal(ov1.ok, true);
  assert.equal(ov2.ok, true);
  const hub3Restarted = makeHub({ dailyTiles: 5, monthlyTiles: 8, dailyOverlayTiles: 2 });
  const ovDenied = await hub3Restarted.tile("flow", 14, 8614, 5862, "overlay");
  assert.deepEqual(ovDenied, { ok: false, reason: "quota-overlay" });

  // Remaining daily slot (1 left out of 5)
  const routeTileOk = await hub3Restarted.tile("flow", 14, 8615, 5862, "route");
  assert.equal(routeTileOk.ok, true);
  const dailyDenied = await hub3Restarted.tile("flow", 14, 8616, 5862, "route");
  assert.deepEqual(dailyDenied, { ok: false, reason: "quota-daily" });

  // 3. Advance to next day -> quota-monthly (8) cap enforces across restart, then fresh hub tests circuit breakers
  now += 24 * 60 * 60_000;
  const statusNextDay = hub3Restarted.status();
  assert.equal(statusNextDay.remainingToday, 5);
  assert.equal(statusNextDay.remainingThisMonth, 3);

  // Fresh SQL ledger to isolate breaker cooldown recovery cycles: 429 (15 min) & 3x 5xx (5 min) & 401 (6h)
  const breakerSql = createPersistentSqlStub();
  let bNow = Date.UTC(2026, 10, 20, 14, 0, 0);
  let bStatus = 502;
  const makeBreakerHub = () => new TrafficHub({
    storage: new SqlLedgerStorage(breakerSql),
    key: "test-key",
    now: () => bNow,
    caps: { dailyTiles: 100, monthlyTiles: 1000, dailyOverlayTiles: 50 },
    fetch: async () => bStatus === 200
      ? new Response(Uint8Array.from([9]), { status: 200 })
      : new Response("fail", { status: bStatus }),
  });

  const bh1 = makeBreakerHub();
  for (let i = 0; i < 3; i += 1) {
    const r = await bh1.tile("flow", 14, 100 + i, 200, "route");
    assert.deepEqual(r, { ok: false, reason: "provider-failing" });
  }
  const bh2 = makeBreakerHub();
  assert.equal(bh2.status().available, false);
  assert.equal(bh2.status().reason, "provider-failing");

  // Past 5-minute breaker cooldown + healthy upstream -> recovers cleanly
  bNow += 5 * 60_000 + 1;
  bStatus = 200;
  const recovered5xx = await bh2.tile("flow", 14, 150, 200, "route");
  assert.equal(recovered5xx.ok, true);
  assert.equal(bh2.status().available, true);
  assert.equal(bh2.status().reason, "ok");

  // 429 opens 15-minute cooldown; persists across restart and recovers after 15m
  bStatus = 429;
  assert.deepEqual(await bh2.tile("flow", 14, 151, 200, "route"), { ok: false, reason: "provider-limit" });
  const bh3 = makeBreakerHub();
  assert.equal(bh3.status().reason, "provider-limit");
  bNow += 15 * 60_000 + 1;
  bStatus = 200;
  assert.equal((await bh3.tile("flow", 14, 152, 200, "route")).ok, true);
  assert.equal(bh3.status().available, true);

  // 401 opens 6-hour key-rejected breaker and recovers after 6h
  bStatus = 401;
  assert.deepEqual(await bh3.tile("flow", 14, 153, 200, "route"), { ok: false, reason: "key-rejected" });
  assert.equal(makeBreakerHub().status().reason, "key-rejected");
  bNow += 6 * 60 * 60_000 + 1;
  bStatus = 200;
  assert.equal((await makeBreakerHub().tile("flow", 14, 154, 200, "route")).ok, true);
});
