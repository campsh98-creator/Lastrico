/**
 * Public-landmark bounding boxes for the external-data audit. Derived ONLY from named OSM ways in the committed archive
 * (Piazzale Lodi ring, Corso Lodi, Via Lazzaro Papi) — never from the GPS trace. Prints rounded WGS84 values.
 */
import { loadArchive, wayCoords } from "./osm-archive.mjs";
const arc = await loadArchive();
function box(filter) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, n = 0, sx = 0, sy = 0, w = 0;
  for (const way of arc.ways.values()) {
    if (!filter(way)) continue;
    w += 1;
    for (const c of wayCoords(arc, way)) { if (!c) continue; n += 1; sx += c[0]; sy += c[1]; minx = Math.min(minx, c[0]); maxx = Math.max(maxx, c[0]); miny = Math.min(miny, c[1]); maxy = Math.max(maxy, c[1]); }
  }
  return { ways: w, nodes: n, centroid: [sx / n, sy / n], bbox: [minx, miny, maxx, maxy] };
}
const ring = box((w) => w.tags?.name === "Piazzale Lodi" && w.tags.junction);
const papi = box((w) => w.tags?.name === "Via Lazzaro Papi" && w.tags.highway);
console.log("ring", JSON.stringify(ring));
console.log("papi", JSON.stringify(papi));
const [cx, cy] = ring.centroid;
console.log("ring centroid (3 dp):", cx.toFixed(3), cy.toFixed(3));
const R = 500; // half side in metres -> 1 km box
const dLat = R / 110540, dLon = R / (111320 * Math.cos((cy * Math.PI) / 180));
console.log("1 km landmark box around ring centroid:", [cx - dLon, cy - dLat, cx + dLon, cy + dLat].map((v) => v.toFixed(5)).join(","));
// Corso Lodi: NW arm extent (within 1 km of the ring centroid)
const cl = box((w) => w.tags?.name === "Corso Lodi" && w.tags.highway && wayCoords(arc, w).some((c) => c && Math.hypot((c[0] - cx) * 111320 * Math.cos((cy * Math.PI) / 180), (c[1] - cy) * 110540) < 1000));
console.log("corso lodi within 1km of ring:", JSON.stringify(cl));
