import assert from "node:assert/strict";
import test from "node:test";
import { decodeMvt, MvtError } from "../lib/traffic/mvt.ts";
import { tileForCoordinate, tilePointToCoordinate, tilesAlongRoute, distanceMeters } from "../lib/traffic/tiles.ts";
import { addFlowTile, createFlowIndex, matchRouteToFlow, routeTraffic, routeTrafficFromSamples, TRAFFIC_DELAY_SHARE, CLOSURE_PENALTY_SECONDS } from "../lib/traffic/flow.ts";
import { dedupeIncidents, incidentsNearRoute, parseIncidentTile } from "../lib/traffic/incidents.ts";
import { TrafficSession } from "../lib/traffic/session.ts";
import { encodeMvt, fakeTransport, flowTile, incidentTile, toTilePixel } from "./helpers/traffic-fixtures.mjs";

/**
 * Live-traffic core. Every tile here is a TEST FIXTURE shaped like TomTom's documented vector tiles
 * (tests/helpers/traffic-fixtures.mjs); the provider itself is not called.
 */

// A straight 2 km route heading east along Milan's latitude, a vertex every 50 m.
const LAT = 45.4642;
const metersPerDegree = 111_320 * Math.cos((LAT * Math.PI) / 180);
const route = Array.from({ length: 41 }, (_, i) => [9.19 + (i * 50) / metersPerDegree, LAT]);
const routeLength = distanceMeters(route[0], route.at(-1));
const along = ([lon]) => (lon - 9.19) * metersPerDegree;

function indexFor(levelAt, options) {
  const index = createFlowIndex();
  for (const tile of tilesAlongRoute(route, 14, 300)) addFlowTile(index, tile, flowTile(tile, route, levelAt, options));
  return index;
}

test("the vector tile reader decodes layers, lines, points and typed properties, and refuses broken bytes", () => {
  const tile = { z: 14, x: 8744, y: 5693 };
  const bytes = encodeMvt({
    layers: [{
      name: "Traffic flow",
      features: [
        { type: 2, parts: [[[0, 0], [100, -50], [100, 400]], [[10, 10], [20, 30]]], properties: { road_type: "Major road", traffic_level: 0.42, road_closure: true } },
        { type: 1, parts: [[[7, 9]], [[70, 90]]], properties: { magnitude: 3 } },
      ],
    }],
  });
  const layer = decodeMvt(bytes).layers["Traffic flow"];
  assert.equal(layer.extent, 4096);
  assert.deepEqual(layer.features[0].parts, [[[0, 0], [100, -50], [100, 400]], [[10, 10], [20, 30]]]);
  assert.deepEqual(layer.features[0].properties, { road_type: "Major road", traffic_level: 0.42, road_closure: true });
  assert.deepEqual(layer.features[1].parts, [[[7, 9]], [[70, 90]]]);
  assert.equal(tilePointToCoordinate(tile, 0, 0, 4096)[0] < tilePointToCoordinate(tile, 4096, 0, 4096)[0], true);
  assert.throws(() => decodeMvt(bytes.subarray(0, bytes.length - 9)), MvtError, "a truncated tile is an error, not a partial tile");
  assert.deepEqual(decodeMvt(new Uint8Array()).layers, {}, "an empty answer is an empty tile");
});

test("tile maths round-trips and a route is covered by the tiles it crosses, margins included", () => {
  const point = [9.19, 45.4642];
  const tile = tileForCoordinate(point, 14);
  const [px, py] = toTilePixel(tile, point);
  const back = tilePointToCoordinate(tile, px, py, 4096);
  assert.ok(distanceMeters(point, back) < 0.5, "pixel round trip");
  const tiles = tilesAlongRoute(route, 14, 300);
  assert.ok(tiles.length >= 2 && tiles.length <= 4, `${tiles.length} tiles for 2 km at z14`);
  assert.equal(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size, tiles.length, "no duplicates");
  assert.ok(tilesAlongRoute(route, 12, 1_200).length <= tiles.length, "a coarser zoom never needs more tiles");
});

