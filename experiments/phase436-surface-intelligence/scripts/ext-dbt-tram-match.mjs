/**
 * Where do the DBT 2020 tram elements (layer 19) and tram sede polygons (layer 45) run inside the landmark box, relative to
 * (a) DBT street elements (layer 1, NOME) and (b) Lastrico/OSM ways (archive): Piazzale Lodi ring, Corso Lodi, Via Lazzaro Papi.
 * Coordinates: WGS84 as served by the REST service (EPSG:7791 -> 4326 verified identical to lib/utm.mjs).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";
const rd = async (n) => JSON.parse(await readFile(join(CACHE, n), "utf8"));
const tram = await rd("dbt-box-19-wgs.json"), streets = await rd("dbt-box-1-wgs.json"), sede = await rd("dbt-box-45-wgs.json");
const arc = await loadArchive();
const segs = (coords) => { const o = []; for (let i = 1; i < coords.length; i += 1) o.push([coords[i - 1], coords[i]]); return o; };
function dPtSeg(p, [a, b]) {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
// index: DBT street elements by NOME
const dbtStreet = streets.features.map((f) => ({ nome: f.attributes.NOME, ty: f.attributes.EL_STR_TY, segs: f.geometry.paths.flatMap(segs) }));
// OSM named ways of interest (all highway ways in the box, by name)
const BOX = [9.2025, 45.4430, 9.2175, 45.4550];
const osm = [];
for (const w of arc.ways.values()) {
  if (!w.tags?.highway) continue;
  const c = wayCoords(arc, w); if (c.some((p) => !p)) continue;
  if (!c.some((p) => p[0] > BOX[0] && p[0] < BOX[2] && p[1] > BOX[1] && p[1] < BOX[3])) continue;
  osm.push({ id: w.id, name: w.tags.name ?? "(unnamed)", highway: w.tags.highway, segs: segs(c) });
}
function nearest(p, set) { let best = { d: 1e9 }; for (const x of set) for (const s of x.segs) { const d = dPtSeg(p, s); if (d < best.d) best = { d, x }; } return best; }
const byDbtName = new Map(), byOsmName = new Map(); let total = 0, within15Osm = 0, within15Dbt = 0;
const perFeature = [];
for (const f of tram.features) {
  let len = 0; const names = new Map();
  for (const path of f.geometry.paths) for (const [a, b] of segs(path)) {
    const L = metres(a, b), n = Math.max(1, Math.round(L / 5));
    for (let i = 0; i < n; i += 1) {
      const p = [a[0] + ((b[0] - a[0]) * (i + 0.5)) / n, a[1] + ((b[1] - a[1]) * (i + 0.5)) / n], w = L / n; len += w; total += w;
      const nd = nearest(p, dbtStreet), no = nearest(p, osm);
      const dn = nd.d <= 15 ? nd.x.nome : "(none within 15 m)", on = no.d <= 15 ? `${no.x.name}` : "(none within 15 m)";
      if (no.d <= 15) within15Osm += w; if (nd.d <= 15) within15Dbt += w;
      byDbtName.set(dn, (byDbtName.get(dn) ?? 0) + w); byOsmName.set(on, (byOsmName.get(on) ?? 0) + w);
      names.set(on, (names.get(on) ?? 0) + w);
    }
  }
  perFeature.push({ objectid: f.attributes.OBJECTID, sede: f.attributes.el_trv_sed_d, pos: f.attributes.el_trv_pos_d, lengthM: +len.toFixed(1), nearestOsmNames: Object.fromEntries([...names].map(([k, v]) => [k, +v.toFixed(1)])) });
}
const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v.toFixed(0)} m`).join("\n  ");
console.log(`DBT tram elements in box: ${tram.features.length}, ${total.toFixed(0)} m (track elements, 2 tracks counted separately where digitised so)`);
console.log(`within 15 m of a DBT street element: ${(100 * within15Dbt / total).toFixed(1)} %; within 15 m of an OSM highway way: ${(100 * within15Osm / total).toFixed(1)} %`);
console.log("by nearest OSM way name (<=15 m):\n  " + fmt(byOsmName));
console.log("by nearest DBT street NOME (<=15 m):\n  " + fmt(byDbtName));
// Tram sede polygons: bbox + type
console.log(`\nDBT sede di trasporto su ferro polygons in box: ${sede.features.length}`, JSON.stringify(sede.features.map((f) => f.attributes.sd_fer_ty_d).reduce((o, k) => (o[k] = (o[k] ?? 0) + 1, o), {})));
// DBT street names in box (all) with element counts and metres: for Corso Lodi / Via Lazzaro Papi / Piazzale Lodi
const names = new Map();
for (const s of dbtStreet) { const L = s.segs.reduce((acc, [a, b]) => acc + metres(a, b), 0); const e = names.get(s.nome) ?? { n: 0, m: 0 }; e.n += 1; e.m += L; names.set(s.nome, e); }
const interest = ["Corso Lodi", "Via Lazzaro Papi", "Piazzale Lodi", "Viale Umbria", "Viale Isonzo"].map((k) => [k, [...names].filter(([n]) => n && n.toLowerCase().includes(k.toLowerCase())).map(([n, v]) => `${n}: ${v.n} elements ${v.m.toFixed(0)} m`)]);
console.log("DBT street elements by name of interest:", JSON.stringify(interest, null, 1));
await writeFile(join(EVID, "dbt-tram-match.json"), JSON.stringify({ box: BOX, tramElements: tram.features.length, tramMetres: +total.toFixed(1), pctWithin15mOfDbtStreet: +(100 * within15Dbt / total).toFixed(1), pctWithin15mOfOsmHighway: +(100 * within15Osm / total).toFixed(1), byNearestOsmName: Object.fromEntries([...byOsmName].map(([k, v]) => [k, +v.toFixed(0)])), byNearestDbtNome: Object.fromEntries([...byDbtName].map(([k, v]) => [k, +v.toFixed(0)])), sedePolygons: sede.features.length, perFeature }, null, 1));
