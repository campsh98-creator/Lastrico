// Uncertainty hotspot score: "where a field survey would reduce routing uncertainty most".
// It is NOT a pavé prediction and never uses the Phase 4.17 model output.
//
// For each grid cell c:
//   U(c)  = Σ length × w(class)  over UNKNOWN segments usable by at least one Lastrico mode
//   Q(c)  = Σ length × w(class)  over PROBABLE pavé (paving_stones) segments usable by a mode (weak evidence)
//   R3(c) = metres of VERIFIED pavé in c and its 8 neighbours (3×3 window)
//   A(c)  = min(1, R3(c) / 300 m)              adjacency to verified pavé clusters, saturating
//   H(c)  = U(c) × (1 + A(c)) + 0.5 × Q(c)      weighted metres of uncertainty a full survey of c would resolve
// H is non-decreasing in U, Q, R3 and in the class weight w; verified smooth/other metres never raise it,
// and turning unknown metres into verified evidence (a survey) lowers it.

import { ROUTING_CLASS_WEIGHT } from "./classify.mjs";
import { round } from "./geo.mjs";

export const HOTSPOT_PARAMS = Object.freeze({
  adjacencySaturationMeters: 300,
  probableFactor: 0.5,
  neighbourhood: "3x3",
  classWeights: ROUTING_CLASS_WEIGHT,
});

export function adjacencyFactor(r3Meters, params = HOTSPOT_PARAMS) {
  if (!(r3Meters > 0)) return 0;
  return Math.min(1, r3Meters / params.adjacencySaturationMeters);
}

/** Pure per-cell score. Inputs are non-negative metres. */
export function scoreCell({ unknownWeighted = 0, probableWeighted = 0, pave3x3 = 0 }, params = HOTSPOT_PARAMS) {
  const a = adjacencyFactor(pave3x3, params);
  const score = unknownWeighted * (1 + a) + params.probableFactor * probableWeighted;
  return { score, adjacency: a };
}

export function cellKey(ix, iy) {
  return `${ix}:${iy}`;
}

/**
 * Compute R3, A, H for every cell and the ranked hotspot list.
 * cells: Map(key -> stats) where stats has ix, iy, confirmedRough, unknownWeighted, probableWeighted,
 *        unknownRoutable, unknownMajor, probableRoutable, unknownNames (Map name -> weighted metres).
 */
export function computeHotspots(cells, { topN = 25, params = HOTSPOT_PARAMS } = {}) {
  const scored = [];
  let totalScore = 0;
  for (const stats of cells.values()) {
    let r3 = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const n = cells.get(cellKey(stats.ix + dx, stats.iy + dy));
        if (n) r3 += n.confirmedRough;
      }
    }
    const { score, adjacency } = scoreCell({
      unknownWeighted: stats.unknownWeighted,
      probableWeighted: stats.probableWeighted,
      pave3x3: r3,
    }, params);
    stats.pave3x3 = r3;
    stats.adjacency = adjacency;
    stats.score = score;
    totalScore += score;
    if (score > 0) scored.push(stats);
  }
  scored.sort((p, q) => (q.score - p.score) || (p.iy - q.iy) || (p.ix - q.ix));
  scored.forEach((s, i) => { s.rank = i + 1; });
  const top = scored.slice(0, topN);
  return { totalScore, rankedCount: scored.length, top };
}

export const fmtInt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtM = (m) => `${fmtInt(m)} m`;

/** Italian, human-readable explanation of why a cell is a hotspot (no prediction language). */
export function explainHotspot(stats, totalScore) {
  const reasons = [];
  if (stats.unknownMajor > 0) {
    reasons.push(`${fmtM(stats.unknownMajor)} senza superficie nota su strade principali (motorway–tertiary)`);
  }
  const otherUnknown = stats.unknownRoutable - stats.unknownMajor;
  if (otherUnknown > 0) {
    reasons.push(`${fmtM(otherUnknown)} senza superficie nota su altre strade percorribili`);
  }
  if (stats.adjacency > 0) {
    reasons.push(`${fmtM(stats.pave3x3)} di pavé verificato nella cella o nelle 8 adiacenti (moltiplicatore ×${(1 + stats.adjacency).toFixed(2).replace(".", ",")})`);
  }
  if (stats.probableRoutable > 0) {
    reasons.push(`${fmtM(stats.probableRoutable)} di pavé solo probabile (paving_stones, evidenza debole)`);
  }
  const share = totalScore > 0 ? (100 * stats.score) / totalScore : 0;
  reasons.push(`${share.toFixed(2).replace(".", ",")}% dell'incertezza ponderata dell'area`);
  return reasons;
}

export function topNames(namesMap, n = 3) {
  return [...namesMap.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n)
    .map(([name, m]) => ({ name, weightedMeters: round(m, 1) }));
}
