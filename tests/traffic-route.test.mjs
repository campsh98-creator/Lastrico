import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { setTrafficTransport } from "../lib/traffic/client.ts";
import { distanceMeters } from "../lib/traffic/tiles.ts";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import { normalizeValhallaResponse } from "../lib/routing-providers.ts";
import { encodeMvt, fakeTransport, flowTile, incidentTile } from "./helpers/traffic-fixtures.mjs";

/**
 * Live traffic through the whole route handler. Provider answers are the recorded FOSSGIS responses of
 * tests/fixtures/region (no network); a request without a recording (the penalised searches traffic adds) is answered
 * with the journey's recorded base route, so only the plumbing is exercised there. Traffic tiles are FIXTURES
 * (tests/helpers/traffic-fixtures.mjs), never live data.
 */
const root = new URL("../", import.meta.url);
const { journeys } = JSON.parse(await readFile(new URL("tests/fixtures/region/journeys.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");
const journey = (id) => journeys.find((entry) => entry.id === id);

async function recorded(request) {
  try {
    return JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/region/provider/${sha256(JSON.stringify(request))}.json.gz`, root))));
  } catch {
    return null;
  }
}

const fallbacks = new Map();
/** The journey's recorded base answer: served for a request that was never recorded (a traffic-penalised search). */
function fallbackFor(entry) {
  if (!fallbacks.has(entry.id)) fallbacks.set(entry.id, baseRequestOf(entry).then((request) => recorded(request)));
  return fallbacks.get(entry.id);
}

/** The first request the handler makes for a journey (the base request with alternates), captured with a failing provider. */
async function baseRequestOf(entry) {
  const probe = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { probe.push({ url: String(url), method: init.method ?? "GET", body: init.body ?? null }); return new Response("{}", { status: 500 }); };
  try {
    const params = new URLSearchParams({ start: entry.start, end: entry.end, mode: "car", avoid: "strong", departure: "2026-11-09T12:00" });
    await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  } finally {
    globalThis.fetch = nativeFetch;
  }
  return probe[0];
}

// One provider stub for the whole file: its identity keeps the provider-answer memo alive between calculations, so a
// recalculation pays only for the requests it has not made before (the stub records what really reached it).
const current = { requests: [] };
const sharedFetch = async (url, init = {}) => {
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  current.requests.push(request);
  const found = (await recorded(request)) ?? (await currentFallback);
  return new Response(found.body, { status: found.status, headers: { "Content-Type": "application/json" } });
};
let currentFallback = null;

/** One calculation with the given traffic transport; `requests` are the routing-provider requests that really went out. */
async function calculate(entry, { mode = "car", extra = {}, transport = null } = {}) {
  currentFallback = await fallbackFor(entry);
  const nativeFetch = globalThis.fetch;
  current.requests = [];
  globalThis.fetch = sharedFetch;
  setTrafficTransport(transport);
  try {
    const params = new URLSearchParams({ start: entry.start, end: entry.end, mode, avoid: "strong", departure: "2026-11-09T12:00", ...extra });
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests: current.requests };
  } finally {
    globalThis.fetch = nativeFetch;
    setTrafficTransport(null);
  }
}

// What a recalculation legitimately differs in: wall-clock timings, the traffic block, and how many requests it really sent.
const strip = ({ performance, traffic, antiPave, ...rest }) => ({ ...rest, antiPave: { ...antiPave, search: { ...antiPave.search, providerRequests: 0 } } });
const slowAround = (center, radius, level = 0.35) => (point) => (distanceMeters(point, center) < radius ? level : 0.95);

test("traffic off: the payload has no traffic block and a repeated request is answered from the memo with no provider request", async () => {
  const entry = journey("milan-inside");
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    const found = await recorded(request);
    if (!found) return new Response("{}", { status: 500 });
    return new Response(found.body, { status: found.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ start: entry.start, end: entry.end, mode: "car", avoid: "strong", departure: "2026-11-09T12:00" });
    const first = await (await GET(new NextRequest(`http://localhost/api/routes?${params}`))).json();
    const used = requests.length;
    assert.ok(used >= 1 && used <= 7, `${used} provider requests`);
    assert.equal("traffic" in first, false, "traffic was not requested: no traffic key at all");
    assert.equal("traffic" in first.fast, false);
    const again = await (await GET(new NextRequest(`http://localhost/api/routes?${params}`))).json();
    assert.equal(requests.length, used, "the same journey a moment later costs no provider request");
    assert.deepEqual(strip(again), strip(first), "the memoised answer gives the identical result");
    // Another avoidance level: the base request is the same, so it is memoised too.
    params.set("avoid", "balanced");
    await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    assert.ok(requests.length - used <= used - 1, "a new avoidance level reuses at least the base answer");
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

/** The routes the recorded base answer holds (the provider's primary and its alternates), with their geometry. */
async function baseRoutesOf(entry) {
  return normalizeValhallaResponse(JSON.parse((await fallbackFor(entry)).body), "car");
}
const consistent = (route) => Math.abs(route.minutes - (route.traffic.freeMinutes + route.traffic.delaySeconds / 60)) < 0.03;
const factorCounts = (requests) => requests.map((r) => (r.body ? JSON.parse(r.body).linear_cost_factors?.length ?? 0 : 0));

test("car, a jam on the provider's own route: the live ETA is longer, the alternative that now wins is shown with what it saves", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  assert.equal(baseline.status, 200);
  const coords = baseline.payload.fast.coordinates;
  const centre = coords[Math.floor(coords.length / 2)];
  const transport = fakeTransport({ flow: (tile) => flowTile(tile, coords, slowAround(centre, 350)) });
  const live = await calculate(entry, { extra: { traffic: "live" }, transport });
  assert.equal(live.status, 200);
  const { traffic } = live.payload;
  assert.equal(traffic.status, "live");
  assert.equal(traffic.provider, "TomTom");
  assert.equal(traffic.mode, "car");
  assert.equal(traffic.delayShare, 1);
  assert.ok(traffic.ageSeconds >= 15 && traffic.ageSeconds < 120, `age ${traffic.ageSeconds}`);
  assert.ok(new Date(traffic.fetchedAt).getTime() < Date.now());
  // The provider's standard route is slowed by the jam (it was 797 s)...
  assert.ok(live.payload.antiPave.standard.seconds > baseline.payload.antiPave.standard.seconds + 300, `standard ${baseline.payload.antiPave.standard.seconds} -> ${live.payload.antiPave.standard.seconds} s`);
  // ...so another provider route is now the fastest, and the card says how much it saves with the same live traffic on both.
  assert.notDeepEqual(live.payload.fast.coordinates, coords, "the jammed route is not the fastest any more");
  assert.ok(traffic.savedVsStandardSeconds >= 60, `saves ${traffic.savedVsStandardSeconds} s`);
  assert.equal(live.payload.antiPave.standard.seconds - traffic.savedVsStandardSeconds, Math.round(live.payload.fast.minutes * 60));
  for (const route of [live.payload.fast, live.payload.safe]) {
    assert.ok(route.traffic.delaySeconds > 0 && route.traffic.coveragePercent > 0 && route.traffic.coveragePercent < 100);
    assert.ok(consistent(route), "the minutes shown are the static time plus the measured delay");
  }
  assert.ok(live.requests.length <= 7 && transport.calls.length <= 24 && transport.calls.every((call) => call.purpose === "route"));
});

test("car, mild traffic on every route: delays and coverage are reported, an incident on the route is listed", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  const coords = baseline.payload.fast.coordinates;
  const transport = fakeTransport({
    flow: (tile) => flowTile(tile, coords, () => 0.9),
    incidents: (tile) => incidentTile(tile, [{ at: coords[Math.floor(coords.length / 3)], category: 1, magnitude: 3, delay: 240, description: "Incidente (fixture)" }]),
  });
  const live = await calculate(entry, { extra: { traffic: "live" }, transport });
  const fast = live.payload.fast;
  assert.ok(fast.traffic.coveragePercent > 90, `coverage ${fast.traffic.coveragePercent}`);
  assert.ok(fast.traffic.delaySeconds > 30 && fast.traffic.delaySeconds < 150, `delay ${fast.traffic.delaySeconds}`);
  assert.ok(consistent(fast));
  assert.equal(fast.traffic.slowestSpeedPercent, 90);
  assert.deepEqual(fast.coordinates, coords, "no congestion to avoid: the same route as without traffic");
  assert.equal(fast.traffic.incidents.some((incident) => incident.category === "accident" && incident.delaySeconds === 240 && incident.description.includes("fixture")), true);
  assert.equal(live.payload.traffic.search.slices, 0, "nothing below 60 % of free flow");
  assert.ok(live.requests.length <= 7);
});

test("car, congestion on the route being refined is penalised in the same provider request as the stone", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  const [primary, alternate] = await baseRoutesOf(entry);
  const centre = primary.coordinates[Math.floor(primary.coordinates.length / 2)];
  // The primary route has a jam in the middle; its alternate is slowed all along, so the primary stays the fastest.
  const levelFor = (route, levelAt) => (tile) => flowTile(tile, route.coordinates, levelAt);
  const tiles = [levelFor(primary, slowAround(centre, 350)), levelFor(alternate, () => 0.7)];
  const transport = fakeTransport({
    flow: (tile) => {
      const parts = tiles.map((make) => decodeMvt(make(tile)).layers["Traffic flow"]).filter(Boolean);
      return encodeMvt({ layers: [{ name: "Traffic flow", features: parts.flatMap((layer) => layer.features.map((f) => ({ type: 2, parts: f.parts, properties: f.properties }))) }] });
    },
  });
  const live = await calculate(entry, { extra: { traffic: "live" }, transport });
  assert.equal(live.payload.traffic.status, "live");
  assert.ok(live.payload.traffic.search.slices >= 1, "the jam is a slice");
  assert.ok(Math.max(...factorCounts(live.requests)) > Math.max(...factorCounts(baseline.requests)), "congestion slices ride in the penalised request");
  assert.ok(live.requests.length <= 7, `${live.requests.length} routing-provider requests, cap 7`);
});

test("traffic requested but unavailable: an explicit reason, and the routes are exactly the ones without traffic", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  for (const [label, transport, reason] of [
    ["quota spent", fakeTransport({ failWith: "quota-daily" }), "quota-daily"],
    ["key rejected", fakeTransport({ failWith: "key-rejected" }), "key-rejected"],
    ["no key", fakeTransport({ failWith: "no-key" }), "no-key"],
    ["no binding", null, "no-binding"],
  ]) {
    const result = await calculate(entry, { extra: { traffic: "live" }, transport });
    assert.equal(result.status, 200, label);
    assert.deepEqual(result.payload.traffic, { status: "unavailable", provider: "TomTom", reason }, label);
    assert.deepEqual(strip(result.payload), strip(baseline.payload), `${label}: not one number differs from the no-traffic answer`);
    assert.ok(result.requests.length <= 7, label);
  }
});

