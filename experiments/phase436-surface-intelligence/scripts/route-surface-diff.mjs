/**
 * Phase 4.36 / osm-data-audit — what is under return-trip route 0 (and route 1), three ways, in metres:
 *   A. the app's own reported numbers (stored in the trace),
 *   B. Lastrico's own code (lib/road-intelligence-scoring.ts) run offline on the compiled tiles (data/surfaces/milan-tiles),
 *   C. an independent computation from the raw archived OSM extracts (data/sources/*.osm.json.gz): nearest car-usable
 *      highway way per 1 m of route, own tag classification, no Lastrico code, no compiled data.
 *
 *   node route-surface-diff.mjs <trace.json> [--route=0] [--out=<dir>]
 *
 * Reads the trace LOCALLY (route geometry only); writes redacted aggregate CSV/JSON to --out (default
 * outputs/phase436-surface-intelligence/evidence/osm-data-audit). Along-route distances are relative metres, no coordinates.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, metres, wayCoords, wayLength, projectOnLine, ROOT, r1 } from "./osm-archive.mjs";

const R = "file:///" + ROOT.replaceAll("\\", "/") + "/";
const args = process.argv.slice(2);
const tracePath = args.find((a) => !a.startsWith("--"));
const routeIndex = Number(args.find((a) => a.startsWith("--route="))?.slice(8) ?? 0);
const outDir = args.find((a) => a.startsWith("--out="))?.slice(6) ?? join(ROOT, "outputs/phase436-surface-intelligence/evidence/osm-data-audit");
if (!tracePath) { console.error("usage: node route-surface-diff.mjs <trace.json> [--route=0] [--out=dir]"); process.exit(2); }
await mkdir(outDir, { recursive: true });

const trace = JSON.parse(await readFile(tracePath, "utf8"));
const route = trace.routes[routeIndex];
const coords = route.coordinates;

// ---------- B. Lastrico's own code on the compiled tiles -------------------------------------------------------
const { spatialRoadStore } = await import(R + "lib/spatial-road-store.ts");
const { scoreRoadIntelligence, EdgeMemo, geographicDistance } = await import(R + "lib/road-intelligence-scoring.ts");
const { buildRoughSections } = await import(R + "lib/rough-sections.ts");
const keys = spatialRoadStore.getTileKeysForCoordinates(coords, 50);
await spatialRoadStore.preloadTiles(keys);
const scoped = spatialRoadStore.getScopedIntelligence(coords, 50);
const memo = new EdgeMemo();
const score = scoreRoadIntelligence(coords, scoped.surfaceIndex, 12 /* MODE_POLICY.car.surfaceMatchMeters, app/api/routes/route.ts:85 */, "car", false, { edgeMemo: memo });
const sections = buildRoughSections(coords, score.roughSegmentIndices, score.confirmedRoughSegmentIndices, undefined, undefined, score.roughSegmentFeatures);
// per-sample matches of Lastrico (12 m samples) with their along-route position
const lastricoSamples = [];
{
  let along = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const L = geographicDistance(coords[i - 1], coords[i]);
    const m = memo.get(coords[i - 1], coords[i]);
    const n = Math.max(1, Math.ceil(L / 12));
    for (let s = 0; s < n; s += 1) {
      const best = m?.[s]?.best ?? null;
      lastricoSamples.push({ from: along + (s * L) / n, len: L / n, edge: i, wayId: best?.osmWayId ?? null, category: best?.surfaceCategory ?? "no-match", material: best?.surface?.value ?? null, name: best?.name ?? null, ambiguous: Boolean(m?.[s]?.ambiguous), memo: Boolean(m) });
    }
    along += L;
  }
}
const lastricoRouteMeters = lastricoSamples.reduce((s, x) => s + x.len, 0);

