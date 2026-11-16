/**
 * Phase 4.36 / osm-data-audit — Piazzale Lodi roundabout: every way and approach, archived vs current OSM vs compiled tiles,
 * and how much of each the planned route (return-trip route 0) uses.
 *
 *   node piazzale-lodi-ring.mjs <trace.json>
 *
 * Public landmark only: roundabout ways are found by name ("Piazzale Lodi") in the archive. The trace is read locally to
 * measure route 0's traversal (relative metres). Outputs evidence/osm-data-audit/piazzale-lodi-ring.csv and .json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, wayCoords, wayLength, projectOnLine, metres, ROOT, r1 } from "./osm-archive.mjs";

const tracePath = process.argv[2];
if (!tracePath) { console.error("usage: node piazzale-lodi-ring.mjs <trace.json>"); process.exit(2); }
const OUT = join(ROOT, "outputs/phase436-surface-intelligence/evidence/osm-data-audit");
const arc = await loadArchive();
const trace = JSON.parse(await readFile(tracePath, "utf8"));
const route = trace.routes[0].coordinates;
const cur = JSON.parse(await readFile(join(ROOT, "experiments/phase436-surface-intelligence/data/osm-current/overpass-q2-piazzale-lodi-corso-lodi-papi.json"), "utf8"));
const curWays = new Map(cur.elements.filter((e) => e.type === "way").map((w) => [w.id, w]));

// compiled tiles (committed runtime data)
const meta = JSON.parse(await readFile(join(ROOT, "data/surfaces/milan-tiles/metadata.json"), "utf8"));
const K = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const compiled = new Map(); // way -> unique segments
for (const tile of ["920_4544", "920_4545", "921_4544", "921_4545"]) {
  const t = JSON.parse(await readFile(join(ROOT, `data/surfaces/milan-tiles/${tile}.json`), "utf8"));
  for (const x of Array.isArray(t) ? t : t.tuples) {
    const [w, , c, kId, rw, svId, flags] = x;
    const key = c.join(",");
    const e = compiled.get(w) ?? new Map();
    e.set(key, { c, cat: K[kId], rw, mat: meta.surfaceVals[svId] ?? null, flags });
    compiled.set(w, e);
  }
}
const mm = (c) => metres([c[0], c[1]], [c[2], c[3]]);

const ring = [...arc.ways.values()].filter((w) => w.tags?.name === "Piazzale Lodi" && w.tags.highway && (w.tags.junction || ["cycleway"].includes(w.tags.highway)));
const ringIds = new Set(ring.filter((w) => w.tags.junction).map((w) => w.id));
const ringNodes = new Set(ring.filter((w) => w.tags.junction).flatMap((w) => w.nodes));
// arms: highway ways that share a node with the ring (not ring itself)
const arms = [...arc.ways.values()].filter((w) => w.tags?.highway && !ringIds.has(w.id) && w.nodes.some((n) => ringNodes.has(n)) && !["footway", "steps", "path", "platform", "pedestrian"].includes(w.tags.highway));

// traversal of route 0 over each way: assign each 0.5 m of the route to the nearest way (ring or arm), as in route-surface-diff
let along = 0;
const trav = new Map();
const first = new Map();
const all = [...ring, ...arms].map((w) => ({ w, c: wayCoords(arc, w) })).filter((x) => !x.c.some((p) => !p));
for (let i = 1; i < route.length; i += 1) {
  const a = route[i - 1], b = route[i], L = metres(a, b), n = Math.max(1, Math.round(L / 0.5));
  for (let s = 0; s < n; s += 1) {
    const p = [a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n];
    let best = null;
    for (const x of all) { const q = projectOnLine(x.c, p); if (q.d <= 3 && (!best || q.d < best.d)) best = { d: q.d, id: x.w.id }; }
    if (best) { trav.set(best.id, (trav.get(best.id) ?? 0) + L / n); if (!first.has(best.id)) first.set(best.id, along + (s * L) / n); }
  }
  along += L;
}

const tf = (t) => ["highway", "name", "oneway", "junction", "surface", "smoothness", "surface_bike", "lanes", "lane_markings", "electrified", "trolley_wire", "tram", "railway", "foot", "bicycle", "access", "motor_vehicle"].filter((k) => t[k] !== undefined).map((k) => `${k}=${t[k]}`).join(" ");
const rows = [...ring, ...arms].map((w) => {
  const raw = wayLength(arc, w);
  const comp = compiled.get(w.id);
  const cw = curWays.get(w.id);
  const compCats = comp ? [...new Set([...comp.values()].map((s) => s.cat))].join("+") : "";
  const compLen = comp ? [...comp.values()].reduce((s, x) => s + mm(x.c), 0) : null;
  return {
    wayId: w.id, role: ringIds.has(w.id) ? "ring" : arms.includes(w) ? "arm/neighbour" : "cycle track", name: w.tags.name ?? "", highway: w.tags.highway, surface: w.tags.surface ?? "", smoothness: w.tags.smoothness ?? "", surface_bike: w.tags.surface_bike ?? "",
    oneway: w.tags.oneway ?? (w.tags.junction ? "(junction)" : ""), electrified_trolley: [w.tags.electrified, w.tags.trolley_wire && `trolley_wire=${w.tags.trolley_wire}`].filter(Boolean).join(" "), rawLengthM: r1(raw), nodes: w.nodes.length,
    archiveVersion: w.version, archiveTimestamp: w.timestamp, currentVersion: cw?.version ?? "", unchangedSinceArchive: cw ? JSON.stringify(cw.tags) === JSON.stringify(w.tags) && JSON.stringify(cw.nodes) === JSON.stringify(w.nodes) : "",
    compiledSegments: comp?.size ?? 0, compiledLengthM: compLen === null ? "" : r1(compLen), compiledCategory: compCats, route0TraversalM: r1(trav.get(w.id) ?? 0), route0AlongStartM: first.has(w.id) ? r1(first.get(w.id)) : "",
  };
}).sort((a, b) => (a.role === b.role ? 0 : a.role === "ring" ? -1 : 1) || b.route0TraversalM - a.route0TraversalM || a.wayId - b.wayId);
const csv = (rs) => [Object.keys(rs[0]).join(","), ...rs.map((r) => Object.values(r).map((v) => (typeof v === "string" && /[",]/.test(v) ? JSON.stringify(v) : v)).join(","))].join("\n") + "\n";
await writeFile(join(OUT, "piazzale-lodi-ring.csv"), csv(rows.filter((r) => r.role !== "arm/neighbour" || r.route0TraversalM > 0 || ["Corso Lodi", "Viale Umbria", "Viale Isonzo", "Via Sannio"].includes(r.name))));

// ring order (follow oneway from way end to next way start)
const ringWays = ring.filter((w) => ringIds.has(w.id));
const startOf = new Map(ringWays.map((w) => [w.nodes[0], w]));
const order = [];
let cur2 = ringWays.find((w) => w.id === 287070936), guard = 0;
do { order.push(cur2); cur2 = startOf.get(cur2.nodes.at(-1)) ?? ringWays.find((w) => w.id !== cur2.id && w.nodes[0] === cur2.nodes.at(-1)); guard += 1; } while (cur2 && cur2.id !== 287070936 && guard < 30);
const ringTotal = ringWays.reduce((s, w) => s + wayLength(arc, w), 0);
const ringSett = ringWays.filter((w) => /sett|cobble/.test(w.tags.surface ?? "")).reduce((s, w) => s + wayLength(arc, w), 0);
const ringBike = ringWays.filter((w) => /milanese|sett|cobble/.test(w.tags.surface_bike ?? "")).reduce((s, w) => s + wayLength(arc, w), 0);
const summary = {
  ringWays: ringWays.length, ringCircumferenceM: r1(ringTotal), ringTaggedSettM: r1(ringSett), ringWithRoughSurfaceBikeM: r1(ringBike),
  ringOrder: order.map((w) => ({ id: w.id, m: r1(wayLength(arc, w)), surface: w.tags.surface, smoothness: w.tags.smoothness ?? null, surface_bike: w.tags.surface_bike ?? null, route0M: r1(trav.get(w.id) ?? 0) })),
  route0RingTraversalM: r1(ringWays.reduce((s, w) => s + (trav.get(w.id) ?? 0), 0)), route0RingSettM: r1(ringWays.filter((w) => /sett|cobble/.test(w.tags.surface ?? "")).reduce((s, w) => s + (trav.get(w.id) ?? 0), 0)),
  allRingWaysUnchangedSinceArchive: ringWays.every((w) => { const c = curWays.get(w.id); return c && JSON.stringify(c.tags) === JSON.stringify(w.tags) && JSON.stringify(c.nodes) === JSON.stringify(w.nodes); }),
  note: "route0*: metres of return-trip route 0 within 3 m of the way; ring order follows the one-way direction from way 287070936",
};
console.log(JSON.stringify(summary, null, 1));
await writeFile(join(OUT, "piazzale-lodi-ring.json"), JSON.stringify({ summary, rows }, null, 1) + "\n");
console.table(rows.filter((r) => r.role === "ring" || r.route0TraversalM > 0).map((r) => ({ id: r.wayId, role: r.role, name: r.name, hw: r.highway, surf: r.surface, sm: r.smoothness, sb: r.surface_bike, m: r.rawLengthM, comp: r.compiledLengthM, cat: r.compiledCategory, route: r.route0TraversalM, chg: r.unchangedSinceArchive })));
