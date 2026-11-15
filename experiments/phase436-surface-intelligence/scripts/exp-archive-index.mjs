/**
 * Index of the archived provider responses by journey (start, end, costing). Offline.
 *   node experiments/phase436-surface-intelligence/scripts/exp-archive-index.mjs
 * Writes (git-ignored) data/exp-cache/archive-index.json: { groupKey: [ {key, kind, locations, factors, alternates, status, ms} ] }
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { EXP, CACHE, OUT } from "./exp-harness.mjs";
const dir = new URL("data/archive/responses/", EXP);
const files = await readdir(dir);
const groups = {};
const kinds = {};
for (const f of files) {
  const e = JSON.parse(await readFile(new URL(f, dir), "utf8"));
  if (!e.request.body) continue;
  const b = JSON.parse(e.request.body);
  const L = b.locations;
  const kind = b.exclude_polygons ? "exclude" : b.linear_cost_factors ? "penalised" : L.length > 2 ? "via" : "base";
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  const gk = `${L[0].lon},${L[0].lat}|${L[L.length - 1].lon},${L[L.length - 1].lat}|${b.costing}`;
  (groups[gk] ??= []).push({ key: e.key, kind, locations: L.length, factors: b.linear_cost_factors?.length ?? 0, alternates: b.alternates ?? 0, status: e.status, ms: e.elapsedMs, via: L.length > 2 ? [L[1].lon, L[1].lat] : null });
}
await writeFile(new URL("archive-index.json", CACHE), JSON.stringify(groups));
const sizes = Object.values(groups).map((g) => g.length);
console.log({ files: files.length, groups: Object.keys(groups).length, kinds, maxPerGroup: Math.max(...sizes), meanPerGroup: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2) });
