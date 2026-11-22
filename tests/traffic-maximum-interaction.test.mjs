import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { encodeMvt, fakeTransport, flowTile } from "./helpers/traffic-fixtures.mjs";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import { setTrafficTransport } from "../lib/traffic/client.ts";
import { distanceMeters } from "../lib/traffic/tiles.ts";
import { normalizeValhallaResponse } from "../lib/routing-providers.ts";

/**
 * Live traffic together with "maximum" anti-pavé, through the real handler on the RECORDED provider answers of the Corso Lodi
 * outbound replica (public OSM junctions, tests/fixtures/phase437). Flow tiles are fixtures; nothing reaches TomTom or FOSSGIS.
 * This file has no synthetic road data on purpose: it runs on the bundled Milan surface tiles, and a test that mocks the road
 * store in the same process can leave it in another state (hence a file of its own).
 */
const root = new URL("../", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase437/cases.json", root), "utf8"));
const outbound = cases.find((entry) => entry.id === "piazzale-lodi-outbound-car");
const readFixture = async (key) => JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/phase437/provider/${key}.json.gz`, root))));
// A recorded response whose route has 0 m of confirmed stone by the local surface data (see residual-stone-exclusion.test.mjs).
const ZERO_STONE_KEY = "5ccc1e1a6d75ef56ee838ddfa9ba7dfdd3eef65266d58048aaabc6e5b606aca5";

/** One flow tile holding the lines of several routes (each with its own level), as the provider would send them. */
function flowFor(tile, specs) {
  const layers = specs.map(({ coords, levelAt }) => decodeMvt(flowTile(tile, coords, levelAt)).layers["Traffic flow"]).filter(Boolean);
  return encodeMvt({
    layers: [{ name: "Traffic flow", features: layers.flatMap((layer) => layer.features.map((f) => ({ type: 2, parts: f.parts, properties: f.properties }))) }],
  });
}

/**
 * The provider stub: the recorded answer when the request was recorded, the exclusion answer for an exclusion request, else the
 * journey's base answer (a traffic-penalised request has a different body than the recorded ones, so only its plumbing is tested).
 */
async function replicaFetch(requests, state) {
  return async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    let entry;
    if (String(request.body).includes("exclude_polygons")) entry = await readFixture(ZERO_STONE_KEY);
    else {
      try { entry = await readFixture(sha256(JSON.stringify(request))); } catch { entry = null; }
      if (!entry) entry = state.base;
    }
    if (!state.base && entry) state.base = entry;
    if (!entry) return new Response("{}", { status: 500 });
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
}

/** `traffic`: null, a transport, or a function of the calculation state (it needs the base routes, known after the first answer). */
async function replica({ avoid, navigation = false, traffic = null }) {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  const state = { base: null };
  globalThis.fetch = await replicaFetch(requests, state);
  setTrafficTransport(typeof traffic === "function" ? traffic(state) : traffic);
  try {
    const params = new URLSearchParams({ area: "milan", start: outbound.start, end: outbound.end, mode: "car", avoid, departure: "2026-11-09T12:00" });
    if (traffic) params.set("traffic", "live");
    if (navigation) params.set("navigation", "1");
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
    setTrafficTransport(null);
  }
}

/**
 * Flow tiles for the recorded base routes: a jam (30 % of free flow, 500 m) in the middle of the provider's primary route and a
 * mild slow-down (65 %, above the 60 % congestion line) all along its alternates, so the primary stays the fastest route and
 * the jam becomes a slice for the penalised search.
 */
const jamOnFastest = (state) => fakeTransport({
  flow: (tile) => {
    const [primary, ...alternates] = normalizeValhallaResponse(JSON.parse(state.base.body), "car");
    const centre = primary.coordinates[Math.floor(primary.coordinates.length / 2)];
    return flowFor(tile, [
      { coords: primary.coordinates, levelAt: (point) => (distanceMeters(point, centre) < 250 ? 0.3 : 0.95) },
      ...alternates.map((route) => ({ coords: route.coordinates, levelAt: () => 0.65 })),
    ]);
  },
});
const factorsIn = (request) => (request.body ? JSON.parse(request.body).linear_cost_factors?.length ?? 0 : 0);
const exclusionsIn = (requests) => requests.filter((request) => String(request.body).includes("exclude_polygons"));
const candidates = (payload) => JSON.stringify(payload.candidateDiagnostics.map((d) => [d.source, d.seconds, d.confirmedPaveMeters, d.selectionVerdict]));

test("maximum avoidance with live traffic: congestion rides in the stone search, the exclusion search stays stone-only, caps hold and 0 m is kept", async (t) => {
  t.after(() => setTrafficTransport(null));
  const quiet = await replica({ avoid: "maximum" });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.payload.safe.confirmedPaveMeters, 0, "baseline without traffic: the Maximum result of the Corso Lodi replica is 0 m");
  let jam = null;
  const live = await replica({ avoid: "maximum", traffic: (state) => (jam = jamOnFastest(state)) });
  assert.equal(live.status, 200);
  assert.equal(live.payload.traffic.status, "live");
  assert.ok(live.payload.traffic.search.slices >= 1, "the jam on the fastest route is a slice");
  const shape = `live ${live.requests.map(factorsIn)} / quiet ${quiet.requests.map(factorsIn)} / ${JSON.stringify(live.payload.antiPave.search)} / ${candidates(live.payload)}`;
  // The first penalised request is the second request of the calculation: with the jam it carries one cost factor more per slice.
  assert.equal(factorsIn(live.requests[1]), factorsIn(quiet.requests[1]) + live.payload.traffic.search.slices, shape);
  assert.ok(live.requests.length <= 7, `${live.requests.length} routing-provider requests, cap 7`);
  assert.equal(live.payload.antiPave.search.providerRequests, live.requests.length, "the counter matches what really went out");
  // Traffic tiles are not routing-provider requests: they go through the ledger and are bounded on their own.
  assert.ok(jam.calls.length >= 1 && jam.calls.length <= 24 && jam.calls.every((call) => call.purpose === "route"));
  // Every exclusion request is stone-only (it never carries the traffic factors) and respects the provider's vertex limit.
  assert.equal(exclusionsIn(live.requests).length, 1, `with the jam the residual exclusion search still runs once: ${shape}`);
  for (const request of exclusionsIn(live.requests)) {
    const body = JSON.parse(request.body);
    assert.equal(body.linear_cost_factors, undefined);
    assert.ok(body.exclude_polygons.reduce((sum, ring) => sum + ring.length, 0) <= 100);
  }
  // The Maximum guarantee is intact: the safe route is the 0 m one.
  assert.equal(live.payload.safe.confirmedPaveMeters, 0, `traffic must not give back the stone that Maximum removed: ${shape}`);
  assert.ok(live.payload.safe.confirmedPaveMeters <= live.payload.fast.confirmedPaveMeters);
});

test("a reroute with live traffic stays inside its 4 requests and never runs the exclusion search", async (t) => {
  t.after(() => setTrafficTransport(null));
  const live = await replica({ avoid: "maximum", navigation: true, traffic: jamOnFastest });
  assert.equal(live.status, 200);
  assert.ok(live.requests.length <= 4, `${live.requests.length} routing-provider requests, cap 4`);
  assert.equal(exclusionsIn(live.requests).length, 0);
  assert.equal(live.payload.antiPave.search.residualExclusion.attempted, false);
});

test("when the traffic provider fails, Maximum gives exactly the answer it gives without traffic", async (t) => {
  t.after(() => setTrafficTransport(null));
  const without = await replica({ avoid: "maximum" });
  for (const reason of ["provider-failing", "quota-daily", "key-rejected", "no-key"]) {
    const down = await replica({ avoid: "maximum", traffic: fakeTransport({ failWith: reason }) });
    assert.equal(down.status, 200);
    assert.deepEqual(down.payload.traffic, { status: "unavailable", provider: "TomTom", reason });
    assert.deepEqual(down.payload.safe.coordinates, without.payload.safe.coordinates, `${reason}: the same safe route`);
    assert.deepEqual(down.payload.fast.coordinates, without.payload.fast.coordinates, `${reason}: the same fast route`);
    assert.equal(down.requests.length, without.requests.length, `${reason}: the same number of routing requests`);
  }
});
