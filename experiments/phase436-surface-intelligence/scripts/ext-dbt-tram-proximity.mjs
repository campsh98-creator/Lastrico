/**
 * Per-landmark proximity of DBT 2020 tram elements (layer 19) to OSM/Lastrico ways: the 12 Piazzale Lodi ring ways, the 4 Via Lazzaro Papi
 * ways, Corso Lodi ways (NW arm vs SE arm, split by the ring centroid). Reports min distance and metres of tram within 5/10/15/30 m.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";
const tram = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const arc = await loadArchive();
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180), ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const dWay = (p, c) => { let m = 1e9; for (let i = 1; i < c.length; i += 1) m = Math.min(m, dSeg(p, c[i - 1], c[i])); return m; };
const ring = [], papi = [], clNW = [], clSE = [], viaFriuli = [];
const RC = [9.2102, 45.4474]; // ring centroid (public landmark, from named OSM ways)
for (const w of arc.ways.values()) {
  if (!w.tags?.highway) continue; const c = wayCoords(arc, w); if (c.some((p) => !p)) continue;
  if (w.tags.name === "Piazzale Lodi" && w.tags.junction) ring.push({ id: w.id, c });
  if (w.tags.name === "Via Lazzaro Papi") papi.push({ id: w.id, c });
  if (w.tags.name === "Corso Lodi" && !["cycleway", "footway"].includes(w.tags.highway)) {
    const mid = c[Math.floor(c.length / 2)];
    if (Math.hypot((mid[0] - RC[0]) * kx, (mid[1] - RC[1]) * ky) < 1000) { (mid[0] < RC[0] ? clNW : clSE).push({ id: w.id, c, hw: w.tags.highway, ow: w.tags.oneway }); }
  }
}
const samples = [];
for (const f of tram.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const a = path[i - 1], b = path[i], L = metres(a, b), n = Math.max(1, Math.round(L / 2)); for (let s = 0; s < n; s += 1) samples.push({ p: [a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n], w: L / n, f: f.attributes.OBJECTID, sede: f.attributes.el_trv_sed_d }); }
const stat = (name, ways) => {
  const out = { group: name, ways: ways.length, minDistM: 1e9, tramWithin: { 5: 0, 10: 0, 15: 0, 30: 0 }, sedeAtWithin15: {} };
  for (const s of samples) { const d = Math.min(...ways.map((w) => dWay(s.p, w.c))); out.minDistM = Math.min(out.minDistM, d); for (const t of [5, 10, 15, 30]) if (d <= t) out.tramWithin[t] += s.w; if (d <= 15) out.sedeAtWithin15[s.sede] = (out.sedeAtWithin15[s.sede] ?? 0) + s.w; }
  out.minDistM = +out.minDistM.toFixed(1); for (const k of Object.keys(out.tramWithin)) out.tramWithin[k] = Math.round(out.tramWithin[k]); for (const k of Object.keys(out.sedeAtWithin15)) out.sedeAtWithin15[k] = Math.round(out.sedeAtWithin15[k]);
  return out;
};
const res = [stat("Piazzale Lodi ring (12 ways)", ring), stat("Piazzale Lodi ring way 287070936 (sett)", ring.filter((w) => w.id === 287070936)), stat("ring way 111768010", ring.filter((w) => w.id === 111768010)), stat("ring way 111767966", ring.filter((w) => w.id === 111767966)), stat("Via Lazzaro Papi (4 ways)", papi), stat("Corso Lodi NW of ring (<=1 km)", clNW), stat("Corso Lodi SE of ring (<=1 km)", clSE)];
for (const r of res) console.log(JSON.stringify(r));
console.log("ways counted: ring", ring.length, "papi", papi.length, "clNW", clNW.length, "clSE", clSE.length);
await writeFile(join(EVID, "dbt-tram-proximity.json"), JSON.stringify({ note: "metres of DBT 2020 tram-element centreline (layer 19) within N m of the OSM ways of each landmark group; 2 m sampling", groups: res }, null, 1));
