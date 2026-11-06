// Provenance and checksum verification. Read-only: mismatches are REPORTED, never repaired.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { segmentKey } from "./classify.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function check(list, { group, file, field, expected, actual, note }) {
  let status;
  if (actual === undefined || actual === null) status = "missing_file";
  else if (expected === undefined || expected === null) status = "not_declared";
  else status = expected === actual ? "ok" : "mismatch";
  list.push({ group, file, field, expected: expected ?? null, actual: actual ?? null, status, ...(note ? { note } : {}) });
  return status;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

/** Collect segment keys (wayId + undirected endpoints) from archived OSM JSON responses. */
function collectRawKeys(responses) {
  const nodes = new Map();
  const ways = new Map();
  for (const response of responses) {
    for (const el of response.elements ?? []) {
      if (el.type === "node") {
        const prev = nodes.get(el.id);
        if (!prev || (el.version ?? 0) > (prev.version ?? 0)) nodes.set(el.id, el);
      } else if (el.type === "way") {
        const prev = ways.get(el.id);
        if (!prev || (el.version ?? 0) > (prev.version ?? 0)) ways.set(el.id, el);
      }
    }
  }
  const keys = new Set();
  let highwayWays = 0;
  for (const way of ways.values()) {
    if (typeof way.tags?.highway !== "string" || way.tags?.area === "yes") continue;
    highwayWays += 1;
    const ids = way.nodes ?? [];
    for (let i = 1; i < ids.length; i += 1) {
      const a = nodes.get(ids[i - 1]);
      const b = nodes.get(ids[i]);
      if (!a || !b) continue;
      keys.add(segmentKey(way.id, a.lon, a.lat, b.lon, b.lat));
    }
  }
  return { keys, highwayWays, nodes: nodes.size };
}

/**
 * Verify every checksum declared in the acquisition and dataset manifests.
 * Returns { checks, citywideKeys, archiveSummary, fileHashes }.
 */