// ---------- C. independent raw computation ------------------------------------------------------------------
const arc = await loadArchive();
const CAR_CLASSES = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road", "track"]);
const roads = [];
for (const w of arc.ways.values()) {
  if (!CAR_CLASSES.has(w.tags?.highway) || w.tags.area === "yes") continue;
  const c = wayCoords(arc, w);
  if (c.some((x) => !x)) continue;
  roads.push({ w, c, minLon: Math.min(...c.map((p) => p[0])), maxLon: Math.max(...c.map((p) => p[0])), minLat: Math.min(...c.map((p) => p[1])), maxLat: Math.max(...c.map((p) => p[1])) });
}
const ROUGH = new Set(["sett", "cobblestone", "cobblestone:flattened", "cobblestone:flattened:large_stone", "unhewn_cobblestone", "cobblestone:rounded", "pebblestone", "milanese_paving", "milanese_paving:rails", "milanese_paving:lanes"]);
const PROBABLE = new Set(["paving_stones", "paving_stones:lanes"]);
const SMOOTH = new Set(["asphalt", "concrete", "concrete:plates", "concrete:lanes"]);
const LOOSE = new Set(["unpaved", "compacted", "gravel", "fine_gravel", "ground", "dirt", "earth"]);
function rawClass(tags) {
  const s = (tags.surface ?? "").trim().toLowerCase();
  if (!s) return { cat: "unknown", why: "no surface tag" };
  if (ROUGH.has(s)) return { cat: "rough", why: `surface=${s}` };
  if (PROBABLE.has(s)) return { cat: "probable", why: `surface=${s}` };
  if (SMOOTH.has(s)) return { cat: "smooth", why: `surface=${s}` };
  if (LOOSE.has(s)) return { cat: "loose", why: `surface=${s}` };
  if (s === "paved") return { cat: "unknown", why: "surface=paved (generic)" };
  return { cat: "unknown", why: `surface=${s} (unmapped value)` };
}
function oneWayDir(tags) { // +1 forward, -1 backward, 0 both
  const o = (tags.oneway ?? (tags.junction === "roundabout" || tags.junction === "circular" ? "yes" : "")).toLowerCase();
  return o === "yes" || o === "1" || o === "true" ? 1 : o === "-1" ? -1 : 0;
}
function carAllowed(tags) {
  for (const k of ["motorcar", "motor_vehicle", "vehicle", "access"]) if (tags[k]) return !["no", "private"].includes(tags[k].toLowerCase());
  return true;
}
const rawSamples = [];
{
  const step = 1;
  let along = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1], b = coords[i];
    const L = metres(a, b);
    const n = Math.max(1, Math.round(L / step));
    const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180), ky = 110_540;
    const rdx = (b[0] - a[0]) * kx, rdy = (b[1] - a[1]) * ky;
    const rl = Math.hypot(rdx, rdy) || 1;
    for (let s = 0; s < n; s += 1) {
      const t = (s + 0.5) / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const padLon = 15 / kx, padLat = 15 / ky;
      let best = null;
      for (const r of roads) {
        if (p[0] < r.minLon - padLon || p[0] > r.maxLon + padLon || p[1] < r.minLat - padLat || p[1] > r.maxLat + padLat) continue;
        const q = projectOnLine(r.c, p);
        if (q.d > 12) continue;
        // heading of the nearest way segment vs route direction
        const c0 = r.c[q.seg], c1 = r.c[q.seg + 1];
        const wdx = (c1[0] - c0[0]) * kx, wdy = (c1[1] - c0[1]) * ky;
        const cos = (rdx * wdx + rdy * wdy) / (rl * (Math.hypot(wdx, wdy) || 1));
        const dir = oneWayDir(r.w.tags);
        const aligned = dir === 0 ? Math.abs(cos) >= 0.58 : cos * dir >= 0.7;
        if (!aligned || !carAllowed(r.w.tags)) continue;
        if (!best || q.d < best.d) best = { d: q.d, w: r.w };
      }
      rawSamples.push({ from: along + (s * L) / n, len: L / n, wayId: best?.w.id ?? null, cls: best ? rawClass(best.w.tags) : { cat: "no-match", why: "no aligned car-usable way within 12 m" }, tags: best?.w.tags ?? null, d: best?.d ?? null });
    }
    along += L;
  }
}

// ---------- redaction: origin and destination streets (from route 0's own end points) never leave this process -------------
function nearestRoadName(p) {
  let best = null;
  for (const r of roads) { const q = projectOnLine(r.c, p); if (q.d < 15 && (!best || q.d < best.d)) best = { d: q.d, w: r.w }; }
  return best?.w.tags.name ?? null;
}
const redactNames = new Map();
const o0 = nearestRoadName(trace.routes[0].coordinates[0]); if (o0) redactNames.set(o0, "<origin street>");
const dLast = rawSamples.at(-1)?.wayId ? arc.ways.get(rawSamples.at(-1).wayId)?.tags?.name : null; // the way under the last metre of this route (same destination for both routes)
const d0 = nearestRoadName(trace.routes[0].coordinates.at(-1)) ?? dLast; if (d0) redactNames.set(d0, "<destination street>");
if (dLast) redactNames.set(dLast, "<destination street>");
const redactedIds = new Set([...arc.ways.values()].filter((w) => redactNames.has(w.tags?.name)).map((w) => w.id));
const rn = (n) => (n && redactNames.has(n) ? redactNames.get(n) : n);
const rid = (id) => (redactedIds.has(id) ? "<redacted>" : id);

