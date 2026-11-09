import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOsmFeature, classifySurface } from "./normalize.mjs";
import { extractHighways } from "./build-representative-network.mjs";
import { generateChunks } from "./generate-tile-chunks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const datasetPath = join(root, "data/surfaces/milan-central.json");
const manifestPath = join(root, "data/surfaces/milan-central.manifest.json");
const representativePath = join(root, "data/milan-road-network-representative.json");
const citywideManifestPath = join(root, "data/sources/milan-citywide-expansion.source.json");
const sourceDir = join(root, "data/sources");
const outputPath = join(root, "data/surfaces/milan-compact-tiles.json");
const compactManifestPath = join(root, "data/surfaces/milan-compact-tiles.manifest.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Phase 4.24 surface rules for Milan. "2026-10" reproduces the archive compiled on 2026-11-04. */
export const MILAN_SURFACE_RULES = "2026-11";

const K_ENUM = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const HC_ENUM = [
  "unknown",
  "steps",
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "cycleway",
  "footway",
  "path",
  "track",
];
const DIR_MAP = { both: 0, forward: 1, backward: 2, unknown: 3 };

export function compileCompactSegments(
  allSegments,
  {
    manifest,
    pilotSegmentCount = allSegments.length,
    addedOutside = 0,
    preserveRawTags = false,
    slim = false,
    keepSmoothness = false,
    // Phase 4.25 (Milan): pedestrian access lets a cyclist walk a vehicle-free stretch at the route ends.
    keepFoot = false,
  },
) {
  function extractRelevantTags(tags) {
    if (!tags) return undefined;
    const filtered = {};
    let count = 0;
    for (const k of Object.keys(tags)) {
      if (
        k === "layer" || k === "bridge" || k === "tunnel" || k === "service" ||
        k === "motorcar" || k === "motor_vehicle" || k === "vehicle" || k === "access" ||
        k === "motorcycle" || k === "bicycle" || (keepSmoothness && k === "smoothness") || (keepFoot && k === "foot") ||
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

  const compactTuples = allSegments.map((seg) => {
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

    const coords = [seg.coordinates[0][0], seg.coordinates[0][1], seg.coordinates[1][0], seg.coordinates[1][1]];
    const kId = K_ENUM.indexOf(seg.surfaceCategory);
    const svId = getSurfaceValId(seg.surface?.value);
    const tagSetId = getTagSetId(preserveRawTags ? seg.rawTags : extractRelevantTags(seg.rawTags));

    if (slim) {
      const hcIdx = HC_ENUM.indexOf(seg.highwayClass);
      return [
        seg.osmWayId,
        getNameId(seg.name),
        coords,
        kId,
        seg.roughnessWeight,
        svId,
        flags,
        mdBits,
        maBits,
        hcIdx >= 0 ? hcIdx : 0,
        tagSetId,
      ];
    }

    return [
      seg.segmentHash,
      seg.osmWayId,
      getNameId(seg.name),
      coords,
      kId,
      seg.roughnessWeight,
      svId,
      flags,
      mdBits,
      maBits,
      seg.highwayClass,
      seg.lengthMeters,
      seg.bearing,
      tagSetId,
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
    version: slim ? "1.2.0" : "1.1.0",
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

/** Re-derive the surface fields of a stored pilot segment from its own raw OSM tags. */
function reclassified(segment, surfaceRules) {
  const c = classifySurface(segment.rawTags ?? {}, segment.highwayClass, "", surfaceRules);
  if (c.surfaceCategory === segment.surfaceCategory && c.material === segment.surface?.value) return segment;
  return { ...segment, surfaceCategory: c.surfaceCategory, roughnessWeight: c.roughnessWeight,
    surface: { ...segment.surface, value: c.material, state: c.state, authority: c.authority, confidence: c.confidence } };
}

function pointToSegmentMeters(p, a, b) {
  const sx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * sx, ay = (a[1] - p[1]) * 110_540, bx = (b[0] - p[0]) * sx, by = (b[1] - p[1]) * 110_540;
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** The October pilot clipped ways at its bounding box. Where the citywide snapshot added the
 * same way's full segment, the clipped stub duplicates part of it: same way, same surface. */
function dropCoveredBoundaryStubs(segments, pilotHashes, bounds) {
  const edge = (p) => p[0] === bounds.west || p[0] === bounds.east || p[1] === bounds.south || p[1] === bounds.north;
  const fullByWay = new Map();
  for (const s of segments) {
    if (pilotHashes.has(s.segmentHash) || s.osmWayId === null) continue;
    const list = fullByWay.get(s.osmWayId) ?? [];
    list.push(s);
    fullByWay.set(s.osmWayId, list);
  }
  const kept = [], removed = [];
  for (const s of segments) {
    const covered = pilotHashes.has(s.segmentHash) && (edge(s.coordinates[0]) || edge(s.coordinates[1]))
      && (fullByWay.get(s.osmWayId) ?? []).some((o) => o.surfaceCategory === s.surfaceCategory
        && pointToSegmentMeters(s.coordinates[0], ...o.coordinates) < 0.5 && pointToSegmentMeters(s.coordinates[1], ...o.coordinates) < 0.5);
    (covered ? removed : kept).push(s);
  }
  return { kept, removed };
}

/**
 * Rebuild the exact Milan segment list that feeds the compact tiles, with raw OSM tags.
 * Shared by the compiler and the data-quality audit so both describe the same data.
 */
export async function collectMilanSegments({ surfaceRules = MILAN_SURFACE_RULES } = {}) {
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

  // 1. Start with all 37,106 original pilot segments to guarantee bit-for-bit backward compatibility
  const mergedMap = new Map();
  for (const s of pilotSegments) {
    mergedMap.set(s.segmentHash, surfaceRules === "2026-10" ? s : reclassified(s, surfaceRules));
  }

  // 2. Add genuine unclipped segments extending outside the core pilot bounds from representative network
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
        const segs = normalizeOsmFeature({ ...way, coordinates: [a, b] }, { ingestedAt, surfaceRules }).segments;
        for (const seg of segs) {
          if (!mergedMap.has(seg.segmentHash)) {
            mergedMap.set(seg.segmentHash, seg);
            addedOutside++;
          }
        }
      }
    }
  }

  // 3. Integrate authentic citywide Milan OSM expansion sectors if available
  const pilotSourceBboxes = (manifest.sources?.[0]?.acquisition?.sources ?? []).map((s) => s.bbox);
  function pointInPilotSourceBboxes(pt) {
    for (const [w, s, e, n] of pilotSourceBboxes) {
      if (pt[0] >= w && pt[0] <= e && pt[1] >= s && pt[1] <= n) return true;
    }
    return false;
  }

  let citywideManifest = null;
  let citywideManifestRaw = null;
  try {
    citywideManifestRaw = await readFile(citywideManifestPath, "utf8");
    citywideManifest = JSON.parse(citywideManifestRaw);
  } catch {}

  if (citywideManifest && Array.isArray(citywideManifest.sources)) {
    const responses = [];
    for (const src of citywideManifest.sources) {
      const gz = await readFile(join(sourceDir, src.file));
      const unzipped = gunzipSync(gz);
      if (sha256(unzipped) !== src.sha256) {
        throw new Error(`Checksum mismatch on citywide source ${src.file}`);
      }
      responses.push(JSON.parse(unzipped));
    }
    const citywideWays = extractHighways(responses);
    for (const way of citywideWays) {
      if (way.tags?.area === "yes") continue;
      const coords = way.coordinates;
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        // Keep exact October snapshot inside already-covered pilot source bboxes
        if (pointInPilotSourceBboxes(a) && pointInPilotSourceBboxes(b)) continue;

        const segs = normalizeOsmFeature({ ...way, coordinates: [a, b] }, { ingestedAt, surfaceRules }).segments;
        for (const seg of segs) {
          // In the expansion ring, retain only segments accessible by at least one Lastrico mode (car, motorcycle, or bicycle)
          // and skip unnamed private courtyard/parking service aisles to keep the Cloudflare Worker bundle well under 3 MB gzipped.
          const hasAnyModeAccess = Boolean(
            seg.modeAccess?.car || seg.modeAccess?.motorcycle || seg.modeAccess?.bicycle,
          );
          if (!hasAnyModeAccess) continue;
          if (seg.highwayClass === "service" && !seg.name) continue;
          if (seg.highwayClass === "footway" || seg.highwayClass === "steps" || seg.highwayClass === "path" || seg.highwayClass === "track") {
            if (seg.surfaceCategory === "unknown" && !seg.cycling?.value?.hasFacility) continue;
          }

          if (!mergedMap.has(seg.segmentHash)) {
            mergedMap.set(seg.segmentHash, seg);
            addedOutside++;
          }
        }
      }
    }
  }

  let allSegments = Array.from(mergedMap.values());
  let removedBoundaryStubs = [];
  if (surfaceRules !== "2026-10") {
    ({ kept: allSegments, removed: removedBoundaryStubs } = dropCoveredBoundaryStubs(allSegments, new Set(pilotSegments.map((p) => p.segmentHash)), manifest.area.bounds));
  }
  allSegments.sort((a, b) => a.segmentHash.localeCompare(b.segmentHash) || (a.osmWayId ?? 0) - (b.osmWayId ?? 0));
  return { allSegments, pilotSegments, manifest, addedOutside, citywideManifestRaw, ingestedAt, surfaceRules, removedBoundaryStubs };
}

export async function compileMilanCompactTiles({
  surfaceRules = MILAN_SURFACE_RULES,
  output = outputPath,
  compactManifest = compactManifestPath,
  tilesDir = join(root, "data/surfaces/milan-tiles"),
  indexTs = join(root, "lib/milan-tile-index.ts"),
} = {}) {
  const { allSegments, pilotSegments, manifest, addedOutside, citywideManifestRaw, ingestedAt, removedBoundaryStubs } = await collectMilanSegments({ surfaceRules });

  const compactTilesData = compileCompactSegments(allSegments, {
    manifest: { ...manifest, generatedAt: ingestedAt },
    pilotSegmentCount: pilotSegments.length,
    addedOutside,
    slim: true,
    keepSmoothness: surfaceRules !== "2026-10",
    keepFoot: surfaceRules !== "2026-10",
  });

  const jsonOutput = JSON.stringify(compactTilesData);
  await writeFile(output, jsonOutput, "utf8");

  // Compute statistics and write milan-compact-tiles.manifest.json
  const byCategory = {
    confirmed_rough: 0,
    probable_rough: 0,
    confirmed_smooth: 0,
    unpaved_loose: 0,
    unknown: 0,
  };
  let totalLengthMeters = 0;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const s of allSegments) {
    byCategory[s.surfaceCategory] = (byCategory[s.surfaceCategory] || 0) + s.lengthMeters;
    totalLengthMeters += s.lengthMeters;
    for (const [lon, lat] of s.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const roundedTotalMeters = Math.round(totalLengthMeters);
  const surfaceBreakdownMeters = Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, Math.round(v)]),
  );
  const surfaceBreakdownPercent = Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, Number(((v / totalLengthMeters) * 100).toFixed(1))]),
  );

  const compactManifestData = {
    schemaVersion: "2.0.0",
    datasetVersion: "osm-milan-citywide-2026-11-04",
    generatedAt: ingestedAt,
    area: {
      zoneId: "MILAN_URBAN_EXPANDED",
      description: "Milan urban road-surface network (central pilot + Southern, Western, Northern, Eastern Milan expansion)",
      bounds: {
        west: Number(minLon.toFixed(4)),
        south: Number(minLat.toFixed(4)),
        east: Number(maxLon.toFixed(4)),
        north: Number(maxLat.toFixed(4)),
      },
    },
    statistics: {
      tileCount: Object.keys(compactTilesData.tiles).length,
      pilotSegments: pilotSegments.length,
      addedOutsideSegments: addedOutside,
      totalSegments: allSegments.length,
      totalLengthMeters: roundedTotalMeters,
      surfaceBreakdownMeters,
      surfaceBreakdownPercent,
    },
    checksums: {
      pilotDatasetSha256: manifest.checksums.datasetSha256,
      compactTilesSha256: sha256(jsonOutput),
      citywideExpansionManifestSha256: citywideManifestRaw ? sha256(citywideManifestRaw) : null,
    },
  };
  if (surfaceRules !== "2026-10") {
    compactManifestData.surfaceRules = {
      version: surfaceRules,
      audit: "outputs/phase424-data-quality/",
      summary: "OSM tags only. tracktype=grade1 is not asphalt evidence; paving_stones with smoothness excellent/good is smooth; asphalt/concrete with smoothness bad or worse is not smooth evidence (unknown); cobblestone:rounded is cobblestone. Clipped October pilot stubs duplicated by the citywide snapshot are dropped.",
    };
    compactManifestData.statistics.removedBoundaryStubs = removedBoundaryStubs.length;
    compactManifestData.statistics.removedBoundaryStubMeters = Math.round(removedBoundaryStubs.reduce((sum, s) => sum + s.lengthMeters, 0));
  }
  await writeFile(compactManifest, JSON.stringify(compactManifestData, null, 2) + "\n", "utf8");

  await generateChunks("milan", output, tilesDir, indexTs);

  return {
    outputPath: output,
    compactManifestPath: compactManifest,
    tiles: Object.keys(compactTilesData.tiles).length,
    segments: allSegments.length,
    totalLengthMeters: roundedTotalMeters,
    surfaceBreakdownMeters,
    surfaceBreakdownPercent,
    bytes: Buffer.byteLength(jsonOutput),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  compileMilanCompactTiles().then(console.log).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
