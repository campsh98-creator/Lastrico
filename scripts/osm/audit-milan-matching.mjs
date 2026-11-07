/** Phase 4.24 — spatial-matching audit of Milan surface labels on real provider routes.
 * For every archived Valhalla route of the Phase 4.25 benchmark, each 12 m scoring sample is
 * matched exactly as scoreRoadIntelligence() does, then the matched OSM way's name is compared
 * with the street name Valhalla reports for that stretch. A rough label on a differently named
 * street is a suspected bleed (across an intersection, or onto an adjacent road).
 *   node scripts/osm/audit-milan-matching.mjs [--tiles=<dir>] [--label=before]
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { scoreRoadIntelligence, headingsAlign } from "../../lib/road-intelligence-scoring.ts";
import { SpatialRoadIntelligenceStore } from "../../lib/spatial-road-store.ts";

const root = new URL("../../", import.meta.url);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const tilesDir = arg("tiles") ? new URL(`file://${arg("tiles").replace(/\/?$/, "/")}`) : new URL("data/surfaces/milan-tiles/", root);
const label = arg("label") ?? "before";
// --legacy-rejection mirrors the pre-Phase-4.24 scorer (a forbidden way under the route hid
// its surface). Parity with production is then not applicable and is not checked.
const legacy = process.argv.includes("--legacy-rejection");
const responsesDir = new URL("outputs/phase425-benchmark/responses/", root);
const MATCH = { car: 12, motorcycle: 11, bicycle: 9 }; // MODE_POLICY.surfaceMatchMeters
const COSTING = { auto: "car", motorcycle: "motorcycle", bicycle: "bicycle" };

const meta = JSON.parse(await readFile(new URL("metadata.json", tilesDir), "utf8"));
const loaders = Object.fromEntries(meta.tileKeys.map((k) => [k, async () => ({ default: JSON.parse(await readFile(new URL(`${k}.json`, tilesDir), "utf8")) })]));
const store = new SpatialRoadIntelligenceStore(meta, loaders, "milan");
await store.preloadTiles(meta.tileKeys);
const index = store.getScopedIntelligenceForTiles([...meta.tileKeys]).surfaceIndex;

function decode(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  const next = () => { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < str.length) { lat += next(); lon += next(); out.push([lon / 1e6, lat / 1e6]); }
  return out;
}
const mpl = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((b[0] - a[0]) * mpl((a[1] + b[1]) / 2), (b[1] - a[1]) * 110_540);
function project(p, a, b, sx) {
  const px = p[0] * sx, py = p[1] * 110_540, ax = a[0] * sx, ay = a[1] * 110_540, bx = b[0] * sx, by = b[1] * 110_540;
  const dx = bx - ax, dy = by - ay, den = dx * dx + dy * dy;
  const raw = den ? ((px - ax) * dx + (py - ay) * dy) / den : 0;
  const t = Math.max(0, Math.min(1, raw));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), beyond: raw < 0 ? -raw * Math.sqrt(den) : raw > 1 ? (raw - 1) * Math.sqrt(den) : 0 };
}
const vgrade = (a, b) => (a.rawTags?.layer ?? "0") !== (b.rawTags?.layer ?? "0") || (a.rawTags?.bridge ?? "no") !== (b.rawTags?.bridge ?? "no") || (a.rawTags?.tunnel ?? "no") !== (b.rawTags?.tunnel ?? "no");

/** Mirror of the category loop of scoreRoadIntelligence(); returns one record per sample. */
function samplesOf(coords, mode) {
  const m = MATCH[mode];
  const samples = [];
  for (let r = 1; r < coords.length; r++) {
    const a = coords[r - 1], b = coords[r], length = dist(a, b);
    const n = Math.max(1, Math.ceil(length / 12));
    for (let s = 0; s < n; s++) {
      const A = [a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n];
      const B = [a[0] + (b[0] - a[0]) * (s + 1) / n, a[1] + (b[1] - a[1]) * (s + 1) / n];
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const sx = mpl(mid[1]), padLat = m / 110_540, padLon = m / Math.max(1, sx);
      const seen = new Set();
      let best = null, bestD = Infinity, bestW = 0, bestBeyond = 0, rejected = Infinity, rejectedSeg = null, rejectedWhy = null;
      const aligned = [];
      const geo = [];
      for (let x = Math.floor((mid[0] - padLon) / index.cellSize); x <= Math.floor((mid[0] + padLon) / index.cellSize); x++) {
        for (let y = Math.floor((mid[1] - padLat) / index.cellSize); y <= Math.floor((mid[1] + padLat) / index.cellSize); y++) {
          for (const c of index.cells.get(`${x}:${y}`) ?? []) {
            if (seen.has(c)) continue; seen.add(c);
            const [c0, c1] = c.coordinates;
            if (mid[1] < Math.min(c0[1], c1[1]) - padLat || mid[1] > Math.max(c0[1], c1[1]) + padLat
              || mid[0] < Math.min(c0[0], c1[0]) - padLon || mid[0] > Math.max(c0[0], c1[0]) + padLon) continue;
            const { d, beyond } = project(mid, c0, c1, sx);
            if (d > m || !headingsAlign(A, B, c0, c1, false, sx)) continue;
            geo.push({ c, d });
            const allowed = c.modeAccess?.[mode] ?? (mode === "bicycle" ? c.isBicycleAllowed : c.isMotorAllowed);
            const dir = c.modeDirections?.[mode] ?? (c.isOneway ? "forward" : "both");
            const st = dir === "backward" ? c1 : c0, en = dir === "backward" ? c0 : c1;
            if (!allowed || dir === "unknown" || !headingsAlign(A, B, st, en, dir !== "both", sx)) {
              if (d < rejected) { rejected = d; rejectedSeg = c; rejectedWhy = !allowed ? "access" : dir === "unknown" ? "directionUnknown" : "wrongWay"; }
              continue;
            }
            aligned.push({ c, d });
            if (d < bestD || (d === bestD && c.roughnessWeight > bestW)) { best = c; bestD = d; bestW = c.roughnessWeight; bestBeyond = beyond; }
          }
        }
      }
      let cat = "unknown", matched = null, why = null, competing = aligned, viaRejected = false;
      if (!best || rejected <= bestD + 0.000001) {
        const onRoute = !legacy && rejectedSeg && rejected <= 2 && !(best && bestD <= 2 && best.surfaceCategory !== rejectedSeg.surfaceCategory);
        if (onRoute) { best = rejectedSeg; bestD = rejected; competing = geo; viaRejected = true; }
        else why = !best ? (rejected < Infinity ? "onlyForbiddenOrWrongWay" : "noArchivedWayWithinRadius") : "nearerForbiddenOrWrongWay";
      }
      if (!why) {
        if (competing.some(({ c, d }) => Math.abs(d - bestD) <= 2 && vgrade(c, best))) why = "verticalAmbiguity";
        else { cat = best.surfaceCategory; matched = best; if (cat === "unknown") why = "archivedWayWithoutSurface"; }
      }
      samples.push({ r, len: length / n, cat, why, viaRejected, rejected: rejectedSeg && rejected <= 1.5 && (why === "onlyForbiddenOrWrongWay" || why === "nearerForbiddenOrWrongWay")
        ? { cat: rejectedSeg.surfaceCategory, why: rejectedWhy, conditional: Object.keys(rejectedSeg.rawTags ?? {}).some((k) => k.includes(":conditional")), way: rejectedSeg.osmWayId, name: rejectedSeg.name, hw: rejectedSeg.highwayClass, tags: rejectedSeg.rawTags } : null, way: matched?.osmWayId ?? null, name: matched?.name ?? null, d: bestD, beyond: matched ? bestBeyond : 0,
        tie: matched ? aligned.filter(({ c, d }) => c !== matched && Math.abs(d - bestD) <= 2 && c.surfaceCategory !== matched.surfaceCategory).length : 0 });
    }
  }
  return samples;
}

