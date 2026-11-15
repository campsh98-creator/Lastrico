/**
 * Cross-tab DBT 2020 tram attribute codes (layer 19: el_trv_pos / el_trv_sed) against geometry facts, inside the landmark box:
 *   - is the tram element inside a DBT "area di circolazione veicolare" polygon (layer 39)?
 *   - is it inside a DBT tram "sede di trasporto su ferro" polygon (layer 45)?
 *   - nearest DBT street name.
 * Purpose: decide which reading of the codes is right. National spec v1.0: EL_TRV_POS 01 = in sede propria, 02 = su sede veicolare
 * (shares the carriageway); EL_TRV_SED 01 = a raso, 02 = su ponte/viadotto, 03 = in galleria. The Comune's REST `_d` labels read the other way round.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { metres } from "./osm-archive.mjs";

const rd = async (n) => JSON.parse(await readFile(join(CACHE, n), "utf8"));
const tram = await rd("dbt-box-19-wgs.json");
const veh = await rd("dbt-box-39-wgs.json");
const sede = await rd("dbt-box-45-wgs.json");
const streets = await rd("dbt-box-1-wgs.json");
const BOX = [9.2025, 45.4430, 9.2175, 45.4550]; // polygons were fetched for this box only: ignore tram samples outside it
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
const inPoly = (p, f) => { let c = false; for (const r of f.geometry.rings) if (inRing(p, r)) c = !c; return c; };
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180);
const ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const nearestName = (p) => { let best = [1e9, null]; for (const f of streets.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const d = dSeg(p, path[i - 1], path[i]); if (d < best[0]) best = [d, f.attributes.NOME]; } return best[0] <= 15 ? best[1] : "(none)"; };

const rows = {};
let total = 0;
for (const f of tram.features) {
  const a = f.attributes;
  for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) {
    const p0 = path[i - 1], p1 = path[i], L = metres(p0, p1), p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    if (p[0] < BOX[0] || p[0] > BOX[2] || p[1] < BOX[1] || p[1] > BOX[3]) continue;
    const inV = veh.features.some((v) => inPoly(p, v)), inS = sede.features.some((s) => inPoly(p, s));
    const key = `pos=${a.el_trv_pos} sed=${a.el_trv_sed} | inVehicularPolygon=${inV} inTramSedePolygon=${inS}`;
    const nm = nearestName(p);
    rows[key] ??= { m: 0, streets: {} };
    rows[key].m += L; rows[key].streets[nm] = (rows[key].streets[nm] ?? 0) + L; total += L;
  }
}
console.log(`tram element metres in box: ${Math.round(total)}`);
for (const [k, v] of Object.entries(rows).sort((x, y) => y[1].m - x[1].m)) console.log(`${Math.round(v.m).toString().padStart(5)} m  ${k}  <- ${Object.entries(v.streets).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([n, m]) => `${n}:${Math.round(m)}`).join(", ")}`);
await writeFile(join(EVID, "dbt-tram-pos-crosstab.json"), JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { m: Math.round(v.m), streets: Object.fromEntries(Object.entries(v.streets).map(([n, m]) => [n, Math.round(m)])) }])), null, 1));
