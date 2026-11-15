/**
 * Are DBT 2020 tram-track elements (layer 19) inside the DBT "area di circolazione veicolare" polygons (layer 39, car carriageway)
 * or inside the DBT tram/rail "sede di trasporto su ferro" polygons (layer 45)? Tests whether the DBT geometry separates rails
 * from the carriageway (own sede) or leaves them inside the vehicular area (embedded/shared). Esri rings, even-odd rule.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { metres } from "./osm-archive.mjs";
const rd = async (n) => JSON.parse(await readFile(join(CACHE, n), "utf8"));
const streets = await rd("dbt-box-1-wgs.json"); const tram = await rd("dbt-box-19-wgs.json"), veh = await rd("dbt-box-39-wgs.json"), sede = await rd("dbt-box-45-wgs.json"), area = await rd("dbt-box-41-wgs.json");
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
const inPoly = (p, f) => { let c = false; for (const r of f.geometry.rings) if (inRing(p, r)) c = !c; return c; };
const bb = (f) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const r of f.geometry.rings) for (const q of r) { a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[0]); d = Math.max(d, q[1]); } return [a, b, c, d]; };
const idx = (layer) => layer.features.map((f) => ({ f, b: bb(f) }));
const V = idx(veh), S = idx(sede), A = idx(area);
const hit = (p, I) => I.find((x) => p[0] >= x.b[0] && p[0] <= x.b[2] && p[1] >= x.b[1] && p[1] <= x.b[3] && inPoly(p, x.f));
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180), ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const nearestName = (p) => { let best = [1e9, null]; for (const f of streets.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const d = dSeg(p, path[i - 1], path[i]); if (d < best[0]) best = [d, f.attributes.NOME]; } return best[0] <= 15 ? best[1] : "(none)"; };
const byStreet = {};
let total = 0; const c = { inVeh: 0, inSede: 0, inArea: 0, inNone: 0, inVehAndSede: 0 }; const vehZon = {}, sedeTy = {};
for (const f of tram.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) {
  const a = path[i - 1], b = path[i], L = metres(a, b), n = Math.max(1, Math.round(L / 2));
  for (let s = 0; s < n; s += 1) {
    const p = [a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n], w = L / n; total += w;
    const v = hit(p, V), sd = hit(p, S), ar = hit(p, A);
    const nm = nearestName(p); const e = (byStreet[nm] ??= { m: 0, inVeh: 0, inSede: 0, inArea: 0, none: 0 }); e.m += w; if (v) e.inVeh += w; if (sd) e.inSede += w; if (ar) e.inArea += w; if (!v && !sd && !ar) e.none += w;
    if (v) { c.inVeh += w; vehZon[v.f.attributes.AC_VEI_ZON] = (vehZon[v.f.attributes.AC_VEI_ZON] ?? 0) + w; }
    if (sd) { c.inSede += w; sedeTy[sd.f.attributes.sd_fer_ty_d] = (sedeTy[sd.f.attributes.sd_fer_ty_d] ?? 0) + w; }
    if (ar) c.inArea += w; if (v && sd) c.inVehAndSede += w; if (!v && !sd && !ar) c.inNone += w;
  }
}
const pct = (x) => `${Math.round(x)} m (${(100 * x / total).toFixed(1)} %)`;
console.log(`tram element metres in box: ${Math.round(total)}`);
console.log("inside a vehicular-circulation polygon (L39):", pct(c.inVeh), "| by AC_VEI_ZON:", JSON.stringify(Object.fromEntries(Object.entries(vehZon).map(([k, v]) => [k, Math.round(v)]))));
console.log("inside a tram/rail sede polygon (L45):", pct(c.inSede), "| by sd_fer_ty_d:", JSON.stringify(Object.fromEntries(Object.entries(sedeTy).map(([k, v]) => [k, Math.round(v)]))));
console.log("inside a 'Area stradale' polygon (L41):", pct(c.inArea), "| in both L39 and L45:", pct(c.inVehAndSede), "| in none:", pct(c.inNone));
console.log("per nearest DBT street name (<=15 m): metres | in vehicular polygon | in tram sede polygon | in area stradale | in none");
for (const [k, e] of Object.entries(byStreet).sort((a, b) => b[1].m - a[1].m)) console.log(`  ${k}: ${Math.round(e.m)} | ${Math.round(e.inVeh)} | ${Math.round(e.inSede)} | ${Math.round(e.inArea)} | ${Math.round(e.none)}`);
await writeFile(join(EVID, "dbt-tram-containment.json"), JSON.stringify({ totalM: Math.round(total), insideVehicularAreaM: Math.round(c.inVeh), insideTramSedeM: Math.round(c.inSede), insideAreaStradaleM: Math.round(c.inArea), insideNoneM: Math.round(c.inNone), insideVehAndSedeM: Math.round(c.inVehAndSede), byNearestDbtStreet: Object.fromEntries(Object.entries(byStreet).map(([k, e]) => [k, Object.fromEntries(Object.entries(e).map(([a, b]) => [a, Math.round(b)]))])), vehAC_VEI_ZON: vehZon, sedeTypes: sedeTy }, null, 1));
