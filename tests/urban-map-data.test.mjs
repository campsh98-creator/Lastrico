import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadUrbanViewport, urbanLabels } from "../lib/urban-map-data.ts";

const assets = new URL("../public/urban-map/v1/", import.meta.url);
const sources = new URL("../data/sources/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", assets), "utf8"));

test("checked-in OSM assets are spatially indexed, attributed and bounded", async () => {
  const ids = new Set();
  const counts = new Map();
  let uncertainSignals = 0;
  assert.equal(manifest.license, "ODbL-1.0");
  assert.equal(manifest.copyright, "https://www.openstreetmap.org/copyright");
  assert.ok(manifest.provenance.every(({ sha256, bbox, retrievedAt }) =>
    /^[a-f\d]{64}$/.test(sha256) && bbox.length === 4 && Number.isFinite(Date.parse(retrievedAt))));
  const files = Object.entries(manifest.tiles).flatMap(([group, tiles]) => tiles.map((tile) => ({ group, tile })));
  for (const { group, tile } of files) {
    const raw = await readFile(new URL(`${group}_${tile}.json`, assets));
    assert.ok(gzipSync(raw).length < 125_000, `compressed tile exceeds budget: ${tile}`);
    for (const feature of JSON.parse(raw)) {
      const expectedTile = feature.coordinate.map((value) => Math.floor(value / manifest.cellSize)).join("_");
      assert.equal(tile, expectedTile);
      assert.ok(Object.hasOwn(urbanLabels, feature.category));
      assert.match(feature.osm, /^(node|way|relation)\/\d+$/);
      assert.ok(!ids.has(feature.id));
      ids.add(feature.id);
      counts.set(feature.category, (counts.get(feature.category) ?? 0) + 1);
      if (feature.category === "speed") assert.match(feature.detail, /^[1-9]\d{0,2} (km\/h|mph)$/);
      if (feature.bearing !== undefined) assert.ok(feature.bearing >= 0 && feature.bearing < 360);
      if (feature.directionUncertain) {
        assert.equal(feature.bearing, undefined);
        if (feature.category === "signal") uncertainSignals += 1;
      }
    }
  }
  for (const [category, count] of counts) {
    assert.equal(count, Object.values(manifest.counts).reduce((sum, area) => sum + (area[category] ?? 0), 0));
  }
  assert.ok(uncertainSignals > 0, "ambiguous tagged signal approaches are preserved for browsing only");
});

test("opposite directions retain distinct explicit speed tags and geometry from the Rome snapshot", async () => {
  const raw = gunzipSync(await readFile(new URL("rome-se.osm.json.gz", sources)));
  const way = JSON.parse(raw).elements.find((item) => item.type === "way" && item.id === 1500811298);
  assert.ok(way, "the sample remains traceable to the original snapshot");
  const tile = JSON.parse(await readFile(new URL("street_628_2091.json", assets), "utf8"));
  const samples = tile.filter((item) => item.osm === "way/1500811298" && item.category === "speed");
  assert.equal(samples.length, 2);
  assert.deepEqual(samples[0].segment, samples[1].segment);
  assert.equal(samples.find(({ bearing }) => bearing === 145).detail, `${way.tags["maxspeed:forward"]} km/h`);
  assert.equal(samples.find(({ bearing }) => bearing === 325).detail, `${way.tags["maxspeed:backward"]} km/h`);
});

test("viewport queries coalesce requests and distinguish source scope, zoom and missing tiles", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    const file = url.split("/").at(-1);
    if (file === "street_628_2091.json") return new Response(null, { status: 503 });
    return new Response(await readFile(new URL(file, assets), "utf8"));
  });
  const bounds = [9.183, 45.461, 9.199, 45.468];
  const [first, second] = await Promise.all([loadUrbanViewport(bounds, "places"), loadUrbanViewport(bounds, "places")]);
  assert.deepEqual(first, second);
  assert.equal(first.coverage, "covered");
  assert.equal(first.pointCoverage, "covered");
  assert.ok(first.features.some(({ name }) => name === "Pam Local"));
  assert.equal(requests.length, 2);
  assert.ok(requests[1].endsWith("places_459_2273.json"));
  await loadUrbanViewport(bounds, "places");
  assert.equal(requests.length, 2, "a repeated viewport uses the local cache");
  const street = await loadUrbanViewport(bounds, "street");
  assert.ok(street.features.some(({ category }) => category === "signal"));
  assert.ok(street.features.every(({ name }) => name !== "Pam Local"));
  assert.equal(requests.length, 3);
  assert.ok(requests[2].endsWith("street_459_2273.json"));
  const combined = await loadUrbanViewport(bounds);
  assert.equal(combined.features.length, first.features.length + street.features.length);
  assert.equal(requests.length, 3);

  const noRecords = await loadUrbanViewport([16.360001, 38.290001, 16.360002, 38.290002]);
  assert.deepEqual(noRecords, { features: [], coverage: "covered", pointCoverage: "covered" });
  const outside = await loadUrbanViewport([10, 44, 10.001, 44.001]);
  assert.deepEqual(outside, { features: [], coverage: "missing", pointCoverage: "missing" });
  const roadOnly = await loadUrbanViewport([12.495, 41.905, 12.496, 41.906]);
  assert.equal(roadOnly.coverage, "covered");
  assert.equal(roadOnly.pointCoverage, "missing");
  const offline = await loadUrbanViewport([12.577, 41.832, 12.579, 41.833]);
  assert.deepEqual(offline, { features: [], coverage: "missing", pointCoverage: "missing", unavailable: true });
  const wide = await loadUrbanViewport([8, 40, 13, 47]);
  assert.equal(wide.coverage, "zoom");
});

test("Policlinico routing access is a real entrance node shared with a mapped road", async () => {
  const tile = JSON.parse(await readFile(new URL("places_459_2272.json", assets), "utf8"));
  const place = tile.find(({ osm }) => osm === "relation/8187983");
  assert.deepEqual(place.access, { coordinate: [9.1949011, 45.4589944], osm: "node/13110609536", road: "way/429719349" });
  assert.notDeepEqual(place.coordinate, place.access.coordinate);
  const raw = gunzipSync(await readFile(new URL("milan-pilot-se.osm.json.gz", sources)));
  const elements = JSON.parse(raw).elements;
  const entrance = elements.find(({ type, id }) => type === "node" && id === 13110609536);
  const road = elements.find(({ type, id }) => type === "way" && id === 429719349);
  assert.equal(entrance.tags.entrance, "yes");
  assert.ok(road.nodes.includes(entrance.id));
});
