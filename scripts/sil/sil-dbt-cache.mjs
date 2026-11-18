/**
 * Phase 4.39b: reads the DBT cache written by sil-dbt-fetch.mjs and assembles the citywide inputs.
 *
 * - tram axes (layer 19): every feature of the municipality, deduplicated by segment id;
 * - railway beds (layer 45) and vehicular areas under the axes (layer 39), deduplicated by OBJECTID;
 * - the municipal boundary (layer 0): the 106 segments shared with other municipalities chained into one ring.
 *   That ring is the area the DBT was asked about. Outside it the DBT says nothing.
 * Everything comes from the request log, so a cache and its hashes are one verifiable unit. No network here.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const sha = (x) => createHash("sha256").update(x).digest("hex");
export const MILAN_ISTAT = "03015146";
const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** Chains boundary polylines into one closed ring. Throws unless every endpoint joins exactly two segments. */
export function chainRing(paths) {
  const byEnd = new Map();
  paths.forEach((path, i) => { for (const end of [path[0], path.at(-1)]) { const k = key(end); if (!byEnd.has(k)) byEnd.set(k, []); byEnd.get(k).push(i); } });
  for (const [k, list] of byEnd) if (list.length !== 2) throw new Error(`Boundary endpoint ${k} joins ${list.length} segments, expected 2`);
  const used = new Set([0]);
  let ring = [...paths[0]];
  while (used.size < paths.length) {
    const tail = key(ring.at(-1));
    const next = byEnd.get(tail).find((i) => !used.has(i));
    if (next === undefined) throw new Error("Boundary does not chain into a single ring");
    used.add(next);
    const p = paths[next];
    ring = ring.concat(key(p[0]) === tail ? p.slice(1) : [...p].reverse().slice(1));
  }
  if (key(ring[0]) !== key(ring.at(-1))) throw new Error("Boundary ring is not closed");
  return ring;
}

/**
 * Even-odd point-in-polygon over one or several rings with edges bucketed by latitude (0.0005 degrees, about 55 m).
 * A ray cast at the point's latitude only meets edges whose latitude range covers it, and every such edge sits in
 * that bucket, so the answer equals the plain test while long street polygons stop costing thousands of edge checks.
 */
export function ringIndex(rings, bucket = 0.0005) {
  const buckets = new Map();
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const lo = Math.floor(Math.min(yi, yj) / bucket), hi = Math.floor(Math.max(yi, yj) / bucket);
      for (let b = lo; b <= hi; b++) { if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(xi, yi, xj, yj); }
    }
  }
  return ([x, y]) => {
    const edges = buckets.get(Math.floor(y / bucket));
    if (!edges) return false;
    let inside = false;
    for (let k = 0; k < edges.length; k += 4) {
      const xi = edges[k], yi = edges[k + 1], xj = edges[k + 2], yj = edges[k + 3];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** Even-odd point in ring. */
export function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export async function loadDbtCache(directory) {
  const log = (await readFile(join(directory, "request-log.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const layers = { 0: new Map(), 19: new Map(), 39: new Map(), 45: new Map() };
  const inputs = [];
  const seenKeys = new Set();
  for (const entry of log) {
    if (entry.status !== 200 || seenKeys.has(entry.key) || !layers[entry.layer]) continue;
    seenKeys.add(entry.key);
    const bytes = await readFile(join(directory, `${entry.key}.json`));
    if (sha(bytes) !== entry.sha256) throw new Error(`DBT cache file changed: ${entry.key}`);
    const page = JSON.parse(bytes);
    if (!Array.isArray(page.features)) continue; // count-only probes
    inputs.push({ layer: entry.layer, sha256: entry.sha256, bytes: bytes.length, features: page.features.length });
    for (const feature of page.features) {
      const id = entry.layer === 19 ? feature.attributes.segmentid : feature.attributes.OBJECTID;
      layers[entry.layer].set(id, feature);
    }
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en", { numeric: true })).map(([, v]) => v);
  const milan = sorted(layers[0]).filter((f) => [f.attributes.CMDILIMUNO, f.attributes.CMDILIMDUE].includes(MILAN_ISTAT));
  inputs.sort((a, b) => a.layer - b.layer || a.sha256.localeCompare(b.sha256));
  return {
    axes: sorted(layers[19]), vehicular: sorted(layers[39]), bed: sorted(layers[45]),
    ring: milan.length ? chainRing(milan.map((f) => f.geometry.paths[0])) : null, boundarySegments: milan.length,
    inputs, inputsSha256: sha(inputs.map((i) => `${i.layer}:${i.sha256}`).join("\n")),
    totals: { requestsLogged: log.length, responsesUsed: inputs.length, bytes: inputs.reduce((n, i) => n + i.bytes, 0) },
  };
}
