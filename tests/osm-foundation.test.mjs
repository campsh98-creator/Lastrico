import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compileMilanFoundation, openFoundationTile, readFoundationArtifact, readFoundationGroup } from "../scripts/osm/compile-osm-foundation.mjs";
import { evaluateOsmTurnRestrictions } from "../scripts/osm/turn-restrictions.mjs";
import { compareSegmentSnapshots, createSegmentIdentity, SEGMENT_IDENTITY_VERSION, sha256, verifyTileBinding } from "../scripts/osm/segment-identity.mjs";

const newEdge = (wayId, wayVersion, nodeIds, coordinates = [[9.18, 45.45], [9.184, 45.45]]) =>
  createSegmentIdentity({ wayId, wayVersion, nodeIds, coordinates });

test("OSM edge identifiers survive reversal and distinguish splits, merges and edits", () => {
  const a = newEdge(10, 1, [1, 2]);
  assert.deepEqual(newEdge(10, 1, [2, 1], [[9.184, 45.45], [9.18, 45.45]]), a);
  const b = newEdge(10, 1, [2, 3]);
  const c = newEdge(30, 4, [7, 8]);
  const unchanged = newEdge(50, 3, [21, 22]);
  const previous = { datasetVersion: "old", segments: [a, b, c, unchanged, newEdge(60, 1, [31, 32]), newEdge(70, 1, [33, 34])] };
  const next = { datasetVersion: "new", segments: [newEdge(11, 1, [1, 2]), newEdge(12, 5, [2, 3]),
    newEdge(12, 5, [7, 8], [[9.18, 45.45], [9.181, 45.45]]), unchanged] };
  const changes = compareSegmentSnapshots(previous, next, { deletedWayIds: [60] });
  assert.deepEqual(changes.map((result) => result.status), ["review", "review", "review", "exact", "deleted", "orphaned"]);
  assert.deepEqual(changes[0].changes, ["split", "reassigned"]);
  assert.deepEqual(changes[1].changes, ["split", "merge", "reassigned", "way-version-changed"]);
  assert.deepEqual(changes[2].changes, ["merge", "reassigned", "geometry-changed", "way-version-changed"]);
  assert.equal(changes[0].target.edgeId, a.edgeId);
  assert.notEqual(changes[0].target.revisionId, a.revisionId);
  assert.notEqual(changes[2].target.edgeId, c.edgeId);
  assert.equal(newEdge(10, null, [1, 2]).revisionId, null);
  assert.equal(compareSegmentSnapshots(previous, { ...next, segments: [...next.segments, newEdge(99, 4, [1, 2])] })[0].status, "ambiguous");
  assert.deepEqual(compareSegmentSnapshots({ datasetVersion: "1", segments: [a] },
    { datasetVersion: "2", segments: [newEdge(10, 2, [1, 5]), newEdge(10, 2, [5, 2])] })[0].changes, ["anchors-no-longer-adjacent"]);
});

test("Piazzale Lodi identities use authenticated way versions and exactly adjacent OSM node IDs", async () => {
  const group = await readFoundationGroup({ name: "legacy-citywide",
    manifestPath: fileURLToPath(new URL("../data/sources/milan-citywide-expansion.source.json", import.meta.url)),
    legacyNodes: true });
  const cases = [[287070936, 17, "sett"], [111768010, null, "asphalt"], [111767966, null, "asphalt"]];
  const edgeIds = new Set();
  for (const [wayId, version, surface] of cases) {
    const way = group.ways.get(wayId);
    assert.equal(way.tags.surface, surface);
    if (version != null) assert.equal(way.version, version);
    assert.ok(way.version > 0 && way.timestamp);
    assert.ok(group.sources[way.source].querySha256 && group.sources[way.source].sha256);
    for (let index = 1; index < way.nodes.length; index++) {
      const nodeIds = [way.nodes[index - 1], way.nodes[index]];
      const coordinates = nodeIds.map((id) => {
        const { lon, lat } = group.nodes.get(id);
        return [lon, lat];
      });
      const segment = newEdge(wayId, way.version, nodeIds, coordinates);
      assert.ok(!edgeIds.has(segment.edgeId));
      assert.ok(segment.revisionId);
      edgeIds.add(segment.edgeId);
    }
  }
  assert.equal(edgeIds.size, 27);
  assert.equal(group.ways.get(111768010).tags.surface_bike, "milanese_paving");
  assert.equal(group.nodes.get(group.ways.get(287070936).nodes[0]).version, undefined);
});

