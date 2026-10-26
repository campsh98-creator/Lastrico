import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { runIngestion } from "../scripts/osm/ingest.mjs";

const datasetUrl = new URL("../data/surfaces/milan-central.json", import.meta.url);
const manifestUrl = new URL("../data/surfaces/milan-central.manifest.json", import.meta.url);

test("manifest matches dataset cryptographic SHA-256 and invariants", async () => {
  const [datasetRaw, manifestRaw] = await Promise.all([
    readFile(datasetUrl, "utf8"),
    readFile(manifestUrl, "utf8"),
  ]);

  const expectedSha256 = createHash("sha256").update(datasetRaw).digest("hex");
  const manifest = JSON.parse(manifestRaw);
  const segments = JSON.parse(datasetRaw);

  assert.equal(manifest.checksums.datasetSha256, expectedSha256);
  assert.equal(manifest.statistics.totalSegments, segments.length);
  assert.equal(manifest.schemaVersion, "2.0.0");
  assert.equal(manifest.sources[0].license, "ODbL-1.0");
  assert.ok(manifest.sources[0].attribution.includes("OpenStreetMap"));

  // Check that all segments have valid coordinates and hashes
  const hashes = new Set();
  for (const seg of segments) {
    assert.equal(typeof seg.segmentHash, "string");
    assert.equal(seg.segmentHash.length, 16);
    hashes.add(seg.segmentHash);
    assert.ok(seg.coordinates.length === 2);
    assert.ok(seg.lengthMeters > 0);
  }
});

test("re-running ingestion produces strictly reproducible output and checksum", async () => {
  const tmpDir = new URL("../data/surfaces/.tmp-test", import.meta.url).pathname;
  const result = await runIngestion({
    ingestedAt: "2026-10-26T00:00:00Z",
    datasetVersion: "2026.10.26-mil-central",
    outputDir: tmpDir,
    outputDatasetPath: `${tmpDir}/test.json`,
    outputManifestPath: `${tmpDir}/test.manifest.json`,
  });
  const currentManifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(result.checksum, currentManifest.checksums.datasetSha256);
  await rm(tmpDir, { recursive: true, force: true });
});
