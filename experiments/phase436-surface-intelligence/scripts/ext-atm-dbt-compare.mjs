/**
 * ATM (ds538, route lines, 2026-07-24) vs DBT 2020 (layer 19 tram elements): for each DBT tram element in the landmark box (grouped by nearest DBT street name),
 * nearest ATM TRAM route (any line) and its distance. Lists every ATM TRAM route name, and the ATM tram routes passing within 60 m of the Corso Lodi / ring ways.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { metres } from "./osm-archive.mjs";
const atm = JSON.parse(await readFile(join(CACHE, "atm-tpl_percorsi.geojson"), "utf8"));
const dbt = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const streets = JSON.parse(await readFile(join(CACHE, "dbt-box-1-wgs.json"), "utf8"));
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180), ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const tram = atm.features.filter((f) => f.properties.mezzo === "TRAM");
console.log("ATM TRAM routes (", tram.length, "):\n" + tram.map((f) => `${f.properties.linea}/${f.properties.percorso}/${f.properties.verso}/${f.properties.tipo_perc}: ${f.properties.nome} (${f.properties.lung_km} km)`).join("\n"));
const nearestAtm = (p) => { let best = [1e9, null]; for (const f of tram) { const g = f.geometry.coordinates; for (let i = 1; i < g.length; i += 1) { if (Math.abs(g[i][0] - p[0]) > 0.003 || Math.abs(g[i][1] - p[1]) > 0.003) continue; const d = dSeg(p, g[i - 1], g[i]); if (d < best[0]) best = [d, f.properties.linea]; } } return best; };
const nameOf = (p) => { let best = [1e9, null]; for (const f of streets.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const d = dSeg(p, path[i - 1], path[i]); if (d < best[0]) best = [d, f.attributes.NOME]; } return best[0] <= 15 ? best[1] : "(none)"; };
const agg = {};
for (const f of dbt.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) {
  const a = path[i - 1], b = path[i], L = metres(a, b), p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const nm = nameOf(p), [d, ln] = nearestAtm(p); const e = (agg[nm] ??= { m: 0, within15: 0, lines: {}, maxD: 0 });
  e.m += L; if (d <= 15) { e.within15 += L; e.lines[ln] = (e.lines[ln] ?? 0) + L; } e.maxD = Math.max(e.maxD, Math.min(d, 999));
}
console.log("\nDBT tram element metres by nearest DBT street (<=15 m): total | with an ATM TRAM route within 15 m | ATM lines | max nearest-ATM distance");
for (const [k, e] of Object.entries(agg).sort((a, b) => b[1].m - a[1].m)) console.log(`  ${k}: ${Math.round(e.m)} | ${Math.round(e.within15)} | ${Object.entries(e.lines).map(([l, v]) => l + ":" + Math.round(v)).join(",") || "-"} | ${e.maxD.toFixed(0)} m`);
await writeFile(join(EVID, "atm-vs-dbt-tram.json"), JSON.stringify({ atmTramRoutes: tram.map((f) => ({ ...f.properties })), dbtTramByStreet: Object.fromEntries(Object.entries(agg).map(([k, e]) => [k, { m: Math.round(e.m), withinAtm15m: Math.round(e.within15), atmLines: e.lines }])) }, null, 1));
