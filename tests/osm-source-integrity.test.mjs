import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractHighways } from "../scripts/osm/build-representative-network.mjs";
import { clipEdge, runIngestion } from "../scripts/osm/ingest.mjs";
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
const root = new URL("../", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("every derived highway is reproducible from checksummed original OSM API responses", async () => {
  const metadata = JSON.parse(await readFile(new URL("data/sources/milan-pilot-osm.source.json", root)));
  const responses = [];
  for (const source of metadata.sources) {
    assert.equal(new URL(source.url).origin, "https://api.openstreetmap.org");
    const raw = gunzipSync(await readFile(new URL(`data/sources/${source.file}`, root)));
    assert.equal(hash(raw), source.sha256);
    responses.push(JSON.parse(raw));
  }
  const network = await readFile(new URL("data/milan-road-network-representative.json", root), "utf8");
  assert.equal(hash(network), metadata.networkSha256);
  assert.deepEqual(JSON.parse(network), extractHighways(responses));
  assert.ok(JSON.parse(network).some((way) => !way.tags.surface), "network selection must retain unmapped surface");
});

test("linear pilot denominator excludes polygon boundaries and clips all endpoints", async () => {
  const manifest = JSON.parse(await readFile(new URL("data/surfaces/milan-central.manifest.json", root)));
  const segments = JSON.parse(await readFile(new URL("data/surfaces/milan-central.json", root)));
  const b = manifest.area.bounds;
  assert.ok(manifest.validation.excludedAreaWays > 0);
  for (const segment of segments) {
    assert.notEqual(segment.rawTags.area, "yes");
    assert.equal(segment.surface.sourceId, `osm:way:${segment.osmWayId}`);
    for (const [lon, lat] of segment.coordinates) {
      assert.ok(lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north);
    }
  }
  assert.equal(manifest.statistics.totalLengthMeters, Math.round(segments.reduce((n, s) => n + s.lengthMeters, 0)));
});

test("edge clipping handles crossings, excursions and zero-length geometry without invented links", () => {
  const bounds = { west: 0, south: 0, east: 1, north: 1 };
  assert.deepEqual(clipEdge([-1, 0.5], [2, 0.5], bounds), [[0, 0.5], [1, 0.5]]);
  assert.deepEqual(clipEdge([0.5, 0.5], [2, 0.5], bounds), [[0.5, 0.5], [1, 0.5]]);
  assert.equal(clipEdge([-1, 2], [2, 2], bounds), null);
  assert.equal(clipEdge([0.5, 0.5], [0.5, 0.5], bounds), null);
  assert.equal(clipEdge([-1, 1], [1, -1], bounds), null);
});

test("ingestion rejects an edited derived network without matching provenance", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-source-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "edited.json");
  await writeFile(sourcePath, "[]");
  await assert.rejects(runIngestion({ sourcePath, outputDir: dir }), /checksum/);
});

test("generic paved does not become evidence of a smooth surface", () => {
  const normalized = normalizeOsmFeature({ id: 1, tags: { highway: "residential", surface: "paved" }, coordinates: [[9.19, 45.46], [9.191, 45.46]] });
  assert.equal(normalized.surfaceCategory, "unknown");
});

test("authentic Milan stone and concrete surface tags map to verified categories", () => {
  const coords = [[9.19, 45.46], [9.191, 45.46]];
  for (const surface of ["cobblestone:flattened", "cobblestone:flattened:large_stone", "milanese_paving", "pebblestone"]) {
    const normalized = normalizeOsmFeature({ id: 10, tags: { highway: "residential", surface }, coordinates: coords });
    assert.equal(normalized.surfaceCategory, "confirmed_rough", `expected ${surface} to be confirmed_rough`);
  }
  for (const surface of ["concrete:plates", "concrete:lanes"]) {
    const normalized = normalizeOsmFeature({ id: 11, tags: { highway: "residential", surface }, coordinates: coords });
    assert.equal(normalized.surfaceCategory, "confirmed_smooth", `expected ${surface} to be confirmed_smooth`);
  }
});

test("surface_bike fallback, official bicycle access, and embedded rails are correctly recognized", () => {
  const coords = [[9.19, 45.46], [9.191, 45.46]];
  const bikeSett = normalizeOsmFeature({ id: 20, tags: { highway: "residential", surface_bike: "milanese_paving" }, coordinates: coords });
  assert.equal(bikeSett.surfaceCategory, "confirmed_rough");
  assert.equal(bikeSett.material, "sett");
  assert.equal(bikeSett.segments[0].surface.value, "sett");

  const officialBike = normalizeOsmFeature({ id: 21, tags: { highway: "pedestrian", bicycle: "official", motor_vehicle: "destination" }, coordinates: coords });
  assert.equal(officialBike.segments[0].modeAccess.bicycle, true);

  const tramWay = normalizeOsmFeature({ id: 22, tags: { highway: "residential", tram: "yes" }, coordinates: coords });
  assert.equal(tramWay.segments[0].embeddedRails, true);

  const platform = normalizeOsmFeature({ id: 23, tags: { highway: "platform", tram: "yes" }, coordinates: coords });
  assert.equal(platform.segments[0].embeddedRails, false);
});

test("ingestion records malformed vertices as invalid ways rather than crashing during deduplication", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-invalid-source-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw = JSON.stringify([{ id: 1, tags: { highway: "residential" }, coordinates: [null, [9.19, 45.46]] }]);
  const metadata = JSON.parse(await readFile(new URL("data/sources/milan-pilot-osm.source.json", root)));
  // Test-only provenance; never written into the production archive.
  metadata.networkSha256 = hash(raw);
  const sourcePath = join(dir, "fixture.json"), sourceMetadataPath = join(dir, "fixture.source.json");
  await writeFile(sourcePath, raw);
  await writeFile(sourceMetadataPath, JSON.stringify(metadata));
  const result = await runIngestion({ sourcePath, sourceMetadataPath, outputDir: dir });
  const manifest = JSON.parse(await readFile(result.manifestPath));
  assert.equal(result.segmentsCount, 0);
  assert.equal(manifest.validation.invalidWays, 1);
  assert.match(manifest.validation.validationErrors[0].errors[0], /Point 0/);
});