test("a tile the provider answers but nobody can read is never used as partial traffic", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  const result = await calculate(entry, { extra: { traffic: "live" }, transport: fakeTransport({ flow: () => Uint8Array.of(0x1a, 0xff, 0xff, 0x7f) }) });
  assert.equal(result.payload.traffic.status, "unavailable");
  assert.equal(result.payload.traffic.reason, "tile-unreadable");
  assert.deepEqual(strip(result.payload), strip(baseline.payload));
});

test("motorcycles feel half of the delay, bicycles none (their incidents and closures are still shown)", async () => {
  const entry = journey("milan-inside");
  const baseline = await calculate(entry);
  const coords = baseline.payload.fast.coordinates;
  const centre = coords[Math.floor(coords.length / 2)];
  const transport = () => fakeTransport({
    flow: (tile) => flowTile(tile, coords, slowAround(centre, 350, 0.3)),
    incidents: (tile) => incidentTile(tile, [{ at: coords[Math.floor(coords.length / 4)], category: 8, magnitude: 4, delay: 0, description: "Chiusura (fixture)" }]),
  });
  const car = await calculate(entry, { mode: "car", extra: { traffic: "live" }, transport: transport() });
  const moto = await calculate(entry, { mode: "motorcycle", extra: { traffic: "live" }, transport: transport() });
  const bike = await calculate(entry, { mode: "bicycle", extra: { traffic: "live" }, transport: transport() });
  const delay = (result) => result.payload.fast.traffic?.delaySeconds ?? null;
  assert.ok(delay(car) > 40);
  assert.ok(Math.abs(delay(moto) - delay(car) / 2) <= Math.max(3, delay(car) * 0.05), `moto ${delay(moto)} vs car ${delay(car)}`);
  assert.equal(moto.payload.traffic.delayShare, 0.5);
  assert.match(moto.payload.traffic.note, /metà/);
  assert.equal(delay(bike), 0);
  assert.equal(bike.payload.traffic.delayShare, 0);
  assert.equal(bike.payload.fast.minutes, bike.payload.fast.traffic.freeMinutes, "bicycle time unchanged");
  assert.equal(bike.payload.fast.traffic.incidents.some((incident) => incident.category === "road-closed"), true, "a closure is still shown to a cyclist");
  for (const result of [car, moto, bike]) assert.ok(result.requests.length <= 7);
});

