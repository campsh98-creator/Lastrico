import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/historical-scoring-regressions.json" with { type: "json" };
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { createRoadIntelligenceIndex, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";

test("historical short segment retains bounded classification confidence", () => {
  const segment = fixture.short;
  const score = scoreRoadIntelligence(segment.coordinates, createRoadIntelligenceIndex([segment]), 12);
  assert.equal(score.classificationConfidence, 1);
});

test("ambiguity on historical regression geometry is independent of index insertion order", () => {
  const segments = fixture.nearby;
  const segment = segments.find((s) => s.segmentHash === fixture.targetHash);
  assert.ok(segment);
  const forward = scoreRoadIntelligence(segment.coordinates, createRoadIntelligenceIndex(segments), 12);
  const reverse = scoreRoadIntelligence(segment.coordinates, createRoadIntelligenceIndex([...segments].reverse()), 12);
  assert.deepEqual(forward, reverse);
});

test("known compacted surface contributes to coverage without becoming smooth or stone", () => {
  // Explicit synthetic fixture; no production dataset or real-world coverage claim.
  const segment = normalizeOsmFeature({
    id: 1, tags: { highway: "cycleway", surface: "compacted" },
    coordinates: [[9.19, 45.46], [9.192, 45.46]],
  }).segments[0];
  const score = scoreRoadIntelligence(segment.coordinates, createRoadIntelligenceIndex([segment]), 12, "bicycle");
  assert.equal(score.unpavedMeters, score.totalMeters);
  assert.equal(score.unknownMeters, 0);
  assert.equal(score.matchedCoveragePercent, 100);
  assert.equal(score.paveMeters, 0);
  assert.equal(score.weightedPaveMeters, 0);
  assert.equal(score.smoothMeters, 0);
});
