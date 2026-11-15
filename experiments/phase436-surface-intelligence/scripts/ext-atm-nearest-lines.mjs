/**
 * For the public landmark ways (Corso Lodi NW arm, ring, Via Lazzaro Papi), the nearest ATM TRAM routes (ds538) by distance, and where the DBT
 * tram elements flagged pos=02 that lie outside any vehicular/sede polygon actually are (3-decimal centroid, nearest OSM name).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE } from "./ext-http.mjs";
import { loadArchive, wayCoords } from "./osm-archive.mjs";
const atm = JSON.parse(await readFile(join(CACHE, "atm-tpl_percorsi.geojson"), "utf8"));
const dbt = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const veh = JSON.parse(await readFile(join(CACHE, "dbt-box-39-wgs.json"), "utf8"));
const sede = JSON.parse(await readFile(join(CACHE, "dbt-box-45-wgs.json"), "utf8"));
const arc = await loadArchive();
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180), ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const RC = [9.2102, 45.4474];
const groups = { "Corso Lodi NW arm": [], "Piazzale Lodi ring": [], "Via Lazzaro Papi": [], "Corso Lodi SE arm": [] };
for (const w of arc.ways.values()) { if (!w.tags?.highway) continue; const c = wayCoords(arc, w); if (c.some((p) => !p)) continue;
  if (w.tags.name === "Piazzale Lodi" && w.tags.junction) groups["Piazzale Lodi ring"].push(c);
  if (w.tags.name === "Via Lazzaro Papi") groups["Via Lazzaro Papi"].push(c);
  if (w.tags.name === "Corso Lodi" && !["cycleway", "footway"].includes(w.tags.highway)) { const m = c[Math.floor(c.length / 2)]; if (Math.hypot((m[0] - RC[0]) * kx, (m[1] - RC[1]) * ky) < 1000) groups[m[0] < RC[0] ? "Corso Lodi NW arm" : "Corso Lodi SE arm"].push(c); } }
const tramRoutes = atm.features.filter((f) => f.properties.mezzo === "TRAM");
for (const [g, ways] of Object.entries(groups)) {
  const best = new Map();
  for (const f of tramRoutes) { let m = 1e9; for (const w of ways) for (let i = 1; i < w.length; i += 1) { const mid = [(w[i][0] + w[i - 1][0]) / 2, (w[i][1] + w[i - 1][1]) / 2]; const gcs = f.geometry.coordinates; for (let j = 1; j < gcs.length; j += 1) { if (Math.abs(gcs[j][0] - mid[0]) > 0.02 || Math.abs(gcs[j][1] - mid[1]) > 0.02) continue; m = Math.min(m, dSeg(mid, gcs[j - 1], gcs[j])); } } const k = f.properties.linea; best.set(k, Math.min(best.get(k) ?? 1e9, m)); }
  console.log(g, "-> nearest ATM TRAM lines (min distance m):", [...best].filter(([, v]) => v < 1e8).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, v]) => `${k}:${v.toFixed(0)}`).join("  "));
}
// where are pos=02 elements outside both polygons?
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
const inPoly = (p, f) => { let c = false; for (const r of f.geometry.rings) if (inRing(p, r)) c = !c; return c; };
const osmNames = [...arc.ways.values()].filter((w) => w.tags?.highway && w.tags.name).map((w) => ({ n: w.tags.name, c: wayCoords(arc, w) })).filter((x) => !x.c.some((p) => !p));
const pts = [];
for (const f of dbt.features) if (f.attributes.el_trv_pos === "02") for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const p = [(path[i - 1][0] + path[i][0]) / 2, (path[i - 1][1] + path[i][1]) / 2]; if (veh.features.some((v) => inPoly(p, v)) || sede.features.some((s) => inPoly(p, s))) continue; pts.push(p); }
const buckets = new Map();
for (const p of pts) { let best = [1e9, "?"]; for (const x of osmNames) { if (Math.abs(x.c[0][0] - p[0]) > 0.01) continue; for (let i = 1; i < x.c.length; i += 1) { const d = dSeg(p, x.c[i - 1], x.c[i]); if (d < best[0]) best = [d, x.n]; } } const k = `${best[0] <= 25 ? best[1] : "(no OSM street within 25 m)"} @ ${p[0].toFixed(3)},${p[1].toFixed(3)}`; buckets.set(k, (buckets.get(k) ?? 0) + 1); }
console.log("pos=02 samples outside any vehicular/sede polygon:", pts.length, "\n", [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v}x ${k}`).join("\n "));