test("outside the enriched coverage traffic still works, in coarser tiles, and the surface stays unknown, never asphalt", async () => {
  const entry = journey("milan-malpensa");
  const baseline = await calculate(entry);
  assert.equal(baseline.status, 200);
  const coords = baseline.payload.safe.coordinates;
  const centre = coords[Math.floor(coords.length * 0.6)];
  const transport = fakeTransport({ flow: (tile) => flowTile(tile, coords, slowAround(centre, 2_500, 0.5)) });
  const live = await calculate(entry, { extra: { traffic: "live" }, transport });
  assert.equal(live.status, 200);
  assert.equal(live.payload.traffic.status, "live");
  assert.ok(transport.calls.length <= 24, `${transport.calls.length} tile requests for ${Math.round(live.payload.safe.distance)} km`);
  assert.ok(live.payload.traffic.flowZoom <= 13, `zoom ${live.payload.traffic.flowZoom}`);
  assert.ok(live.payload.safe.minutes > baseline.payload.safe.minutes, "the slow stretch costs time");
  assert.ok(live.payload.safe.unknownSurfaceMeters > 30_000, "traffic does not make the unknown surface known");
  assert.equal(live.payload.safe.smoothSurfaceMeters <= live.payload.safe.surfaceTotalMeters - live.payload.safe.unknownSurfaceMeters, true);
  assert.ok(live.requests.length <= 7);
});

test("the provider budget holds in the worst case: every request fails, with and without traffic", async () => {
  const entry = journey("milan-inside");
  for (const extra of [{}, { traffic: "live" }]) {
    for (const navigation of [false, true]) {
      const nativeFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
      setTrafficTransport(fakeTransport({ flow: () => new Uint8Array() }));
      try {
        const params = new URLSearchParams({ start: entry.start, end: entry.end, mode: "car", avoid: "maximum", ...extra, ...(navigation ? { navigation: "1" } : {}) });
        const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
        assert.equal(response.status, 503, "an honest failure");
        assert.ok(calls <= (navigation ? 4 : 7), `${calls} requests (navigation ${navigation})`);
      } finally {
        globalThis.fetch = nativeFetch;
        setTrafficTransport(null);
      }
    }
  }
});
