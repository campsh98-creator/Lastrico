/**
 * Phase 4.39: rails as infrastructure, from three independent sources, joined to the compiled Milan segments.
 *
 * - OSM: railway ways of the Phase 4.38 sidecar (only where the extraction asked for them, see sil-coverage.mjs).
 * - DBT 2020 (Comune di Milano): tram axes, classified by the SPECIFICATION code EL_TRV_POS (02 = shared
 *   carriageway, 01 = own right-of-way) with polygon containment, never by the Comune's swapped `_d` labels.
 * - ATM ds538: only whether a scheduled tram line runs there ("service"), never whether rails exist.
 *
 * Pure functions, no network, no clock, Node built-ins only. Geometry uses the scorer's flat-earth metric.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { metres, sha256 } from "./sil-core.mjs";
import { ringIndex } from "./sil-dbt-cache.mjs";

const LON0 = 9.19, LAT0 = 45.465;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110_540;
export const toM = (p) => [(p[0] - LON0) * KX, (p[1] - LAT0) * KY];
export const JOIN = { alongM: 5, cosAligned: 0.866 /* 30 deg */, stepM: 2, flagShare: 0.5, cellM: 25, atmM: 12 };

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Spatial grid over axis edges (metres). `axes`: [{ edges: [[lonlat, lonlat], ...] }]. */
export function indexAxes(axes) {
  const grid = new Map();
  const edges = axes.map((axis) => axis.edges.map(([p, q]) => [toM(p), toM(q)]));
  edges.forEach((list, ai) => list.forEach(([p, q], ei) => {
    const x0 = Math.floor(Math.min(p[0], q[0]) / JOIN.cellM) - 1, x1 = Math.floor(Math.max(p[0], q[0]) / JOIN.cellM) + 1;
    const y0 = Math.floor(Math.min(p[1], q[1]) / JOIN.cellM) - 1, y1 = Math.floor(Math.max(p[1], q[1]) / JOIN.cellM) + 1;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${x}:${y}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push([ai, ei]);
    }
  }));
  return { grid, edges };
}

/**
 * Segments whose axis runs along them: an axis edge within 5 m and 30 degrees at >= 50 % of 2 m samples.
 * `segments`: [{ key, a, b }] (lon/lat). Returns Map(key -> { alongM, tracks, axes: Set(axisIndex) }).
 */
export function joinAxes(axes, segments) {
  return joinAxesDetailed(axes, segments).flagged;
}

/**
 * Same join, also reporting near misses: segments where an axis runs along 20 % to 50 % of the length
 * (a track that enters or leaves, or a segment that should be split). They are NOT flagged.
 */
export function joinAxesDetailed(axes, segments) {
  const { grid, edges } = indexAxes(axes);
  const out = new Map();
  const partial = new Map();
  for (const segment of segments) {
    const A = toM(segment.a), B = toM(segment.b);
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1e-9;
    const L = metres(segment.a, segment.b);
    const n = Math.max(1, Math.ceil(L / JOIN.stepM));
    let along = 0, tracks = 0;
    const used = new Set();
    for (let k = 0; k < n; k++) {
      const px = A[0] + (dx * (k + 0.5)) / n, py = A[1] + (dy * (k + 0.5)) / n;
      const ids = new Set();
      for (const [ai, ei] of grid.get(`${Math.floor(px / JOIN.cellM)}:${Math.floor(py / JOIN.cellM)}`) ?? []) {
        const [p, q] = edges[ai][ei];
        if (distSeg(px, py, p[0], p[1], q[0], q[1]) > JOIN.alongM) continue;
        const ex = q[0] - p[0], ey = q[1] - p[1], el = Math.hypot(ex, ey) || 1e-9;
        if (Math.abs((dx * ex + dy * ey) / (len * el)) >= JOIN.cosAligned) ids.add(ai);
      }
      if (ids.size) {
        along += L / n;
        tracks = Math.max(tracks, ids.size);
        for (const ai of ids) used.add(ai);
      }
    }
    if (along >= JOIN.flagShare * L) out.set(segment.key, { alongM: Math.round(along * 10) / 10, tracks, axes: used });
    else if (along >= 0.2 * L) partial.set(segment.key, { alongM: Math.round(along * 10) / 10, axes: used });
  }
  return { flagged: out, partial };
}

// ---------- OSM axes from the Phase 4.38 sidecar ----------
const TRAM_TYPES = new Set(["tram", "light_rail"]);
const LIFECYCLE = ["disused:railway", "abandoned:railway", "construction:railway"];

