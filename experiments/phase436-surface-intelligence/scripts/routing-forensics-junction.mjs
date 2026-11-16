/**
 * Phase 4.36 routing forensics, Agent 1: local OSM junction inspection (H1: is the turn from the origin street
 * into Via Friuli legal and connected in the repository's OSM extracts?).
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-junction.mjs [--out=file]
 *
 * Reads only data/sources/milan-citywide-s-east|s-central.osm.json.gz (Overpass `way[highway]` + nodes: NO relations,
 * so turn-restriction relations are not present in this data; recorded in the output). Offline.
 * Privacy: only public corridor names are written; every other street is "<other street>" and its way/node ids are withheld.
 */
import zlib from "node:zlib";
import fs from "node:fs";
const root = new URL("../../../", import.meta.url);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const nodes = new Map(); const nodeTags = new Map(); const ways = new Map(); let relations = 0; const sources = [];
for (const f of ["milan-citywide-s-east.osm.json.gz", "milan-citywide-s-central.osm.json.gz"]) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`data/sources/${f}`, root))));
  sources.push(f);
  for (const e of d.elements) {
    if (e.type === "node") { nodes.set(e.id, [e.lon, e.lat]); if (e.tags) nodeTags.set(e.id, e.tags); }
    else if (e.type === "way") ways.set(e.id, e);
    else if (e.type === "relation") relations += 1;
  }
}
const byNode = new Map();
for (const w of ways.values()) w.nodes.forEach((n, i) => { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push({ w, i }); });
const FRIULI = [...ways.values()].filter((w) => w.tags?.name === "Via Friuli" && w.tags.highway === "residential"
  && w.nodes.some((n) => { const p = nodes.get(n); return p && p[0] > 9.205 && p[0] < 9.215 && p[1] > 45.4484 && p[1] < 45.4520; }));
import { pub } from "./lib/osm-local.mjs";
const r5 = (p) => p.map((x) => +x.toFixed(3));
const describeWay = (w, nodeId) => {
  const i = w.nodes.indexOf(nodeId);
  const dir = w.tags.oneway === "yes" ? (i === 0 ? "leaves node (oneway starts here)" : i === w.nodes.length - 1 ? "arrives at node (oneway ends here)" : "passes through (oneway)") : "two-way";
  return { way: w.tags.name === "Via Friuli" ? w.id : "<withheld>", name: pub(w.tags.name ?? null), highway: w.tags.highway, oneway: w.tags.oneway ?? null, access: w.tags.access ?? null, motor_vehicle: w.tags.motor_vehicle ?? null,
    vehicle: w.tags.vehicle ?? null, surface: w.tags.surface ?? null, maxspeed: w.tags.maxspeed ?? null, direction: dir, tagKeys: Object.keys(w.tags).sort().join(",") };
};
const result = { sources, relationsInSources: relations, note: "Overpass way[highway] + skeleton nodes: no relation elements, so no turn restrictions exist in this data", friuliWays: FRIULI.map((w) => ({ way: w.id, nodes: w.nodes.length, oneway: w.tags.oneway, surface: w.tags.surface })), junctions: [] };
// junction nodes of Via Friuli with another named road
for (const fw of FRIULI) for (const n of fw.nodes) {
  const here = byNode.get(n) ?? []; const others = here.filter((h) => h.w.id !== fw.id && !FRIULI.some((x) => x.id === h.w.id));
  if (!others.length) continue;
  const p = nodes.get(n);
  result.junctions.push({ node: "<node id withheld>", at: r5(p), nodeTags: nodeTags.get(n) ?? null, ways: here.map((h) => describeWay(h.w, n)) });
}
console.log(JSON.stringify(result, null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
