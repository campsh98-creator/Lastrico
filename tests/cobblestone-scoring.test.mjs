import assert from "node:assert/strict";
import test from "node:test";
import {
  createSurfaceIndex,
  geographicDistance,
  scoreSurfaceExposure,
} from "../lib/cobblestone-scoring.ts";

const route = [[9.19, 45.46], [9.192, 45.46]];

test("surface scoring detects aligned overlap but ignores a perpendicular crossing", () => {
  const aligned = createSurfaceIndex([{
    id: 1,
    surface: "sett",
    coordinates: [[9.1905, 45.46], [9.1915, 45.46]],
  }]);
  const crossing = createSurfaceIndex([{
    id: 2,
    surface: "sett",
    coordinates: [[9.191, 45.4595], [9.191, 45.4605]],
  }]);
  const alignedScore = scoreSurfaceExposure(route, aligned, 10);
  const crossingScore = scoreSurfaceExposure(route, crossing, 10);
  assert.ok(alignedScore.paveMeters > 60);
  assert.ok(alignedScore.paveMeters < 120);
  assert.equal(crossingScore.paveMeters, 0);
});

test("paving stones remain probable and receive a lower weighted exposure", () => {
  const index = createSurfaceIndex([{
    id: 3,
    surface: "paving_stones",
    coordinates: route,
  }]);
  const score = scoreSurfaceExposure(route, index, 10);
  assert.equal(score.confirmedMeters, 0);
  assert.ok(score.probableMeters > 100);
  assert.ok(score.weightedPaveMeters < score.paveMeters);
  assert.equal(score.confidence, 0.65);
  assert.equal(score.matchedFeatures, 1);
});

test("reported pave exposure cannot exceed route geometry length", () => {
  const index = createSurfaceIndex([
    { id: 4, surface: "sett", coordinates: route },
    { id: 5, surface: "cobblestone", coordinates: route },
  ]);
  const score = scoreSurfaceExposure(route, index, 12);
  assert.ok(score.pavePercent <= 100);
  assert.ok(score.weightedPaveMeters <= score.paveMeters);
});

test("zero known exposure leaves the entire route unknown", () => {
  const score = scoreSurfaceExposure(route, createSurfaceIndex([]), 12);
  assert.equal(score.paveMeters, 0);
  assert.equal(score.unknownMeters, Math.round(geographicDistance(...route)));
  assert.equal(score.matchedCoveragePercent, 0);
  assert.equal(score.classificationConfidence, 0);
  assert.equal(score.dataConfidence, null);
});

test("partial category confidence is separate from unknown route coverage", () => {
  const score = scoreSurfaceExposure(route, createSurfaceIndex([{
    id: 6,
    surface: "sett",
    coordinates: [[9.1905, 45.46], [9.1915, 45.46]],
  }]), 10);
  assert.ok(score.unknownMeters > 0);
  assert.ok(score.matchedCoveragePercent > 0 && score.matchedCoveragePercent < 100);
  assert.equal(score.paveMeters + score.unknownMeters, Math.round(geographicDistance(...route)));
  assert.equal(score.classificationConfidence, 1);
  assert.equal(score.confidence, score.classificationConfidence);
  assert.equal(score.dataConfidence, null);
});

test("a rougher adjacent parallel road cannot override the directly matched road", () => {
  const direct = { id: 7, surface: "paving_stones", coordinates: route };
  const adjacent = {
    id: 8,
    surface: "sett",
    coordinates: route.map(([lng, lat]) => [lng, lat + 8 / 110540]),
  };
  const expected = scoreSurfaceExposure(route, createSurfaceIndex([direct]), 12);
  for (const features of [[direct, adjacent], [adjacent, direct]]) {
    assert.deepEqual(scoreSurfaceExposure(route, createSurfaceIndex(features), 12), expected);
  }
});

test("a parallel road outside the matching tolerance remains unknown", () => {
  const index = createSurfaceIndex([{
    id: 9,
    surface: "sett",
    coordinates: route.map(([lng, lat]) => [lng, lat + 20 / 110540]),
  }]);
  const score = scoreSurfaceExposure(route, index, 12);
  assert.equal(score.paveMeters, 0);
  assert.equal(score.unknownMeters, Math.round(geographicDistance(...route)));
});

test("overlapping geometry is counted once and equal-distance evidence uses the higher weight", () => {
  const features = [
    { id: 10, surface: "paving_stones", coordinates: route },
    { id: 11, surface: "sett", coordinates: route },
    { id: 12, surface: "cobblestone", coordinates: route },
  ];
  for (const entries of [features, [...features].reverse()]) {
    const score = scoreSurfaceExposure(route, createSurfaceIndex(entries), 12);
    assert.equal(score.paveMeters, Math.round(geographicDistance(...route)));
    assert.equal(score.confirmedMeters, score.paveMeters);
    assert.equal(score.probableMeters, 0);
    assert.equal(score.unknownMeters, 0);
    assert.equal(score.matchedCoveragePercent, 100);
    assert.equal(score.matchedFeatures, 1);
  }
});

test("unsupported surface tags do not establish known smooth coverage", () => {
  for (const surface of ["asphalt", "toString", "__proto__"]) {
    const index = createSurfaceIndex([{ id: 13, surface, coordinates: route }]);
    assert.equal(index.cells.size, 0);
    const score = scoreSurfaceExposure(route, index, 12);
    assert.equal(score.paveMeters, 0);
    assert.equal(score.unknownMeters, Math.round(geographicDistance(...route)));
  }
});

test("empty and stationary routes have finite zero-length metrics", () => {
  for (const coordinates of [[], [route[0]], [route[0], route[0]]]) {
    const score = scoreSurfaceExposure(coordinates, createSurfaceIndex([]), 12);
    assert.equal(score.unknownMeters, 0);
    assert.equal(score.matchedCoveragePercent, 0);
    assert.equal(score.paveMeters, 0);
    assert.equal(score.dataConfidence, null);
  }
});

test("invalid surface geometry cannot enter the spatial index", () => {
  const malformed = [
    [[Infinity, 45.46], route[1]],
    [route[0], [9.19, NaN]],
    [route[0], [181, 45.46]],
    [route[0], [9.19, 91]],
    [route[0], [9.19]],
    [route[0], null],
  ];
  for (const coordinates of malformed) {
    assert.equal(createSurfaceIndex([{ id: 14, surface: "sett", coordinates }]).cells.size, 0);
  }
  assert.equal(createSurfaceIndex([{ id: NaN, surface: "sett", coordinates: route }]).cells.size, 0);
  for (const cellSize of [0, -1, Infinity, NaN]) {
    assert.throws(() => createSurfaceIndex([], cellSize), RangeError);
  }
});

