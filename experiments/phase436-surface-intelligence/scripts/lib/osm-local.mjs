/**
 * Phase 4.36 helper: snap route geometries to the repository's local OSM extracts (data/sources/milan-citywide-*.osm.json.gz,
 * Overpass `way[highway]` + nodes, retrieved 2026-11-04; no relations) and describe the way sequence.
 * Offline. Used by routing-forensics-live.mjs to name the streets a provider route follows without trusting maneuver merging (names pass through pub()).
 */
import zlib from "node:zlib";
import fs from "node:fs";

const root = new URL("../../../../", import.meta.url);
// Privacy (principal agent rule): only these public names may appear in any written output. Every other street name (the origin street,
// the destination street and the side streets next to the origin) is written as "<other street>"; their way and node ids are withheld.
export const PUBLIC_NAMES = new Set(["Via Friuli", "Viale Umbria", "Viale Isonzo", "Piazzale Lodi", "Corso Lodi", "Via Lazzaro Papi", "Viale Filippetti", "Porta Romana", "Alzaia Naviglio Pavese"]);
export const pub = (name) => (!name ? (name ?? null) : PUBLIC_NAMES.has(name) ? name : "<other street>");
const hide = pub;

export function loadLocalOsm(files = ["milan-citywide-s-east.osm.json.gz", "milan-citywide-s-central.osm.json.gz", "milan-citywide-s-west.osm.json.gz"]) {
  const nodes = new Map(); const ways = new Map();
  for (const f of files) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`data/sources/${f}`, root))));
    for (const e of d.elements) { if (e.type === "node") nodes.set(e.id, [e.lon, e.lat]); else if (e.type === "way") ways.set(e.id, e); }
  }
  const segs = [];
  for (const w of ways.values()) {
    const pts = w.nodes.map((n) => nodes.get(n));
    if (pts.some((p) => !p)) continue;
    if (!pts.some((p) => p[0] > 9.165 && p[0] < 9.235 && p[1] > 45.42 && p[1] < 45.47)) continue;
    for (let i = 1; i < pts.length; i += 1) segs.push({ w, a: pts[i - 1], b: pts[i] });
  }
  return { nodes, ways, segs };
}

const K = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
export const meters = (a, b) => Math.hypot((a[0] - b[0]) * K((a[1] + b[1]) / 2), (a[1] - b[1]) * 110540);
function segDistance(p, a, b) {
  const k = K(p[1]); const dx = (b[0] - a[0]) * k, dy = (b[1] - a[1]) * 110540, px = (p[0] - a[0]) * k, py = (p[1] - a[1]) * 110540;
  const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, (px * dx + py * dy) / l)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

/** Way sequence of a route: each vertex goes to the nearest way (<= 12 m, vehicle-capable ways preferred), consecutive equal ways merged. */
export function wayChain(osm, coordinates) {
  const car = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "primary_link", "secondary_link", "tertiary_link"]);
  const out = []; let at = 0;
  for (let i = 0; i < coordinates.length; i += 1) {
    if (i > 0) at = meters(coordinates[i - 1], coordinates[i]);
    let best = null;
    for (const s of osm.segs) {
      const d = segDistance(coordinates[i], s.a, s.b) + (car.has(s.w.tags?.highway) ? 0 : 6);
      if (!best || d < best.d) best = { d, w: s.w };
    }
    const tags = best && best.d <= 12 ? best.w.tags ?? {} : null;
    const key = best && tags ? best.w.id : null;
    const last = out.at(-1);
    if (last && last.way === key) last.meters += at;
    else out.push({ way: key, name: hide(tags?.name), highway: tags?.highway ?? null, surface: tags?.surface ?? null, oneway: tags?.oneway ?? null, railway: tags?.railway ?? null, meters: at });
  }
  // merge consecutive ways that carry the same name/highway/surface for readability
  const merged = [];
  for (const s of out) {
    const l = merged.at(-1);
    if (l && l.name === s.name && l.highway === s.highway && l.surface === s.surface) l.meters += s.meters;
    else merged.push({ ...s });
  }
  return merged.map((m) => ({ name: m.name, highway: m.highway, surface: m.surface, oneway: m.oneway, meters: Math.round(m.meters) }));
}
