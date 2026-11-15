import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { clipEdge } from "./ingest.mjs";
import { isRailwayWay, isRestrictionRelation, sanitizeOsmResponse } from "./osm-extraction.mjs";
import { coordinateE7, createSegmentIdentity, SEGMENT_IDENTITY_VERSION, sha256, verifyTileBinding } from "./segment-identity.mjs";

export const FOUNDATION_SCHEMA = "lastrico-osm-foundation-v1";
const TILE_RESOLUTION = 100;
const compareIds = (a, b) => a.id - b.id;
const sortedEntries = (object) => Object.entries(object ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const tags = (object) => Object.fromEntries(sortedEntries(object));
const elementVersion = (record) => record.version ?? 0;

export async function readFoundationGroup({ manifestPath, name, legacyNodes = false, supplement = false, verifiedManifestSha256 }) {
  const manifestBytes = await readFile(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  if (verifiedManifestSha256 && verifiedManifestSha256 !== manifestSha256) {
    throw new Error(`Source manifest changed during compilation: ${manifestPath}`);
  }
  const manifest = JSON.parse(manifestBytes);
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error(`Empty source manifest: ${manifestPath}`);
  const maps = { node: new Map(), way: new Map(), relation: new Map() };
  const sources = [];

  for (const source of manifest.sources) {
    if (source.file !== basename(source.file)) throw new Error(`Expected a source basename: ${source.file}`);
    const fileBytes = await readFile(join(dirname(manifestPath), source.file));
    const raw = source.file.endsWith(".gz") ? gunzipSync(fileBytes) : fileBytes;
    if (sha256(raw) !== source.sha256 || (source.gzipSha256 && sha256(fileBytes) !== source.gzipSha256)) {
      throw new Error(`Checksum mismatch: ${source.file}`);
    }
    if (source.querySha256 && (typeof source.query !== "string" || sha256(source.query) !== source.querySha256)) {
      throw new Error(`Query checksum mismatch: ${source.file}`);
    }
    const response = sanitizeOsmResponse(JSON.parse(raw), { legacySyntheticNodeVersions: legacyNodes });
    const sourceIndex = sources.length;
    sources.push({
      file: source.file, sector: source.sector ?? null, endpoint: source.url ?? source.endpoint ?? null,
      bbox: source.bbox ?? null, coverage: source.coverage ?? "legacy", selection: source.selection ?? manifest.selection ?? null,
      query: source.query ?? null, querySha256: source.query ? sha256(source.query) : null,
      sha256: sha256(raw), inputSha256: source.inputSha256 ?? source.rawResponseSha256 ?? null,
      requestedAt: source.requestedAt ?? null, retrievedAt: source.retrievedAt ?? null, serverDate: source.serverDate ?? null,
      osmBaseTimestamp: response.osm3s?.timestamp_osm_base ?? null,
      generator: response.upstreamGenerator ?? response.generator,
      extractionSchema: source.extractionSchema ?? manifest.schemaVersion ?? null,
      legacySyntheticNodeVersions: legacyNodes,
    });
    for (const element of response.elements) {
      const map = maps[element.type];
      const current = map.get(element.id);
      if (!current || elementVersion(element) > elementVersion(current)) {
        map.set(element.id, { ...element, source: sourceIndex });
      }
    }
  }
  return { name, sources, manifestSha256, supplement, completeSectorCoverage: manifest.completeSectorCoverage === true, nodes: maps.node, ways: maps.way, relations: maps.relation };
}

function visible(record) {
  return record && record.visible !== false;
}

function point(node) {
  return visible(node) && Number.isFinite(node.lon) && Number.isFinite(node.lat) ? [node.lon, node.lat] : null;
}

function coordinatesKey(coordinates) {
  return coordinates.map((p) => coordinateE7(p).join(",")).join(":");
}

function wayEdges(group, way, bounds) {
  const edges = new Map();
  const add = (coordinates, index, status) => {
    const key = coordinatesKey(coordinates);
    const reversedKey = coordinatesKey([...coordinates].reverse());
    for (const [k, orientation] of [[key, 1], [reversedKey, -1]]) {
      const current = edges.get(k);
      if (current?.[0] === "exact" && status === "clipped") continue;
      edges.set(k, !current || (current[0] === "clipped" && status === "exact")
        ? [status, index, orientation] : ["ambiguous"]);
    }
  };
  for (let index = 0; index + 1 < way.nodes.length; index++) {
    const coordinates = way.nodes.slice(index, index + 2).map((id) => point(group.nodes.get(id)));
    if (coordinates.includes(null) || way.nodes[index] === way.nodes[index + 1]) continue;
    add(coordinates, index, "exact");
    if (!bounds) continue;
    const clipped = clipEdge(...coordinates, bounds);
    if (clipped && coordinatesKey(clipped) !== coordinatesKey(coordinates)) add(clipped, index, "clipped");
  }
  return edges;
}

function entityMetadata(record) {
  return { id: record.id, version: record.version ?? null, timestamp: record.timestamp ?? null,
    changeset: record.changeset ?? null, source: record.source, ...(record.visible === false ? { visible: false } : {}),
    tags: tags(record.tags) };
}

function intersectedTiles(a, b) {
  const keys = [];
  for (let x = Math.floor(Math.min(a[0], b[0]) * TILE_RESOLUTION); x <= Math.floor(Math.max(a[0], b[0]) * TILE_RESOLUTION); x++) {
    for (let y = Math.floor(Math.min(a[1], b[1]) * TILE_RESOLUTION); y <= Math.floor(Math.max(a[1], b[1]) * TILE_RESOLUTION); y++) {
      keys.push(`${x}_${y}`);
    }
  }
  return keys;
}

function compileEntities(group, linkedWayIds, railsByTile, groupIndex, bounds) {
  const ways = new Set(linkedWayIds);
  const nodes = new Set();
  const relationRefs = new Map();
  const relations = [...group.relations.values()].sort(compareIds).map((relation) => {
    const restriction = isRestrictionRelation(relation.tags);
    for (const { type, role, ref } of relation.members ?? []) {
      if (type === "way") {
        if (!relationRefs.has(ref)) relationRefs.set(ref, []);
        relationRefs.get(ref).push([relation.id, role]);
        if (restriction) ways.add(ref);
      } else if (type === "node" && restriction) {
        nodes.add(ref);
      }
    }
    const missingMembers = relation.members?.filter(({ type, ref }) => {
      if (type === "node") return !point(group.nodes.get(ref));
      if (type === "relation") return !visible(group.relations.get(ref));
      const way = group.ways.get(ref);
      return !visible(way) || (way.nodes?.length ?? 0) < 2 || way.nodes.some((id) => !point(group.nodes.get(id)));
    });
    return { ...entityMetadata(relation), members: relation.members ?? null,
      missingMembers: restriction ? missingMembers ?? null : null };
  });

  for (const way of group.ways.values()) {
    if (!visible(way) || (group.supplement && way.tags.highway)) ways.add(way.id);
    if (!visible(way) || !isRailwayWay(way.tags)) continue;
    ways.add(way.id);
    const keys = new Set();
    for (let index = 1; index < (way.nodes?.length ?? 0); index++) {
      const a = point(group.nodes.get(way.nodes[index - 1]));
      const b = point(group.nodes.get(way.nodes[index]));
      const edge = a && b && (bounds ? clipEdge(a, b, bounds) : [a, b]);
      if (edge) for (const key of intersectedTiles(...edge)) keys.add(key);
    }
    for (const key of keys) {
      if (!railsByTile.has(key)) railsByTile.set(key, []);
      railsByTile.get(key).push([groupIndex, way.id]);
    }
  }

  const compiledWays = [...ways].sort((a, b) => a - b).flatMap((id) => {
    const way = group.ways.get(id);
    if (!way) return [];
    for (const nodeId of way.nodes ?? []) nodes.add(nodeId);
    return [{ ...entityMetadata(way), nodeIds: way.nodes ?? [], relationRefs: relationRefs.get(id) ?? [] }];
  });
  for (const node of group.nodes.values()) {
    if (!visible(node) || Object.keys(node.tags ?? {}).length) nodes.add(node.id);
  }
  const compiledNodes = [...nodes].sort((a, b) => a - b).flatMap((id) => {
    const node = group.nodes.get(id);
    return node ? [{ ...entityMetadata(node), coordinates: point(node) }] : [];
  });
  return { ways: compiledWays, nodes: compiledNodes, relations };
}

async function writeAtomic(path, bytes) {
  const pending = path + `.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, bytes);
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}

async function emit(directory, stem, object) {
  const raw = Buffer.from(JSON.stringify(object));
  const compressed = gzipSync(raw, { level: 9 });
  const checksum = sha256(raw);
  const file = `${stem}-${checksum}.json.gz`;
  await writeAtomic(join(directory, file), compressed);
  return { file, sha256: checksum, gzipSha256: sha256(compressed), rawBytes: raw.length, gzipBytes: compressed.length };
}

/** Join by way identity and its exact archived OSM coordinates. Each source group retains its own timeline. */
export async function compileMilanFoundation({ directory, tilesDir, baseCompactSha256, pilotBounds, coverageBounds,
  groups, allSegments }) {
  await mkdir(directory, { recursive: true });
  const datasetVersion = sha256(JSON.stringify([FOUNDATION_SCHEMA, SEGMENT_IDENTITY_VERSION,
    baseCompactSha256, groups.map((group) => [group.name, group.manifestSha256, group.supplement])]));
  const groupIndexes = new Map(groups.map((group, index) => [group.name, index]));
  if (groupIndexes.size !== groups.length) throw new Error("Duplicate foundation group");
  const edgeCache = new Map();
  const wayIds = groups.map(() => new Set());
  const segmentBindings = new Map();
  const coverage = { exact: 0, clipped: 0, ambiguous: 0, unmatched: 0, unknownWayVersion: 0 };
  for (const segment of allSegments) {
    const group = groupIndexes.get(segment.foundationSourceGroup);
    const wayId = segment.osmWayId;
    const way = groups[group]?.ways.get(wayId);
    let row = ["unmatched"];
    if (visible(way) && way.nodes) {
      const cacheKey = `${group}:${wayId}`;
      if (!edgeCache.has(cacheKey)) {
        edgeCache.set(cacheKey, wayEdges(groups[group], way, segment.foundationSourceGroup === "pilot" ? pilotBounds : null));
      }
      const edge = edgeCache.get(cacheKey).get(coordinatesKey(segment.coordinates));
      if (edge?.[0] === "ambiguous") row = ["ambiguous", group];
      else if (edge) row = [edge[0], group, edge[1], edge[2]];
      else row = ["unmatched", group];
      wayIds[group].add(wayId);
      if (way.version == null) coverage.unknownWayVersion++;
    }
    coverage[row[0]]++;
    const key = `${wayId}:${coordinatesKey(segment.coordinates)}`;
    if (segmentBindings.has(key)) throw new Error(`Duplicate compact segment binding: ${key}`);
    segmentBindings.set(key, row);
  }

  const railsByTile = new Map();
  const sourceGroups = [];
  for (const [index, group] of groups.entries()) {
    const entities = compileEntities(group, wayIds[index], railsByTile, index, coverageBounds);
    sourceGroups.push({ name: group.name, sources: group.sources, manifestSha256: group.manifestSha256,
      completeSectorCoverage: group.completeSectorCoverage,
      entities: await emit(directory, `entities-${index}`, entities),
      counts: { nodes: entities.nodes.length, ways: entities.ways.length,
        railwayWays: entities.ways.filter((way) => isRailwayWay(way.tags)).length,
        restrictions: entities.relations.filter((relation) => isRestrictionRelation(relation.tags)).length,
        restrictionsWithMissingMembers: entities.relations.filter((relation) => isRestrictionRelation(relation.tags)
          && (relation.missingMembers === null || relation.missingMembers.length > 0)).length,
        relations: entities.relations.length } });
  }
  const { tileKeys } = JSON.parse(await readFile(join(tilesDir, "metadata.json")));
  const baseTileKeys = new Set(tileKeys);
  const tiles = {};
  for (const key of [...new Set([...tileKeys, ...railsByTile.keys()])].sort()) {
    const baseBytes = baseTileKeys.has(key) ? await readFile(join(tilesDir, `${key}.json`)) : null;
    const segments = baseBytes ? JSON.parse(baseBytes).tuples.map((tuple) => {
      const [wayId, , coords] = tuple;
      const binding = segmentBindings.get(`${wayId}:${coordinatesKey([coords.slice(0, 2), coords.slice(2, 4)])}`);
      if (!binding) throw new Error(`Missing segment binding in tile ${key}`);
      return binding;
    }) : [];
    const railwayWays = (railsByTile.get(key) ?? []).sort(([ga, wa], [gb, wb]) => ga - gb || wa - wb);
    tiles[key] = await emit(directory, `tile-${key}`, { key, datasetVersion, identityVersion: SEGMENT_IDENTITY_VERSION,
      baseTileSha256: baseBytes ? sha256(baseBytes) : null, segments, railwayWays });
  }
  const manifest = { schema: FOUNDATION_SCHEMA, identityVersion: SEGMENT_IDENTITY_VERSION,
    datasetVersion, baseCompactSha256, attribution: "© OpenStreetMap contributors", license: "ODbL-1.0",
    coverageBounds, coverage, sourceGroups, tiles };
  await writeAtomic(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function readFoundationArtifact(directory, descriptor) {
  if (basename(descriptor.file) !== descriptor.file) throw new Error("Expected a foundation artifact basename");
  const bytes = await readFile(join(directory, descriptor.file));
  if (sha256(bytes) !== descriptor.gzipSha256) throw new Error(`Foundation gzip checksum mismatch: ${descriptor.file}`);
  const raw = gunzipSync(bytes);
  if (sha256(raw) !== descriptor.sha256) throw new Error(`Foundation checksum mismatch: ${descriptor.file}`);
  return JSON.parse(raw);
}

/** Bind once per tile before reading positional joins. Load the group tables from the same verified manifest. */
export function openFoundationTile({ tile, baseTileBytes, datasetVersion, entityGroups }) {
  const binding = verifyTileBinding(tile, { datasetVersion, baseTileBytes });
  if (binding.status !== "matched") return binding;
  const tuples = baseTileBytes ? JSON.parse(baseTileBytes).tuples : [];
  if (tuples.length !== tile.segments.length) throw new Error("Invalid foundation tile length");
  return { status: "matched", railwayWays: tile.railwayWays, segment(tupleIndex) {
    const row = tile.segments[tupleIndex];
    if (!row || row[0] !== "exact") return { status: row?.[0] ?? "missing" };
    const [, groupIndex, edgeIndex, orientation] = row;
    const [wayId] = tuples[tupleIndex];
    const group = entityGroups[groupIndex];
    const way = group.ways.get(wayId);
    const nodeIds = way.nodeIds.slice(edgeIndex, edgeIndex + 2);
    const coordinates = nodeIds.map((id) => group.nodes.get(id).coordinates);
    return { status: "exact", orientation, sourceGroup: groupIndex,
      identity: createSegmentIdentity({ wayId, wayVersion: way.version, nodeIds, coordinates }) };
  } };
}
