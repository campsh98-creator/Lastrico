import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import { matchUpcomingUrbanFeatures, urbanPoiCategory, urbanRouteWindow, urbanSearchText } from "../lib/urban-map-context.ts";

const south = [9.19, 45.46];
const north = [9.19, 45.461];
const midpoint = [9.19, 45.4605];

test("matches directional limits to the approaching route and ignores nearby unassociated signs", () => {
  const features = [
    { id: "30", category: "speed", coordinate: midpoint, bearing: 0, detail: "30 km/h", segment: [south, north] },
    { id: "50", category: "speed", coordinate: midpoint, bearing: 180, detail: "50 km/h", segment: [south, north] },
    { id: "nearby", category: "speed", coordinate: [9.19015, midpoint[1]], bearing: 0, segment: [south, north] },
    { id: "unknown", category: "stop", coordinate: midpoint },
    { id: "crossing", category: "crossing", coordinate: midpoint },
  ];
  const route = (a, b) => [{ coordinate: a, meters: 0 }, { coordinate: b, meters: 111 }];
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
    { coordinate: [9.1740175, 45.437614], meters: 50 },
  ];
  const matches = matchUpcomingUrbanFeatures(features, points);
  assert.equal(matches.some(({ feature }) => feature.detail === "40 km/h"), false);
});
