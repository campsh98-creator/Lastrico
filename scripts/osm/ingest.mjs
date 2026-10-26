/**
 * Deterministic ingestion CLI for Milan Road Intelligence
 * Reads source OSM snapshot, validates geometry, normalizes attributes,
 * generates cryptographic manifest, and writes to data/surfaces/
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOsmFeature } from "./normalize.mjs";
import { validateCoordinates } from "./validate.mjs";
import { generateManifest } from "./manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");
const representativeNetworkPath = join(rootDir, "data/milan-road-network-representative.json");
const defaultSourcePath = representativeNetworkPath;
const outputDir = join(rootDir, "data/surfaces");
const outputDatasetPath = join(outputDir, "milan-central.json");
const outputManifestPath = join(outputDir, "milan-central.manifest.json");

export async function runIngestion(options = {}) {
  const sourcePath = options.sourcePath || defaultSourcePath;
  const rawText = await readFile(sourcePath, "utf8");
  const rawFeatures = JSON.parse(rawText);

  const allSegments = [];
  const validationErrors = [];
  const jumpWarnings = [];
  let validWays = 0;

  // Use a fixed ISO date if requested for deterministic reproducibility, or current date
  const ingestedAt = options.ingestedAt || "2026-10-26T00:00:00Z";
  const datasetVersion = options.datasetVersion || "2026.10.26-mil-central";
  const outDir = options.outputDir || outputDir;
  const outDataset = options.outputDatasetPath || outputDatasetPath;
  const outManifest = options.outputManifestPath || outputManifestPath;

  for (const rawWay of rawFeatures) {
    const coords = rawWay.coordinates || [];
    const val = validateCoordinates(coords);
    if (!val.valid) {
      validationErrors.push({ id: rawWay.id, errors: val.errors });
      continue;
    }
    if (val.jumps.length > 0) {
      jumpWarnings.push({ id: rawWay.id, jumps: val.jumps });
    }

    const normalized = normalizeOsmFeature(rawWay, { ingestedAt });
    allSegments.push(...normalized.segments);
    validWays += 1;
  }

  // Sort segments deterministically by segmentHash
  allSegments.sort((a, b) => a.segmentHash.localeCompare(b.segmentHash));

  // Serialize dataset
  const datasetJson = JSON.stringify(allSegments, null, 2);
  const datasetBuffer = Buffer.from(datasetJson, "utf8");

  // Generate manifest
  const manifest = generateManifest({
    datasetVersion,
    datasetBuffer,
    segments: allSegments,
    waysCount: validWays,
    sourceDate: "2026-07-30T00:00:00Z", // Original snapshot date from COBBLESTONE_DATA_MODEL.md
  });
  manifest.validation = {
    validWays,
    invalidWays: validationErrors.length,
    flaggedJumpsOver250m: jumpWarnings.length,
    validationErrors,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);

  // Atomic write to avoid race conditions with concurrent test readers
  await mkdir(outDir, { recursive: true });
  const tmpDatasetPath = `${outDataset}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const tmpManifestPath = `${outManifest}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmpDatasetPath, datasetJson, "utf8");
  await writeFile(tmpManifestPath, manifestJson, "utf8");
  await rename(tmpDatasetPath, outDataset);
  await rename(tmpManifestPath, outManifest);

  return {
    segmentsCount: allSegments.length,
    waysCount: validWays,
    checksum: manifest.checksums.datasetSha256,
    datasetPath: outDataset,
    manifestPath: outManifest,
  };
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runIngestion()
    .then((result) => {
      console.log(`Ingestion completed successfully.`);
      console.log(`- Segments: ${result.segmentsCount}`);
      console.log(`- Ways: ${result.waysCount}`);
      console.log(`- SHA-256: ${result.checksum}`);
    })
    .catch((err) => {
      console.error("Ingestion failed:", err);
      process.exit(1);
    });
}
