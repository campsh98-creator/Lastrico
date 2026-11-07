// Verified-evidence aggregation. This module never sees experimental predictions.

import {
  CATEGORIES, GENERIC_UNKNOWN_MATERIALS, HIGHWAY_CLASSES, MAIN_NETWORK_CLASSES, MAJOR_CLASSES,
  ROUTING_CLASS_WEIGHT, expectedCategory, emptyBreakdown, knownShare,
} from "./classify.mjs";
import { makeProjection, round, splitOnGrid } from "./geo.mjs";
import { cellKey, computeHotspots, explainHotspot, topNames, HOTSPOT_PARAMS } from "./hotspots.mjs";
import { chainSegments, encodeLine } from "./encode.mjs";

function roundBreakdown(b) {
  const out = {};
  let total = 0;
  for (const k of CATEGORIES) { out[k] = round(b[k], 1); total += b[k]; }
  return { total: round(total, 1), ...out, knownShare: knownShare(b) === null ? null : round(knownShare(b), 4) };
}

function newCell(ix, iy) {
  return {
    ix, iy, total: 0, ...emptyBreakdown(), confirmedRough: 0,
    unknownRoutable: 0, unknownMajor: 0, unknownWeighted: 0,
    probableRoutable: 0, probableWeighted: 0, unknownNames: new Map(),
  };
}

export const CELL_FIELDS = [
  "ix", "iy", "total", "confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown",
  "unknownRoutable", "unknownMajor", "probableRoutable", "unknownWeighted", "probableWeighted",
  "pave3x3", "adjacency", "score", "rank",
];

/**
 * @param area  { id, label, projection: {lon0, lat0, phi0}, cellSizeMeters, sources: {id: label} }
 * @param segments decoded segments (classify.decodeTuple) with an added `source` id
 */
