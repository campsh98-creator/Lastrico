/**
 * Milan OSM Expansion Utility
 *
 * Provides reproducible, checksummed expansion of authentic OpenStreetMap road network tiles.
 *
 * Usage:
 *   node scripts/osm/expand-milan-network.mjs              # Check status & show connected download instructions
 *   node scripts/osm/expand-milan-network.mjs --download  # Download missing expansion tiles (requires internet)
 *   node scripts/osm/expand-milan-network.mjs --western   # Target western expansion tiles only
 *   node scripts/osm/expand-milan-network.mjs --import <file> # Import tile from disk
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractHighways } from "./build-representative-network.mjs";
import { runIngestion } from "./ingest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = join(root, "data/sources");
const sourceManifest = join(sourceDir, "milan-pilot-osm.source.json");
const outputPath = join(root, "data/milan-road-network-representative.json");

export const BASE_TILES = [
  { name: "sw", bbox: [9.18, 45.455, 9.19, 45.465], description: "South-West Central (Duomo / Missori / Carrobbio)" },
  { name: "se", bbox: [9.19, 45.455, 9.20, 45.465], description: "South-East Central (San Babila / Guastalla / Crocetta)" },
  { name: "nw", bbox: [9.18, 45.465, 9.19, 45.475], description: "North-West Central (Castello / Brera / Cairoli)" },
  { name: "ne", bbox: [9.19, 45.465, 9.20, 45.475], description: "North-East Central (Turati / Palestro / Montenapoleone)" },
];

export const WESTERN_EXPANSION_TILES = [
  {
    name: "w-sw",
    bbox: [9.169, 45.455, 9.180, 45.465],
    file: "milan-pilot-w-sw.osm.json.gz",
    description: "Western Cerchia dei Navigli South (Sant'Ambrogio, San Vittore, Conca del Naviglio)",
  },
  {
    name: "w-nw",
    bbox: [9.169, 45.465, 9.180, 45.475],
    file: "milan-pilot-w-nw.osm.json.gz",
    description: "Western Cerchia dei Navigli North (Cadorna, Santa Maria delle Grazie, Parco Sempione)",
  },
];

export const PERIMETER_EXPANSION_TILES = [
  {
    name: "n-nw",
    bbox: [9.180, 45.475, 9.190, 45.480],
    file: "milan-pilot-n-nw.osm.json.gz",
    description: "Northern Bastioni West (Moscova north, Porta Garibaldi south)",
  },
  {
    name: "n-ne",
    bbox: [9.190, 45.475, 9.200, 45.480],
    file: "milan-pilot-n-ne.osm.json.gz",
    description: "Northern Bastioni East (Repubblica, Giardini Pubblici north)",
  },
  {
    name: "e-nw",
    bbox: [9.200, 45.465, 9.206, 45.475],
    file: "milan-pilot-e-nw.osm.json.gz",
    description: "Eastern Bastioni (Porta Venezia / Corso Buenos Aires start)",
  },
  {
    name: "s-sw",
    bbox: [9.175, 45.450, 9.185, 45.455],
    file: "milan-pilot-s-sw.osm.json.gz",
    description: "Southern Axis West (Darsena / Navigli / Porta Ticinese)",
  },
  {
    name: "s-se",
    bbox: [9.195, 45.450, 9.205, 45.455],
    file: "milan-pilot-s-se.osm.json.gz",
    description: "Southern Axis East (Porta Romana / Piazza Medaglie d'Oro)",
  },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function checkNetworkStatus() {
  const provenance = JSON.parse(await readFile(sourceManifest, "utf8"));
  const existingFiles = new Map();
  for (const s of provenance.sources) {
    existingFiles.set(s.file, s);
  }

  const results = {
    currentPilotBounds: provenance.bounds,
    installedSources: provenance.sources.length,
    verifiedSha256: true,
    missingWesternTiles: [],
    missingPerimeterTiles: [],
  };

  // Verify installed files integrity
  for (const s of provenance.sources) {
    try {
      const rawGzip = await readFile(join(sourceDir, s.file));
      const unzipped = gunzipSync(rawGzip);
      if (sha256(unzipped) !== s.sha256) {
        console.error(`ERROR: Checksum mismatch on ${s.file}`);
        results.verifiedSha256 = false;
      }
    } catch (e) {
      console.error(`ERROR: Could not read ${s.file}: ${e.message}`);
      results.verifiedSha256 = false;
    }
  }

  for (const tile of WESTERN_EXPANSION_TILES) {
    if (!existingFiles.has(tile.file)) {
      results.missingWesternTiles.push(tile);
    }
  }

  for (const tile of PERIMETER_EXPANSION_TILES) {
    if (!existingFiles.has(tile.file)) {
      results.missingPerimeterTiles.push(tile);
    }
  }

  return results;
}

export function generateDownloadCommands(tiles) {
  const commands = [];
  for (const tile of tiles) {
    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${tile.bbox.join(",")}`;
    commands.push({
      tile: tile.name,
      file: tile.file,
      url,
      curlCommand: `curl -s "${url}" | gzip > data/sources/${tile.file}`,
    });
  }
  return commands;
}

export async function downloadExpansionTiles({ westernOnly = false } = {}) {
  const targetTiles = westernOnly
    ? WESTERN_EXPANSION_TILES
    : [...WESTERN_EXPANSION_TILES, ...PERIMETER_EXPANSION_TILES];

  console.log(`Starting download of ${targetTiles.length} OSM expansion tiles...`);
  const provenance = JSON.parse(await readFile(sourceManifest, "utf8"));
  const existingFiles = new Set(provenance.sources.map((s) => s.file));

  let downloadedCount = 0;
  for (const tile of targetTiles) {
    if (existingFiles.has(tile.file)) {
      console.log(`[SKIP] ${tile.file} already present in manifest.`);
      continue;
    }

    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${tile.bbox.join(",")}`;
    console.log(`[FETCH] Downloading ${tile.name} (${tile.description}) from ${url}...`);

    let response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "Lastrico-Road-Intelligence/1.0 (anti-pave research; offline-first)" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new Error(`Network failure downloading ${tile.name}: ${err.message}. If running in an air-gapped sandbox, run this command in a connected environment.`);
    }

    if (!response.ok) {
      throw new Error(`OSM HTTP Error ${response.status} for bbox ${tile.bbox.join(",")}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    // Validate OSM JSON structure
    const parsed = JSON.parse(bytes);
    extractHighways([parsed]);

    const gzipped = gzipSync(bytes);
    const fileChecksum = sha256(bytes);

    await writeFile(join(sourceDir, tile.file), gzipped);
    provenance.sources.push({
      file: tile.file,
      url,
      bbox: tile.bbox,
      retrievedAt: new Date().toISOString(),
      serverDate: response.headers.get("date"),
      sha256: fileChecksum,
      description: tile.description,
    });

    console.log(`[OK] Saved ${tile.file} (${(gzipped.length / 1024).toFixed(1)} KB, SHA-256: ${fileChecksum.slice(0, 16)}...)`);
    downloadedCount++;

    // Polite delay between OSM requests
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (downloadedCount > 0) {
    console.log("Recompiling representative road network...");
    // Read all responses
    const responses = [];
    for (const source of provenance.sources) {
      const unzipped = gunzipSync(await readFile(join(sourceDir, source.file)));
      responses.push(JSON.parse(unzipped));
    }

    // Update bounding box in provenance to envelop all tiles
    let minW = Infinity, minS = Infinity, maxE = -Infinity, maxN = -Infinity;
    for (const s of provenance.sources) {
      minW = Math.min(minW, s.bbox[0]);
      minS = Math.min(minS, s.bbox[1]);
      maxE = Math.max(maxE, s.bbox[2]);
      maxN = Math.max(maxN, s.bbox[3]);
    }
    provenance.bounds = { west: minW, south: minS, east: maxE, north: maxN };

    const ways = extractHighways(responses);
    const networkJson = JSON.stringify(ways, null, 2) + "\n";
    await writeFile(outputPath, networkJson);
    provenance.networkSha256 = sha256(networkJson);
    await writeFile(sourceManifest, JSON.stringify(provenance, null, 2) + "\n");

    console.log(`Updated network with ${ways.length} total highway ways.`);
    console.log("Running ingestion pipeline...");
    await runIngestion();
    console.log("Dataset expansion complete!");
  } else {
    console.log("All requested tiles were already present. No updates needed.");
  }
}

async function main() {
  const isDownload = process.argv.includes("--download");
  const isWesternOnly = process.argv.includes("--western");

  console.log("=== Lastrico Road Intelligence: Milan OSM Network Expansion Utility ===");
  const status = await checkNetworkStatus();

  console.log(`Current Pilot Bounds: [${status.currentPilotBounds.west}, ${status.currentPilotBounds.south}, ${status.currentPilotBounds.east}, ${status.currentPilotBounds.north}]`);
  console.log(`Installed Tile Sources: ${status.installedSources}`);
  console.log(`Source SHA-256 Checksums: ${status.verifiedSha256 ? "VERIFIED VALID" : "INVALID"}`);
  console.log(`Missing Western Tiles: ${status.missingWesternTiles.length}`);
  console.log(`Missing Perimeter Tiles: ${status.missingPerimeterTiles.length}\n`);

  if (isDownload) {
    await downloadExpansionTiles({ westernOnly: isWesternOnly });
    return;
  }

  // If not downloading, print reproducible instructions for connected environments
  console.log("--- Executable Procedure for Connected Local Environment ---");
  console.log("To download and integrate the authentic OSM expansion tiles on a machine with internet access:");
  console.log("\n1. Western Expansion Only (covers Cadorna, Magenta, Conca del Naviglio):");
  console.log("   node scripts/osm/expand-milan-network.mjs --download --western");
  console.log("\n2. Full Corridor Expansion (Western + Bastioni perimeter):");
  console.log("   node scripts/osm/expand-milan-network.mjs --download");
  console.log("\n3. Or via standalone curl commands (run from repository root):");
  const westernCmds = generateDownloadCommands(WESTERN_EXPANSION_TILES);
  for (const cmd of westernCmds) {
    console.log(`   # ${cmd.tile}: ${cmd.url}`);
    console.log(`   ${cmd.curlCommand}`);
  }
  console.log("\n4. After downloading tiles, rebuild the network and surface database:");
  console.log("   node scripts/osm/build-representative-network.mjs");
  console.log("   node scripts/osm/ingest.mjs");
  console.log("   node scripts/osm/quality-report.mjs");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