test("flow is matched along the direction of travel: the middle of the route is slow, the rest is not described", () => {
  const index = indexFor((p) => (along(p) > 800 && along(p) < 1_400 ? 0.3 : null));
  const samples = matchRouteToFlow(index, route);
  const slow = samples.filter((s) => s.ratio === 0.3);
  const unknown = samples.filter((s) => s.ratio === null);
  assert.ok(slow.length > 25 && slow.length < 40, `${slow.length} slow samples (600 m at 20 m)`);
  assert.equal(slow.length + unknown.length, samples.length, "a stretch the tiles do not describe is null, never free flow");
  // The opposite carriageway's data is not this route's traffic.
  const opposite = indexFor(() => 0.2, { reverse: true });
  assert.ok(matchRouteToFlow(opposite, route).every((s) => s.ratio === null), "reversed lines never match");
});

test("traffic-aware time: cars feel all the delay, motorcycles half, bicycles none; coverage is reported, not assumed", () => {
  const index = indexFor((p) => (along(p) > 800 && along(p) < 1_400 ? 0.5 : 1));
  const free = 240;
  const car = routeTraffic(index, route, free, "car");
  // 600 m of 2000 m at half speed: the covered third of the time doubles.
  assert.ok(Math.abs(car.trafficSeconds - (free + free * (600 / routeLength))) < 6, `car ${car.trafficSeconds.toFixed(1)} s`);
  assert.ok(car.coveragePercent > 99, "described all the way");
  const moto = routeTraffic(index, route, free, "motorcycle");
  assert.ok(Math.abs(moto.delaySeconds - car.delaySeconds * TRAFFIC_DELAY_SHARE.motorcycle) < 1, "half the delay");
  const bike = routeTraffic(index, route, free, "bicycle");
  assert.equal(bike.trafficSeconds, free, "a queue of cars does not slow a bicycle");
  assert.equal(bike.delaySeconds, 0);
  const partial = routeTraffic(indexFor((p) => (along(p) < 1_000 ? 0.5 : null)), route, free, "car");
  assert.ok(partial.coveragePercent > 45 && partial.coveragePercent < 55, `coverage ${partial.coveragePercent}`);
  assert.ok(Math.abs(partial.trafficSeconds - (free + free * (1_000 / routeLength))) < 6, "undescribed stretches keep the provider time");
  const nothing = routeTraffic(createFlowIndex(), route, free, "car");
  assert.equal(nothing.coveragePercent, 0);
  assert.equal(nothing.trafficSeconds, free);
  assert.equal(nothing.minRatio, null);
});

test("a standstill is capped, flow faster than free never speeds the route up, and a closure adds a penalty for motor traffic", () => {
  const stopped = routeTraffic(indexFor(() => 0), route, 100, "car");
  assert.ok(Math.abs(stopped.trafficSeconds - 1000) < 2, "ratio floor of a tenth: ten times the time at most");
  const fast = routeTraffic(indexFor(() => 1), route, 100, "car");
  assert.ok(Math.abs(fast.trafficSeconds - 100) < 0.5);
  const closed = routeTraffic(indexFor((p) => 1, { closedAt: (p) => along(p) > 500 && along(p) < 700 }), route, 100, "car");
  assert.ok(closed.closedMeters >= 180 && closed.closedMeters <= 220, `${closed.closedMeters} m closed`);
  assert.ok(closed.trafficSeconds >= 100 + CLOSURE_PENALTY_SECONDS, "selection will avoid the closed route");
  assert.equal(routeTraffic(indexFor((p) => 1, { closedAt: () => true }), route, 100, "bicycle").trafficSeconds, 100, "bicycle: a notice, no time effect");
});

test("congested stretches of 150 m or more become slices for the penalised search; short or fast ones do not", () => {
  const index = indexFor((p) => (along(p) > 400 && along(p) < 800 ? 0.4 : along(p) > 1_200 && along(p) < 1_280 ? 0.3 : 0.9));
  const result = routeTraffic(index, route, 200, "car");
  assert.equal(result.congestedSlices.length, 1, "the 80 m jam is too short to target");
  const slice = result.congestedSlices[0];
  assert.ok(along(slice[0]) >= 380 && along(slice.at(-1)) <= 820);
  assert.ok(result.congestedMeters >= 460 && result.congestedMeters <= 500, `${result.congestedMeters} m congested`);
  const samples = matchRouteToFlow(index, route);
  assert.equal(routeTrafficFromSamples(samples, 200, "bicycle").delayShare, 0);
});

