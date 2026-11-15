/**
 * Which ATM surface routes (ds538) run on Corso Lodi / Piazzale Lodi ring / Via Lazzaro Papi? Metres of each route within 12 m of the OSM ways of
 * each landmark group. Also compares ATM TRAM geometry with DBT 2020 tram elements (layer 19) near Corso Lodi, and ATM TRAM vs OSM tram in the archive.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";
const atm = JSON.parse(await readFile(join(CACHE, "atm-tpl_percorsi.geojson"), "utf8"));
const dbt = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const arc = await loadArchive();
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180), ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const dWay = (p, c) => { let m = 1e9; for (let i = 1; i < c.length; i += 1) m = Math.min(m, dSeg(p, c[i - 1], c[i])); return m; };
const RC = [9.2102, 45.4474]; const groups = { ring: [], papi: [], clNW: [], clSE: [] };
for (const w of arc.ways.values()) {
  if (!w.tags?.highway) continue; const c = wayCoords(arc, w); if (c.some((p) => !p)) continue;
  if (w.tags.name === "Piazzale Lodi" && w.tags.junction) groups.ring.push(c);
  if (w.tags.name === "Via Lazzaro Papi") groups.papi.push(c);
  if (w.tags.name === "Corso Lodi" && !["cycleway", "footway"].includes(w.tags.highway)) { const mid = c[Math.floor(c.length / 2)]; if (Math.hypot((mid[0] - RC[0]) * kx, (mid[1] - RC[1]) * ky) < 1000) (mid[0] < RC[0] ? groups.clNW : groups.clSE).push(c); }
}
const near = (p, ways, r) => ways.some((c) => dWay(p, c) <= r);
const rows = [];
for (const f of atm.features) {
  const g = f.geometry.coordinates; const e = { linea: f.properties.linea, mezzo: f.properties.mezzo, percorso: f.properties.percorso, verso: f.properties.verso, nome: f.properties.nome, tipo: f.properties.tipo_perc, lungKm: f.properties.lung_km, ring: 0, papi: 0, clNW: 0, clSE: 0 };
  let any = false;
  for (let i = 1; i < g.length; i += 1) { const a = g[i - 1], b = g[i], L = metres(a, b); if (L > 200) continue; const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (p[0] < 9.2 || p[0] > 9.22 || p[1] < 45.44 || p[1] > 45.455) continue; for (const k of Object.keys(groups)) if (near(p, groups[k], 12)) { e[k] += L; any = true; } }
  if (any) rows.push(e);
}
for (const r of rows) for (const k of ["ring", "papi", "clNW", "clSE"]) r[k] = Math.round(r[k]);
rows.sort((a, b) => (b.clNW + b.clSE + b.ring + b.papi) - (a.clNW + a.clSE + a.ring + a.papi));
console.log("ATM routes with >0 m within 12 m of the landmark ways (metres): linea mezzo percorso verso tipo | ring papi clNW clSE | nome");
for (const r of rows) console.log(`${r.linea}\t${r.mezzo}\t${r.percorso}\t${r.verso}\t${r.tipo}\t| ${r.ring}\t${r.papi}\t${r.clNW}\t${r.clSE}\t| ${r.nome}`);
const tramLines = [...new Set(rows.filter((r) => r.mezzo === "TRAM" && (r.clNW + r.clSE + r.ring + r.papi) > 50).map((r) => r.linea))];
console.log("TRAM lines (>50 m on the landmark ways):", tramLines.join(", ") || "(none)");
// ATM TRAM vs DBT tram: for DBT tram samples near Corso Lodi NW, distance to nearest ATM TRAM polyline
const tramRoutes = atm.features.filter((f) => f.properties.mezzo === "TRAM").map((f) => f.geometry.coordinates);
let n = 0, within = 0, sumD = 0, maxD = 0;
for (const f of dbt.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const a = path[i - 1], b = path[i]; const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!near(p, groups.clNW, 15)) continue; let m = 1e9; for (const r of tramRoutes) for (let j = 1; j < r.length; j += 1) { const q = [(r[j - 1][0] + r[j][0]) / 2, (r[j - 1][1] + r[j][1]) / 2]; if (Math.abs(q[0] - p[0]) > 0.001 || Math.abs(q[1] - p[1]) > 0.001) continue; m = Math.min(m, dSeg(p, r[j - 1], r[j])); } n += 1; if (m <= 15) within += 1; if (m < 1e8) { sumD += m; maxD = Math.max(maxD, m); } }
console.log(`DBT tram segments on Corso Lodi NW arm: ${n}; with an ATM TRAM route within 15 m: ${within}; mean offset ${(sumD / n).toFixed(1)} m, max ${maxD.toFixed(1)} m`);
await writeFile(join(EVID, "atm-landmark-routes.json"), JSON.stringify({ retrievedNote: "ATM ds538 GeoJSON, Last-Modified 2026-07-24", thresholdM: 12, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length + " OSM ways"])), routes: rows, tramLinesOnLandmarkWays: tramLines, dbtVsAtm: { dbtTramSegmentsOnCorsoLodiNW: n, withinAtmTram15m: within } }, null, 1));