export function verifyProvenance(root, { collectCitywideKeys = true } = {}) {
  const checks = [];
  const fileHashes = {};
  const rel = (p) => p.replace(`${root}/`, "");
  const hashFile = (path) => {
    const bytes = readIfExists(path);
    if (!bytes) return null;
    const h = sha256(bytes);
    fileHashes[rel(path)] = h;
    return { bytes, h };
  };

  const sourcesDir = join(root, "data/sources");
  const archiveSummary = [];
  let citywideKeys = null;

  const acquisitionManifests = [
    { id: "milan-pilot", file: "milan-pilot-osm.source.json", area: "milan" },
    { id: "milan-citywide", file: "milan-citywide-expansion.source.json", area: "milan" },
    { id: "roccella-pilot", file: "roccella-pilot-osm.source.json", area: "roccella" },
  ];
  const manifests = {};
  for (const m of acquisitionManifests) {
    const path = join(sourcesDir, m.file);
    const read = hashFile(path);
    if (!read) {
      check(checks, { group: "acquisition-manifest", file: rel(path), field: "presence", expected: "present", actual: null });
      continue;
    }
    manifests[m.id] = JSON.parse(read.bytes.toString("utf8"));
  }

  for (const m of acquisitionManifests) {
    const manifest = manifests[m.id];
    if (!manifest) continue;
    const citywideResponses = [];
    for (const src of manifest.sources ?? []) {
      const path = join(sourcesDir, src.file);
      const gz = readIfExists(path);
      const entry = {
        manifest: m.file, file: src.file, area: m.area, url: src.url ?? null, bbox: src.bbox ?? null,
        retrievedAt: src.retrievedAt ?? null, serverDate: src.serverDate ?? null, description: src.description ?? null,
      };
      if (!gz) {
        check(checks, { group: "raw-archive", file: rel(path), field: "sha256(gunzip)", expected: src.sha256, actual: null });
        archiveSummary.push({ ...entry, status: "missing_file" });
        continue;
      }
      const gzHash = sha256(gz);
      fileHashes[rel(path)] = gzHash;
      const raw = gunzipSync(gz);
      const rawHash = sha256(raw);
      const s1 = check(checks, { group: "raw-archive", file: rel(path), field: "sha256(gunzip)", expected: src.sha256, actual: rawHash });
      let s2 = "not_declared";
      if (src.gzipSha256) s2 = check(checks, { group: "raw-archive", file: rel(path), field: "sha256(gzip)", expected: src.gzipSha256, actual: gzHash });
      if (src.rawBytes !== undefined) check(checks, { group: "raw-archive", file: rel(path), field: "rawBytes", expected: src.rawBytes, actual: raw.length });
      if (src.gzipBytes !== undefined) check(checks, { group: "raw-archive", file: rel(path), field: "gzipBytes", expected: src.gzipBytes, actual: gz.length });
      archiveSummary.push({
        ...entry, rawSha256: rawHash, gzipSha256: gzHash, rawBytes: raw.length, gzipBytes: gz.length,
        status: s1 === "ok" && (s2 === "ok" || s2 === "not_declared") ? "ok" : "mismatch",
      });
      if (m.id === "milan-citywide" && collectCitywideKeys) citywideResponses.push(JSON.parse(raw.toString("utf8")));
    }
    if (m.id === "milan-citywide" && collectCitywideKeys) {
      const collected = collectRawKeys(citywideResponses);
      citywideKeys = collected.keys;
    }
  }

  // Derived highway networks (networkSha256 of the extracted ways file).
  const repr = hashFile(join(root, "data/milan-road-network-representative.json"));
  check(checks, { group: "derived-network", file: "data/milan-road-network-representative.json", field: "networkSha256 (milan-pilot-osm.source.json)", expected: manifests["milan-pilot"]?.networkSha256, actual: repr?.h });
  const rocNet = hashFile(join(root, "data/roccella-road-network.json"));
  check(checks, { group: "derived-network", file: "data/roccella-road-network.json", field: "networkSha256 (roccella-pilot-osm.source.json)", expected: manifests["roccella-pilot"]?.networkSha256, actual: rocNet?.h });

  // Normalised datasets and their manifests.
  const milanManifestRead = hashFile(join(root, "data/surfaces/milan-central.manifest.json"));
  const milanManifest = milanManifestRead ? JSON.parse(milanManifestRead.bytes.toString("utf8")) : null;
  const milanDataset = hashFile(join(root, "data/surfaces/milan-central.json"));
  check(checks, { group: "normalised-dataset", file: "data/surfaces/milan-central.json", field: "checksums.datasetSha256", expected: milanManifest?.checksums?.datasetSha256, actual: milanDataset?.h });
  check(checks, { group: "derived-network", file: "data/milan-road-network-representative.json", field: "sources[0].sha256 (milan-central.manifest.json)", expected: milanManifest?.sources?.[0]?.sha256, actual: repr?.h });

  const rocManifestRead = hashFile(join(root, "data/surfaces/roccella-pilot.manifest.json"));
  const rocManifest = rocManifestRead ? JSON.parse(rocManifestRead.bytes.toString("utf8")) : null;
  const rocDataset = hashFile(join(root, "data/surfaces/roccella-pilot.json"));
  check(checks, { group: "normalised-dataset", file: "data/surfaces/roccella-pilot.json", field: "checksums.datasetSha256", expected: rocManifest?.checksums?.datasetSha256, actual: rocDataset?.h });
  check(checks, { group: "derived-network", file: "data/roccella-road-network.json", field: "sources[0].sha256 (roccella-pilot.manifest.json)", expected: rocManifest?.sources?.[0]?.sha256, actual: rocNet?.h });

  // Compact runtime datasets.
  const milanCompactManifestRead = hashFile(join(root, "data/surfaces/milan-compact-tiles.manifest.json"));
  const milanCompactManifest = milanCompactManifestRead ? JSON.parse(milanCompactManifestRead.bytes.toString("utf8")) : null;
  const milanCompact = hashFile(join(root, "data/surfaces/milan-compact-tiles.json"));
  check(checks, { group: "compact", file: "data/surfaces/milan-compact-tiles.json", field: "checksums.compactTilesSha256", expected: milanCompactManifest?.checksums?.compactTilesSha256, actual: milanCompact?.h });
  check(checks, { group: "compact", file: "data/sources/milan-citywide-expansion.source.json", field: "checksums.citywideExpansionManifestSha256", expected: milanCompactManifest?.checksums?.citywideExpansionManifestSha256, actual: fileHashes["data/sources/milan-citywide-expansion.source.json"] ?? null });
  check(checks, { group: "compact", file: "data/surfaces/milan-compact-tiles.manifest.json", field: "checksums.pilotDatasetSha256 = milan-central datasetSha256", expected: milanManifest?.checksums?.datasetSha256, actual: milanCompactManifest?.checksums?.pilotDatasetSha256 ?? null });

  const rocCompact = hashFile(join(root, "data/surfaces/roccella-compact-tiles.json"));
  check(checks, { group: "compact", file: "data/surfaces/roccella-compact-tiles.json", field: "checksums.compactSha256", expected: rocManifest?.checksums?.compactSha256, actual: rocCompact?.h });

  return {
    checks,
    citywideKeys,
    archiveSummary,
    fileHashes,
    manifests: { ...manifests, milanCentral: milanManifest, milanCompact: milanCompactManifest, roccellaPilot: rocManifest },
    buffers: {
      milanDataset: milanDataset?.bytes ?? null,
      milanCompact: milanCompact?.bytes ?? null,
      roccellaDataset: rocDataset?.bytes ?? null,
      roccellaCompact: rocCompact?.bytes ?? null,
      representative: repr?.bytes ?? null,
    },
  };
}

/** Runtime chunks (data/surfaces/<area>-tiles/*.json) must carry exactly the compact tuples. */
export function verifyRuntimeChunks(root, area, compact) {
  const dir = join(root, `data/surfaces/${area}-tiles`);
  const result = { area, dir: `data/surfaces/${area}-tiles`, tilesInCompact: Object.keys(compact.tiles).length, chunkFiles: 0, identicalTiles: 0, differingTiles: [], missingTiles: [], extraTiles: [], metadataConsistent: false };
  if (!existsSync(dir)) { result.status = "missing_dir"; return result; }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "metadata.json").sort();
  result.chunkFiles = files.length;
  const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  result.metadataConsistent = JSON.stringify(meta.names) === JSON.stringify(compact.names)
    && JSON.stringify(meta.surfaceVals) === JSON.stringify(compact.surfaceVals)
    && JSON.stringify(meta.tagSets) === JSON.stringify(compact.tagSets)
    && meta.totalSegments === compact.totalSegments
    && meta.sourceDatasetSha256 === compact.sourceDatasetSha256;
  const seen = new Set();
  for (const f of files) {
    const key = f.slice(0, -5);
    seen.add(key);
    const chunk = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const expected = compact.tiles[key];
    if (!expected) { result.extraTiles.push(key); continue; }
    if (JSON.stringify(chunk.tuples) === JSON.stringify(expected)) result.identicalTiles += 1;
    else result.differingTiles.push(key);
  }
  for (const key of Object.keys(compact.tiles)) if (!seen.has(key)) result.missingTiles.push(key);
  result.status = result.metadataConsistent && result.differingTiles.length === 0 && result.missingTiles.length === 0 && result.extraTiles.length === 0 ? "ok" : "mismatch";
  return result;
}
