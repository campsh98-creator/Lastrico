import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { createRoadIntelligenceIndex, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";

const coordinates = [[9.19, 45.46], [9.192, 45.46]];
const way = (tags = {}, id = 1, points = coordinates) => normalizeOsmFeature({
  id, coordinates: points, tags: { highway: "residential", surface: "asphalt", ...tags },
}).segments;
const score = (segments, mode = "car", reverse = false) => scoreRoadIntelligence(
  reverse ? [...coordinates].reverse() : coordinates, createRoadIntelligenceIndex(segments), 12, mode,
);
// The same way 5.5 m beside the route: it must never lend surface evidence to a mode that may
// not use it. A way under the route reports its own surface (Phase 4.24); legality is separate.
const besideRoute = coordinates.map(([lon, lat]) => [lon, lat + 0.00005]);

test("specific modal access overrides generic access without leaking to other modes", () => {
  const tags = { access: "no", bicycle: "yes", motorcar: "yes", motorcycle: "no" };
  const beside = way(tags, 1, besideRoute);
  assert.equal(score(beside, "bicycle").matchedCoveragePercent, 100);
  assert.equal(score(beside, "car").matchedCoveragePercent, 100);
  assert.equal(score(beside, "motorcycle").matchedCoveragePercent, 0);
  assert.equal(score(way({ vehicle: "no" }, 1, besideRoute), "bicycle").matchedCoveragePercent, 0);
  assert.equal(score(way({ highway: "cycleway" }, 1, besideRoute), "car").matchedCoveragePercent, 0);
  // Under the route the surface is reported for every mode; only the forbidden mode is flagged.
  const under = way(tags);
  for (const mode of ["car", "motorcycle", "bicycle"]) assert.equal(score(under, mode).matchedCoveragePercent, 100);
  assert.equal(score(under, "car").confirmedRestrictionMeters, 0);
  assert.equal(score(under, "bicycle").confirmedRestrictionMeters, 0);
  assert.ok(score(under, "motorcycle").confirmedRestrictionMeters > 100);
});

test("bicycle exceptions and reversed base oneway preserve legal surface matching", () => {
  for (const tags of [
    { oneway: "yes", "oneway:bicycle": "no" },
    { oneway: "-1", "oneway:bicycle": "no" },
    { oneway: "yes", cycleway: "opposite_lane" },
  ]) {
    assert.equal(way(tags)[0].cycling.value.direction, "bidirezionale");
    assert.equal(score(way(tags), "bicycle").matchedCoveragePercent, 100);
    assert.equal(score(way(tags), "bicycle", true).matchedCoveragePercent, 100);
  }
  const reversedBike = way({ oneway: "-1", "oneway:bicycle": "yes" });
  assert.equal(score(reversedBike, "bicycle").matchedCoveragePercent, 100);
  assert.equal(score(reversedBike, "bicycle").confirmedRestrictionMeters, 0);
  // Wrong-way travel on the route's own road: surface reported, travel flagged as prohibited.
  assert.equal(score(reversedBike, "bicycle", true).matchedCoveragePercent, 100);
  assert.ok(score(reversedBike, "bicycle", true).confirmedRestrictionMeters > 100);
  assert.ok(score(way({ oneway: "yes", "oneway:bicycle": "no" }), "car", true).confirmedRestrictionMeters > 100);
  assert.equal(score(way({ oneway: "-1", "oneway:bicycle": "yes" }, 1, besideRoute), "bicycle", true).matchedCoveragePercent, 0);
});

test("blocked nearest geometry cannot borrow surface from an accessible parallel road", () => {
  // Blocked road 3 m away (not under the route), accessible asphalt 7 m on the other side.
  const blocked = way({ motor_vehicle: "no", surface: "sett" }, 1, coordinates.map(([lon, lat]) => [lon, lat + 0.000027]));
  const parallel = way({}, 2, coordinates.map(([lon, lat]) => [lon, lat - 0.000063]));
  const result = score([...blocked, ...parallel]);
  assert.equal(result.matchedCoveragePercent, 0);
  assert.equal(result.unknownMeters, result.totalMeters);
  assert.equal(result.matchedFeatures, 0);
  // Under the route, the blocked road's own stones are reported, never the parallel asphalt.
  const under = score([...way({ motor_vehicle: "no", surface: "sett" }), ...way({}, 2, besideRoute)]);
  assert.equal(under.confirmedMeters, under.totalMeters);
  assert.equal(under.smoothMeters, 0);
  assert.ok(under.confirmedRestrictionMeters > 100);
});

test("overlapping grades remain unknown instead of sharing a geometric identity", () => {
  const surface = way({ layer: "0" });
  const bridge = way({ layer: "1", bridge: "yes", surface: "sett" }, 2);
  const result = score([...surface, ...bridge]);
  assert.equal(result.matchedCoveragePercent, 0);
  assert.ok(result.ambiguousMatchesCount > 0);
  assert.deepEqual(result, score([...bridge, ...surface]));
});

test("unknown highway remains unknown and known-surface feature counts use source ways", () => {
  assert.equal(way({ highway: "" })[0].highwayClass, "unknown");
  const split = way({}, 1, [coordinates[0], [9.191, 45.46], coordinates[1]]);
  assert.equal(score(split).matchedFeatures, 1);
  assert.equal(score(split).matchedSegments, 2);
  assert.equal(score(way({ surface: "" })).matchedFeatures, 0);
});

test("conditional or unresolved access and direction cannot imply permitted travel", () => {
  for (const tags of [
    { access: "private" },
    { "motor_vehicle:conditional": "no @ (08:00-18:00)" },
    { oneway: "reversible" },
    { "oneway:conditional": "yes @ (08:00-18:00)" },
  ]) {
    assert.equal(score(way(tags, 1, besideRoute)).matchedCoveragePercent, 0);
    // Under the route the surface is still the surface; no permission is inferred from it.
    assert.equal(score(way(tags)).matchedCoveragePercent, 100);
  }
  assert.equal(score(way({ junction: "roundabout" }, 1, besideRoute), "car", true).matchedCoveragePercent, 0);
  assert.ok(score(way({ junction: "roundabout" }), "car", true).confirmedRestrictionMeters > 100);
});

test("explicit mode-specific oneway overrides generic conditional oneway without leaking to cars", () => {
  const segments = way({
    oneway: "yes",
    "oneway:conditional": "no @ (00:00-06:00)",
    "oneway:motorcycle": "no",
    "oneway:bicycle": "no",
  });
  assert.equal(score(way({
    oneway: "yes", "oneway:conditional": "no @ (00:00-06:00)", "oneway:motorcycle": "no", "oneway:bicycle": "no",
  }, 1, besideRoute), "car").matchedCoveragePercent, 0);
  assert.equal(score(segments, "car").confirmedRestrictionMeters, 0);
  assert.equal(score(segments, "motorcycle").matchedCoveragePercent, 100);
  assert.equal(score(segments, "motorcycle", true).matchedCoveragePercent, 100);
  assert.equal(score(segments, "bicycle").matchedCoveragePercent, 100);
  assert.equal(score(segments, "bicycle", true).matchedCoveragePercent, 100);
});

test("separately mapped cycleways are not counted as facilities on a motor road", () => {
  for (const cycleway of ["no", "separate", "unknown_value", "shared_lane"]) {
    assert.equal(score(way({ cycleway })).cyclewayMeters, 0);
  }
  assert.ok(score(way({ "cycleway:right": "no", "cycleway:left": "lane" })).cyclewayMeters > 0);
});
