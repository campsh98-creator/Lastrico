import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoadIntelligenceIndex,
  headingsAlign,
  scoreRoadIntelligence,
} from "../lib/road-intelligence-scoring.ts";

const sampleRoute = [
  [9.190, 45.460],
  [9.192, 45.460],
];

test("unidirectional heading check rejects opposing one-way segment on dual carriageway", () => {
  // Route travelling East (from 9.190 to 9.192)
  const routeSegment = sampleRoute;

  // Carriageway A: eastbound oneway (matches route)
  const wayA = [
    [9.190, 45.46002],
    [9.192, 45.46002],
  ];
  // Carriageway B: westbound oneway (opposing route, 8m away)
  const wayB = [
    [9.192, 45.46008],
    [9.190, 45.46008],
  ];

  // Bidirectional heading check accepts both
  assert.equal(headingsAlign(routeSegment[0], routeSegment[1], wayA[0], wayA[1], false), true);
  assert.equal(headingsAlign(routeSegment[0], routeSegment[1], wayB[0], wayB[1], false), true);

  // Unidirectional heading check accepts only eastbound Way A
  assert.equal(headingsAlign(routeSegment[0], routeSegment[1], wayA[0], wayA[1], true), true);
  assert.equal(headingsAlign(routeSegment[0], routeSegment[1], wayB[0], wayB[1], true), false);
});

test("scoring correctly accounts for confirmed smooth surfaces without misclassifying as unknown", () => {
  const smoothSegment = {
    segmentHash: "0000000000000001",
    osmWayId: 101,
    name: "Via dell'Asfalto",
    coordinates: sampleRoute,
    lengthMeters: 156,
    bearing: 90,
    highwayClass: "residential",
    isOneway: false,
    isMotorAllowed: true,
    isBicycleAllowed: true,
    embeddedRails: false,
    surface: {
      state: "known",
      value: "asphalt",
      sourceId: "osm:way:101",
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: "2026-10-26T00:00:00Z",
      confidence: 1.0,
    },
    smoothness: {
      state: "unknown",
      value: "unknown",
      sourceId: null,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: "2026-10-26T00:00:00Z",
      confidence: 0.0,
    },
    cycling: {
      state: "unknown",
      value: { hasFacility: false, typology: "none", direction: "unknown", surface: null, source: "none" },
      sourceId: null,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: "2026-10-26T00:00:00Z",
      confidence: 0.0,
    },
    surfaceCategory: "confirmed_smooth",
    roughnessWeight: 0.0,
  };

  const index = createRoadIntelligenceIndex([smoothSegment]);
  const score = scoreRoadIntelligence(sampleRoute, index, 12, "car");

  assert.equal(score.paveMeters, 0);
  assert.ok(score.smoothMeters > 100);
  assert.equal(score.unknownMeters, 0);
  assert.equal(score.matchedCoveragePercent, 100);
  assert.equal(score.smoothPercent, 100);
  assert.equal(score.classificationConfidence, 1.0);
});