export function aggregateArea(area, segments, { topN = 25, params = HOTSPOT_PARAMS } = {}) {
  const proj = makeProjection(area.projection);
  const size = area.cellSizeMeters;
  const totals = emptyBreakdown();
  const unknownSub = { generic_value: 0, no_usable_value: 0 };
  const byClass = new Map();
  const bySource = new Map();
  const byMode = { car: emptyBreakdown(), bicycle: emptyBreakdown(), any_mode: emptyBreakdown(), no_mode: emptyBreakdown() };
  const mainNetwork = emptyBreakdown();
  const tiles = new Map();
  const cells = new Map();
  const groups = new Map();
  const wayIndex = new Map();
  const materialAudit = new Map();
  let segmentCount = 0;
  let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;

  segments.forEach((s, idx) => {
    segmentCount += 1;
    const L = s.length;
    const cat = s.category;
    totals[cat] += L;
    if (cat === "unknown") {
      if (GENERIC_UNKNOWN_MATERIALS.has(s.material)) unknownSub.generic_value += L; else unknownSub.no_usable_value += L;
    }
    const expected = expectedCategory(s.material, s.smoothness);
    const auditKey = `${s.material}|${cat}|${expected}`;
    const audit = materialAudit.get(auditKey) ?? { material: s.material, category: cat, expected, meters: 0, segments: 0 };
    audit.meters += L; audit.segments += 1; materialAudit.set(auditKey, audit);

    if (!byClass.has(s.highwayClass)) byClass.set(s.highwayClass, { ...emptyBreakdown(), routable: 0, unknownRoutable: 0 });
    const bc = byClass.get(s.highwayClass);
    bc[cat] += L;
    if (s.routable) { bc.routable += L; if (cat === "unknown") bc.unknownRoutable += L; }

    if (!bySource.has(s.source)) bySource.set(s.source, { ...emptyBreakdown(), segments: 0, main: emptyBreakdown() });
    const bs = bySource.get(s.source);
    bs[cat] += L; bs.segments += 1;
    // Like-for-like comparison between sources: the main vehicular network was not touched by the compile filter.
    if (MAIN_NETWORK_CLASSES.has(s.highwayClass)) bs.main[cat] += L;

    if (s.car) byMode.car[cat] += L;
    if (s.bicycle) byMode.bicycle[cat] += L;
    if (s.routable) byMode.any_mode[cat] += L; else byMode.no_mode[cat] += L;
    if (MAIN_NETWORK_CLASSES.has(s.highwayClass)) mainNetwork[cat] += L;

    minLon = Math.min(minLon, s.lon0, s.lon1); maxLon = Math.max(maxLon, s.lon0, s.lon1);
    minLat = Math.min(minLat, s.lat0, s.lat1); maxLat = Math.max(maxLat, s.lat0, s.lat1);

    // Production 0.01° tiles (key floor(lon*100)_floor(lat*100)); length split exactly at tile edges.
    for (const [tx, ty, f] of splitOnGrid(s.lon0 * 100, s.lat0 * 100, s.lon1 * 100, s.lat1 * 100)) {
      const tk = `${tx}_${ty}`;
      if (!tiles.has(tk)) tiles.set(tk, { tx, ty, ...emptyBreakdown() });
      tiles.get(tk)[cat] += L * f;
    }

    // ~250 m analysis grid in the local projection; length split exactly at cell edges.
    const w = ROUTING_CLASS_WEIGHT[s.highwayClass] ?? ROUTING_CLASS_WEIGHT.unknown;
    const pieces = splitOnGrid(proj.x(s.lon0) / size, proj.y(s.lat0) / size, proj.x(s.lon1) / size, proj.y(s.lat1) / size);
    for (const [ix, iy, f] of pieces) {
      const ck = cellKey(ix, iy);
      let c = cells.get(ck);
      if (!c) { c = newCell(ix, iy); cells.set(ck, c); }
      const m = L * f;
      c.total += m;
      c[cat] += m;
      if (cat === "confirmed_rough") c.confirmedRough += m;
      if (s.routable && cat === "unknown") {
        c.unknownRoutable += m;
        c.unknownWeighted += m * w;
        if (MAJOR_CLASSES.has(s.highwayClass)) c.unknownMajor += m;
        if (s.name && w > 0) c.unknownNames.set(s.name, (c.unknownNames.get(s.name) ?? 0) + m * w);
      }
      if (s.routable && cat === "probable_rough") {
        c.probableRoutable += m;
        c.probableWeighted += m * w;
      }
    }

    const gk = `${s.wayId ?? "null"}|${cat}`;
    let g = groups.get(gk);
    if (!g) { g = { wayId: s.wayId, cat, segs: [] }; groups.set(gk, g); }
    g.segs.push({ a: [s.lon0, s.lat0], b: [s.lon1, s.lat1] });

    if (s.wayId !== null && s.wayId !== undefined) {
      const list = wayIndex.get(s.wayId);
      if (list) list.push(idx); else wayIndex.set(s.wayId, [idx]);
    }
  });

  const { totalScore, rankedCount, top } = computeHotspots(cells, { topN, params });

  const cellRows = [...cells.values()]
    .sort((p, q) => (p.iy - q.iy) || (p.ix - q.ix))
    .map((c) => [
      c.ix, c.iy, round(c.total), round(c.confirmed_rough), round(c.probable_rough), round(c.confirmed_smooth),
      round(c.unpaved_loose), round(c.unknown), round(c.unknownRoutable), round(c.unknownMajor), round(c.probableRoutable),
      round(c.unknownWeighted), round(c.probableWeighted), round(c.pave3x3), round(c.adjacency, 3), round(c.score), c.rank ?? 0,
    ]);
  const cellNames = {};
  for (const c of cells.values()) {
    if (c.unknownNames.size) cellNames[cellKey(c.ix, c.iy)] = topNames(c.unknownNames, 2).map((n) => n.name);
  }

  const hotspots = top.map((c) => {
    const x0 = c.ix * size; const y0 = c.iy * size;
    return {
      rank: c.rank,
      cell: { ix: c.ix, iy: c.iy },
      center: { lon: round(proj.lon(x0 + size / 2), 6), lat: round(proj.lat(y0 + size / 2), 6) },
      bounds: { west: round(proj.lon(x0), 6), south: round(proj.lat(y0), 6), east: round(proj.lon(x0 + size), 6), north: round(proj.lat(y0 + size), 6) },
      score: round(c.score),
      shareOfAreaScore: totalScore > 0 ? round(c.score / totalScore, 5) : 0,
      components: {
        unknownWeighted: round(c.unknownWeighted), unknownRoutable: round(c.unknownRoutable), unknownMajor: round(c.unknownMajor),
        probableWeighted: round(c.probableWeighted), probableRoutable: round(c.probableRoutable),
        pave3x3: round(c.pave3x3), adjacency: round(c.adjacency, 3),
      },
      cellTotals: roundBreakdown(c),
      topUnknownStreets: topNames(c.unknownNames, 3),
      reasons: explainHotspot(c, totalScore),
    };
  });

  const classRows = HIGHWAY_CLASSES.filter((hc) => byClass.has(hc)).map((hc) => {
    const b = byClass.get(hc);
    return { highwayClass: hc, routingWeight: ROUTING_CLASS_WEIGHT[hc], ...roundBreakdown(b), routable: round(b.routable), unknownRoutable: round(b.unknownRoutable) };
  });
  const sourceRows = Object.keys(area.sources).filter((id) => bySource.has(id)).map((id) => {
    const b = bySource.get(id);
    return { source: id, label: area.sources[id], segments: b.segments, ...roundBreakdown(b), mainNetwork: roundBreakdown(b.main) };
  });
  for (const id of bySource.keys()) if (!(id in area.sources)) {
    const b = bySource.get(id);
    sourceRows.push({ source: id, label: id, segments: b.segments, ...roundBreakdown(b), mainNetwork: roundBreakdown(b.main) });
  }
  const tileRows = [...tiles.values()].sort((p, q) => (p.ty - q.ty) || (p.tx - q.tx)).map((t) => ({ tile: `${t.tx}_${t.ty}`, ...roundBreakdown(t) }));

  // Display geometry: groups sorted by way id then category for determinism.
  const layers = Object.fromEntries(CATEGORIES.map((k) => [k, []]));
  const groupList = [...groups.values()].sort((p, q) => ((p.wayId ?? -1) - (q.wayId ?? -1)) || (CATEGORIES.indexOf(p.cat) - CATEGORIES.indexOf(q.cat)));
  let polylineCount = 0; let pointCount = 0;
  for (const g of groupList) {
    for (const line of chainSegments(g.segs)) {
      layers[g.cat].push(encodeLine(line, area.projection.lon0, area.projection.lat0));
      polylineCount += 1; pointCount += line.length;
    }
  }

  const sumCells = emptyBreakdown();
  for (const c of cells.values()) for (const k of CATEGORIES) sumCells[k] += c[k];

  const verified = {
    id: area.id,
    label: area.label,
    datasetBounds: { west: round(minLon, 6), south: round(minLat, 6), east: round(maxLon, 6), north: round(maxLat, 6) },
    segments: segmentCount,
    totals: roundBreakdown(totals),
    unknownBreakdown: { generic_value: round(unknownSub.generic_value), no_usable_value: round(unknownSub.no_usable_value) },
    mainNetwork: { classes: [...MAIN_NETWORK_CLASSES], ...roundBreakdown(mainNetwork) },
    byMode: Object.fromEntries(Object.entries(byMode).map(([k, v]) => [k, roundBreakdown(v)])),
    byClass: classRows,
    bySource: sourceRows,
    byTile: tileRows,
    materialAudit: [...materialAudit.values()]
      .sort((p, q) => (p.material < q.material ? -1 : p.material > q.material ? 1 : 0) || (p.category < q.category ? -1 : 1))
      .map((a) => ({ ...a, meters: round(a.meters), consistentWithProduction: a.expected === a.category })),
    grid: {
      cellSizeMeters: size,
      projection: { ...area.projection, kx: round(proj.kx, 6), ky: proj.ky },
      cellCount: cells.size,
      fields: CELL_FIELDS,
      rows: cellRows,
      unknownStreetNames: cellNames,
      partitionCheck: roundBreakdown(sumCells),
    },
    hotspots: { totalScore: round(totalScore), cellsWithScore: rankedCount, topN, list: hotspots },
  };
  const geometry = {
    id: area.id,
    origin: { lon0: area.projection.lon0, lat0: area.projection.lat0 },
    quantization: 1e-5,
    polylines: polylineCount,
    points: pointCount,
    layers,
  };
  return { verified, geometry, wayIndex };
}
