import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";

/**
 * Phase 4.31 release gate. The real /api/routes handler on real provider responses (recorded from
 * FOSSGIS Valhalla, tests/fixtures/phase431-anti-pave/provider) and the real Milan surface tiles:
 * the Porta Romana / Viale Angelo Filippetti field case and its neighbours.
 */
const root = new URL("../", import.meta.url);
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase431-anti-pave/cases.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");
const { spatialRoadStore } = await import("../lib/spatial-road-store.ts");

const keys = spatialRoadStore.getTileKeysForCoordinates([[9.199, 45.452]], 600);
await spatialRoadStore.preloadTiles(keys);
const ways = (name) => keys.flatMap((key) => spatialRoadStore.getTileSegments(key)).filter((segment) => segment.name === name);
const FILIPPETTI = ways("Viale Angelo Filippetti");
const SABOTINO = ways("Viale Sabotino");
function metersOn(coordinates, segments) {
  let meters = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1], b = coordinates[i];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const near = segments.some(({ coordinates: [c, d] }) => {
      const dx = (d[0] - c[0]) * 78_000, dy = (d[1] - c[1]) * 110_540, px = (m[0] - c[0]) * 78_000, py = (m[1] - c[1]) * 110_540;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
      return Math.hypot(px - t * dx, py - t * dy) < 4;
    });
    if (near) meters += Math.hypot((b[0] - a[0]) * 78_000, (b[1] - a[1]) * 110_540);
  }
  return meters;
}

async function run(id) {
  const c = cases.find((entry) => entry.id === id);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    if (c.failSearch && String(request.body ?? "").includes("linear_cost_factors")) return new Response("{}", { status: 503 });
    const key = sha256(JSON.stringify(request));
    const entry = JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/phase431-anti-pave/provider/${key}.json.gz`, root))));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid: "strong", departure: "2026-11-09T12:00" });
    if (c.navigation) params.set("navigation", "1");
    if (c.maxExtraMinutes) params.set("maxExtraMinutes", c.maxExtraMinutes);
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json() };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}
const shown = (payload) => (payload.hasDistinctAlternative ? payload.safe : payload.fast);

test("Porta Romana: a distinct anti-pavé route along Viale Filippetti is offered (−493 m confirmed pavé, ~20 s)", async () => {
  const { status, payload } = await run("porta-vittoria-car");
  assert.equal(status, 200);
  assert.equal(payload.hasDistinctAlternative, true);
  assert.equal(payload.antiPave.status, "alternative");
  assert.equal(payload.fast.confirmedPaveMeters, 567);
  assert.equal(payload.safe.confirmedPaveMeters, 74);
  assert.ok(metersOn(payload.safe.coordinates, FILIPPETTI) > 400, "the anti-pavé route runs along Viale Filippetti");
  assert.ok(metersOn(payload.fast.coordinates, SABOTINO) > 400, "the fastest runs along Viale Sabotino");
  const extraSeconds = (payload.safe.minutes - payload.fast.minutes) * 60;
  assert.ok(extraSeconds > 0 && extraSeconds <= 30, `+${Math.round(extraSeconds)} s`);
  assert.notDeepEqual(payload.safe.coordinates, payload.fast.coordinates, "two real routes, not one shown twice");
});

test("on the approach to Porta Romana the anti-pavé search runs even when a costly alternate already exists", async () => {
  const { payload } = await run("regina-margherita-car");
  // Before the fix the provider's alternate (−492 m pavé for +383 s) stopped the search here.
  assert.equal(payload.antiPave.search.attempted, true);
  assert.equal(payload.antiPave.status, "fastest-avoids-pave");
  assert.ok(metersOn(payload.fast.coordinates, FILIPPETTI) > 400);
  assert.ok(payload.antiPave.avoidedVsStandardMeters >= 400, `${payload.antiPave.avoidedVsStandardMeters} m avoided`);
  assert.ok(payload.fast.minutes * 60 <= payload.antiPave.standard.seconds, "not slower than the standard route");
});

test("a navigation reroute on the approach keeps optimising for pavé (the field case)", async () => {
  const { payload } = await run("regina-margherita-motorcycle-reroute");
  assert.equal(payload.calculationMode, "navigation");
  assert.equal(payload.antiPave.status, "fastest-avoids-pave");
  assert.ok(metersOn(shown(payload).coordinates, FILIPPETTI) > 400, "the reroute uses Viale Filippetti");
  assert.ok(metersOn(shown(payload).coordinates, SABOTINO) < 50, "not Viale Sabotino (522 m of pavé in the published version)");
  assert.ok(shown(payload).confirmedPaveMeters < 100);
});

test("a failing anti-pavé search is reported as a failure, never as 'no alternative'", async () => {
  const { status, payload } = await run("regina-margherita-motorcycle-reroute-search-down");
  assert.equal(status, 200, "the person still gets a route");
  assert.equal(payload.antiPave.status, "generation-failed");
  assert.equal(payload.antiPave.search.failed, true);
  assert.equal(payload.hasDistinctAlternative, false);
});

test("the extra-time allowance is honoured: 0 minutes means the fastest, and it is said why", async () => {
  const { payload } = await run("porta-vittoria-car-no-extra");
  assert.equal(payload.hasDistinctAlternative, false);
  assert.equal(payload.antiPave.status, "over-extra-time");
  assert.equal(payload.appliedPreferences.maximumExtraMinutes, 0);
});

test("Promessi Sposi → Vetra: no meaningful improvement exists and the response says so", async () => {
  const { payload } = await run("promessi-sposi-vetra-car");
  assert.equal(payload.hasDistinctAlternative, false);
  assert.equal(payload.antiPave.status, "no-better-route");
  assert.equal(payload.antiPave.search.attempted, true, "the search ran; it found nothing better");
  assert.equal(payload.fast.confirmedPaveMeters, 143);
});
