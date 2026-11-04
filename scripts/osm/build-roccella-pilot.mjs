/** Genuine OSM pilot. --download acquires source responses; default rebuilds offline. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { extractHighways } from "./build-representative-network.mjs";
import { runIngestion } from "./ingest.mjs";
import { compileCompactSegments } from "./compile-compact-tiles.mjs";
import { generateChunks } from "./generate-tile-chunks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = join(root, "data/sources");
export const ROCCELLA_BOUNDS = { west: 16.36, south: 38.29, east: 16.44, north: 38.35 };
export const ROCCELLA_TILES = [
  { name: "sw", bbox: [16.36, 38.29, 16.40, 38.32] },
  { name: "se", bbox: [16.40, 38.29, 16.44, 38.32] },
  { name: "nw", bbox: [16.36, 38.32, 16.40, 38.35] },
  { name: "ne", bbox: [16.40, 38.32, 16.44, 38.35] },
];
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function buildRoccellaPilot({ download = false, outputDirectory = join(root, "data") } = {}) {
  const metadataPath = join(sourceDir, "roccella-pilot-osm.source.json");
  if (download) {
    const sources = [], downloads = [];
    for (const tile of ROCCELLA_TILES) {
      const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${tile.bbox.join(",")}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Lastrico/0.5.0 (local open-source pilot; https://github.com/campsh98-creator/Lastrico)", "Accept": "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`OSM ${tile.name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      extractHighways([JSON.parse(bytes)]);
      const file = `roccella-pilot-${tile.name}.osm.json.gz`;
      sources.push({ file, url, bbox: tile.bbox, retrievedAt: new Date().toISOString(), serverDate: response.headers.get("date"), sha256: sha256(bytes) });
      downloads.push({ file, bytes: gzipSync(bytes) });
    }
    await mkdir(sourceDir, { recursive: true });
    for (const source of downloads) await writeFile(join(sourceDir, source.file), source.bytes);
    await writeFile(metadataPath, JSON.stringify({
      provider: "OpenStreetMap API 0.6", bounds: ROCCELLA_BOUNDS,
      selection: "All highway ways returned by four map requests; linear geometry clipped to operational pilot bounds. Includes town, historic streets, marina and local connecting roads; not an administrative boundary or field completeness claim.",
      temporalScope: "Four sequential live API responses, not an atomic historical snapshot; original element versions and edit timestamps preserved.",
      sources,
    }, null, 2) + "\n");
  }
  const provenance = JSON.parse(await readFile(metadataPath, "utf8"));
  const responses = [];
  for (const source of provenance.sources) {
    const bytes = gunzipSync(await readFile(join(sourceDir, source.file)));
    if (sha256(bytes) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.file}`);
    responses.push(JSON.parse(bytes));
  }
  const network = JSON.stringify(extractHighways(responses), null, 2) + "\n";
  provenance.networkSha256 = sha256(network);
  await mkdir(outputDirectory, { recursive: true });
  const sourcePath = join(outputDirectory, "roccella-road-network.json");
  const sourceMetadataPath = outputDirectory === join(root, "data") ? metadataPath : join(outputDirectory, "roccella-source.json");
  await writeFile(sourcePath, network);
  await writeFile(sourceMetadataPath, JSON.stringify(provenance, null, 2) + "\n");
  const outputDatasetPath = join(outputDirectory, "surfaces/roccella-pilot.json");
  const outputManifestPath = join(outputDirectory, "surfaces/roccella-pilot.manifest.json");
  await runIngestion({ sourcePath, sourceMetadataPath, outputDatasetPath, outputManifestPath,
    pilotArea: "ROCCELLA_PILOT",
    datasetVersion: `osm-api-roccella-${provenance.sources.at(-1).retrievedAt.slice(0, 10)}` });
  const segments = JSON.parse(await readFile(outputDatasetPath, "utf8"));
  const manifest = JSON.parse(await readFile(outputManifestPath, "utf8"));
  manifest.area.zoneId = "ROCCELLA_PILOT";
  manifest.area.description = "Roccella Ionica operational pilot (16.36–16.44 E, 38.29–38.35 N), not an administrative boundary";
  const compact = compileCompactSegments(segments, { manifest, preserveRawTags: true });
  const compactPath = join(outputDirectory, "surfaces/roccella-compact-tiles.json");
  const compactJson = JSON.stringify(compact);
  await writeFile(compactPath, compactJson);
  await generateChunks(
    "roccella",
    compactPath,
    join(outputDirectory, "surfaces/roccella-tiles"),
    join(root, "lib/roccella-tile-index.ts"),
  );
  manifest.checksums.compactSha256 = sha256(compactJson);
  manifest.statistics.compactBytes = Buffer.byteLength(compactJson);
  manifest.statistics.tileCount = Object.keys(compact.tiles).length;
  await writeFile(outputManifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { ...manifest.statistics, datasetSha256: manifest.checksums.datasetSha256, compactSha256: manifest.checksums.compactSha256 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildRoccellaPilot({ download: process.argv.includes("--download") }).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
}
