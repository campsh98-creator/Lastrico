import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";
import {
  createRoadIntelligenceIndex,
  scoreRoadIntelligence,
} from "../lib/road-intelligence-scoring.ts";

const root = new URL("../", import.meta.url);

test("spatialRoadStore satisfies integrity and segment count invariants", async () => {
  const manifest = JSON.parse(await readFile(new URL("data/surfaces/milan-central.manifest.json", root)));
  assert.equal(spatialRoadStore.pilotSegments, manifest.statistics.totalSegments);
  assert.ok(spatialRoadStore.totalSegments >= manifest.statistics.totalSegments);
  assert.equal(spatialRoadStore.sourceSha256, manifest.checksums.datasetSha256);
  assert.equal(spatialRoadStore.tileCount, 117);

  const allRoads = spatialRoadStore.getAllRoads();
  assert.equal(allRoads.length, spatialRoadStore.totalSegments);
  assert.ok(allRoads.every((road) => road.segmentHash && Array.isArray(road.coordinates)));

  // Verify surface confidence invariant: unknown must have 0 confidence
  const unknownSegs = allRoads.filter((s) => s.surfaceCategory === "unknown");
  assert.ok(unknownSegs.length > 0);
  assert.ok(unknownSegs.every((s) => s.surface.confidence === 0));

  const roughSegs = allRoads.filter((s) => s.surfaceCategory === "confirmed_rough");
  assert.ok(roughSegs.length > 0);
  assert.ok(roughSegs.every((s) => s.surface.confidence === 1));
});

test("spatially scoped access preserves bit-for-bit scoring fidelity across all modes", async () => {
  const segments = JSON.parse(await readFile(new URL("data/surfaces/milan-central.json", root)));
  const fullIndex = createRoadIntelligenceIndex(segments);

  const routes = [
    // San Babila to Duomo
    [[9.198, 45.467], [9.195, 45.466], [9.192, 45.465], [9.189, 45.464]],
    // Cordusio to Castello
    [[9.186, 45.465], [9.184, 45.467], [9.182, 45.469], [9.180, 45.471]],
    // Corso Venezia
    [[9.198, 45.467], [9.201, 45.470], [9.203, 45.472], [9.205, 45.474]],
  ];

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    for (const route of routes) {
      const scoped = spatialRoadStore.getScopedIntelligence(route, 80);
      assert.ok(scoped.roads.length > 0);

      const fullScore = scoreRoadIntelligence(route, fullIndex, 12, mode);
      const scopedScore = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, mode);

      assert.deepEqual(scopedScore, fullScore, `Mismatch on mode ${mode}`);
    }
  }
});

test("spatially scoped store serves expansion tiles across western and eastern corridors", () => {
  // Western corridor route (Corso Magenta into 917_4546)
  const westernRoute = [
    [9.1725, 45.4655],
    [9.1770, 45.4645],
    [9.1830, 45.4630],
  ];
  const westernKeys = spatialRoadStore.getTileKeysForCoordinates(westernRoute, 80);
  assert.ok(westernKeys.includes("917_4546"));
  const westernScoped = spatialRoadStore.getScopedIntelligence(westernRoute, 80);
  assert.ok(westernScoped.roads.some((r) => r.coordinates[0][0] < 9.180));

  // Eastern corridor route (Porta Venezia into 920_4546)
  const easternRoute = [
    [9.1990, 45.4740],
    [9.2040, 45.4745],
  ];
  const easternKeys = spatialRoadStore.getTileKeysForCoordinates(easternRoute, 80);
  assert.ok(easternKeys.includes("920_4546") || easternKeys.includes("920_4547"));
  const easternScoped = spatialRoadStore.getScopedIntelligence(easternRoute, 80);
  assert.ok(easternScoped.roads.some((r) => r.coordinates[0][0] > 9.200 || r.coordinates[1][0] > 9.200));
});

test("spatialRoadStore identifies missing detour tiles accurately", () => {
  const baseRoute = [[9.190, 45.465], [9.192, 45.465]];
  const baseKeys = spatialRoadStore.getTileKeysForCoordinates(baseRoute, 80);

  // Distant detour 1km away in 917_4546
  const distantDetour = [[9.172, 45.465]];
  const missing = spatialRoadStore.getMissingTileKeys(baseKeys, distantDetour, 80);
  assert.ok(missing.includes("917_4546"));
});

test("spatialRoadStore handles edge cases safely", () => {
  const emptyKeys = spatialRoadStore.getTileKeysForCoordinates([]);
  assert.deepEqual(emptyKeys, []);

  const oobKeys = spatialRoadStore.getTileKeysForCoordinates([[12.0, 40.0]]);
  assert.deepEqual(oobKeys, []);

  const missingSegs = spatialRoadStore.getTileSegments("999_999");
  assert.deepEqual(missingSegs, []);
  const missingPave = spatialRoadStore.getTilePaveDetails("999_999");
  assert.deepEqual(missingPave, []);
});

