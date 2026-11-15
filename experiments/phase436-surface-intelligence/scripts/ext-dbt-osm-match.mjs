/**
 * Spatial matchability of DBT 2020 street elements (REST layer 1 "EL_STR tracciato", 798 segments in the landmark box) with the OSM ways Lastrico compiles
 * (archive, car-usable highway classes). Also lists what the DBT says about the Piazzale Lodi ring (EL_STR/AC_VEI/AR_STR named PIAZZALE LODI).
 *
 * Test: for every OSM way in the box (excluding footway/cycleway/path/steps/pedestrian/service-without-name), take 1 m samples; find the nearest DBT street
 * element within 12 m (Lastrico's own car tolerance) with direction cosine >= 0.58 (Lastrico's alignment gate); report match rate, offset quantiles,
 * and agreement of the street NAME (case/accent-insensitive). No attribute carries a surface, so this only measures how a DBT-derived flag could be joined.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";

const streets = JSON.parse(await readFile(join(CACHE, "dbt-box-1-wgs.json"), "utf8"));
const veh = JSON.parse(await readFile(join(CACHE, "dbt-box-39-wgs.json"), "utf8"));
const arc = await loadArchive();
const BOX = [9.2025, 45.4430, 9.2175, 45.4550];
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180);
const ky = 110540;
const norm = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const segs = [];
for (const f of streets.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) segs.push({ a: path[i - 1], b: path[i], nome: norm(f.attributes.NOME), ty: f.attributes.EL_STR_TY, id: f.attributes.SEGMENTID });
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const cosAbs = (a, b, c, d) => { const v1 = [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky], v2 = [(d[0] - c[0]) * kx, (d[1] - c[1]) * ky]; return Math.abs((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)); };

const SKIP = new Set(["footway", "cycleway", "path", "steps", "pedestrian", "bridleway", "corridor", "platform", "track", "proposed", "construction"]);
let total = 0, matched = 0, nameAgree = 0, nameBothNamed = 0;
const offsets = [];
const perHighway = {};
const perName = {};
for (const w of arc.ways.values()) {
  const hw = w.tags?.highway;
  if (!hw || SKIP.has(hw)) continue;
  if (hw === "service" && !w.tags.name) continue;
  const c = wayCoords(arc, w);
  if (c.some((p) => !p)) continue;
  const wn = norm(w.tags.name);
  for (let i = 1; i < c.length; i += 1) {
    const a = c[i - 1], b = c[i], L = metres(a, b), n = Math.max(1, Math.round(L));
    for (let s = 0; s < n; s += 1) {
      const p = [a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n];
      if (p[0] < BOX[0] || p[0] > BOX[2] || p[1] < BOX[1] || p[1] > BOX[3]) continue;
      total += L / n;
      let best = null;
      for (const g of segs) { const d = dSeg(p, g.a, g.b); if (d <= 12 && (!best || d < best.d) && cosAbs(a, b, g.a, g.b) >= 0.58) best = { d, g }; }
      const e = (perHighway[hw] ??= { m: 0, matched: 0 });
      e.m += L / n;
      if (best) { matched += L / n; e.matched += L / n; offsets.push(best.d); if (wn && best.g.nome) { nameBothNamed += L / n; if (wn === best.g.nome) nameAgree += L / n; } }
      if (w.tags.name && ["Corso Lodi", "Via Lazzaro Papi", "Piazzale Lodi"].includes(w.tags.name)) { const q = (perName[w.tags.name] ??= { m: 0, matched: 0, nameAgree: 0 }); q.m += L / n; if (best) { q.matched += L / n; if (wn === best.g.nome) q.nameAgree += L / n; } }
    }
  }
}
offsets.sort((x, y) => x - y);
const q = (f) => offsets[Math.floor(f * (offsets.length - 1))]?.toFixed(1);
const res = {
  osmCarWayMetresInBox: Math.round(total), withDbtStreetElementWithin12mAligned: Math.round(matched), matchPct: +(100 * matched / total).toFixed(1),
  offsetM: { p50: q(0.5), p90: q(0.9), p99: q(0.99) }, nameAgreementPctOfMatchedBothNamed: +(100 * nameAgree / nameBothNamed).toFixed(1),
  perHighway: Object.fromEntries(Object.entries(perHighway).map(([k, v]) => [k, { m: Math.round(v.m), matchPct: +(100 * v.matched / v.m).toFixed(1) }])),
  landmarks: Object.fromEntries(Object.entries(perName).map(([k, v]) => [k, { osmM: Math.round(v.m), matchPct: +(100 * v.matched / v.m).toFixed(1), nameAgreePct: +(100 * v.nameAgree / (v.matched || 1)).toFixed(1) }])),
};
console.log(JSON.stringify(res, null, 1));

// What does the DBT say about the ring? (REST layer 1 + layer 39 polygons named PIAZZALE LODI)
const ringEl = streets.features.filter((f) => /piazzale lodi/i.test(f.attributes.NOME));
const tyCount = {};
for (const f of ringEl) tyCount[f.attributes.EL_STR_TY] = (tyCount[f.attributes.EL_STR_TY] ?? 0) + 1;
const ringPoly = veh.features.filter((f) => /piazzale lodi/i.test(f.attributes.NOME));
const zonCount = {};
let ringArea = 0;
for (const f of ringPoly) { zonCount[f.attributes.AC_VEI_ZON] = (zonCount[f.attributes.AC_VEI_ZON] ?? 0) + 1; ringArea += f.attributes.Shape_Area ?? 0; }
const ring = { streetElementsNamedPiazzaleLodi: ringEl.length, EL_STR_TYcounts: tyCount, EL_STR_FONvalues: [...new Set(ringEl.map((f) => f.attributes.EL_STR_FON))], vehicularPolygonsNamedPiazzaleLodi: ringPoly.length, AC_VEI_ZONcounts: zonCount, AC_VEI_FONvalues: [...new Set(ringPoly.map((f) => f.attributes.AC_VEI_FON))], note: "EL_STR_TY 0205 = rotatoria, 0204 = piazza, 0206 = incrocio (national spec v2.0); the ring is one AC_VEI polygon with zone 0204 (piazza)" };
console.log(JSON.stringify(ring, null, 1));
await writeFile(join(EVID, "dbt-osm-match.json"), JSON.stringify({ matchability: res, ringAccordingToDbt: ring }, null, 1));
