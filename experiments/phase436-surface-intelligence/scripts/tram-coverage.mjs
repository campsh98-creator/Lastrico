/**
 * Phase 4.36 / osm-data-audit — how much of the tram infrastructure that OSM maps is visible to Lastrico?
 *
 *   node tram-coverage.mjs [--out=<file.json>]
 *
 * The compile keeps only ways with a `highway` tag (scripts/osm/build-representative-network.mjs:35), so separate
 * `railway=tram` ways never reach the runtime data. Rails reach it only through the `embeddedRails` flag that
 * scripts/osm/normalize.mjs:276-288 derives from tags on a highway way (tram=yes, embedded_rails=yes, lanes:tram, ...).
 * This script measures, for every metre of archived `railway=tram` way (only the pilot OSM-API extracts contain any):
 *   - is it within 10 m of a car-usable highway way (shared carriageway / street running)?
 *   - does that nearest highway way carry a tag that sets embeddedRails?
 */
import { writeFile } from "node:fs/promises";
import { loadArchive, wayCoords, wayLength, projectOnLine, metres, r1 } from "./osm-archive.mjs";

const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const arc = await loadArchive();
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "road", "pedestrian", "cycleway", "footway", "track", "path"]);
const flags = (t) => t.railway === "tram" || t.embedded_rails === "yes" || t["railway:tram"] === "yes" || t.tram === "yes" || t["tram:forward"] === "yes" || t["tram:backward"] === "yes" || t["oneway:tram"] !== undefined || t["lanes:tram"] !== undefined || t["lanes:tram:forward"] !== undefined || t["lanes:tram:backward"] !== undefined;
const roads = [];
for (const w of arc.ways.values()) {
  if (!CAR.has(w.tags?.highway) || w.tags.area === "yes") continue;
  const c = wayCoords(arc, w);
  if (c.some((p) => !p)) continue;
  roads.push({ w, c, lon: [Math.min(...c.map((p) => p[0])), Math.max(...c.map((p) => p[0]))], lat: [Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[1]))] });
}
let total = 0, near10 = 0, near10Flagged = 0, near10Rough = 0, near3 = 0;
const unflaggedByName = {};
for (const t of arc.ways.values()) {
  if (t.tags?.railway !== "tram") continue;
  const c = wayCoords(arc, t).filter(Boolean);
  for (let i = 1; i < c.length; i += 1) {
    const L = metres(c[i - 1], c[i]);
    const n = Math.max(1, Math.round(L / 5));
    for (let s = 0; s < n; s += 1) {
      const p = [c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * (s + 0.5)) / n, c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * (s + 0.5)) / n];
      total += L / n;
      let best = null;
      for (const r of roads) {
        if (p[0] < r.lon[0] - 0.0002 || p[0] > r.lon[1] + 0.0002 || p[1] < r.lat[0] - 0.0001 || p[1] > r.lat[1] + 0.0001) continue;
        const q = projectOnLine(r.c, p);
        if (q.d <= 10 && (!best || q.d < best.d)) best = { d: q.d, w: r.w };
      }
      if (!best) continue;
      near10 += L / n;
      if (best.d <= 3) near3 += L / n;
      if (flags(best.w.tags)) near10Flagged += L / n;
      else { const k = best.w.tags.name ?? "(unnamed)"; unflaggedByName[k] = (unflaggedByName[k] ?? 0) + L / n; }
      if (/sett|cobble|milanese/.test(best.w.tags.surface ?? "")) near10Rough += L / n;
    }
  }
}
const out = {
  tramWayMetresInArchive: r1(total), tramMetresWithin10mOfAHighwayWay: r1(near10), within3m: r1(near3), ofWhichNearestHighwayWayCarriesATramTag: r1(near10Flagged), ofWhichNearestHighwayWaySurfaceIsStone: r1(near10Rough),
  shareOfTramTrackVisibleToLastricoPct: r1((100 * near10Flagged) / total),
  topStreetsWithMappedTramNextToThemButNoTramTag: Object.entries(unflaggedByName).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ street: k, tramMetres: r1(v) })),
  note: "Only the 11 pilot (OSM API) extracts contain railway=* ways; the 8 citywide Overpass extracts were queried with way[highway] and contain none, so tram infrastructure south and east of the pilot box (Piazzale Lodi, Corso Lodi, Via Lazzaro Papi) is not in the archive at all.",
};
console.log(JSON.stringify(out, null, 1));
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 1) + "\n");