/**
 * Tram axes from foundation entity groups. `groups`: [{ name, ways: Map, nodes: Map }] (entity maps by id).
 * Only operational `railway=tram|light_rail`; disused, abandoned and under-construction ways are counted, never joined.
 * The same way present in two groups is taken once, from the higher version.
 */
export function osmAxes(groups) {
  const chosen = new Map();
  const stats = { railwayWays: 0, operationalTram: 0, notTram: 0, lifecycleOnly: 0, missingVertices: 0, duplicates: 0 };
  for (const group of groups) {
    for (const way of group.ways.values()) {
      const kind = way.tags?.railway;
      const lifecycle = LIFECYCLE.some((key) => way.tags?.[key]);
      if (!kind && !lifecycle) continue;
      stats.railwayWays++;
      if (!kind) { stats.lifecycleOnly++; continue; }
      if (!TRAM_TYPES.has(kind)) { stats.notTram++; continue; }
      const coordinates = way.nodeIds.map((id) => group.nodes.get(id)?.coordinates ?? null);
      if (coordinates.some((c) => !c)) { stats.missingVertices++; continue; }
      const previous = chosen.get(way.id);
      if (previous) {
        stats.duplicates++;
        if ((previous.version ?? 0) >= (way.version ?? 0)) continue;
      }
      chosen.set(way.id, { id: way.id, group: group.name, railway: kind, version: way.version ?? null,
        timestamp: way.timestamp ?? null, coordinates,
        edges: coordinates.slice(1).map((c, i) => [coordinates[i], c]) });
    }
  }
  const axes = [...chosen.values()].sort((a, b) => a.id - b.id);
  stats.operationalTram = axes.length;
  return { axes, stats };
}

// ---------- DBT 2020 axes (Comune di Milano), classified by specification codes ----------
const bbox = (rings) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
function pip(pt, rings) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Reads the cached DBT features of a box (ArcGIS JSON in WGS84): layer 19 tram axes (EL_TRV), 39 vehicular
 * areas (AC_VEI), 45 railway beds (SD_FER). Returns the axes with `pos` and `sharing`, the box and input hashes.
 * `box`: [west, south, east, north], the area the cache covers; nothing outside it is claimed.
 */
export function dbtAxes(directory, box) {
  const files = { tram: "dbt-box-19-wgs.json", vehicular: "dbt-box-39-wgs.json", bed: "dbt-box-45-wgs.json" };
  const raw = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(join(directory, f))]));
  const tram = JSON.parse(raw.tram), vehicular = JSON.parse(raw.vehicular), bed = JSON.parse(raw.bed);
  const polys = (layer) => layer.features.map((f) => ({ rings: f.geometry.rings, bb: bbox(f.geometry.rings) }));
  const vehPolys = polys(vehicular), bedPolys = polys(bed);
  const inAny = (list, p) => list.some((q) => p[0] >= q.bb[0] && p[0] <= q.bb[2] && p[1] >= q.bb[1] && p[1] <= q.bb[3] && pip(p, q.rings));
  const inside = (p) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
  const axes = [];
  for (const feature of tram.features) {
    const a = feature.attributes;
    const edges = [];
    for (const path of feature.geometry.paths) for (let i = 1; i < path.length; i++) edges.push([path[i - 1], path[i]]);
    let inVeh = 0, inBed = 0, total = 0;
    for (const [p, q] of edges) {
      const L = metres(p, q);
      if (!inside([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])) continue;
      const n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) {
        const m = [p[0] + ((q[0] - p[0]) * (k + 0.5)) / n, p[1] + ((q[1] - p[1]) * (k + 0.5)) / n];
        total += L / n;
        if (inAny(vehPolys, m)) inVeh += L / n;
        if (inAny(bedPolys, m)) inBed += L / n;
      }
    }
    const vehShare = total ? inVeh / total : 0, bedShare = total ? inBed / total : 0;
    // POS from the specification: 02 shared carriageway, 01 own right-of-way. Both need polygon agreement, else unknown.
    const sharing = a.el_trv_pos === "02" && vehShare >= 0.8 && bedShare < 0.2 ? "shared_carriageway"
      : a.el_trv_pos === "01" && bedShare >= 0.8 && vehShare < 0.2 ? "own_right_of_way" : "unknown";
    axes.push({ id: a.segmentid, pos: a.el_trv_pos, status: a.el_trv_sta, sharing, edges });
  }
  axes.sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return { axes, box, inputs: Object.fromEntries(Object.entries(files).map(([k, f]) => [f, { sha256: sha256(raw[k]), bytes: raw[k].length }])) };
}

