/**
 * Phase 4.36 routing-experiments: per-way raw OSM facts and base rates, derived ONLY from the archived OSM extracts in data/sources/.
 *   node experiments/phase436-surface-intelligence/scripts/exp-waytags.mjs
 * Writes (git-ignored) data/exp-cache/way-tags.json  { id: [surface, surface_bike, smoothness, highway, tramAdjacentShare] }
 * and the compact evidence/routing-experiments/base-rates.json used as the explicit PRIOR of model C (a proxy, see the report).
 * Tram adjacency uses the same rule as osm-data-audit/tram-coverage.mjs (tram way sample within 10 m of a highway way), now stored per highway way.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { loadArchive, wayCoords, wayLength, metres, projectOnLine } from "./osm-archive.mjs";
import { OUT, CACHE, sha256 } from "./exp-harness.mjs";

const arc = await loadArchive();
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "road", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "cycleway", "pedestrian", "track", "footway", "path"]);
const roads = [];
for (const w of arc.ways.values()) {
  if (!CAR.has(w.tags?.highway) || w.tags.area === "yes") continue;
  const c = wayCoords(arc, w);
  if (c.some((p) => !p)) continue;
  roads.push({ w, c, len: wayLength(arc, w) });
}
// grid index (0.001 deg cells) of highway ways for the tram adjacency
const cell = (lon, lat) => `${Math.floor(lon / 0.001)}:${Math.floor(lat / 0.001)}`;
const grid = new Map();
roads.forEach((r, i) => { for (const p of r.c) { const k = cell(p[0], p[1]); let a = grid.get(k); if (!a) grid.set(k, (a = new Set())); a.add(i); } });
const tramMeters = new Map();
let tramTotal = 0;
for (const t of arc.ways.values()) {
  if (t.tags?.railway !== "tram") continue;
  const c = wayCoords(arc, t).filter(Boolean);
  for (let i = 1; i < c.length; i += 1) {
    const L = metres(c[i - 1], c[i]); const n = Math.max(1, Math.round(L / 5));
    for (let s = 0; s < n; s += 1) {
      const p = [c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * (s + 0.5)) / n, c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * (s + 0.5)) / n];
      tramTotal += L / n;
      const cx = Math.floor(p[0] / 0.001), cy = Math.floor(p[1] / 0.001);
      let best = null;
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        const set = grid.get(`${cx + dx}:${cy + dy}`); if (!set) continue;
        for (const i2 of set) { const q = projectOnLine(roads[i2].c, p); if (q.d <= 10 && (!best || q.d < best.d)) best = { d: q.d, i: i2 }; }
      }
      if (best) tramMeters.set(roads[best.i].w.id, (tramMeters.get(roads[best.i].w.id) ?? 0) + L / n);
    }
  }
}

const table = {};
const norm = (v) => (v ? String(v).trim().toLowerCase() : null);
for (const r of roads) {
  const t = r.w.tags;
  const share = Math.min(1, (tramMeters.get(r.w.id) ?? 0) / Math.max(r.len, 1));
  table[r.w.id] = [norm(t.surface), norm(t.surface_bike), norm(t.smoothness), t.highway, Math.round(share * 100) / 100];
}
await mkdir(CACHE, { recursive: true });
const tableJson = JSON.stringify(table);
await writeFile(new URL("way-tags.json", CACHE), tableJson);

// ---- base rates (prior for model C): car-usable ways of the 8 citywide sectors, metres by highway class and sector ----
const STONE_C = new Set(["sett", "cobblestone", "unhewn_cobblestone", "cobblestone:flattened", "cobblestone:flattened:large_stone", "milanese_paving", "milanese_paving:rails", "milanese_paving:lanes", "pebblestone", "cobblestone:rounded"]);
const STONE_P = new Set(["paving_stones", "paving_stones:lanes"]);
const SMOOTH = new Set(["asphalt", "concrete", "concrete:plates", "concrete:lanes"]);
const LOOSE = new Set(["unpaved", "compacted", "gravel", "fine_gravel", "ground", "dirt", "earth"]);
const CARCLASS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"]);
const byClass = {}, bySector = {}, byZone = {};
const bump = (o, k1, k2, m) => { ((o[k1] ??= {})[k2] = (o[k1][k2] ?? 0) + m); };
for (const w of arc.ways.values()) {
  const t = w.tags ?? {}; if (!CARCLASS.has(t.highway)) continue;
  if (t.area === "yes" || t.access === "no" || t.motor_vehicle === "no") continue;
  const m = wayLength(arc, w); const s = norm(t.surface) ?? "";
  const bucket = !s ? "untagged" : STONE_C.has(s) ? "stone_confirmed" : STONE_P.has(s) ? "stone_probable" : SMOOTH.has(s) ? "smooth" : LOOSE.has(s) ? "loose" : "other_value";
  bump(byClass, t.highway, bucket, m);
  { const p0 = wayCoords(arc, w).find(Boolean); const core = p0 && p0[0] >= 9.169 && p0[0] <= 9.206 && p0[1] >= 45.45 && p0[1] <= 45.48; bump(byZone, `${core ? "core" : "outer"}|${t.highway}`, bucket, m); }
  bump(bySector, `${w._file.replace("milan-citywide-", "c-").replace("milan-pilot-", "p-").replace(".osm.json.gz", "")}|${t.highway}`, bucket, m);
}
const share = (o) => {
  const known = (o.stone_confirmed ?? 0) + (o.stone_probable ?? 0) + (o.smooth ?? 0) + (o.loose ?? 0);
  const total = known + (o.untagged ?? 0) + (o.other_value ?? 0);
  return { metres: Math.round(total), taggedCoveragePct: +((100 * known) / Math.max(total, 1)).toFixed(1), pStoneConfirmedAmongKnown: +((o.stone_confirmed ?? 0) / Math.max(known, 1)).toFixed(4),
    pStoneProbableAmongKnown: +((o.stone_probable ?? 0) / Math.max(known, 1)).toFixed(4), untaggedMetres: Math.round(o.untagged ?? 0), stoneConfirmedMetres: Math.round(o.stone_confirmed ?? 0), stoneProbableMetres: Math.round(o.stone_probable ?? 0) };
};
const classes = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, share(v)]));
const zones = Object.fromEntries(Object.entries(byZone).map(([k, v]) => [k, share(v)]));
const sectors = Object.fromEntries(Object.entries(bySector).filter(([k]) => /\|(residential|service|unclassified|tertiary)$/.test(k)).map(([k, v]) => [k, share(v)]));
const evidence = {
  generatedBy: "experiments/phase436-surface-intelligence/scripts/exp-waytags.mjs",
  source: "data/sources/milan-citywide-*.osm.json.gz (Overpass way[highway], retrieved 2026-11-04) plus the 11 pilot OSM-API extracts (Oct 2026); newest version of each way; car-usable classes, area/access=no/motor_vehicle=no excluded; metres by flat-earth metric",
  caveat: "PROXY. Shares are among ways that carry a surface tag; they describe mapped streets, not the untagged ones. Missingness is not shown to be random (UNVERIFIED); Phase 4.17 showed that predicting the surface of a single way from context fails (NO-GO).",
  byHighwayClass: classes, byZoneAndClass: zones, bySectorForMinorClasses: sectors,
  tramWays: { metresInArchive: Math.round(tramTotal), highwayWaysWithTramAdjacency: tramMeters.size, waysWithShareGe50pct: Object.values(table).filter((v) => v[4] >= 0.5).length },
  wayTagsSha256: sha256(tableJson), ways: Object.keys(table).length,
};
await mkdir(OUT, { recursive: true });
await writeFile(new URL("base-rates.json", OUT), JSON.stringify(evidence, null, 1) + "\n");
console.log(JSON.stringify({ classes, tram: evidence.tramWays, ways: evidence.ways }, null, 1));
