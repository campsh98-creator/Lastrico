/**
 * Phase 4.31 — the street sequence of the routes the app proposes between two points (nearest
 * OSM way per geometry sample) with pavé metres per street, at an explicit departure time.
 *
 *   node scripts/route-street-sequence.mjs <lon,lat> <lon,lat> <mode> [YYYY-MM-DDTHH:MM] [maxExtraMinutes]
 */

import { NextRequest } from "next/server.js";
const root = new URL("../", import.meta.url).href;
const { loadApi } = await import(root + "tests/helpers/load-api.mjs");
const { installArchivedProvider } = await import(root + "scripts/lib/archived-provider.mjs");
const { spatialRoadStore: s } = await import(root + "lib/spatial-road-store.ts");
const [start, end, mode, dep = "2026-11-09T12:00", extra = ""] = process.argv.slice(2);
const p = installArchivedProvider({ live: true });
const { GET } = await loadApi("app/api/routes/route.ts");
const params = new URLSearchParams({ area: "milan", start, end, mode, avoid: "strong", departure: dep });
if (extra) params.set("maxExtraMinutes", extra);
const j = await (await GET(new NextRequest(`http://localhost/api/routes?${params}`))).json();
p.restore();
const seq = async (route) => {
  const tiles = s.getTileKeysForCoordinates(route.coordinates, 30); await s.preloadTiles(tiles);
  const segs = tiles.flatMap((k) => s.getTileSegments(k)); const out = [];
  for (let i = 1; i < route.coordinates.length; i++) {
    const a = route.coordinates[i - 1], b = route.coordinates[i]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot((b[0] - a[0]) * 78000, (b[1] - a[1]) * 110540);
    let best = null;
    for (const sg of segs) { const [c, d] = sg.coordinates; const dx = (d[0] - c[0]) * 78000, dy = (d[1] - c[1]) * 110540, px = (m[0] - c[0]) * 78000, py = (m[1] - c[1]) * 110540; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0; const dist = Math.hypot(px - t * dx, py - t * dy); if (dist < 4 && (!best || dist < best.dist)) best = { sg, dist }; }
    const name = best?.sg.name ?? "(?)"; const rough = best && best.sg.surfaceCategory.endsWith("rough") ? len : 0;
    const last = out.at(-1); if (last && last.name === name) { last.m += len; last.rough += rough; } else out.push({ name, m: len, rough });
  }
  return out.filter((x) => x.m > 20).map((x) => `${x.name} ${Math.round(x.m)}m${x.rough > 5 ? ` (pavé ${Math.round(x.rough)})` : ""}`).join(" → ");
};
console.log(`${mode} maxExtra=${extra || "-"} | alt ${j.hasDistinctAlternative} | fast ${(j.fast.minutes).toFixed(1)} min conf ${j.fast.confirmedPaveMeters}`);
console.log("  FAST:", await seq(j.fast));
if (j.hasDistinctAlternative) { console.log(`  ANTI-PAVÉ ${(j.safe.minutes).toFixed(1)} min conf ${j.safe.confirmedPaveMeters}:`, await seq(j.safe)); }
