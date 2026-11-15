import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { sha256 } from "./segment-identity.mjs";

const base = new URL("../../data/surfaces/", import.meta.url);
const staged = process.argv[2];
if (!staged) throw new Error("Usage: node scripts/osm/compare-foundation-build.mjs <candidate-directory>");
const compact = "milan-compact-tiles.json";
const leftBytes = await readFile(new URL(compact, base));
const rightBytes = await readFile(join(staged, compact));
const left = JSON.parse(leftBytes);
const right = JSON.parse(rightBytes);
const changes = { tuples: 0, flags: 0, modeDirections: 0, modeAccess: 0, tileKeys: 0 };
const affectedWays = new Set();
const changedByMode = { car: new Set(), motorcycle: new Set(), bicycle: new Set() };
assert.deepEqual(Object.keys(right.tiles), Object.keys(left.tiles));
for (const key of Object.keys(left.tiles)) {
  const a = left.tiles[key];
  const b = right.tiles[key];
  assert.equal(b.length, a.length, key);
  let changed = false;
  for (let index = 0; index < a.length; index++) {
    const old = a[index], current = b[index];
    // Resolve dictionary indexes so a harmless ordering change cannot conceal surface or tag changes.
    assert.deepEqual([current[0], right.names[current[1]], current[2], current[3], current[4],
      right.surfaceVals[current[5]], current[9], right.tagSets[current[10]]],
      [old[0], left.names[old[1]], old[2], old[3], old[4], left.surfaceVals[old[5]], old[9], left.tagSets[old[10]]], key);
    if (old[6] === current[6] && old[7] === current[7] && old[8] === current[8]) continue;
    changed = true;
    changes.tuples++;
    affectedWays.add(old[0]);
    if (old[6] !== current[6]) changes.flags++;
    if (old[7] !== current[7]) changes.modeDirections++;
    if (old[8] !== current[8]) changes.modeAccess++;
    for (const [mode, shift] of [["car", 4], ["motorcycle", 2], ["bicycle", 0]]) {
      if (((old[7] ^ current[7]) >> shift) & 3) changedByMode[mode].add(old[0]);
    }
  }
  if (changed) changes.tileKeys++;
}
const manifest = JSON.parse(await readFile(join(staged, "osm-foundation", "manifest.json"), "utf8"));
assert.equal(manifest.baseCompactSha256, sha256(rightBytes));
const descriptors = [...Object.values(manifest.tiles), ...manifest.sourceGroups.map((group) => group.entities)];
const runtimeMeasure = (bytes) => ({ sha256: sha256(bytes), rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length });
console.log(JSON.stringify({ base: runtimeMeasure(leftBytes), candidate: runtimeMeasure(rightBytes), directions: {
  ...changes, affectedWays: affectedWays.size, byMode: Object.fromEntries(Object.entries(changedByMode).map(([mode, ids]) => [mode, ids.size])),
}, sourceGroups: manifest.sourceGroups.map(({ name, counts, sources }) => ({ name, counts,
  sources: sources.length, withSnapshot: sources.filter((source) => source.osmBaseTimestamp).length })),
  foundation: { coverage: manifest.coverage, files: (await readdir(join(staged, "osm-foundation"))).length,
    rawBytes: descriptors.reduce((sum, item) => sum + item.rawBytes, 0),
    gzipBytes: descriptors.reduce((sum, item) => sum + item.gzipBytes, 0),
    datasetVersion: manifest.datasetVersion,
    manifestSha256: sha256(await readFile(join(staged, "osm-foundation", "manifest.json"))) },
}, null, 2));