test("vehicular scoring ignores footway and pedestrian segments", () => {
  const footwaySegment = {
    segmentHash: "0000000000000002",
    osmWayId: 102,
    name: "Marciapiede Pedonale",
    coordinates: sampleRoute,
    lengthMeters: 156,
    bearing: 90,
    highwayClass: "footway",
    isOneway: false,
    isMotorAllowed: false,
    isBicycleAllowed: false,
    embeddedRails: false,
    surface: {
      state: "known",
      value: "paving_stones",
      sourceId: "osm:way:102",
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: "2026-10-26T00:00:00Z",
      confidence: 0.65,
    },
    smoothness: { state: "unknown", value: "unknown", sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    cycling: { state: "unknown", value: { hasFacility: false, typology: "none", direction: "unknown", surface: null, source: "none" }, sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    surfaceCategory: "probable_rough",
    roughnessWeight: 0.65,
  };

  const index = createRoadIntelligenceIndex([footwaySegment]);

  // Car score ignores the footway
  const carScore = scoreRoadIntelligence(sampleRoute, index, 12, "car");
  assert.equal(carScore.paveMeters, 0);
  assert.ok(carScore.unknownMeters > 0);

  // A forbidden bicycle segment must not be treated as available infrastructure.
  const biciScore = scoreRoadIntelligence(sampleRoute, index, 12, "bicycle");
  assert.equal(biciScore.paveMeters, 0);
  assert.equal(biciScore.unknownMeters, biciScore.totalMeters);
  const allowedIndex = createRoadIntelligenceIndex([{ ...footwaySegment, isBicycleAllowed: true }]);
  assert.ok(scoreRoadIntelligence(sampleRoute, allowedIndex, 12, "bicycle").paveMeters > 0);
});

test("zero-coverage route remains 100% unknown and is never assumed smooth", () => {
  const emptyIndex = createRoadIntelligenceIndex([]);
  const score = scoreRoadIntelligence(sampleRoute, emptyIndex, 12, "car");
  assert.equal(score.paveMeters, 0);
  assert.equal(score.smoothMeters, 0);
  assert.equal(score.unknownMeters, score.totalMeters);
  assert.equal(score.matchedCoveragePercent, 0);
});

test("parallel-road matching distinguishes same-road segments from distinct competing roads", () => {
  // Road A segment 1 and 2 (same physical road: osmWayId 501, "Via Manzoni")
  const roadASeg1 = {
    segmentHash: "0000000000000501",
    osmWayId: 501,
    name: "Via Manzoni",
    coordinates: sampleRoute,
    lengthMeters: 156,
    bearing: 90,
    highwayClass: "tertiary",
    isOneway: false,
    isMotorAllowed: true,
    isBicycleAllowed: true,
    embeddedRails: false,
    surface: { state: "known", value: "sett", sourceId: "osm:way:501", authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 1.0 },
    smoothness: { state: "unknown", value: "unknown", sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    cycling: { state: "unknown", value: { hasFacility: false, typology: "none", direction: "unknown", surface: null, source: "none" }, sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    surfaceCategory: "confirmed_rough",
    roughnessWeight: 1.0,
  };
  const roadASeg2 = {
    ...roadASeg1,
    segmentHash: "0000000000000502",
    coordinates: [
      [9.192, 45.460],
      [9.194, 45.460],
    ],
  };

  // Same-road segments must NOT trigger ambiguous matches
  const sameRoadIndex = createRoadIntelligenceIndex([roadASeg1, roadASeg2]);
  const sameRoadScore = scoreRoadIntelligence(sampleRoute, sameRoadIndex, 12, "car");
  assert.equal(sameRoadScore.ambiguousMatchesCount, 0);

  // Road B is a distinct parallel road (osmWayId 999, "Via Montenapoleone") only 1.5m away
  const competingRoadB = {
    segmentHash: "0000000000000999",
    osmWayId: 999,
    name: "Via Montenapoleone",
    coordinates: [
      [9.190, 45.460015], // 1.6m north
      [9.192, 45.460015],
    ],
    lengthMeters: 156,
    bearing: 90,
    highwayClass: "tertiary",
    isOneway: false,
    isMotorAllowed: true,
    isBicycleAllowed: true,
    embeddedRails: false,
    surface: { state: "known", value: "asphalt", sourceId: "osm:way:999", authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 1.0 },
    smoothness: { state: "unknown", value: "unknown", sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    cycling: { state: "unknown", value: { hasFacility: false, typology: "none", direction: "unknown", surface: null, source: "none" }, sourceId: null, authority: "osm_curated", observedAt: null, ingestedAt: "2026-10-26T00:00:00Z", confidence: 0.0 },
    surfaceCategory: "confirmed_smooth",
    roughnessWeight: 0.0,
  };

  // Competing distinct parallel road DOES trigger ambiguous matches count
  const competingIndex = createRoadIntelligenceIndex([roadASeg1, competingRoadB]);
  const competingScore = scoreRoadIntelligence(sampleRoute, competingIndex, 12, "car");
  assert.ok(competingScore.ambiguousMatchesCount > 0);
});
