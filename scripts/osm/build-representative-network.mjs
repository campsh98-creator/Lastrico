/** Rebuild the pilot highway network from archived, genuine OSM API responses.
 * Run with --download to refresh the four public map requests; otherwise no network is used.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = join(root, "data/sources");
const sourceManifest = join(sourceDir, "milan-pilot-osm.source.json");
const outputPath = join(root, "data/milan-road-network-representative.json");
export const PILOT_BOUNDS = { west: 9.18, south: 45.455, east: 9.20, north: 45.475 };
export const OSM_TILES = [
  { name: "sw", bbox: [9.18, 45.455, 9.19, 45.465] },
  { name: "se", bbox: [9.19, 45.455, 9.20, 45.465] },
  { name: "nw", bbox: [9.18, 45.465, 9.19, 45.475] },
  { name: "ne", bbox: [9.19, 45.465, 9.20, 45.475] },
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function extractHighways(responses) {
  const nodes = new Map();
  const ways = new Map();
  for (const response of responses) {
    if (!Array.isArray(response.elements) || !String(response.generator).startsWith("openstreetmap")) {
      throw new Error("Expected an archived OpenStreetMap API map response");
    }
    for (const element of response.elements) {
      const target = element.type === "node" ? nodes : element.type === "way" ? ways : null;
      if (target && (!target.has(element.id) || element.version > target.get(element.id).version)) target.set(element.id, element);
    }
  }
  return [...ways.values()].filter((way) => typeof way.tags?.highway === "string")
    .sort((a, b) => a.id - b.id).map((way) => ({
      id: way.id,
      version: way.version,
      timestamp: way.timestamp, // OSM edit timestamp, not a physical survey date.
      tags: way.tags,
      coordinates: way.nodes.map((id) => {
        const node = nodes.get(id);
        if (!node || !Number.isFinite(node.lon) || !Number.isFinite(node.lat)) throw new Error(`Missing/invalid OSM node ${id}`);
        return [node.lon, node.lat];
      }),
    }));
}

export async function buildRepresentativeNetwork({ download = false } = {}) {
  if (download) {
    const sources = [];
    const downloads = [];
    await mkdir(sourceDir, { recursive: true });
    for (const tile of OSM_TILES) {
      const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${tile.bbox.join(",")}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`OSM HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      extractHighways([JSON.parse(bytes)]); // Reject error pages or incomplete geometries before saving.
      const file = `milan-pilot-${tile.name}.osm.json.gz`;
      downloads.push({ file, bytes: gzipSync(bytes) });
      sources.push({ file, url, bbox: tile.bbox, retrievedAt: new Date().toISOString(), serverDate: response.headers.get("date"), sha256: sha256(bytes) });
    }
    // A failed request must not replace part of the existing verified archive.
    for (const { file, bytes } of downloads) await writeFile(join(sourceDir, file), bytes);
    await writeFile(sourceManifest, JSON.stringify({ provider: "OpenStreetMap API 0.6", bounds: PILOT_BOUNDS, selection: "All ways with a highway tag, including missing/unknown surface; four map tiles, deduplicated by OSM way ID. This is a small city-centre pilot, not all Milan.", temporalScope: "Four sequential live API responses, not an atomic historical snapshot; original element versions and edit timestamps preserved.", sources }, null, 2) + "\n");
  }
  const provenance = JSON.parse(await readFile(sourceManifest, "utf8"));
  const responses = [];
  for (const source of provenance.sources) {
    const bytes = gunzipSync(await readFile(join(sourceDir, source.file)));
    if (sha256(bytes) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.file}`);
    responses.push(JSON.parse(bytes));
  }
  const ways = extractHighways(responses);
  const output = JSON.stringify(ways, null, 2) + "\n";
  await writeFile(outputPath, output);
  provenance.networkSha256 = sha256(output);
  await writeFile(sourceManifest, JSON.stringify(provenance, null, 2) + "\n");
  return { ways: ways.length, outputPath, checksum: sha256(output) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildRepresentativeNetwork({ download: process.argv.includes("--download") }).then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
}