test("compilation keeps the exact tile binding, clipped parent edge, rail-only geometry and relation provenance", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "lastrico-osm-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const tilesDir = join(scratch, "tiles");
  await mkdir(tilesDir);
  const bounded = { west: 9.18, east: 9.2, south: 45.45, north: 45.47 };
  const metadata = { version: 3, timestamp: "2026-02-01T00:00:00Z", changeset: 555 };
  const n = (id, lon, tags) => ({ ...metadata, type: "node", id, lon, lat: 45.454, tags, user: "exclude" });
  const w = (id, nodes, tags) => ({ ...metadata, type: "way", id, nodes, tags, uid: 456 });
  const document = { version: 0.6, generator: "Overpass API", osm3s: { timestamp_osm_base: "2026-03-01T00:00:00Z" },
    elements: [
      n(1, 9.179), n(2, 9.185, { barrier: "bollard", bicycle: "yes" }), n(3, 9.189), n(4, 9.184), n(5, 9.186),
      w(10, [1, 2, 3], { highway: "primary", surface: "asphalt", smoothness: "good", surface_bike: "sett" }),
      w(15, [4, 5], { highway: "service", surface: "asphalt" }),
      w(20, [4, 5], { railway: "tram", layer: "1" }),
      w(25, undefined, { railway: "tram" }),
      { ...metadata, type: "relation", id: 30, tags: { type: "restriction", restriction: "no_u_turn", day_on: "Mo", hour_on: "08:00" },
        members: [{ type: "way", ref: 10, role: "from" }, { type: "node", ref: 2, role: "via" }, { type: "way", ref: 10, role: "to" }] },
    ] };
  const source = JSON.stringify(document);
  const sourcePath = join(scratch, "sector.json");
  const manifestPath = join(scratch, "source.json");
  await writeFile(sourcePath, source);
  await writeFile(manifestPath, JSON.stringify({ selection: "fixture", sources: [{ file: "sector.json",
    sha256: sha256(source), query: "fixture query", bbox: [9.18, 45.45, 9.2, 45.47], retrievedAt: "2026-03-02T00:00:00Z" }] }));
  const group = await readFoundationGroup({ name: "pilot", manifestPath });
  assert.equal(group.sources[0].osmBaseTimestamp, document.osm3s.timestamp_osm_base);
  const coords = [[[9.18, 45.454], [9.185, 45.454]], [[9.185, 45.454], [9.189, 45.454]]];
  const baseTileBytes = Buffer.from(JSON.stringify({ tuples: coords.map((edge) => [10, 0, edge.flat()]) }));
  await writeFile(join(tilesDir, "metadata.json"), JSON.stringify({ tileKeys: ["918_4545"] }));
  await writeFile(join(tilesDir, "918_4545.json"), baseTileBytes);
  const supplement = await readFoundationGroup({ name: "recent-sector", manifestPath, supplement: true });
  const options = { tilesDir, groups: [group, supplement], baseCompactSha256: sha256("fixture compact"), pilotBounds: bounded, coverageBounds: bounded,
    allSegments: coords.map((coordinates) => ({ osmWayId: 10, coordinates, foundationSourceGroup: "pilot" })) };
  const dir = join(scratch, "one");
  const manifest = await compileMilanFoundation({ directory: dir, ...options });
  assert.deepEqual(manifest, await compileMilanFoundation({ directory: join(scratch, "two"), ...options }));
  const read = (descriptor) => readFoundationArtifact(dir, descriptor);
  assert.deepEqual(manifest.coverage, { exact: 1, clipped: 1, ambiguous: 0, unmatched: 0, unknownWayVersion: 0 });
  const tile = await read(manifest.tiles["918_4545"]);
  assert.deepEqual(tile.railwayWays, [[0, 20], [1, 20]]);
  assert.deepEqual(tile.segments, [["clipped", 0, 0, 1], ["exact", 0, 1, 1]]);
  const entities = await read(manifest.sourceGroups[0].entities);
  const roads = new Map(entities.ways.map((way) => [way.id, way]));
  const supplementalWays = (await read(manifest.sourceGroups[1].entities)).ways;
  assert.equal(roads.has(15), false);
  assert.equal(supplementalWays.find((way) => way.id === 15).tags.surface, "asphalt");
  const nodes = new Map(entities.nodes.map((node) => [node.id, node]));
  assert.deepEqual(roads.get(20).nodeIds.map((id) => nodes.get(id).coordinates), [[9.184, 45.454], [9.186, 45.454]]);
  assert.deepEqual(roads.get(25).nodeIds, []);
  assert.equal(nodes.get(2).tags.barrier, "bollard");
  assert.equal(roads.get(10).tags.surface_bike, "sett");
  assert.equal(roads.get(10).tags.smoothness, "good");
  assert.equal(roads.get(10).version, 3);
  assert.equal(roads.get(10).timestamp, metadata.timestamp);
  assert.equal(roads.get(10).changeset, metadata.changeset);
  assert.equal(roads.get(10).uid, undefined);
  assert.deepEqual(roads.get(10).relationRefs, [[30, "from"], [30, "to"]]);
  assert.deepEqual(entities.relations[0].missingMembers, []);
  assert.equal(entities.relations[0].tags.day_on, "Mo");
  assert.equal(entities.relations[0].tags.hour_on, "08:00");
  const evaluated = evaluateOsmTurnRestrictions({ ways: roads, relations: entities.relations, mode: "car",
    traversal: [{ wayId: 10, fromNodeId: 1, toNodeId: 2 }, { wayId: 10, fromNodeId: 2, toNodeId: 1 }] });
  assert.equal(evaluated.status, "unknown");
  assert.equal(evaluated.restrictions[0].reason, "conditional");
  const lookup = { tile, baseTileBytes, datasetVersion: manifest.datasetVersion, entityGroups: [{ ways: roads, nodes }] };
  const joined = openFoundationTile(lookup);
  assert.equal(joined.segment(0).status, "clipped");
  assert.deepEqual(joined.segment(1).identity.nodeIds, [2, 3]);
  assert.equal(verifyTileBinding({ ...tile, identityVersion: SEGMENT_IDENTITY_VERSION }, { ...lookup, datasetVersion: "old" }).status, "dataset-version-mismatch");
  assert.equal(verifyTileBinding(tile, { ...lookup, baseTileBytes: Buffer.from("other tile") }).status, "tile-hash-mismatch");
  await writeFile(sourcePath, source + "\n");
  await assert.rejects(readFoundationGroup({ name: "pilot", manifestPath }), /Checksum mismatch/);
});

