import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractHighways } from "../scripts/osm/build-representative-network.mjs";
import { buildRoccellaPilot, ROCCELLA_BOUNDS, sha256 } from "../scripts/osm/build-roccella-pilot.mjs";
import { compileCompactSegments } from "../scripts/osm/compile-compact-tiles.mjs";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const json = async (path) => JSON.parse(await read(path));

test("Roccella network is reproducible exclusively from checksummed genuine OSM responses", async () => {
  const metadata = await json("data/sources/roccella-pilot-osm.source.json");
  assert.deepEqual(metadata.bounds, ROCCELLA_BOUNDS);
  assert.equal(metadata.sources.length, 4);
  const responses = [];
  for (const source of metadata.sources) {
    assert.equal(new URL(source.url).origin, "https://api.openstreetmap.org");
    const raw = gunzipSync(await readFile(new URL(`data/sources/${source.file}`, root)));
    assert.equal(sha256(raw), source.sha256);
    responses.push(JSON.parse(raw));
  }
  const network = await read("data/roccella-road-network.json");
  assert.equal(sha256(network), metadata.networkSha256);
  assert.deepEqual(JSON.parse(network), extractHighways(responses));
  assert.ok(JSON.parse(network).some((way) => !way.tags.surface));
});

test("Roccella compact source identity, unknown coverage and restrictions match normalized data", async () => {
  const segments = await json("data/surfaces/roccella-pilot.json");
  const manifest = await json("data/surfaces/roccella-pilot.manifest.json");
  const compactRaw = await read("data/surfaces/roccella-compact-tiles.json");
  const compact = JSON.parse(compactRaw);
  assert.equal(manifest.area.zoneId, "ROCCELLA_PILOT");
  assert.deepEqual(manifest.area.bounds, ROCCELLA_BOUNDS);
  assert.equal(sha256(await read("data/surfaces/roccella-pilot.json")), manifest.checksums.datasetSha256);
  assert.equal(sha256(compactRaw), manifest.checksums.compactSha256);
  assert.equal(compact.sourceDatasetSha256, manifest.checksums.datasetSha256);
  assert.equal(compact.totalSegments, segments.length);
  const tuples = new Map(Object.values(compact.tiles).flat().map((tuple) => [`${tuple[1]}:${tuple[0]}`, tuple]));
  for (const segment of segments) {
    const tuple = tuples.get(`${segment.osmWayId}:${segment.segmentHash}`);
    assert.ok(tuple);
    assert.deepEqual(compact.tagSets[tuple[13]], segment.rawTags);
    assert.notEqual(segment.rawTags.area, "yes");
    for (const [lon, lat] of segment.coordinates) {
      assert.ok(lon >= ROCCELLA_BOUNDS.west && lon <= ROCCELLA_BOUNDS.east);
      assert.ok(lat >= ROCCELLA_BOUNDS.south && lat <= ROCCELLA_BOUNDS.north);
    }
  }
  assert.ok(segments.some((segment) => segment.surfaceCategory === "unknown"));
  assert.equal(manifest.statistics.totalLengthMeters, Math.round(segments.reduce((sum, segment) => sum + segment.lengthMeters, 0)));
});

test("compact compiler preserves separate source ways sharing the same geometry", () => {
  const geometry = [[16.4, 38.32], [16.401, 38.32]];
  const segments = [1, 2].flatMap((id) => normalizeOsmFeature({ id, coordinates: geometry,
    tags: { highway: "residential", surface: id === 1 ? "asphalt" : "sett", access: id === 1 ? "yes" : "no" } }).segments);
  const compact = compileCompactSegments(segments, {
    manifest: { generatedAt: "fixture", checksums: { datasetSha256: "fixture-not-authoritative" } }, preserveRawTags: true,
  });
  assert.equal(compact.totalSegments, 2);
  const ids = new Set(Object.values(compact.tiles).flat().map((tuple) => tuple[1]));
  assert.deepEqual([...ids], [1, 2]);
});

test("Roccella offline rebuild reproduces dataset, compact tiles and manifest without touching Milan", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "lastrico-roccella-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const milanPath = "data/surfaces/milan-compact-tiles.json";
  const milanBefore = sha256(await read(milanPath));
  await buildRoccellaPilot({ outputDirectory: directory });
  for (const file of ["roccella-pilot.json", "roccella-pilot.manifest.json", "roccella-compact-tiles.json"]) {
    assert.equal(await readFile(join(directory, "surfaces", file), "utf8"), await read(`data/surfaces/${file}`));
  }
  assert.equal(sha256(await read(milanPath)), milanBefore);
});
