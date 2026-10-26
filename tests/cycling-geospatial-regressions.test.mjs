import assert from "node:assert/strict";
import test from "node:test";
import { matchCyclingToRoadSegment, normalizeMunicipalCyclingFeature } from "../lib/adapters/milan-cycling-adapter.ts";

const line = [[9.19, 45.46], [9.192, 45.46]];
const road = { coordinates: line, name: "Via Test", bearing: 90 };
function cycling(coordinates = line, direction = "bidirezionale", id = 1) {
  return normalizeMunicipalCyclingFeature({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { id, anagrafica: "Via Test", tipologia: "sede propria", marcia: direction },
  }, "2026-10-26T00:00:00Z");
}

test("cycling matcher rejects distant namesakes, crossings and endpoint-only proximity", () => {
  for (const geometry of [
    [[12, 43], [12, 44]],
    [[9.191, 45.459], [9.191, 45.461]],
    [[9.192, 45.46], [9.194, 45.46]],
    [[9.1909, 45.46], [9.1911, 45.46]],
  ]) assert.equal(matchCyclingToRoadSegment(road, [cycling(geometry)]).matched, false);
});

test("cycling matcher validates distances and geometry instead of accepting malformed records", () => {
  for (const threshold of [NaN, Infinity, 0, -1]) {
    assert.equal(matchCyclingToRoadSegment(road, [cycling()], threshold).matched, false);
  }
  for (const geometry of [[], [null, line[1]], [[NaN, 45.46], line[1]], [line[0], line[0]]]) {
    assert.equal(matchCyclingToRoadSegment(road, [cycling(geometry)]).matched, false);
  }
  assert.equal(matchCyclingToRoadSegment({ ...road, coordinates: [line[0], line[0]] }, [cycling()]).matched, false);
});

test("cycling matcher respects digitized forward/reverse direction and rejects unknown direction", () => {
  assert.equal(matchCyclingToRoadSegment(road, [cycling(line, "monodirezionale concorde")]).matched, true);
  assert.equal(matchCyclingToRoadSegment(road, [cycling(line, "monodirezionale discorde")]).matched, false);
  assert.equal(matchCyclingToRoadSegment(road, [cycling([...line].reverse(), "monodirezionale discorde")]).matched, true);
  assert.equal(matchCyclingToRoadSegment(road, [cycling([...line].reverse())]).matched, true);
  const unknown = matchCyclingToRoadSegment(road, [cycling(line, "unknown")]);
  assert.equal(unknown.matched, false);
  assert.equal(unknown.ambiguous, true);
});

test("cycling matcher combines adjacent pieces and rejects multiple qualifying records", () => {
  const rec = cycling();
  rec.geometry = [[line[0], [9.191, 45.46]], [[9.191, 45.46], line[1]]];
  assert.equal(matchCyclingToRoadSegment(road, [rec]).matched, true);
  const nearby = cycling(line.map(([lon, lat]) => [lon, lat + 0.00002]), "bidirezionale", 2);
  const ambiguous = matchCyclingToRoadSegment(road, [rec, nearby]);
  assert.equal(ambiguous.matched, false);
  assert.equal(ambiguous.ambiguous, true);
  const distant = cycling([[12, 43], [12, 44]], "bidirezionale", 3);
  assert.equal(matchCyclingToRoadSegment(road, [rec, distant]).matched, true);
});

test("unknown municipal typology cannot invent a dedicated cycling facility", () => {
  const feature = { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { id: 1, tipologia: "unrecognized", marcia: "bidirezionale" } };
  const rec = normalizeMunicipalCyclingFeature(feature);
  assert.equal(rec.infrastructure.value.hasFacility, false);
  assert.equal(rec.infrastructure.state, "unknown");
  assert.equal(rec.infrastructure.confidence, 0);
  assert.equal(matchCyclingToRoadSegment(road, [rec]).matched, false);
});