const norm = (s) => (s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const files = (await readdir(responsesDir)).filter((f) => f.endsWith(".json")).sort();
const seenShapes = new Set();
const byMode = {};
const suspects = new Map();
const rejectedWays = new Map();
// Route use per OSM way: where an independent check of the tag would change most decisions.
const routeUse = new Map();
let routes = 0, parityFailures = 0;
for (const f of files) {
  const entry = JSON.parse(await readFile(new URL(f, responsesDir), "utf8"));
  if (!entry.request.url.includes("valhalla") || entry.status !== 200) continue;
  const body = JSON.parse(entry.request.body); const mode = COSTING[body.costing];
  if (!mode) continue;
  const data = JSON.parse(entry.body);
  for (const trip of [data.trip, ...(data.alternates ?? []).map((x) => x.trip)].filter(Boolean)) {
    const legs = trip.legs ?? [];
    const coords = []; const names = [];
    for (const [li, leg] of legs.entries()) {
      const pts = decode(leg.shape);
      const offset = coords.length - (li > 0 ? 1 : 0);
      coords.push(...(li > 0 ? pts.slice(1) : pts));
      for (const mv of leg.maneuvers ?? []) for (let k = (mv.begin_shape_index ?? 0) + 1; k <= (mv.end_shape_index ?? 0); k++) names[offset + k] = (mv.street_names ?? []).map(norm);
    }
    const shapeKey = `${mode}:${legs.map((l) => l.shape).join("|")}`;
    if (seenShapes.has(shapeKey) || coords.length < 2) continue;
    seenShapes.add(shapeKey); routes++;
    const samples = samplesOf(coords, mode);
    // Parity with production: category metres must equal scoreRoadIntelligence on the same route.
    const prod = scoreRoadIntelligence(coords, index, MATCH[mode], mode, true);
    const sum = (c) => Math.round(samples.filter((s) => s.cat === c).reduce((a, s) => a + s.len, 0));
    const ok = Math.abs(sum("confirmed_rough") + sum("probable_rough") - prod.paveMeters) <= 2 && Math.abs(sum("confirmed_smooth") - prod.smoothMeters) <= 2;
    if (!ok && !legacy) parityFailures++;
    // Street change points along the route, by distance.
    const cum = [0]; for (let k = 1; k < coords.length; k++) cum[k] = cum[k - 1] + dist(coords[k - 1], coords[k]);
    const changes = []; for (let k = 2; k < coords.length; k++) if (JSON.stringify(names[k] ?? []) !== JSON.stringify(names[k - 1] ?? [])) changes.push(cum[k - 1]);
    const t = (byMode[mode] ??= { routes: 0, meters: 0, cats: {} }); t.routes++; t.meters += cum.at(-1);
    let along = 0, prevR = 0, inR = 0;
    for (const s of samples) {
      if (s.r !== prevR) { prevR = s.r; inR = 0; }
      const at = cum[s.r - 1] + inR + s.len / 2; inR += s.len; along = at;
      const e = (t.cats[s.cat] ??= { meters: 0, onRouteGeometry: 0, offset1to4m: 0, offsetOver4m: 0, beyondWayEnd: 0, tieWithOtherCategory: 0, sameName: 0, unnamed: 0, otherNameNearChange: 0, otherNameElsewhere: 0, offsetOver4mOtherName: 0 });
      e.meters += s.len;
      if (s.way !== null && s.cat !== "confirmed_smooth") {
        const u = routeUse.get(s.way) ?? { way: `osm:way:${s.way}`, name: s.name, category: s.cat, meters: 0, routes: new Set(), modes: new Set() };
        u.meters += s.len; u.routes.add(shapeKey); u.modes.add(mode); routeUse.set(s.way, u);
      }
      if (s.viaRejected) { const k = `surfaceFromWayUnderRouteNotUsableByMode`; e[k] = (e[k] ?? 0) + s.len; }
      if (s.cat === "unknown") {
        e[s.why] = (e[s.why] ?? 0) + s.len;
        if (s.rejected) {
          const k = `onRejectedWay:${s.rejected.cat}:${s.rejected.why}${s.rejected.conditional ? ":conditional" : ""}`;
          e[k] = (e[k] ?? 0) + s.len;
          const wk = `${mode}|${s.rejected.way}`;
          const w = rejectedWays.get(wk) ?? { mode, way: `osm:way:${s.rejected.way}`, name: s.rejected.name, highway: s.rejected.hw, category: s.rejected.cat, why: s.rejected.why, tags: s.rejected.tags, meters: 0 };
          w.meters += s.len; rejectedWays.set(wk, w);
        }
        continue;
      }
      // Valhalla and the archive share OSM geometry: a sample on the same way sits within ~1.5 m.
      if (s.d <= 1.5) e.onRouteGeometry += s.len; else if (s.d <= 4) e.offset1to4m += s.len; else e.offsetOver4m += s.len;
      if (s.beyond > 1) e.beyondWayEnd += s.len;
      if (s.tie) e.tieWithOtherCategory += s.len;
      const routeNames = names[s.r] ?? [];
      if (!s.name || routeNames.length === 0) { e.unnamed += s.len; }
      else if (routeNames.includes(norm(s.name))) { e.sameName += s.len; }
      const near = changes.some((c) => Math.abs(c - along) <= 25);
      if (s.name && routeNames.length && !routeNames.includes(norm(s.name))) {
        e[near ? "otherNameNearChange" : "otherNameElsewhere"] += s.len;
        if (s.d > 4) e.offsetOver4mOtherName += s.len;
      }
      if ((s.cat === "confirmed_rough" || s.cat === "probable_rough") && (s.d > 1.5 || s.beyond > 1 || s.tie)) {
        const k = `${mode}|${s.way}|${routeNames[0] ?? ""}`;
        const x = suspects.get(k) ?? { mode, way: `osm:way:${s.way}`, matchedName: s.name, routeStreet: routeNames[0] ?? null, category: s.cat, meters: 0, nearStreetChange: 0, beyondEnd: 0, tie: 0, maxDistance: 0 };
        x.meters += s.len; if (near) x.nearStreetChange += s.len; if (s.beyond > 1) x.beyondEnd += s.len; if (s.tie) x.tie += s.len; x.maxDistance = Math.max(x.maxDistance, s.d);
        suspects.set(k, x);
      }
      continue;
    }
  }
}
const r1 = (v) => Math.round(v * 10) / 10;
const summary = { label, scorer: legacy ? "legacy (pre-4.24 rejection)" : "production", parityChecked: !legacy, tiles: tilesDir.pathname.replace(root.pathname, ""), routes, parityFailures,
  byMode: Object.fromEntries(Object.entries(byMode).map(([m, t]) => [m, { routes: t.routes, km: r1(t.meters / 1000),
    categories: Object.fromEntries(Object.entries(t.cats).map(([c, e]) => [c, Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Math.round(v)]))])) }])),
  verificationPriorities: Object.fromEntries(["confirmed_rough", "probable_rough", "unknown", "unpaved_loose"].map((cat) => [cat,
    [...routeUse.values()].filter((u) => u.category === cat).sort((a, b) => b.routes.size - a.routes.size || b.meters - a.meters).slice(0, 25)
      .map((u) => ({ way: u.way, name: u.name, routes: u.routes.size, modes: [...u.modes].sort(), meters: Math.round(u.meters) }))])),
  topRejectedOnRoute: [...rejectedWays.values()].sort((a, b) => b.meters - a.meters).slice(0, 80).map((w) => ({ ...w, meters: Math.round(w.meters) })),
  topSuspects: [...suspects.values()].sort((a, b) => b.meters - a.meters).slice(0, 60).map((x) => ({ ...x, meters: Math.round(x.meters), nearStreetChange: Math.round(x.nearStreetChange), beyondEnd: Math.round(x.beyondEnd), maxDistance: r1(x.maxDistance) })) };
await mkdir(new URL("outputs/phase424-data-quality/", root), { recursive: true });
await writeFile(new URL(`outputs/phase424-data-quality/matching-${label}.json`, root), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify({ routes, parityFailures, byMode: summary.byMode }, null, 1));
for (const x of summary.topSuspects.slice(0, 25)) console.log(x.mode, x.category, x.meters, "m", x.way, JSON.stringify(x.matchedName), "on", JSON.stringify(x.routeStreet), "near", x.nearStreetChange, "beyond", x.beyondEnd, "tie", x.tie, "d", x.maxDistance);
