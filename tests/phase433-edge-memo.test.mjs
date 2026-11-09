import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EdgeMemo, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";
import { parseLocalDeparture } from "../lib/access-conditions.ts";

/**
 * Phase 4.33: candidates of one request share most of their edges, so each edge is matched once
 * per request (lib/road-intelligence-scoring.ts, EdgeMemo). These tests hold the memo to exact
 * equality with scoring without it, on real Milan routes, including the case where tiles are loaded
 * between two scorings.
 */
const routes = JSON.parse(await readFile(new URL("fixtures/phase431-deviation-routes.json", import.meta.url), "utf8")).routes;
const departure = parseLocalDeparture("2026-11-09T12:00");
const options = (extra = {}) => ({ terminalWalkingForBicycle: true, departure, authorisedZtl: new Set(), ...extra });

async function scopedFor(coordinates, tileLimit = Infinity) {
  const keys = spatialRoadStore.getTileKeysForCoordinates(coordinates, 50);
  await spatialRoadStore.preloadTiles(keys);
  // A fresh tile set per call: scoped indexes are cached by tile set and grow with addTileKey.
  const scoped = spatialRoadStore.getScopedIntelligenceForTiles(keys.slice(0, Math.min(tileLimit, keys.length)));
  return { scoped, keys };
}

// Overlapping candidates, as a request produces: the route, its first and last two thirds, and the route again.
const variants = (coordinates) => {
  const third = Math.floor(coordinates.length / 3);
  return [coordinates, coordinates.slice(0, 2 * third + 1), coordinates.slice(third), coordinates];
};

test("scoring with a shared edge memo equals scoring each candidate alone (car, motorcycle, bicycle)", async () => {
  for (const [id, route] of Object.entries(routes)) {
    const mode = id.split("-").at(-1);
    const { scoped } = await scopedFor(route.coordinates);
    const memo = new EdgeMemo();
    for (const coordinates of variants(route.coordinates)) {
      const withMemo = scoreRoadIntelligence(coordinates, scoped.surfaceIndex, 12, mode, false, options({ edgeMemo: memo }));
      const alone = scoreRoadIntelligence(coordinates, scoped.surfaceIndex, 12, mode, false, options());
      assert.deepStrictEqual(withMemo, alone, `${id}: ${coordinates.length} points`);
    }
  }
});

test("an edge matched before its neighbouring tiles were loaded is matched again after they are", async () => {
  const route = routes["castello-porta-venezia-car"].coordinates;
  const { scoped, keys } = await scopedFor(route, 1);
  assert.ok(keys.length > 1, "the route spans several tiles");
  const memo = new EdgeMemo();
  const opts = options({ edgeMemo: memo });
  const partial = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "car", false, opts);
  for (const key of keys.slice(1)) scoped.addTileKey(key);
  const complete = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "car", false, opts);
  const fresh = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "car", false, options());
  assert.deepStrictEqual(complete, fresh, "memo results equal a fresh scoring once all tiles are loaded");
  assert.ok(partial.totalMeters === complete.totalMeters && partial.matchedSegments < complete.matchedSegments,
    "with one tile the route matched fewer segments, so the memo must not have kept those edges");
});

test("a memo serves one context only: another mode or access context scores without it", async () => {
  const route = routes["cordusio-porta-romana-bicycle"].coordinates;
  const { scoped } = await scopedFor(route);
  const memo = new EdgeMemo();
  scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "bicycle", false, options({ edgeMemo: memo }));
  for (const [mode, extra] of [["car", {}], ["bicycle", { authorisedZtl: new Set(["ztl-quadrilatero"]) }], ["bicycle", { departure: parseLocalDeparture("2026-11-09T21:00") }]]) {
    const reused = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, mode, false, options({ edgeMemo: memo, ...extra }));
    const alone = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, mode, false, options(extra));
    assert.deepStrictEqual(reused, alone, `${mode} ${JSON.stringify(Object.keys(extra))}`);
  }
});
