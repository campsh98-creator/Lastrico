/**
 * Phase 4.36 / SIL prototype - offline, deterministic join of DBT 2020 tram axes onto the REAL compiled Milan segments.
 * Scope: the public landmark box (9.2025,45.4430,9.2175,45.4550) only, because Agent 3 cached DBT features for that box
 * (experiments/.../data/external/dbt-box-{19,39,45}-wgs.json, retrieved 2026-11-14 from the Comune's public REST service).
 * Nothing outside the box is computed or claimed. No network. Design feasibility, not product validation.
 *
 *   node si-dbt-join.mjs            -> evidence/surface-intelligence-design/dbt-join-box.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { ROOT, OUT, loadMilanTiles, metres, sha256, stable } from "./si-lib.mjs";

const CACHE = join(ROOT, "experiments/phase436-surface-intelligence/data/external");
export const BOX = [9.2025, 45.4430, 9.2175, 45.4550];
const LAT0 = 45.4490, KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110_540;
const toM = (p) => [(p[0] - 9.2) * KX, (p[1] - LAT0) * KY];
const inBox = (p, pad = 0) => p[0] >= BOX[0] - pad / KX && p[0] <= BOX[2] + pad / KX && p[1] >= BOX[1] - pad / KY && p[1] <= BOX[3] + pad / KY;
const ALONG_M = 5, CROSS_M = 3, COS_ALIGNED = 0.866 /* 30 deg */, COS_CROSSING = 0.5 /* >= 60 deg */, STEP_M = 2, FLAG_SHARE = 0.5;

