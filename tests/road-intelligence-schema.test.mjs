import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateBearing,
  computeCanonicalEdgeHash,
  computeSegmentHash,
  quantizeCoordinate,
} from "../lib/road-intelligence-types.ts";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";

const datasetUrl = new URL("../data/surfaces/milan-central.json", import.meta.url);

test("quantizeCoordinate rounds to 6 decimal places", () => {
  const coord = [9.123456789, 45.987654321];
  const quantized = quantizeCoordinate(coord);
  assert.equal(quantized[0], 9.123457);
  assert.equal(quantized[1], 45.987654);
});

test("calculateBearing returns correct degree compass angles", () => {
  // Due North
  assert.equal(Math.round(calculateBearing([9.0, 45.0], [9.0, 45.1])), 0);
  // Due East
  assert.equal(Math.round(calculateBearing([9.0, 45.0], [9.1, 45.0])), 90);
  // Due South
  assert.equal(Math.round(calculateBearing([9.0, 45.1], [9.0, 45.0])), 180);
  // Due West
  assert.equal(Math.round(calculateBearing([9.1, 45.0], [9.0, 45.0])), 270);
});

test("computeSegmentHash is deterministic and invariant to non-coordinate noise", () => {
  const a = [9.182, 45.465];
  const b = [9.183, 45.466];
  const bearing = calculateBearing(a, b);
  const hash1 = computeSegmentHash(a, b, bearing, 15000);
  const hash2 = computeSegmentHash(a, b, bearing, 15000);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
});

test("computeCanonicalEdgeHash is symmetric and traversal-direction invariant", () => {
  const a = [9.182, 45.465];
  const b = [9.183, 45.466];
  const hashForward = computeCanonicalEdgeHash(a, b);
  const hashReverse = computeCanonicalEdgeHash(b, a);
  assert.equal(hashForward, hashReverse);
  assert.equal(hashForward.length, 16);
});

test("segment identity hash collisions are zero across the entire ingested dataset", async () => {
  const segments = JSON.parse(await readFile(datasetUrl, "utf8"));
  const hashSet = new Set();
  for (const seg of segments) {
    assert.equal(hashSet.has(seg.segmentHash), false, `Collision on hash ${seg.segmentHash}`);
    hashSet.add(seg.segmentHash);
  }
  assert.equal(hashSet.size, segments.length);
  assert.ok(hashSet.size > 5000);
});

test("oneway=-1 correctly reverses segment coordinate order for legal travel direction", () => {
  const reverseOnewayWay = {
    id: 55555,
    tags: {
      highway: "residential",
      oneway: "-1",
    },
    coordinates: [
      [9.180, 45.460], // A
      [9.190, 45.460], // B
    ],
  };
  const normalized = normalizeOsmFeature(reverseOnewayWay);
  assert.equal(normalized.segments.length, 1);
  const seg = normalized.segments[0];
  assert.equal(seg.isOneway, true);
  // Because oneway=-1, legal travel is B -> A, so segment coordinates must start at B and end at A
  assert.deepEqual(seg.coordinates[0], [9.190, 45.460]);
  assert.deepEqual(seg.coordinates[1], [9.180, 45.460]);
  // Bearing should point West (270 degrees)
  assert.equal(Math.round(seg.bearing), 270);
});

test("observation timestamp is NEVER fabricated when not in primary source", () => {
  const feature = {
    id: 99999,
    surface: "sett",
    coordinates: [[9.18, 45.46], [9.19, 45.46]],
  };
  const normalized = normalizeOsmFeature(feature);
  assert.equal(normalized.segments[0].surface.observedAt, null);
  assert.equal(normalized.segments[0].smoothness.observedAt, null);
  assert.ok(normalized.segments[0].surface.ingestedAt);
});

test("smoothness is NEVER inferred from surface material", () => {
  const settWay = {
    id: 1001,
    tags: { surface: "sett" },
    coordinates: [[9.18, 45.46], [9.19, 45.46]],
  };
  const normalizedSett = normalizeOsmFeature(settWay);
  assert.equal(normalizedSett.segments[0].surface.value, "sett");
  assert.equal(normalizedSett.segments[0].smoothness.value, "unknown");
  assert.equal(normalizedSett.segments[0].smoothness.state, "unknown");

  const explicitWay = {
    id: 1002,
    tags: { surface: "sett", smoothness: "good" },
    coordinates: [[9.18, 45.46], [9.19, 45.46]],
  };
  const normalizedExplicit = normalizeOsmFeature(explicitWay);
  assert.equal(normalizedExplicit.segments[0].surface.value, "sett");
  assert.equal(normalizedExplicit.segments[0].smoothness.value, "good");
  assert.equal(normalizedExplicit.segments[0].smoothness.state, "known");
});
