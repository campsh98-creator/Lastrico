/** Reproducible ingestion of the archived OSM pilot, clipped to its documented bounds. */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOsmFeature } from "./normalize.mjs";
import { validateCoordinates } from "./validate.mjs";
import { generateManifest } from "./manifest.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultSourcePath = join(rootDir, "data/milan-road-network-representative.json");
const defaultMetadataPath = join(rootDir, "data/sources/milan-pilot-osm.source.json");
const defaultOutputDir = join(rootDir, "data/surfaces");

// Liang–Barsky: preserve each source edge independently, never bridge an excursion outside the box.
export function clipEdge(a, b, bounds) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - bounds.west, bounds.east - a[0], a[1] - bounds.south, bounds.north - a[1]];
  let start = 0, end = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else if (p[i] < 0) start = Math.max(start, q[i] / p[i]);
    else end = Math.min(end, q[i] / p[i]);
    if (start >= end) return null;
  }
  if (dx === 0 && dy === 0) return null;
  const point = (t) => [Math.max(bounds.west, Math.min(bounds.east, a[0] + t * dx)), Math.max(bounds.south, Math.min(bounds.north, a[1] + t * dy))];
  return [point(start), point(end)];
}

export async function runIngestion(options = {}) {
  const sourcePath = options.sourcePath || defaultSourcePath;
  const rawText = await readFile(sourcePath, "utf8");
  const provenance = JSON.parse(await readFile(options.sourceMetadataPath || defaultMetadataPath, "utf8"));
  const sourceSha256 = createHash("sha256").update(rawText).digest("hex");
  if (sourceSha256 !== provenance.networkSha256) throw new Error("Derived road network checksum does not match archived-source provenance; rebuild it first");
  const rawFeatures = JSON.parse(rawText);
  const sourceDate = provenance.sources.map((s) => s.retrievedAt).sort().at(-1);
  const ingestedAt = options.ingestedAt || sourceDate;
  const datasetVersion = options.datasetVersion || `osm-api-pilot-${sourceDate.slice(0, 10)}`;
  const outDir = options.outputDir || defaultOutputDir;
  const outDataset = options.outputDatasetPath || join(outDir, "milan-central.json");
  const outManifest = options.outputManifestPath || join(outDir, "milan-central.manifest.json");
  const allSegments = [], validationErrors = [], jumpWarnings = [];
  let validWays = 0, excludedAreaWays = 0;
  for (const rawWay of rawFeatures) {
    if (rawWay.tags?.area === "yes") { excludedAreaWays++; continue; }
    const sourceCoords = Array.isArray(rawWay.coordinates) ? rawWay.coordinates : [];
    const coords = sourceCoords.filter((point, i, all) => i === 0
      || !Array.isArray(point) || point.length !== 2
      || !Array.isArray(all[i - 1]) || all[i - 1].length !== 2
      || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
    const val = validateCoordinates(coords, { west: -180, south: -90, east: 180, north: 90 });
    if (!val.valid) { validationErrors.push({ id: rawWay.id, errors: val.errors }); continue; }
    if (val.jumps.length) jumpWarnings.push({ id: rawWay.id, jumps: val.jumps });
    const countBefore = allSegments.length;
    for (let i = 1; i < coords.length; i++) {
      const edge = clipEdge(coords[i - 1], coords[i], provenance.bounds);
      if (edge) allSegments.push(...normalizeOsmFeature({ ...rawWay, coordinates: edge }, { ingestedAt }).segments);
    }
    if (allSegments.length > countBefore) validWays++;
  }
  allSegments.sort((a, b) => a.segmentHash.localeCompare(b.segmentHash) || a.osmWayId - b.osmWayId);
  const datasetJson = JSON.stringify(allSegments, null, 2);
  const manifest = generateManifest({ datasetVersion, datasetBuffer: Buffer.from(datasetJson), segments: allSegments, waysCount: validWays, sourceDate, provenance, generatedAt: ingestedAt });
  manifest.validation = { excludedAreaWays, validWays, invalidWays: validationErrors.length, flaggedJumpsOver250m: jumpWarnings.length, validationErrors };
  await mkdir(dirname(outDataset), { recursive: true });
  await mkdir(dirname(outManifest), { recursive: true });
  const suffix = `.${process.pid}.${Date.now()}.tmp`;
  await writeFile(outDataset + suffix, datasetJson);
  await writeFile(outManifest + suffix, JSON.stringify(manifest, null, 2) + "\n");
  await rename(outDataset + suffix, outDataset);
  await rename(outManifest + suffix, outManifest);
  return { segmentsCount: allSegments.length, waysCount: validWays, checksum: manifest.checksums.datasetSha256, datasetPath: outDataset, manifestPath: outManifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runIngestion().then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
}
