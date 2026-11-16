/**
 * Phase 4.36 routing-experiments: per-sample surface features of a route, from the PRODUCTION scorer (lib/road-intelligence-scoring.ts) and the
 * committed Milan tiles, plus raw OSM facts joined by OSM way id (data/exp-cache/way-tags.json from exp-waytags.mjs).
 *
 * A route is walked exactly as the scorer walks it (edges, ceil(length/12) samples per edge, same lengths), and every sample keeps what the
 * production matcher found under it. `accumulate()` re-derives the production numbers (rounded the same way) from those samples under an
 * injectable classification, so a DATA LAYER (overlay) can change what a sample is without touching the scorer, and the baseline layer
 * reproduces candidateDiagnostics exactly (validated in exp-validate-features.mjs).
 */
import { readFile } from "node:fs/promises";
import { ROOT, CACHE } from "./exp-harness.mjs";

const importLib = (p) => import(new URL(p, ROOT).href);
export const MATCH_METERS = { car: 12, motorcycle: 11, bicycle: 9 }; // MODE_POLICY[*].surfaceMatchMeters (app/api/routes/route.ts:83-132)
let ctx = null;
export async function scoring() {
  if (ctx) return ctx;
  const [{ getSpatialRoadStore }, { scoreRoadIntelligence, EdgeMemo, geographicDistance }, { parseLocalDeparture }] = await Promise.all([
    importLib("lib/spatial-road-store.ts"), importLib("lib/road-intelligence-scoring.ts"), importLib("lib/access-conditions.ts")]);
  ctx = { store: await getSpatialRoadStore("milan"), scoreRoadIntelligence, EdgeMemo, geographicDistance, parseLocalDeparture };
  return ctx;
}
let wayTags = null;
export async function loadWayTags() {
  if (!wayTags) wayTags = JSON.parse(await readFile(new URL("way-tags.json", CACHE), "utf8"));
  return wayTags;
}
export const PILOT_BOX = { lon: [9.169, 9.206], lat: [45.45, 45.48] }; // pilot source boxes (data/sources/milan-pilot-osm.source.json): the only area with railway ways in the archive
export const inPilotBox = (lon, lat) => lon >= PILOT_BOX.lon[0] && lon <= PILOT_BOX.lon[1] && lat >= PILOT_BOX.lat[0] && lat <= PILOT_BOX.lat[1];

function allTileKeys(coords, paddingMeters) {
  const keys = new Set();
  const add = (lon, lat) => {
    const padLat = paddingMeters / 110_540, padLon = paddingMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
    for (let x = Math.floor((lon - padLon) * 100); x <= Math.floor((lon + padLon) * 100); x += 1)
      for (let y = Math.floor((lat - padLat) * 100); y <= Math.floor((lat + padLat) * 100); y += 1) keys.add(`${x}_${y}`);
  };
  coords.forEach(([lon, lat], i) => {
    add(lon, lat);
    if (i > 0) { const a = coords[i - 1]; const L = Math.hypot((lon - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180), (lat - a[1]) * 110_540);
      for (let k = 1; k < Math.ceil(L / 100); k += 1) { const t = k / Math.ceil(L / 100); add(a[0] + (lon - a[0]) * t, a[1] + (lat - a[1]) * t); } }
  });
  return [...keys];
}

/**
 * Samples of one route. `departure` is the handler's "YYYY-MM-DDTHH:MM" string.
 * Returns { production: RoadIntelligenceScore (the scorer's own numbers), samples: [...] }.
 */
export async function sampleTable(coords, mode, departureParam) {
  const c = await scoring();
  await c.store.preloadTiles(c.store.getTileKeysForCoordinates(coords, 50));
  // Scope = every tile key around the route, existing or not (a missing tile has no segments), so the scorer marks no cell incomplete and keeps its edge memo.
  const scoped = c.store.getScopedIntelligenceForTiles(allTileKeys(coords, 60));
  const memo = new c.EdgeMemo();
  const departure = c.parseLocalDeparture(departureParam);
  const production = c.scoreRoadIntelligence(coords, scoped.surfaceIndex, MATCH_METERS[mode], mode, false,
    { terminalWalkingForBicycle: true, departure, authorisedZtl: new Set(), edgeMemo: memo });
  const samples = [];
  let along = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1], b = coords[i];
    const edge = c.geographicDistance(a, b);
    const n = Math.max(1, Math.ceil(edge / 12));
    const len = edge / n;
    const matches = memo.get(a, b);
    if (!matches) throw new Error("edge memo miss: tiles incomplete");
    for (let k = 0; k < n; k += 1) {
      const best = matches[k]?.best ?? null;
      const t = (k + 0.5) / n;
      samples.push({
        len, along: along + k * len, edge: i, lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t,
        cat: best ? best.surfaceCategory : "nomatch", w: best ? best.roughnessWeight : 0, mat: best ? best.surface.value : null,
        sm: best?.smoothness?.value ?? null, way: best ? best.osmWayId : null, hw: best ? best.highwayClass : null,
        rails: best ? Boolean(best.embeddedRails) : false, name: best ? best.name : null,
      });
    }
    along += edge;
  }
  return { production, samples };
}

/** Production rounding of the accumulated metres (road-intelligence-scoring.ts:770-806), reproduced. */
export function finish(acc) {
  const total = Math.round(acc.total);
  const pave = Math.min(total, Math.round(acc.pave));
  const confirmed = acc.probable > 0 ? Math.min(pave, Math.round(acc.confirmed)) : pave;
  const probable = Math.max(0, pave - confirmed);
  const smooth = Math.min(total - pave, Math.round(acc.smooth));
  const unpaved = Math.min(total - pave - smooth, Math.round(acc.unpaved));
  const unknown = Math.max(0, total - (pave + smooth + unpaved));
  const weighted = Math.round(acc.weighted);
  const weightedUnpaved = Math.round(acc.weightedUnpaved);
  return { total, pave, confirmed, probable, smooth, unpaved, unknown, weighted, weightedUnpaved, risk: weighted + weightedUnpaved };
}

/** A classification maps a sample to { cat, w } (and may flag channels). The baseline classification is the scorer's own. */
export const BASELINE = (s) => ({ cat: s.cat, w: s.w });

export function accumulate(samples, classify = BASELINE, extra = null) {
  const acc = { total: 0, pave: 0, weighted: 0, confirmed: 0, probable: 0, smooth: 0, unpaved: 0, weightedUnpaved: 0 };
  const channels = {}; // free-form per-channel metres filled by `extra`
  for (const s of samples) {
    acc.total += s.len;
    const { cat, w } = classify(s);
    if (cat === "confirmed_rough") { acc.pave += s.len; acc.weighted += s.len * w; acc.confirmed += s.len; }
    else if (cat === "probable_rough") { acc.pave += s.len; acc.weighted += s.len * w; acc.probable += s.len; }
    else if (cat === "confirmed_smooth") acc.smooth += s.len;
    else if (cat === "unpaved_loose") { acc.unpaved += s.len; acc.weightedUnpaved += s.len * w; }
    if (extra) extra(s, cat, w, channels);
  }
  return { ...finish(acc), channels };
}
