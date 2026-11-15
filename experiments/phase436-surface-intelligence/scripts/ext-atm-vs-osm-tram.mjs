/**
 * Does the ATM ds538 tram-route geometry add anything beyond OSM `railway=tram` ways (archive, pilot box only: lon 9.169-9.206, lat 45.45-45.48)?
 * For ATM TRAM route vertices inside the pilot box: share within 15 m of an archived OSM tram way. Also share of the DBT 2020 tram elements fetched for the
 * landmark box (REST layer 19) that lie within 15 m of an OSM tram way (archive: only where the pilot box overlaps the landmark box).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";

const atm = JSON.parse(await readFile(join(CACHE, "atm-tpl_percorsi.geojson"), "utf8"));
const dbt = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const streets = JSON.parse(await readFile(join(CACHE, "dbt-box-1-wgs.json"), "utf8"));
const arc = await loadArchive();
const PILOT = [9.169, 45.45, 9.206, 45.48];
const kx = 111320 * Math.cos((45.465 * Math.PI) / 180);
const ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const tramWays = [];
for (const w of arc.ways.values()) { if (w.tags?.railway !== "tram") continue; const c = wayCoords(arc, w); if (c.some((p) => !p)) continue; tramWays.push(c); }
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const near = (p, r) => { for (const c of tramWays) { for (let i = 1; i < c.length; i += 1) { if (Math.abs(c[i][0] - p[0]) > 0.004 || Math.abs(c[i][1] - p[1]) > 0.003) continue; if (dSeg(p, c[i - 1], c[i]) <= r) return true; } } return false; };
let atmM = 0, atmNear = 0;
const lines = new Set();
for (const f of atm.features) {
  if (f.properties.mezzo !== "TRAM") continue;
  const g = f.geometry.coordinates;
  for (let i = 1; i < g.length; i += 1) {
    const mid = [(g[i][0] + g[i - 1][0]) / 2, (g[i][1] + g[i - 1][1]) / 2];
    if (!inBox(mid, PILOT)) continue;
    const L = metres(g[i - 1], g[i]); if (L > 200) continue;
    atmM += L; lines.add(f.properties.linea);
    if (near(mid, 15)) atmNear += L;
  }
}
// DBT tram segments overlapping the pilot box
let dbtM = 0, dbtNear = 0;
const missByStreet = {};
const nameOf = (p) => { let best = [1e9, null]; for (const f of streets.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) { const d = dSeg(p, path[i - 1], path[i]); if (d < best[0]) best = [d, f.attributes.NOME]; } return best[0] <= 15 ? best[1] : '(none)'; };
for (const f of dbt.features) for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) {
  const mid = [(path[i][0] + path[i - 1][0]) / 2, (path[i][1] + path[i - 1][1]) / 2];
  if (!inBox(mid, PILOT)) continue;
  const L = metres(path[i - 1], path[i]); dbtM += L; if (near(mid, 15)) dbtNear += L; else { const k = nameOf(mid); missByStreet[k] = (missByStreet[k] ?? 0) + L; }
}
const res = { osmTramWaysInArchive: tramWays.length, atmTramRouteMetresInPilotBox: Math.round(atmM), atmWithin15mOfOsmTram: Math.round(atmNear), atmSharePct: +(100 * atmNear / atmM).toFixed(1), atmLinesInPilotBox: [...lines].sort(), dbtTramMetresInPilotBoxPartOfLandmarkBox: Math.round(dbtM), dbtWithin15mOfOsmTram: Math.round(dbtNear), dbtMissingFromOsmByDbtStreet: Object.fromEntries(Object.entries(missByStreet).map(([k, v]) => [k, Math.round(v)])), dbtSharePct: dbtM ? +(100 * dbtNear / dbtM).toFixed(1) : null };
console.log(JSON.stringify(res, null, 1));
await writeFile(join(EVID, "atm-vs-osm-tram.json"), JSON.stringify(res, null, 1));