function pip(pt, rings) { // even-odd across all rings of one polygon feature
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function runDbtJoin({ tiles, meta }) {
  const t0 = performance.now();
  const files = ["dbt-box-19-wgs.json", "dbt-box-39-wgs.json", "dbt-box-45-wgs.json"];
  const raw = Object.fromEntries(files.map((f) => [f, readFileSync(join(CACHE, f))]));
  const tram = JSON.parse(raw[files[0]]), veh = JSON.parse(raw[files[1]]), sede = JSON.parse(raw[files[2]]);
  const vehPolys = veh.features.map((f) => ({ rings: f.geometry.rings, bb: bbox(f.geometry.rings) }));
  const sedePolys = sede.features.map((f) => ({ rings: f.geometry.rings, bb: bbox(f.geometry.rings) }));
  const inAny = (polys, p) => polys.some((q) => p[0] >= q.bb[0] && p[0] <= q.bb[2] && p[1] >= q.bb[1] && p[1] <= q.bb[3] && pip(p, q.rings));

  // 1. tram axis edges with per-feature classification (POS from the spec codes, NOT from the Comune's swapped _d labels)
  const axes = [];
  for (const f of tram.features) {
    const a = f.attributes;
    const edges = [];
    for (const path of f.geometry.paths) for (let i = 1; i < path.length; i += 1) edges.push([path[i - 1], path[i]]);
    let inVeh = 0, inSede = 0, tot = 0;
    for (const [p, q] of edges) {
      const L = metres(p, q); if (!inBox([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])) continue;
      const n = Math.max(1, Math.ceil(L / STEP_M));
      for (let k = 0; k < n; k += 1) { const m = [p[0] + ((q[0] - p[0]) * (k + 0.5)) / n, p[1] + ((q[1] - p[1]) * (k + 0.5)) / n]; tot += L / n; if (inAny(vehPolys, m)) inVeh += L / n; if (inAny(sedePolys, m)) inSede += L / n; }
    }
    const pos = a.el_trv_pos, vehShare = tot ? inVeh / tot : 0, sedeShare = tot ? inSede / tot : 0;
    const sharing = pos === "02" && vehShare >= 0.8 && sedeShare < 0.2 ? "shared_carriageway" : pos === "01" && sedeShare >= 0.8 && vehShare < 0.2 ? "own_right_of_way" : "unknown";
    axes.push({ id: a.segmentid, pos, sta: a.el_trv_sta, sharing, edges: edges.map(([p, q]) => [toM(p), toM(q)]), edgesLL: edges });
  }
  // grid index (25 m) over axis edges
  const grid = new Map();
  axes.forEach((ax, ai) => ax.edges.forEach(([p, q], ei) => {
    const x0 = Math.floor(Math.min(p[0], q[0]) / 25) - 1, x1 = Math.floor(Math.max(p[0], q[0]) / 25) + 1, y0 = Math.floor(Math.min(p[1], q[1]) / 25) - 1, y1 = Math.floor(Math.max(p[1], q[1]) / 25) + 1;
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) { const k = `${x}:${y}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([ai, ei]); }
  }));

  // 2. unique compiled segments (a tuple on a tile boundary appears in two tiles)
  const seen = new Set(), segs = [];
  for (const [tileKey, t] of [...tiles.entries()].sort()) t.tuples.forEach((tu, idx) => {
    const c = tu[2], key = `${tu[0]}|${c.join(",")}`;
    if (seen.has(key)) return; seen.add(key);
    const a = [c[0], c[1]], b = [c[2], c[3]];
    if (!inBox([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 20)) return;
    segs.push({ w: tu[0], nameId: tu[1], a, b, tileKey, idx, hc: tu[9], L: metres(a, b) });
  });

  // 3. join: sample each segment every 2 m; an axis edge within 5 m and within 30 deg is "along"; within 3 m and >= 60 deg is a crossing
  const flagged = [], crossingList = [];
  let crossings = 0;
  for (const s of segs) {
    const A = toM(s.a), B = toM(s.b), dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1e-9;
    const n = Math.max(1, Math.ceil(s.L / STEP_M));
    let along = 0, tracks = 0, lastCross = -99; const classes = {};
    for (let k = 0; k < n; k += 1) {
      const px = A[0] + (dx * (k + 0.5)) / n, py = A[1] + (dy * (k + 0.5)) / n;
      const ids = new Set(), crossIds = new Set(); let crossHere = false, crossCos = 1;
      for (const [ai, ei] of grid.get(`${Math.floor(px / 25)}:${Math.floor(py / 25)}`) ?? []) {
        const [p, q] = axes[ai].edges[ei], d = distSeg(px, py, p[0], p[1], q[0], q[1]);
        if (d > ALONG_M) continue;
        const ex = q[0] - p[0], ey = q[1] - p[1], el = Math.hypot(ex, ey) || 1e-9, cos = Math.abs((dx * ex + dy * ey) / (len * el));
        if (cos >= COS_ALIGNED) { ids.add(ai); } else if (d <= CROSS_M && cos <= COS_CROSSING) { crossHere = true; crossIds.add(ai); crossCos = Math.min(crossCos, cos); }
      }
      if (ids.size) { along += s.L / n; tracks = Math.max(tracks, ids.size); for (const ai of ids) { const k2 = `${axes[ai].pos}:${axes[ai].sharing}`; classes[k2] = (classes[k2] ?? 0) + 1; } }
      if (crossHere && k - lastCross > 3) { crossings += 1; lastCross = k; s.cross = (s.cross ?? 0) + 1; crossingList.push([s.w, s.a, s.b, Math.round(((k + 0.5) / n) * 1000) / 1000, Math.round((Math.acos(crossCos) * 180) / Math.PI), crossIds.size]); }
    }
    if (along >= FLAG_SHARE * s.L) {
      const top = Object.entries(classes).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
      flagged.push({ w: s.w, a: s.a, b: s.b, tileKey: s.tileKey, idx: s.idx, alongM: Math.round(along * 10) / 10, tracks, pos: top.split(":")[0], sharing: top.split(":")[1] });
    }
  }
  flagged.sort((x, y) => x.w - y.w || x.a[0] - y.a[0] || x.a[1] - y.a[1]);

  // 4. cross-check against Agent 3's numbers (same box): axis metres per class, and how much axis is representable on compiled segments
  const check = { pos02_sharedCarriageway_m: 0, pos01_ownRoW_m: 0, other_m: 0, axisMetresInBox: 0, axisWithin5mOfAnyCompiledSegment_m: 0 };
  const segGrid = new Map();
  segs.forEach((s, si) => { const A = toM(s.a), B = toM(s.b); for (let x = Math.floor(Math.min(A[0], B[0]) / 25) - 1; x <= Math.floor(Math.max(A[0], B[0]) / 25) + 1; x += 1) for (let y = Math.floor(Math.min(A[1], B[1]) / 25) - 1; y <= Math.floor(Math.max(A[1], B[1]) / 25) + 1; y += 1) { const k = `${x}:${y}`; if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push(si); } });
  for (const ax of axes) for (let ei = 0; ei < ax.edges.length; ei += 1) {
    const [pLL, qLL] = ax.edgesLL[ei], L = metres(pLL, qLL); if (!inBox([(pLL[0] + qLL[0]) / 2, (pLL[1] + qLL[1]) / 2])) continue;
    const [p, q] = ax.edges[ei], n = Math.max(1, Math.ceil(L / STEP_M));
    for (let k = 0; k < n; k += 1) {
      const px = p[0] + ((q[0] - p[0]) * (k + 0.5)) / n, py = p[1] + ((q[1] - p[1]) * (k + 0.5)) / n, w = L / n;
      check.axisMetresInBox += w;
      if (ax.pos === "02" && ax.sharing === "shared_carriageway") check.pos02_sharedCarriageway_m += w; else if (ax.pos === "01" && ax.sharing === "own_right_of_way") check.pos01_ownRoW_m += w; else check.other_m += w;
      let hit = false;
      for (const si of segGrid.get(`${Math.floor(px / 25)}:${Math.floor(py / 25)}`) ?? []) { const A = toM(segs[si].a), B = toM(segs[si].b); if (distSeg(px, py, A[0], A[1], B[0], B[1]) <= ALONG_M) { hit = true; break; } }
      if (hit) check.axisWithin5mOfAnyCompiledSegment_m += w;
    }
  }
  for (const k of Object.keys(check)) check[k] = Math.round(check[k]);

  // 5. per-way aggregates
  const byWay = new Map();
  for (const s of segs) { const r = byWay.get(s.w) ?? { wayId: s.w, name: meta.names[s.nameId] ?? null, segments: 0, lengthM: 0, flaggedSegments: 0, railMetresAlong: 0, tracksMax: 0, sharing: {}, crossings: 0 }; r.segments += 1; r.lengthM += s.L; r.crossings += s.cross ?? 0; byWay.set(s.w, r); }
  for (const f of flagged) { const r = byWay.get(f.w); r.flaggedSegments += 1; r.railMetresAlong += f.alongM; r.tracksMax = Math.max(r.tracksMax, f.tracks); r.sharing[f.sharing] = (r.sharing[f.sharing] ?? 0) + 1; }
  const ways = [...byWay.values()].map((r) => ({ ...r, lengthM: Math.round(r.lengthM * 10) / 10, railMetresAlong: Math.round(r.railMetresAlong * 10) / 10 })).sort((a, b) => a.wayId - b.wayId);
  const tramPos = axes.reduce((m, a) => (m[a.pos] = (m[a.pos] ?? 0) + 1, m), {});
  return {
    inputs: Object.fromEntries(files.map((f) => [f, { sha256: sha256(raw[f]), bytes: raw[f].length }])),
    box: BOX, parameters: { ALONG_M, CROSS_M, COS_ALIGNED, COS_CROSSING, STEP_M, FLAG_SHARE },
    counts: { axisFeatures: axes.length, axisFeaturesByPos: tramPos, compiledSegmentsInBox: segs.length, compiledMetresInBox: Math.round(segs.reduce((s, x) => s + x.L, 0)), flaggedSegments: flagged.length, flaggedMetres: Math.round(flagged.reduce((s, x) => s + x.alongM, 0)), segmentsWithCrossing: segs.filter((s) => s.cross).length, crossingEvents: crossings, waysWithFlaggedSegments: ways.filter((w) => w.flaggedSegments).length },
    axisCrossCheckVsAgent3: { ...check, agent3_pos02_inVehicular_m: 2059, agent3_pos01_inSede_m: 1435, agent3_neither_m: 19, note: "Agent 3 sampled at a different step and clipped differently; agreement within a few percent is expected, not exact" },
    elapsedMs: Math.round(performance.now() - t0),
    ways, flagged, crossingList,
  };
}
const bbox = (rings) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };

if (process.argv[1]?.endsWith("si-dbt-join.mjs")) {
  const { tiles, meta } = loadMilanTiles();
  const r = runDbtJoin({ tiles, meta });
  const slim = { ...r, ways: r.ways.filter((w) => w.flaggedSegments > 0 || /Lodi|Papi|Friuli/.test(w.name ?? "")), flagged: r.flagged.map((f) => [f.w, f.a, f.b, f.alongM, f.tracks, f.pos, f.sharing]), crossings: r.crossingList };
  delete slim.crossingList;
  slim.waysNote = "ways with a flagged segment plus every way named Piazzale/Corso Lodi, Via Lazzaro Papi or Via Friuli in the box; flagged = [wayId, a, b, railMetresAlong, tracks, pos, sharing]; crossings = [wayId, a, b, fractionAlongSegment, angleDeg, axisCount]";
  delete slim.elapsedMs;
  writeFileSync(join(OUT, "dbt-join-box.json"), stable(slim, 0));
  console.log(JSON.stringify({ counts: r.counts, check: r.axisCrossCheckVsAgent3, elapsedMs: r.elapsedMs }, null, 1));
}
