import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOsmFeature } from "./normalize.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const datasetPath = join(root, "data/surfaces/milan-central.json");
const manifestPath = join(root, "data/surfaces/milan-central.manifest.json");
const representativePath = join(root, "data/milan-road-network-representative.json");
const outputPath = join(root, "data/surfaces/milan-compact-tiles.json");

export function compileCompactSegments(allSegments, { manifest, pilotSegmentCount = allSegments.length, addedOutside = 0, preserveRawTags = false }) {
function extractRelevantTags(tags) {
  if (!tags) return undefined;
  const filtered = {};
  let count = 0;
  for (const k of Object.keys(tags)) {
    if (
      k === "layer" || k === "bridge" || k === "tunnel" || k === "service" ||
      k === "motorcar" || k === "motor_vehicle" || k === "vehicle" || k === "access" ||
      k === "motorcycle" || k === "bicycle" ||
      k.includes(":conditional") || k.includes(":forward") || k.includes(":backward") ||
      (k.startsWith("cycleway:") && (k.includes("oneway") || k.includes("conditional")))
    ) {
      filtered[k] = tags[k];
      count++;
    }
  }
  return count > 0 ? filtered : undefined;
}

const names = [];
const nameMap = new Map();
function getNameId(n) {
  if (n === null) return -1;
  let id = nameMap.get(n);
  if (id === undefined) {
    id = names.length;
    nameMap.set(n, id);
    names.push(n);
  }
  return id;
}

const surfaceVals = [];
const surfaceValMap = new Map();
function getSurfaceValId(v) {
  if (!v) return -1;
  let id = surfaceValMap.get(v);
  if (id === undefined) {
    id = surfaceVals.length;
    surfaceValMap.set(v, id);
    surfaceVals.push(v);
  }
  return id;
}

const tagSets = [];
const tagSetMap = new Map();
function getTagSetId(t) {
  if (!t) return -1;
  const s = JSON.stringify(t);
  let id = tagSetMap.get(s);
  if (id === undefined) {
    id = tagSets.length;
    tagSetMap.set(s, id);
    tagSets.push(t);
  }
  return id;
}

const K_ENUM = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const DIR_MAP = { "both": 0, "forward": 1, "backward": 2, "unknown": 3 };

const compactTuples = allSegments.map(seg => {
  const flags = (seg.isOneway ? 1 : 0) |
                (seg.isMotorAllowed ? 2 : 0) |
                (seg.isBicycleAllowed ? 4 : 0) |
                (seg.embeddedRails ? 8 : 0) |
                (seg.cycling?.value?.hasFacility ? 16 : 0);

  const ma = seg.modeAccess;
  const maBits = ma ? ((ma.car ? 1 : 0) | (ma.motorcycle ? 2 : 0) | (ma.bicycle ? 4 : 0)) : -1;

  const md = seg.modeDirections;
  const mdBits = md ? (
    (DIR_MAP[md.car ?? "both"] << 4) |
    (DIR_MAP[md.motorcycle ?? "both"] << 2) |
    (DIR_MAP[md.bicycle ?? "both"])
  ) : -1;

  return [
    seg.segmentHash,
    seg.osmWayId,
    getNameId(seg.name),
    [seg.coordinates[0][0], seg.coordinates[0][1], seg.coordinates[1][0], seg.coordinates[1][1]],
    K_ENUM.indexOf(seg.surfaceCategory),
    seg.roughnessWeight,
    getSurfaceValId(seg.surface?.value),
    flags,
    mdBits,
    maBits,
    seg.highwayClass,
    seg.lengthMeters,
    seg.bearing,
    getTagSetId(preserveRawTags ? seg.rawTags : extractRelevantTags(seg.rawTags))
  ];
});

// Partition into tiles with 0.01 deg resolution
const tileMap = new Map();
for (let i = 0; i < allSegments.length; i++) {
  const s = allSegments[i];
  const tuple = compactTuples[i];
  const [a, b] = s.coordinates;
  const minX = Math.floor(Math.min(a[0], b[0]) * 100);
  const maxX = Math.floor(Math.max(a[0], b[0]) * 100);
  const minY = Math.floor(Math.min(a[1], b[1]) * 100);
  const maxY = Math.floor(Math.max(a[1], b[1]) * 100);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = `${x}_${y}`;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key).push(tuple);
    }
  }
}

const compactTilesData = {
  version: "1.1.0",
  sourceDatasetSha256: manifest.checksums.datasetSha256,
  sourceGeneratedAt: manifest.generatedAt,
  pilotSegments: pilotSegmentCount,
  totalSegments: allSegments.length,
  addedOutsideSegments: addedOutside,
  tileGrid: {
    resolutionDeg: 0.01,
  },
  names,
  surfaceVals,
  tagSets,
  tiles: Object.fromEntries(tileMap),
};

return compactTilesData;
}

export async function compileMilanCompactTiles() {
const [datasetRaw, manifestRaw, representativeRaw] = await Promise.all([
  readFile(datasetPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(representativePath, "utf8"),
]);

const pilotSegments = JSON.parse(datasetRaw);
const manifest = JSON.parse(manifestRaw);
const rawFeatures = JSON.parse(representativeRaw);

const PILOT = { west: 9.180, south: 45.455, east: 9.200, north: 45.475 };
const ingestedAt = manifest.generatedAt || "2026-10-26T00:44:43.832077+00:00";

// 1. Start with all 18,246 original pilot segments to guarantee bit-for-bit backward compatibility
const mergedMap = new Map();
for (const s of pilotSegments) {
  mergedMap.set(s.segmentHash, s);
}

// 2. Add genuine unclipped segments extending outside the pilot bounds
let addedOutside = 0;
for (const way of rawFeatures) {
  if (way.tags?.area === "yes") continue;
  const coords = way.coordinates;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const isOutside =
      a[0] < PILOT.west || a[0] > PILOT.east || a[1] < PILOT.south || a[1] > PILOT.north ||
      b[0] < PILOT.west || b[0] > PILOT.east || b[1] < PILOT.south || b[1] > PILOT.north;
    if (isOutside) {
      const segs = normalizeOsmFeature({ ...way, coordinates: [a, b] }, { ingestedAt }).segments;
      for (const seg of segs) {
        if (!mergedMap.has(seg.segmentHash)) {
          mergedMap.set(seg.segmentHash, seg);
          addedOutside++;
        }
      }
    }
  }
}

const allSegments = Array.from(mergedMap.values());
allSegments.sort((a, b) => a.segmentHash.localeCompare(b.segmentHash) || (a.osmWayId ?? 0) - (b.osmWayId ?? 0));

const compactTilesData = compileCompactSegments(allSegments, { manifest: { ...manifest, generatedAt: ingestedAt }, pilotSegmentCount: pilotSegments.length, addedOutside });
const jsonOutput = JSON.stringify(compactTilesData);
await writeFile(outputPath, jsonOutput, "utf8");
return { outputPath, tiles: Object.keys(compactTilesData.tiles).length, segments: allSegments.length, bytes: Buffer.byteLength(jsonOutput) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  compileMilanCompactTiles().then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
}
