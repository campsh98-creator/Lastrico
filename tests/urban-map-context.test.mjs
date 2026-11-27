import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import { matchUpcomingUrbanFeatures, urbanDestination, urbanPoiCategory, urbanRouteWindow, urbanSearchText } from "../lib/urban-map-context.ts";

const south = [9.19, 45.46];
const north = [9.19, 45.461];
const midpoint = [9.19, 45.4605];

test("matches directional limits to the approaching route and ignores nearby unassociated signs", () => {
  const features = [
    { id: "30", osm: "way/100", category: "speed", coordinate: midpoint, bearing: 0, detail: "30 km/h", segment: [south, north] },
    { id: "50", osm: "way/100", category: "speed", coordinate: midpoint, bearing: 180, detail: "50 km/h", segment: [south, north] },
    { id: "nearby", osm: "way/100", category: "speed", coordinate: [9.19015, midpoint[1]], bearing: 0, segment: [south, north] },
    { id: "unknown", category: "stop", coordinate: midpoint },
    { id: "crossing", category: "crossing", coordinate: midpoint },
  ];
  const route = (a, b) => [{ coordinate: a, meters: 0 }, { coordinate: b, meters: 111, incomingWay: "way/100" }];
  assert.deepEqual(matchUpcomingUrbanFeatures(features, route(south, north)).map(({ feature }) => feature.id), ["30", "crossing"]);
  assert.deepEqual(matchUpcomingUrbanFeatures(features, route(north, south)).map(({ feature }) => feature.id), ["50", "crossing"]);
});

test("route windows include actual bends and stop at arrival", () => {
  const bend = [9.191, 45.46];
  const model = buildRouteProgressModel([south, bend, north], [], () => 100);
  assert.deepEqual(urbanRouteWindow(model, 50, 300).map(({ meters }) => meters), [50, 100, 200]);
  assert.deepEqual(urbanRouteWindow(model, 200, 300), []);
});

test("POI search classifies verified tags and folds accents", () => {
  assert.equal(urbanPoiCategory("amenity", "charging_station"), "charging");
  assert.equal(urbanPoiCategory("aeroway", "aerodrome"), "airport");
  assert.equal(urbanPoiCategory("shop", "vacant"), undefined);
  assert.equal(urbanPoiCategory("highway", "station"), undefined);
  assert.equal(urbanSearchText("  Università  "), "universita");
});

test("conflicting limits from adjacent Milan branches do not win on the mapped road", () => {
  const url = new URL("../public/urban-map/v1/street_458_2271.json", import.meta.url);
  const features = JSON.parse(readFileSync(url)).filter(({ osm, category }) =>
    category === "speed" && ["way/1056986321", "way/273261079", "way/30453197"].includes(osm));
  assert.equal(new Set(features.map(({ osm }) => osm)).size, 3);
  const points = [
    { coordinate: [9.1746533, 45.4375995], meters: 0 },
    { coordinate: [9.1740175, 45.437614], meters: 50, incomingWay: "way/1056986321" },
  ];
  const matches = matchUpcomingUrbanFeatures(features, points);
  assert.deepEqual(matches.map(({ feature }) => feature.detail), ["50 km/h"]);
  assert.deepEqual(matchUpcomingUrbanFeatures(features, points.map(({ coordinate, meters }) => ({ coordinate, meters }))), []);
});

test("nearby distinct ways cannot supply a limit or a regulatory sign at a split or crossing", () => {
  const turn = [9.190015, 45.461];
  const rampEnd = [9.19003, 45.462];
  const split = [
    { coordinate: south, meters: 0 },
    { coordinate: turn, meters: 111, incomingWay: "way/101" },
    { coordinate: rampEnd, meters: 222, incomingWay: "way/102" },
  ];
  const regulatory = [
    // Both different ways are close and have the same bearing, and one has no competing speed limit.
    { id: "parallel", osm: "way/110", category: "speed", coordinate: midpoint, segment: [south, north], detail: "30 km/h" },
    { id: "ramp", osm: "way/111", category: "speed", coordinate: [9.19002, 45.4615], segment: [turn, rampEnd], detail: "50 km/h" },
    { id: "junction", osm: "node/999", approachWay: "way/110", category: "stop", coordinate: turn, segment: [south, turn], bearing: 0 },
    { id: "coincident", osm: "way/112", category: "sign", detail: "IT:B2", coordinate: midpoint, segment: [south, turn], bearing: 0 },
  ];
  assert.deepEqual(matchUpcomingUrbanFeatures(regulatory, split), []);
  const supported = { ...regulatory[2], approachWay: "way/101" };
  assert.deepEqual(matchUpcomingUrbanFeatures([supported], split).map(({ feature }) => feature.id), ["junction"]);
});

test("conflicting values on a verified way are still suppressed", () => {
  const points = [{ coordinate: south, meters: 0 }, { coordinate: north, meters: 111, incomingWay: "way/10" }];
  const base = { osm: "way/10", category: "speed", coordinate: midpoint, segment: [south, north] };
  assert.deepEqual(matchUpcomingUrbanFeatures([
    { ...base, id: "30", detail: "30 km/h" },
    { ...base, id: "50", detail: "50 km/h" },
  ], points), []);
});

test("a POI destination uses only traceable entrance coordinates", () => {
  const place = { coordinate: midpoint, osm: "relation/1", category: "hospital" };
  assert.equal(urbanDestination(place), null);
  assert.equal(urbanDestination({ ...place, access: { coordinate: south, osm: "way/1", road: "way/2" } }), null);
  assert.deepEqual(urbanDestination({ ...place, access: { coordinate: south, osm: "node/1", road: "way/2" } }), south);
});
