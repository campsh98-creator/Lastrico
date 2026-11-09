// EXPERIMENTAL, UNVERIFIED Phase 4.17 predictions. Kept in a separate structure and file.
// Nothing here is ever added to, subtracted from, or used by the verified aggregation or the hotspot score.

import { makeProjection, round, splitOnGrid } from "./geo.mjs";
import { chainSegments, encodeLine } from "./encode.mjs";

export const EXPERIMENTAL_LABEL = "Previsione sperimentale — non verificata";
export const P_BINS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.000001];

/**
 * @param predictions array of {id: "milan:123", area, p_pave, ...} (Phase 4.17 unknown-predictions.json.gz)
 * @param area area config; @param segments decoded verified segments; @param wayIndex wayId -> segment indices
 * Returns a structure for ONE area; it holds copies of geometry, never references to verified aggregates.
 */
export function buildExperimentalLayer(area, predictions, segments, wayIndex) {
  const proj = makeProjection(area.projection);
  const size = area.cellSizeMeters;
  const own = predictions.filter((p) => p.area === area.id).slice()
    .sort((a, b) => Number(a.id.split(":")[1]) - Number(b.id.split(":")[1]));
  const cells = new Map();
  const polylines = [];
  const binMeters = new Array(P_BINS.length - 1).fill(0);
  const binWays = new Array(P_BINS.length - 1).fill(0);
  let matchedWays = 0; let unmatchedWays = 0; let predictedUnknownMeters = 0; let predictedUnknownSegments = 0;
  let knownSegmentsSkipped = 0; let knownMetersSkipped = 0; let waysWithKnownSegments = 0;
  let outOfDistributionWays = 0; let pSum = 0; let pMax = 0; let pAtLeastHalf = 0;

  for (const pred of own) {
    const wayId = Number(pred.id.split(":")[1]);
    const p = Number(pred.p_pave);
    pSum += p; pMax = Math.max(pMax, p); if (p >= 0.5) pAtLeastHalf += 1;
    if (pred.out_of_city_training_distribution) outOfDistributionWays += 1;
    const idxs = wayIndex.get(wayId);
    if (!idxs || idxs.length === 0) { unmatchedWays += 1; continue; }
    matchedWays += 1;
    const segs = [];
    let hadKnown = false;
    for (const i of idxs) {
      const s = segments[i];
      if (s.category !== "unknown") { knownSegmentsSkipped += 1; knownMetersSkipped += s.length; hadKnown = true; continue; }
      predictedUnknownSegments += 1;
      predictedUnknownMeters += s.length;
      segs.push({ a: [s.lon0, s.lat0], b: [s.lon1, s.lat1] });
      const bin = P_BINS.findIndex((lo, k) => p >= lo && p < P_BINS[k + 1]);
      if (bin >= 0) binMeters[bin] += s.length;
      for (const [ix, iy, f] of splitOnGrid(proj.x(s.lon0) / size, proj.y(s.lat0) / size, proj.x(s.lon1) / size, proj.y(s.lat1) / size)) {
        const k = `${ix}:${iy}`;
        const c = cells.get(k) ?? { ix, iy, meters: 0, pMeters: 0, ways: new Set() };
        c.meters += s.length * f; c.pMeters += p * s.length * f; c.ways.add(wayId);
        cells.set(k, c);
      }
    }
    if (hadKnown) waysWithKnownSegments += 1;
    if (segs.length) {
      const bin = P_BINS.findIndex((lo, k) => p >= lo && p < P_BINS[k + 1]);
      if (bin >= 0) binWays[bin] += 1;
      const pInt = Math.round(p * 1000);
      for (const line of chainSegments(segs)) polylines.push(encodeLine(line, area.projection.lon0, area.projection.lat0, [pInt]));
    }
  }

  const cellRows = [...cells.values()].sort((a, b) => (a.iy - b.iy) || (a.ix - b.ix))
    .map((c) => [c.ix, c.iy, round(c.meters), c.meters > 0 ? round(c.pMeters / c.meters, 4) : 0, c.ways.size]);

  return {
    id: area.id,
    status: "experimental_unverified",
    label: EXPERIMENTAL_LABEL,
    ways: own.length,
    matchedWays,
    unmatchedWays,
    waysWithKnownSegmentsInRuntimeData: waysWithKnownSegments,
    knownSegmentsSkipped,
    knownMetersSkipped: round(knownMetersSkipped),
    predictedUnknownSegments,
    predictedUnknownMeters: round(predictedUnknownMeters),
    outOfDistributionWays,
    meanP: own.length ? round(pSum / own.length, 4) : null,
    maxP: round(pMax, 4),
    waysWithPAtLeast05: pAtLeastHalf,
    pBins: P_BINS.slice(0, -1).map((lo, k) => ({ from: lo, to: Math.min(1, P_BINS[k + 1]), ways: binWays[k], meters: round(binMeters[k]) })),
    grid: { fields: ["ix", "iy", "predictedUnknownMeters", "lengthWeightedP", "ways"], rows: cellRows },
    geometry: { origin: { lon0: area.projection.lon0, lat0: area.projection.lat0 }, quantization: 1e-5, encoding: "[round(p*1000), x0, y0, dx1, dy1, ...]", polylines },
  };
}
