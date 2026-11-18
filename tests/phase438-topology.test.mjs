import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { createRoadIntelligenceIndex, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";
import { SpatialRoadIntelligenceStore } from "../lib/spatial-road-store.ts";
import { compileCompactSegments } from "../scripts/osm/compile-compact-tiles.mjs";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { evaluateOsmTurnRestrictions } from "../scripts/osm/turn-restrictions.mjs";

const points = [[9.2, 45.45], [9.202, 45.45]];
const modes = ["car", "motorcycle", "bicycle"];
function circular(tags, coordinates = points) {
  return normalizeOsmFeature({ id: 713165261, coordinates, tags: {
    highway: "primary", junction: "circular", surface: "asphalt", ...tags,
  } }).segments[0];
}

test("circular defaults retain inferred direction for every mode without blocking a route", () => {
  const segment = circular({});
  assert.deepEqual(segment.modeDirections, { car: "forward", motorcycle: "forward", bicycle: "forward" });
  assert.equal(segment.inferredCircularOnewayModes, 7);
  const parallel = circular({}, points.map(([lon, lat]) => [lon, lat + 0.00005]));
  for (const mode of modes) {
    const reverse = [...points].reverse();
    const index = createRoadIntelligenceIndex([parallel]);
    assert.equal(scoreRoadIntelligence(points, index, 12, mode).matchedCoveragePercent, 100);
    assert.equal(scoreRoadIntelligence(reverse, index, 12, mode).matchedCoveragePercent, 0);
    const onRoad = scoreRoadIntelligence(reverse, createRoadIntelligenceIndex([segment]), 12, mode);
    assert.equal(onRoad.confirmedRestrictionMeters, 0);
    assert.equal(onRoad.smoothMeters, onRoad.totalMeters);
  }
});

test("circular direction keeps bidirectional, reverse, modal, conditional and access precedence", () => {
  const both = circular({ oneway: "no" });
  assert.deepEqual(both.modeDirections, { car: "both", motorcycle: "both", bicycle: "both" });
  assert.equal(both.inferredCircularOnewayModes, undefined);
  const reverse = circular({ oneway: "-1", "oneway:bicycle": "no", access: "no", motorcar: "yes", bicycle: "yes" });
  assert.deepEqual(reverse.coordinates, [...points].reverse());
  assert.deepEqual(reverse.modeDirections, { car: "forward", motorcycle: "forward", bicycle: "both" });
  assert.deepEqual(reverse.modeAccess, { car: true, motorcycle: false, bicycle: true });
  const index = createRoadIntelligenceIndex([reverse]);
  assert.ok(scoreRoadIntelligence(points, index, 12, "car").blockingRestrictionMeters > 100);
  assert.ok(scoreRoadIntelligence([...points].reverse(), index, 12, "motorcycle").blockingRestrictionMeters > 100);
  assert.equal(scoreRoadIntelligence(points, index, 12, "bicycle").blockingRestrictionMeters, 0);

  const modal = circular({ "oneway:motorcar": "-1", "oneway:bicycle": "no" });
  assert.deepEqual(modal.modeDirections, { car: "backward", motorcycle: "forward", bicycle: "both" });
  assert.equal(modal.inferredCircularOnewayModes, 2);
  assert.ok(scoreRoadIntelligence(points, createRoadIntelligenceIndex([modal]), 12, "car").blockingRestrictionMeters > 100);
  const conditional = circular({ "oneway:conditional": "yes @ (08:00-18:00)", "oneway:motorcycle": "no" });
  assert.deepEqual(conditional.modeDirections, { car: "unknown", motorcycle: "both", bicycle: "unknown" });
  assert.equal(conditional.inferredCircularOnewayModes, undefined);
  assert.equal(circular({ cycleway: "opposite_lane" }).modeDirections.bicycle, "both");
});

test("compact tiles round-trip inferred and explicit modal direction and accept legacy tiles", () => {
  const segment = circular({ "oneway:motorcar": "-1", "oneway:bicycle": "no" });
  const legacy = normalizeOsmFeature({ id: 713165261, coordinates: points, tags: {
    highway: "primary", junction: "circular", surface: "asphalt",
  } }, { topologyRules: "legacy" }).segments[0];
  const manifest = { checksums: { datasetSha256: "fixture" }, generatedAt: "2026-11-04T00:00:00Z" };
  for (const slim of [false, true]) {
    const compact = compileCompactSegments([segment], { manifest, slim });
    const [hydrated] = new SpatialRoadIntelligenceStore(compact).getAllRoads();
    assert.deepEqual(hydrated.modeDirections, segment.modeDirections);
    assert.equal(hydrated.inferredCircularOnewayModes, 2);
    const index = createRoadIntelligenceIndex([hydrated]);
    assert.ok(scoreRoadIntelligence(points, index, 12, "car").blockingRestrictionMeters > 100);
    assert.equal(scoreRoadIntelligence([...points].reverse(), index, 12, "motorcycle").blockingRestrictionMeters, 0);

    const [hydratedLegacy] = new SpatialRoadIntelligenceStore(compileCompactSegments([legacy], { manifest, slim })).getAllRoads();
    assert.deepEqual(hydratedLegacy.modeDirections, { car: "both", motorcycle: "both", bicycle: "both" });
    assert.equal(hydratedLegacy.inferredCircularOnewayModes, undefined);
  }
});

const ways = new Map(Object.entries({ 11: [1, 2], 22: [2, 3], 33: [2, 4], 55: [3, 5, 6], 66: [6, 7], 77: [5, 8], 88: [9, 2] })
  .map(([id, nodes]) => [Number(id), { id: Number(id), nodes }]));
const edge = (wayId, fromNodeId, toNodeId) => ({ wayId, fromNodeId, toNodeId });
const member = (role, ref, type = "way") => ({ role, ref, type });
const relation = (tags, members = [member("from", 11), member("via", 2, "node"), member("to", 22)]) => ({
  id: 444, tags: { type: "restriction", ...tags }, members,
});
const evaluate = (traversal, relations, mode = "car", coverageComplete = true) =>
  evaluateOsmTurnRestrictions({ ways, relations, traversal, mode, coverageComplete });
const approach = edge(11, 1, 2);
const left = edge(22, 2, 3);
const right = edge(33, 2, 4);

test("node-based no/only relations respect modal values and exceptions", () => {
  const no = relation({ restriction: "no_left_turn", except: "bicycle;psv" });
  for (const mode of ["car", "motorcycle"]) {
    assert.deepEqual(evaluate([approach, left], [no], mode).restrictions, [
      { relationId: 444, index: 0, status: "prohibited", reason: "no_left_turn" },
    ]);
  }
  assert.equal(evaluate([approach, left], [no], "bicycle").status, "no-known-restriction");
  assert.equal(evaluate([approach, right], [no]).status, "no-known-restriction");
  const only = relation({ "restriction:motor_vehicle": "only_left_turn", "restriction:motorcycle": "no_left_turn" });
  assert.equal(evaluate([approach, right], [only]).status, "prohibited");
  assert.equal(evaluate([approach, right], [only], "motorcycle").status, "no-known-restriction");
  assert.equal(evaluate([approach, left], [only], "motorcycle").status, "prohibited");
  assert.equal(evaluate([approach, right], [only], "bicycle").status, "no-known-restriction");
  const uTurn = relation({ restriction: "no_u_turn" }, [member("from", 11), member("via", 2, "node"), member("to", 11)]);
  assert.equal(evaluate([approach, edge(11, 2, 1)], [uTurn]).status, "prohibited");
  const noEntry = relation({ restriction: "no_entry" }, [member("from", 11), member("from", 88), member("via", 2, "node"), member("to", 22)]);
  assert.equal(evaluate([edge(88, 9, 2), left], [noEntry]).status, "prohibited");
});

test("via-way members are traversed in order using the directed OSM edge sequence", () => {
  const via = [member("from", 11), member("via", 22), member("via", 55), member("to", 66)];
  const path = [approach, left, edge(55, 3, 5), edge(55, 5, 6), edge(66, 6, 7)];
  const earlyExit = [approach, left, edge(55, 3, 5), edge(77, 5, 8)];
  const no = relation({ restriction: "no_straight_on" }, via);
  const only = relation({ restriction: "only_straight_on" }, via);
  assert.equal(evaluate(path, [no]).status, "prohibited");
  assert.equal(evaluate(path, [only]).status, "no-known-restriction");
  assert.equal(evaluate(earlyExit, [no]).status, "no-known-restriction");
  assert.equal(evaluate(earlyExit, [only]).status, "prohibited");
  assert.equal(evaluate(path.slice(0, -1), [only]).restrictions[0].reason, "traversal-ends");
  assert.equal(evaluate(path, [relation({ restriction: "no_straight_on" }, [via[0], via[2], via[1], via[3]])]).status, "unknown");
});

test("unavailable evidence and ambiguous relations produce no permission verdict", () => {
  assert.equal(evaluate([approach, left], [], "car", false).reason, "incomplete-coverage");
  assert.equal(evaluate([approach, edge(66, 6, 7)], []).reason, "unresolved-traversal");
  const conditional = relation({ "restriction:bicycle:conditional": "no_left_turn @ (Mo-Fr 08:00-09:00)" });
  assert.equal(evaluate([approach, left], [conditional], "bicycle").restrictions[0].reason, "conditional");
  assert.equal(evaluate([approach, left], [conditional], "car").status, "no-known-restriction");
  const invalid = relation({ restriction: "only_left_turn" }, [member("from", 11), member("via", 2, "node"), member("to", 999)]);
  assert.equal(evaluate([approach, left], [invalid]).restrictions[0].reason, "unresolved-topology");
  const unfamiliar = relation({ restriction: "no_turn_on_red" });
  assert.equal(evaluate([approach, left], [unfamiliar]).restrictions[0].reason, "unsupported-value");
});

test("an archived Milan restriction exempts motorcycles and bicycles from its no-left-turn", () => {
  const file = new URL("../data/sources/milan-pilot-nw.osm.json.gz", import.meta.url);
  const { elements } = JSON.parse(gunzipSync(readFileSync(file)));
  const archiveWays = new Map(elements.filter((element) => element.type === "way").map((way) => [way.id, way]));
  const restriction = elements.find((element) => element.type === "relation" && element.id === 16115966);
  assert.ok(restriction);
  const traversal = [edge(163757284, 11072778865, 1584826185), edge(1191244697, 1584826185, 11059630283)];
  const input = { ways: archiveWays, relations: [restriction], traversal };
  assert.equal(evaluateOsmTurnRestrictions({ ...input, mode: "car" }).status, "prohibited");
  for (const mode of ["motorcycle", "bicycle"]) {
    assert.deepEqual(evaluateOsmTurnRestrictions({ ...input, mode }), {
      status: "unknown", reason: "incomplete-coverage", restrictions: [],
    });
  }
});
