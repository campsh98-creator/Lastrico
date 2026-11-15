/**
 * For DBT 2020 tram-track samples (layer 19, pos=02 "su sede veicolare") on the Corso Lodi NW arm: which OSM way (Lastrico segment source) lies under/next to them,
 * with what `surface`, `highway`, `oneway`, and at what lateral offset. Answers: if Lastrico imported the DBT tram flag, which compiled segments would carry it,
 * and would the tracks sit on stone-tagged or asphalt-tagged ways?
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, EVID } from "./ext-http.mjs";
import { loadArchive, wayCoords, metres } from "./osm-archive.mjs";

const tram = JSON.parse(await readFile(join(CACHE, "dbt-box-19-wgs.json"), "utf8"));
const arc = await loadArchive();
const kx = 111320 * Math.cos((45.447 * Math.PI) / 180);
const ky = 110540;
const dSeg = (p, a, b) => { const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy); };
const RC = [9.2102, 45.4474];
const ways = [];
for (const w of arc.ways.values()) {
  if (!w.tags?.highway || w.tags.name !== "Corso Lodi" || ["cycleway", "footway", "path"].includes(w.tags.highway)) continue;
  const c = wayCoords(arc, w);
  if (c.some((p) => !p)) continue;
  const m = c[Math.floor(c.length / 2)];
  if (m[0] < RC[0] && Math.hypot((m[0] - RC[0]) * kx, (m[1] - RC[1]) * ky) < 1000) ways.push({ id: w.id, c, t: w.tags });
}
const byKey = {};
const offs = [];
let total = 0;
for (const f of tram.features) {
  if (f.attributes.el_trv_pos !== "02") continue;
  for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1], b = path[i], L = metres(a, b), n = Math.max(1, Math.round(L / 2));
    for (let s = 0; s < n; s += 1) {
      const p = [a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n];
      let best = null;
      for (const w of ways) for (let k = 1; k < w.c.length; k += 1) { const d = dSeg(p, w.c[k - 1], w.c[k]); if (d < 8 && (!best || d < best.d)) best = { d, w }; }
      if (!best) continue;
      total += L / n; offs.push(best.d);
      const key = `${best.w.t.highway} oneway=${best.w.t.oneway ?? "-"} surface=${best.w.t.surface ?? "(none)"}`;
      byKey[key] = (byKey[key] ?? 0) + L / n;
    }
  }
}
offs.sort((x, y) => x - y);
const q = (f) => offs[Math.floor(f * (offs.length - 1))].toFixed(1);
console.log(`DBT pos=02 tram-track metres within 8 m of a Corso Lodi NW-arm OSM way: ${Math.round(total)} (two tracks counted separately); offset p50 ${q(0.5)} m, p90 ${q(0.9)} m`);
for (const [k, v] of Object.entries(byKey).sort((x, y) => y[1] - x[1])) console.log(`  ${Math.round(v).toString().padStart(5)} m  ${k}`);
await writeFile(join(EVID, "dbt-tram-on-osm-surface.json"), JSON.stringify({ trackMetresWithin8m: Math.round(total), offsetM: { p50: +q(0.5), p90: +q(0.9) }, byNearestOsmWay: Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, Math.round(v)])) }, null, 1));