test("spatialRoadStore caches and evicts LRU index entries boundedly with true touch", () => {
  const p1 = [9.185, 45.465];
  const p2 = [9.195, 45.465];
  const res1 = spatialRoadStore.getScopedIntelligence([p1, p2], 80);
  const res2 = spatialRoadStore.getScopedIntelligence([p1, p2], 80);
  assert.equal(res1, res2, "Index cache should return identical object reference on hit");

  // Generate distinct tile combinations to trigger LRU eviction
  const tilePoints = [
    [9.172, 45.456],
    [9.172, 45.466],
    [9.172, 45.476],
    [9.182, 45.456],
    [9.182, 45.466],
    [9.182, 45.476],
    [9.192, 45.456],
    [9.192, 45.466],
    [9.192, 45.476],
    [9.202, 45.456],
    [9.202, 45.466],
    [9.202, 45.476],
  ];

  for (const pt of tilePoints) {
    spatialRoadStore.getScopedIntelligence([pt], 10);
  }

  // Cache size must never exceed 8
  assert.ok(spatialRoadStore.indexCacheSize <= 8, `Cache size ${spatialRoadStore.indexCacheSize} exceeds maximum limit of 8`);
  assert.equal(spatialRoadStore.indexCacheSize, 8);
});

test("117-tile citywide compact store satisfies reconciliation and oneway restriction invariants", () => {
  assert.equal(spatialRoadStore.tileCount, 117);
  assert.equal(spatialRoadStore.pilotSegments, 37106);
  // Phase 4.24: 258 clipped pilot stubs duplicated by the citywide snapshot and 8 expansion-ring
  // segments that became unknown (tracktype=grade1, asphalt in bad condition) are no longer stored.
  assert.equal(spatialRoadStore.totalSegments, 102028);
  assert.equal(spatialRoadStore.totalSegments - spatialRoadStore.pilotSegments, 64922);

  // Verify Southern Milan (Porta Romana -> Largo Promessi Sposi) tile coverage
  const southernKeys = spatialRoadStore.getTileKeysForCoordinates([
    [9.2022, 45.4521],
    [9.1880, 45.4420],
    [9.1765, 45.4351],
  ], 80);
  assert.ok(southernKeys.includes("917_4543"), "Largo Promessi Sposi tile 917_4543 must be present");
  assert.ok(southernKeys.includes("918_4544"), "Corso Lodi / Ripamonti tile 918_4544 must be present");
  const southernScoped = spatialRoadStore.getScopedIntelligence([
    [9.2022, 45.4521],
    [9.1880, 45.4420],
    [9.1765, 45.4351],
  ], 80);
  assert.ok(southernScoped.roads.length > 1000, "Southern Milan corridor must serve > 1,000 authentic road segments");

  // Test oneway evaluation on a segment without rawTags
  const testSegment = {
    segmentHash: "test-hash-oneway",
    osmWayId: 12345,
    name: "Via Test Oneway",
    coordinates: [[9.185, 45.465], [9.185, 45.466]],
    isOneway: true,
    isMotorAllowed: true,
    isBicycleAllowed: true,
    modeAccess: { car: true, motorcycle: true, bicycle: true },
    modeDirections: { car: "forward", motorcycle: "forward", bicycle: "both" },
    surfaceCategory: "confirmed_smooth",
    surface: { material: "asphalt", confidence: 1 },
    highwayClass: "residential",
    lengthMeters: 110,
    bearing: 0,
    roughnessWeight: 0,
  };

  const testIndex = createRoadIntelligenceIndex([testSegment]);
  // Forward traversal for car should have 0 restrictions
  const forwardScore = scoreRoadIntelligence([[9.185, 45.465], [9.185, 45.466]], testIndex, 12, "car");
  assert.equal(forwardScore.confirmedRestrictionMeters, 0);

  // Backward (wrong-way) traversal for car should detect restriction
  const backwardScore = scoreRoadIntelligence([[9.185, 45.466], [9.185, 45.465]], testIndex, 12, "car");
  assert.ok(backwardScore.confirmedRestrictionMeters > 0, "Wrong-way traversal must be confirmed as restricted");

  // Bicycle counterflow (modeDirections.bicycle = 'both') should NOT be restricted backward
  const bikeBackwardScore = scoreRoadIntelligence([[9.185, 45.466], [9.185, 45.465]], testIndex, 12, "bicycle");
  assert.equal(bikeBackwardScore.confirmedRestrictionMeters, 0, "Bicycle with both direction permission must not be restricted backward");
});