test("incidents: categories and delays come from the tile, duplicates collapse, only those on the route are listed", () => {
  const tile = tileForCoordinate(route[20], 12);
  const onRoute = [route[10][0], route[10][1] + 5 / 110_540];
  const bytes = incidentTile(tile, [
    { at: onRoute, category: 1, magnitude: 3, delay: 300, description: "Incidente in corso" },
    { at: [onRoute[0] + 5 / metersPerDegree, onRoute[1]], category: 1, magnitude: 3, delay: 300, description: "Incidente in corso" },
    { at: [route[30][0], LAT + 400 / 110_540], category: 9, magnitude: 1, delay: 0, description: "Lavori" },
    { at: [route[35][0], LAT], category: 8, magnitude: 4, delay: 0, description: "Strada chiusa" },
  ]);
  const found = dedupeIncidents(parseIncidentTile(tile, bytes));
  assert.equal(found.length, 3, "the two reports of the same accident are one");
  const near = incidentsNearRoute(found, route);
  assert.deepEqual(near.map((i) => i.category), ["accident", "road-closed"], "the roadworks 400 m away are not on the route; order follows the route");
  assert.equal(near[0].delaySeconds, 300);
  assert.equal(near[1].magnitude, 4);
});

test("a session loads what the routes need within its request cap, and falls back as a whole on any failure", async () => {
  const transport = fakeTransport({ flow: (tile) => flowTile(tile, route, () => 0.5), incidents: (tile) => incidentTile(tile, []) });
  const session = new TrafficSession("car", { transport });
  assert.equal(session.available, false, "nothing loaded yet");
  await session.ensure([route]);
  assert.equal(session.available, true);
  const first = transport.calls.length;
  assert.ok(first >= 2 && first <= 8, `${first} tile requests for a 2 km route`);
  assert.ok(session.forRoute(route, 240).trafficSeconds > 400, "half speed all along");
  await session.ensure([route]);
  assert.equal(transport.calls.length, first, "a route already covered asks for nothing");
  assert.equal(session.meta().tileRequests, first);

  const failing = new TrafficSession("car", { transport: fakeTransport({ failWith: "quota-daily" }) });
  await failing.ensure([route]);
  assert.equal(failing.available, false);
  assert.equal(failing.unavailableReason, "quota-daily");
  const noTransport = new TrafficSession("car", { transport: null });
  await noTransport.ensure([route]);
  assert.equal(noTransport.unavailableReason, "no-binding");
  const broken = new TrafficSession("car", { transport: fakeTransport({ flow: () => Uint8Array.of(0x1a, 0xff, 0xff, 0x7f) }) });
  await broken.ensure([route]);
  assert.equal(broken.unavailableReason, "tile-unreadable", "an unreadable tile is never used as a partial answer");

  const capped = new TrafficSession("car", { maxRequests: 1, transport: fakeTransport({ flow: (tile) => flowTile(tile, route, () => 0.5) }) });
  await capped.ensure([route]);
  assert.equal(capped.available, false, "a calculation cannot exceed its tile cap");
  assert.equal(capped.unavailableReason, "calculation-cap");
});

test("a long journey is covered by coarser tiles instead of exceeding the cap", async () => {
  const long = Array.from({ length: 61 }, (_, i) => [9.19 - (i * 1_000) / metersPerDegree, LAT + i * 0.0006]); // about 60 km
  const transport = fakeTransport({ flow: (tile) => flowTile(tile, long, () => 0.8) });
  const session = new TrafficSession("car", { transport });
  await session.ensure([long]);
  assert.equal(session.available, true);
  assert.ok(transport.calls.length <= 24, `${transport.calls.length} requests`);
  assert.ok(session.meta().flowZoom <= 13, `flow zoom ${session.meta().flowZoom}`);
});