// ---------- ATM ds538: service only ----------
/** Tram routes of the ATM surface-line file as axes (mode TRAM only). `file`: GeoJSON of LineStrings. */
export function atmTramAxes(file) {
  const bytes = readFileSync(file);
  const geo = JSON.parse(bytes);
  const axes = geo.features.filter((f) => f.properties?.mezzo === "TRAM" && f.geometry?.type === "LineString")
    .map((f, i) => ({ id: `${f.properties.linea}-${f.properties.percorso}-${i}`, line: String(f.properties.linea), edges: f.geometry.coordinates.slice(1).map((c, k) => [f.geometry.coordinates[k], c]) }));
  return { axes, sha256: sha256(bytes), bytes: bytes.length, routes: axes.length, lines: [...new Set(axes.map((a) => a.line))].sort() };
}

/** Distance in metres from a point to the nearest axis edge, or Infinity beyond `limit`. */
export function nearestAxisM(index, point, limit = JOIN.atmM) {
  const [px, py] = toM(point);
  let best = Infinity;
  const reach = Math.ceil(limit / JOIN.cellM);
  const cx = Math.floor(px / JOIN.cellM), cy = Math.floor(py / JOIN.cellM);
  for (let x = cx - reach + 1; x <= cx + reach - 1; x++) for (let y = cy - reach + 1; y <= cy + reach - 1; y++) {
    for (const [ai, ei] of index.grid.get(`${x}:${y}`) ?? []) {
      const [p, q] = index.edges[ai][ei];
      best = Math.min(best, distSeg(px, py, p[0], p[1], q[0], q[1]));
    }
  }
  return best <= limit ? best : Infinity;
}

// ---------- DBT 2020, citywide classification ----------
const PCELL = 0.002;
function polygonIndex(polygons) {
  const list = polygons.map((f) => ({ rings: f.geometry.rings, bb: bbox(f.geometry.rings), inside: ringIndex(f.geometry.rings) }));
  const grid = new Map();
  list.forEach((q, i) => {
    for (let x = Math.floor(q.bb[0] / PCELL); x <= Math.floor(q.bb[2] / PCELL); x++) for (let y = Math.floor(q.bb[1] / PCELL); y <= Math.floor(q.bb[3] / PCELL); y++) {
      const k = `${x}:${y}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  return (p) => (grid.get(`${Math.floor(p[0] / PCELL)}:${Math.floor(p[1] / PCELL)}`) ?? []).some((i) => {
    const q = list[i];
    return p[0] >= q.bb[0] && p[0] <= q.bb[2] && p[1] >= q.bb[1] && p[1] <= q.bb[3] && q.inside(p);
  });
}

/**
 * Classifies DBT tram axes with the same rule as dbtAxes(), for any set of features (citywide).
 * `contains(point)` says whether a point lies in the area the DBT was asked about (the municipality); axis
 * samples outside it are not counted. The polygon layers only need to hold what lies under the axes.
 */
export function classifyDbtAxes({ axes: features, vehicular, bed, contains }) {
  const inVeh = polygonIndex(vehicular), inBed = polygonIndex(bed);
  const axes = [];
  for (const feature of features) {
    const a = feature.attributes;
    const edges = [];
    for (const path of feature.geometry.paths) for (let i = 1; i < path.length; i++) edges.push([path[i - 1], path[i]]);
    let veh = 0, bd = 0, total = 0;
    for (const [p, q] of edges) {
      const L = metres(p, q);
      const n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) {
        const m = [p[0] + ((q[0] - p[0]) * (k + 0.5)) / n, p[1] + ((q[1] - p[1]) * (k + 0.5)) / n];
        if (contains && !contains(m)) continue;
        total += L / n;
        if (inVeh(m)) veh += L / n;
        if (inBed(m)) bd += L / n;
      }
    }
    const vehShare = total ? veh / total : 0, bedShare = total ? bd / total : 0;
    const sharing = a.el_trv_pos === "02" && vehShare >= 0.8 && bedShare < 0.2 ? "shared_carriageway"
      : a.el_trv_pos === "01" && bedShare >= 0.8 && vehShare < 0.2 ? "own_right_of_way" : "unknown";
    axes.push({ id: a.segmentid, pos: a.el_trv_pos, status: a.el_trv_sta, sharing, edges, vehShare: Math.round(vehShare * 100) / 100, bedShare: Math.round(bedShare * 100) / 100, sampledM: Math.round(total) });
  }
  axes.sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return axes;
}
