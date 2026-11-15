/**
 * Phase 4.36 / osm-data-audit — read-only loader for the archived OSM extracts in data/sources/.
 * Node built-ins only. Nothing is written to data/ and nothing goes over the network.
 *
 *   import { loadArchive, metres, bearing, ... } from "./osm-archive.mjs";
 *   const arc = await loadArchive();                  // citywide (Overpass, 2026-11-04) + pilot (OSM API, 2026-10-26/28)
 *
 * `ways` holds, per OSM way id, the newest `version` across all files, plus every file that contained it.
 * `relations` holds relations (only the pilot OSM-API extracts contain any; the citywide Overpass extracts
 * were queried with way["highway"] + recurse-down, so they have none).
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SOURCES = join(ROOT, "data/sources");

const FILES = [
  ...["s-central", "s-west", "s-east", "west", "east", "n-west", "n-central", "n-east"].map((s) => ({ file: `milan-citywide-${s}.osm.json.gz`, kind: "citywide" })),
  ...["sw", "se", "nw", "ne", "w-sw", "w-nw", "n-nw", "n-ne", "e-nw", "s-sw", "s-se"].map((s) => ({ file: `milan-pilot-${s}.osm.json.gz`, kind: "pilot" })),
];

export async function loadArchive({ kinds = ["citywide", "pilot"] } = {}) {
  const manifests = {
    citywide: JSON.parse(await readFile(join(SOURCES, "milan-citywide-expansion.source.json"), "utf8")),
    pilot: JSON.parse(await readFile(join(SOURCES, "milan-pilot-osm.source.json"), "utf8")),
  };
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  const perFile = [];
  const wayFiles = new Map();
  for (const { file, kind } of FILES) {
    if (!kinds.includes(kind)) continue;
    const bytes = gunzipSync(await readFile(join(SOURCES, file)));
    const sha = createHash("sha256").update(bytes).digest("hex");
    const manifestEntry = manifests[kind].sources.find((s) => s.file === file);
    const j = JSON.parse(bytes);
    const counts = { node: 0, way: 0, relation: 0 };
    for (const e of j.elements) {
      counts[e.type] += 1;
      if (e.type === "node") {
        const old = nodes.get(e.id);
        if (!old || (e.version ?? 0) >= (old.version ?? 0)) nodes.set(e.id, e);
      } else if (e.type === "way") {
        const old = ways.get(e.id);
        if (!old || (e.version ?? 0) > (old.version ?? 0)) ways.set(e.id, { ...e, _file: file, _kind: kind });
        if (!wayFiles.has(e.id)) wayFiles.set(e.id, []);
        wayFiles.get(e.id).push(file);
      } else if (e.type === "relation") {
        const old = relations.get(e.id);
        if (!old || (e.version ?? 0) > (old.version ?? 0)) relations.set(e.id, { ...e, _file: file });
      }
    }
    perFile.push({ file, kind, counts, sha256Ok: manifestEntry ? sha === manifestEntry.sha256 : null, retrievedAt: manifestEntry?.retrievedAt, bbox: manifestEntry?.bbox, osmBase: j.osm3s?.timestamp_osm_base ?? null, generator: j.generator });
  }
  return { nodes, ways, relations, perFile, wayFiles, manifests };
}

// Same flat-earth metric the app uses (lib/road-intelligence-scoring.ts:88-98): 111,320·cos(lat) and 110,540 m/deg.
export function metres(a, b) {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180), (b[1] - a[1]) * 110_540);
}
export function bearing(a, b) {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
export function wayCoords(arc, way) {
  return way.nodes.map((id) => {
    const n = arc.nodes.get(id);
    return n ? [n.lon, n.lat] : null;
  });
}
export function wayLength(arc, way) {
  const c = wayCoords(arc, way);
  let l = 0;
  for (let i = 1; i < c.length; i += 1) if (c[i] && c[i - 1]) l += metres(c[i - 1], c[i]);
  return l;
}
/** Nearest distance (m) from point p to polyline coords, and distance along the polyline. */
export function projectOnLine(coords, p) {
  const lat0 = p[1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  let best = { d: Infinity, along: 0, seg: -1 };
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const ax = (coords[i - 1][0] - p[0]) * kx, ay = (coords[i - 1][1] - p[1]) * ky;
    const bx = (coords[i][0] - p[0]) * kx, by = (coords[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const sl = Math.sqrt(l2);
    if (d < best.d) best = { d, along: acc + t * sl, seg: i - 1 };
    acc += sl;
  }
  return best;
}
export const r1 = (x) => Math.round(x * 10) / 10;
export const r3 = (x) => Math.round(x * 1000) / 1000;