// ---------- aggregate ------------------------------------------------------------------------------------------
const wayRows = new Map();
const row = (id) => { if (!wayRows.has(id)) wayRows.set(id, { id, rawM: 0, lastricoM: 0, firstAlong: Infinity, lastAlong: -Infinity }); return wayRows.get(id); };
for (const s of rawSamples) { const r = row(s.wayId ?? "none"); r.rawM += s.len; r.firstAlong = Math.min(r.firstAlong, s.from); r.lastAlong = Math.max(r.lastAlong, s.from + s.len); }
for (const s of lastricoSamples) { const r = row(s.wayId ?? "none"); r.lastricoM += s.len; r.firstAlong = Math.min(r.firstAlong, s.from); r.lastAlong = Math.max(r.lastAlong, s.from + s.len); }
const cat = (x) => ({ rough: 0, probable: 0, smooth: 0, loose: 0, unknown: 0, "no-match": 0, ...x });
const rawTotals = cat({}); for (const s of rawSamples) rawTotals[s.cls.cat] += s.len;
const lastricoTotals = { confirmed_rough: 0, probable_rough: 0, confirmed_smooth: 0, unpaved_loose: 0, unknown: 0, "no-match": 0 };
for (const s of lastricoSamples) lastricoTotals[s.category] += s.len;

// runs of non-assessed route (Lastrico) with cause from raw tags
const runs = [];
for (const s of lastricoSamples) {
  if (s.category !== "unknown" && s.category !== "no-match") continue;
  const last = runs.at(-1);
  const raw = s.wayId ? arc.ways.get(s.wayId) : null;
  const why = s.category === "no-match" ? "no segment matched (no aligned/accessible way within 12 m, or ambiguous vertical grade)" : rawClass(raw?.tags ?? {}).why;
  if (last && last.wayId === rid(s.wayId) && last.category === s.category && s.from - last.to < 1) { last.to = s.from + s.len; last.m += s.len; }
  else runs.push({ from: s.from, to: s.from + s.len, m: s.len, wayId: rid(s.wayId), category: s.category, name: rn(raw?.tags?.name) ?? null, highway: raw?.tags?.highway ?? null, surfaceTag: raw?.tags?.surface ?? null, smoothness: raw?.tags?.smoothness ?? null, why, wayLenM: raw ? wayLength(arc, raw) : null });
}

const rowsOut = [...wayRows.values()].filter((r) => r.id !== "none" || r.rawM + r.lastricoM > 0).sort((a, b) => a.firstAlong - b.firstAlong).map((r) => {
  const w = r.id === "none" ? null : arc.ways.get(r.id);
  const lc = lastricoSamples.find((s) => s.wayId === r.id);
  return { wayId: rid(r.id), name: rn(w?.tags?.name) ?? "", highway: w?.tags?.highway ?? "", surface: w?.tags?.surface ?? "", smoothness: w?.tags?.smoothness ?? "", surface_bike: w?.tags?.surface_bike ?? "", oneway: w?.tags?.oneway ?? (w?.tags?.junction ? "(implied by junction)" : ""), version: w?.version ?? "", rawWayLengthM: w ? r1(wayLength(arc, w)) : "", routeMetresIndependent: r1(r.rawM), routeMetresLastrico: r1(r.lastricoM), diffM: r1(r.lastricoM - r.rawM), lastricoCategory: lc?.category ?? "", alongFirst: r1(r.firstAlong), alongLast: r1(r.lastAlong) };
});

const summary = {
  route: routeIndex, routePolylineMetres: r1(lastricoRouteMeters),
  appReported: route.pave, appReportedRoughSections: route.roughSections.map((x) => ({ startMeters: x.startMeters, endMeters: x.endMeters, confirmedMeters: x.confirmedMeters, probableMeters: x.probableMeters, name: x.name, surface: x.surface })),
  lastricoOffline: { total: score.totalMeters, pave: score.paveMeters, confirmed: score.confirmedMeters, probable: score.probableMeters, smooth: score.smoothMeters, unpaved: score.unpavedMeters, unknown: score.unknownMeters, coveragePct: score.matchedCoveragePercent, embeddedRailsMeters: score.embeddedRailsMeters, ambiguousSamples: score.ambiguousMatchesCount, restrictionMeters: score.confirmedRestrictionMeters, roughSections: sections.map((x) => ({ startMeters: x.startMeters, endMeters: x.endMeters, confirmedMeters: x.confirmedMeters, probableMeters: x.probableMeters, name: x.name, surface: x.surface })) },
  lastricoSampleTotals: Object.fromEntries(Object.entries(lastricoTotals).map(([k, v]) => [k, r1(v)])),
  independentRawTotals: Object.fromEntries(Object.entries(rawTotals).map(([k, v]) => [k, r1(v)])),
  unknownRuns: runs.map((r) => ({ ...r, from: r1(r.from), to: r1(r.to), m: r1(r.m), wayLenM: r.wayLenM === null ? null : r1(r.wayLenM) })),
  unknownRunsByCause: Object.entries(runs.reduce((acc, r) => { acc[r.why] = (acc[r.why] ?? 0) + r.m; return acc; }, {})).map(([why, m]) => ({ why, metres: r1(m) })),
};
console.log(JSON.stringify(summary, null, 2));
const csv = (rows) => [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map((v) => (typeof v === "string" && /[",]/.test(v) ? JSON.stringify(v) : v)).join(","))].join("\n") + "\n";
await writeFile(join(outDir, `route${routeIndex}-per-way.csv`), csv(rowsOut));
await writeFile(join(outDir, `route${routeIndex}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
