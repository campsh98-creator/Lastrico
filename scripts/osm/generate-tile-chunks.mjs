import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

export async function generateChunks(areaName, compactJsonPath, outputDir, indexTsPath) {
  console.log(`Generating tile chunks for ${areaName} from ${compactJsonPath}...`);
  const raw = await readFile(compactJsonPath, "utf8");
  const data = JSON.parse(raw);

  await mkdir(outputDir, { recursive: true });

  const metadata = {
    version: data.version,
    sourceDatasetSha256: data.sourceDatasetSha256,
    sourceGeneratedAt: data.sourceGeneratedAt,
    pilotSegments: data.pilotSegments ?? data.totalSegments,
    totalSegments: data.totalSegments,
    tileGrid: data.tileGrid,
    names: data.names,
    surfaceVals: data.surfaceVals,
    tagSets: data.tagSets,
    tileKeys: Object.keys(data.tiles).sort(),
  };

  const metaPath = join(outputDir, "metadata.json");
  await writeFile(metaPath, JSON.stringify(metadata), "utf8");

  const tileKeys = metadata.tileKeys;
  for (const key of tileKeys) {
    const tuples = data.tiles[key];
    const cells = {};
    for (let i = 0; i < tuples.length; i++) {
      const t = tuples[i];
      const coords = t.length === 11 ? t[2] : t[3];
      const minX = Math.floor(Math.min(coords[0], coords[2]) * 1000);
      const maxX = Math.floor(Math.max(coords[0], coords[2]) * 1000);
      const minY = Math.floor(Math.min(coords[1], coords[3]) * 1000);
      const maxY = Math.floor(Math.max(coords[1], coords[3]) * 1000);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const ckey = `${x}:${y}`;
          if (!cells[ckey]) cells[ckey] = [i];
          else cells[ckey].push(i);
        }
      }
    }
    const tilePayload = { cells, tuples };
    const tilePath = join(outputDir, `${key}.json`);
    await writeFile(tilePath, JSON.stringify(tilePayload), "utf8");
  }

  // Generate TypeScript index with explicit typed lazy loaders
  const relOutputDir = outputDir.replace(join(root, "lib/"), "").replace(join(root, "data/"), "../data/");
  const tsContent = [
    `// Auto-generated tile loaders for ${areaName}`,
    `import type { TilePayload } from "./spatial-road-store";`,
    ``,
    `export const ${areaName}TileLoaders: Record<string, () => Promise<{ default: TilePayload }>> = {`,
    ...tileKeys.map((k) => `  ${JSON.stringify(k)}: () => import(${JSON.stringify(`${relOutputDir}/${k}.json`)}).then((m) => ({ default: m.default as unknown as TilePayload })),`),
    `};`,
    ``,
  ].join("\n");

  await writeFile(indexTsPath, tsContent, "utf8");
  console.log(`✓ ${areaName}: Generated ${tileKeys.length} tiles + metadata + index.`);
}

async function main() {
  await generateChunks(
    "milan",
    join(root, "data/surfaces/milan-compact-tiles.json"),
    join(root, "data/surfaces/milan-tiles"),
    join(root, "lib/milan-tile-index.ts"),
  );

  await generateChunks(
    "roccella",
    join(root, "data/surfaces/roccella-compact-tiles.json"),
    join(root, "data/surfaces/roccella-tiles"),
    join(root, "lib/roccella-tile-index.ts"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
