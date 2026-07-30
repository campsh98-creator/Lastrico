import assert from "node:assert/strict";
import test from "node:test";
import {
  createSurfaceIndex,
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

