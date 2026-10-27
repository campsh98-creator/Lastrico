import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { createRoadIntelligenceIndex, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";

const coordinates = [[9.19, 45.46], [9.192, 45.46]];
const roads = (tags = {}, id = 1, points = coordinates) => normalizeOsmFeature({
  id, coordinates: points, tags: { highway: "residential", surface: "asphalt", ...tags },
}).segments;
const score = (segments, mode = "car", points = coordinates) => scoreRoadIntelligence(
  points, createRoadIntelligenceIndex(segments), 12, mode,
);

test("explicit restrictions are separate from surface uncertainty and respect mode exceptions", () => {
  const segments = roads({ access: "no", bicycle: "yes", motorcycle: "private" });
  const car = score(segments);
  assert.equal(car.confirmedRestrictionMeters, car.totalMeters);
  assert.equal(car.unknownMeters, car.totalMeters);
  assert.equal(score(segments, "bicycle").confirmedRestrictionMeters, 0);
  assert.ok(score(segments, "motorcycle").confirmedRestrictionMeters > 100);
  assert.equal(score(roads({ access: "private", motorcar: "yes" })).confirmedRestrictionMeters, 0);
  assert.equal(score(roads({ access: "no", motor_vehicle: "yes", motorcycle: "no" })).confirmedRestrictionMeters, 0);
  assert.ok(score(roads({ access: "no", motor_vehicle: "yes", motorcycle: "no" }), "motorcycle").confirmedRestrictionMeters > 100);
});

test("wrong-way evidence honors reverse one-way and bicycle counterflow", () => {
  const reverse = [...coordinates].reverse();
  assert.equal(score(roads({ oneway: "yes" })).confirmedRestrictionMeters, 0);
  assert.ok(score(roads({ oneway: "yes" }), "car", reverse).confirmedRestrictionMeters > 100);
  assert.ok(score(roads({ oneway: "-1" })).confirmedRestrictionMeters > 100);
  assert.equal(score(roads({ oneway: "-1" }), "car", reverse).confirmedRestrictionMeters, 0);
  for (const tags of [{ oneway: "yes", "oneway:bicycle": "no" }, { oneway: "yes", cycleway: "opposite_lane" }]) {
    assert.equal(score(roads(tags), "bicycle", reverse).confirmedRestrictionMeters, 0);
    assert.ok(score(roads(tags), "car", reverse).confirmedRestrictionMeters > 100);
  }
});

test("unknown access, conditional restrictions, bicycle pushing and defaults are not confirmed violations", () => {
  for (const tags of [
    { access: "unknown" }, { access: "destination" }, { access: "customers" },
    { access: "no", "access:conditional": "yes @ (08:00-18:00)" },
    { access: "no", "motorcar:conditional": "yes @ (08:00-18:00)" },
    { highway: "footway" }, { highway: "unknown" },
    { oneway: "yes", "oneway:conditional": "no @ (08:00-18:00)" },
    { oneway: "reversible" }, { access: "no", "motorcar:forward": "yes" },
  ]) assert.equal(score(roads(tags), "car", [...coordinates].reverse()).confirmedRestrictionMeters, 0);
  assert.equal(score(roads({ bicycle: "dismount", oneway: "yes" }), "bicycle", [...coordinates].reverse()).confirmedRestrictionMeters, 0);
  assert.equal(score(roads({ highway: "footway" }), "bicycle").confirmedRestrictionMeters, 0);
  assert.equal(score(roads({ oneway: "yes", "cycleway:left:oneway": "no" }), "bicycle", [...coordinates].reverse()).confirmedRestrictionMeters, 0);
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    assert.equal(score(roads({ highway: "service", service: "driveway", access: "private" }), mode).confirmedRestrictionMeters, 0);
    assert.ok(score(roads({ highway: "service", service: "driveway", access: "no" }), mode).confirmedRestrictionMeters > 100);
  }
});

test("nearby prohibited roads, endpoint touches and ambiguous grades cannot disqualify a route", () => {
  const blocked = roads({ access: "no" });
  const parallel = coordinates.map(([lon, lat]) => [lon, lat + 0.00005]);
  assert.equal(score(blocked, "car", parallel).confirmedRestrictionMeters, 0);
  const ambiguous = roads({}, 2, coordinates.map(([lon, lat]) => [lon, lat + 0.00001]));
  assert.equal(score([...blocked, ...ambiguous]).confirmedRestrictionMeters, 0);
  assert.equal(score([...ambiguous, ...blocked]).confirmedRestrictionMeters, 0);
  assert.equal(score([...blocked, ...roads({ bridge: "yes", layer: "1" }, 2)]).confirmedRestrictionMeters, 0);
  const touching = [coordinates[1], [9.194, 45.46]];
  assert.equal(score(blocked, "car", touching).confirmedRestrictionMeters, 0);
  const crossing = [[9.191, 45.459], [9.191, 45.461]];
  assert.equal(score(blocked, "car", crossing).confirmedRestrictionMeters, 0);
});

test("restriction evidence is independent of source ordering without changing surface metrics", () => {
  const blocked = roads({ access: "no" });
  const farther = roads({}, 2, coordinates.map(([lon, lat]) => [lon, lat + 0.00005]));
  assert.deepEqual(score([...blocked, ...farther]), score([...farther, ...blocked]));
  assert.equal(score([...blocked, ...farther]).smoothMeters, 0);
  assert.ok(score([...blocked, ...farther]).confirmedRestrictionMeters > 100);
});
