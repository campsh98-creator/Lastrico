/**
 * Lastrico Road Intelligence Foundation — Spatial Scoring Engine
 * Phase 2 Multi-Attribute Spatial Matching & Scoring
 */

import type {
  GeoCoordinate,
  RoadSegmentRecord,
} from "./road-intelligence-types";

export type RoadIntelligenceScore = {
  totalMeters: number;
  /** Distance on rough surfaces (confirmed + probable) */
  paveMeters: number;
  /** Distance weighted by roughness factor (1.0 for sett, 0.65 for paving_stones) */
  weightedPaveMeters: number;
  /** Distance on confirmed rough stone (sett, cobblestone) */
  confirmedMeters: number;
  /** Distance on probable stone (paving_stones) */
  probableMeters: number;
  /** Distance on confirmed smooth surfaces (asphalt, concrete) */
  smoothMeters: number;
  /** Distance on known loose/unpaved surfaces, distinct from smooth or rough stone */
  unpavedMeters: number;
  /** Percentage of route on rough surface [0 - 100] */
  pavePercent: number;
  /** Percentage of route on smooth surface [0 - 100] */
  smoothPercent: number;
  /** Distance without direct surface evidence. Never assumed smooth! */
  unknownMeters: number;
  /** Percentage of route with known surface evidence (rough, smooth or unpaved) */
  matchedCoveragePercent: number;
  /** Distance along dedicated or segregated cycling infrastructure */
  cyclewayMeters: number;
  /** Distance along road with embedded tram rails */
  embeddedRailsMeters: number;
  /** Classification confidence based on source evidence quality */
  classificationConfidence: number;
  dataConfidence: null;
  matchedSegments: number;
  /** Distinct source ways contributing known surface evidence. */
  matchedFeatures: number;
  /** Count of ambiguous matches detected (e.g. parallel candidate within 2m) */
  ambiguousMatchesCount: number;
};

export type RoadIntelligenceIndex = {
  cellSize: number;
  cells: Map<string, RoadSegmentRecord[]>;
  allSegments: RoadSegmentRecord[];
};

function metersPerLongitude(latitude: number): number {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function geographicDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  const latitude = (a[1] + b[1]) / 2;
  return Math.hypot(
    (b[0] - a[0]) * metersPerLongitude(latitude),
    (b[1] - a[1]) * 110_540,
  );
}

function pointToSegmentDistance(
  point: GeoCoordinate,
  a: GeoCoordinate,
  b: GeoCoordinate,
): number {
  const latitude = point[1];
  const scaleX = metersPerLongitude(latitude);
  const px = point[0] * scaleX;
  const py = point[1] * 110_540;
  const ax = a[0] * scaleX;
  const ay = a[1] * 110_540;
  const bx = b[0] * scaleX;
  const by = b[1] * 110_540;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator))
    : 0;
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

/**
 * Directional alignment check.
 * If requireForward is true (one-way streets), checks forward cosine >= 0.70 (within ~45 degrees).
 * If requireForward is false (two-way streets), checks bidirectional |cosine| >= 0.58 (within ~54.5 degrees).
 */
export function headingsAlign(
  a: GeoCoordinate,
  b: GeoCoordinate,
  c: GeoCoordinate,
  d: GeoCoordinate,
  requireForward = false,
): boolean {
  const latitude = (a[1] + b[1] + c[1] + d[1]) / 4;
  const scaleX = metersPerLongitude(latitude);
  const routeX = (b[0] - a[0]) * scaleX;
  const routeY = (b[1] - a[1]) * 110_540;
  const wayX = (d[0] - c[0]) * scaleX;
  const wayY = (d[1] - c[1]) * 110_540;
  const denominator = Math.hypot(routeX, routeY) * Math.hypot(wayX, wayY);
  if (denominator <= 0) return false;

  const cosTheta = (routeX * wayX + routeY * wayY) / denominator;
  if (requireForward) {
    return cosTheta >= 0.70;
  }
  return Math.abs(cosTheta) >= 0.58;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export function createRoadIntelligenceIndex(
  segments: RoadSegmentRecord[],
  cellSize = 0.001,
): RoadIntelligenceIndex {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError("Cell size must be finite and positive");
  }
  const cells = new Map<string, RoadSegmentRecord[]>();

  for (const seg of segments) {
    const [a, b] = seg.coordinates;
    const minX = Math.floor(Math.min(a[0], b[0]) / cellSize);
    const maxX = Math.floor(Math.max(a[0], b[0]) / cellSize);
    const minY = Math.floor(Math.min(a[1], b[1]) / cellSize);
    const maxY = Math.floor(Math.max(a[1], b[1]) / cellSize);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = cellKey(x, y);
        const existing = cells.get(key);
        if (existing) existing.push(seg);
        else cells.set(key, [seg]);
      }
    }
  }

  return { cellSize, cells, allSegments: segments };
}

function nearbySegments(
  index: RoadIntelligenceIndex,
  point: GeoCoordinate,
  matchMeters: number,
): Set<RoadSegmentRecord> {
  const lonPadding = matchMeters / Math.max(1, metersPerLongitude(point[1]));
  const latPadding = matchMeters / 110_540;
  const minX = Math.floor((point[0] - lonPadding) / index.cellSize);
  const maxX = Math.floor((point[0] + lonPadding) / index.cellSize);
  const minY = Math.floor((point[1] - latPadding) / index.cellSize);
  const maxY = Math.floor((point[1] + latPadding) / index.cellSize);

  const found = new Set<RoadSegmentRecord>();
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      index.cells.get(cellKey(x, y))?.forEach((seg) => found.add(seg));
    }
  }
  return found;
}

export function scoreRoadIntelligence(
  coordinates: GeoCoordinate[],
  index: RoadIntelligenceIndex,
  matchMeters: number,
  mode: "car" | "motorcycle" | "bicycle" = "car",
): RoadIntelligenceScore {
  let paveMeters = 0;
  let weightedPaveMeters = 0;
  let confirmedMeters = 0;
  let probableMeters = 0;
  let smoothMeters = 0;
  let unpavedMeters = 0;
  let cyclewayMeters = 0;
  let embeddedRailsMeters = 0;
  let totalMeters = 0;
  let ambiguousMatchesCount = 0;
  const matched = new Set<string>();
  const matchedFeatures = new Set<string>();

  for (let rIndex = 1; rIndex < coordinates.length; rIndex += 1) {
    const a = coordinates[rIndex - 1];
    const b = coordinates[rIndex];
    const length = geographicDistance(a, b);
    totalMeters += length;

    const samples = Math.max(1, Math.ceil(length / 12));
    const sampleLength = length / samples;

    for (let sample = 0; sample < samples; sample += 1) {
      const startRatio = sample / samples;
      const endRatio = (sample + 1) / samples;
      const sampleA: GeoCoordinate = [
        a[0] + (b[0] - a[0]) * startRatio,
        a[1] + (b[1] - a[1]) * startRatio,
      ];
      const sampleB: GeoCoordinate = [
        a[0] + (b[0] - a[0]) * endRatio,
        a[1] + (b[1] - a[1]) * endRatio,
      ];
      const midpoint: GeoCoordinate = [
        (sampleA[0] + sampleB[0]) / 2,
        (sampleA[1] + sampleB[1]) / 2,
      ];

      let best: RoadSegmentRecord | null = null;
      let bestDistance = Infinity;
      let bestWeight = 0;
      let nearestRejected = Infinity;
      const alignedCandidates: { segment: RoadSegmentRecord; distance: number }[] = [];

      for (const candidate of nearbySegments(index, midpoint, matchMeters)) {
        const distance = pointToSegmentDistance(
          midpoint,
          candidate.coordinates[0],
          candidate.coordinates[1],
        );

        if (distance > matchMeters) continue;

        const geometricallyAligned = headingsAlign(
          sampleA,
          sampleB,
          candidate.coordinates[0],
          candidate.coordinates[1],
        );
        if (!geometricallyAligned) continue;
        const allowed = candidate.modeAccess?.[mode] ?? (mode === "bicycle" ? candidate.isBicycleAllowed : candidate.isMotorAllowed);
        const direction = candidate.modeDirections?.[mode] ?? (candidate.isOneway ? "forward" : "both");
        const [start, end] = direction === "backward" ? [...candidate.coordinates].reverse() : candidate.coordinates;
        if (!allowed || direction === "unknown" || !headingsAlign(sampleA, sampleB, start, end, direction !== "both")) {
          nearestRejected = Math.min(nearestRejected, distance);
          continue;
        }

        alignedCandidates.push({ segment: candidate, distance });

        const weight = candidate.roughnessWeight;
        if (
          distance < bestDistance ||
          (distance === bestDistance && weight > bestWeight)
        ) {
          best = candidate;
          bestDistance = distance;
          bestWeight = weight;
        }
      }

      // Reject a closer prohibited road rather than transferring its route samples
      // to an accessible parallel road with unrelated surface evidence.
      if (!best || nearestRejected <= bestDistance + 0.000001) continue;

      // Compare against the final nearest road, not a temporary leader in index order.
      const selected = best;
      if (alignedCandidates.some(({ segment, distance }) =>
        Math.abs(distance - bestDistance) <= 2 &&
        ((segment.osmWayId !== null && selected.osmWayId !== null && segment.osmWayId !== selected.osmWayId) ||
         (segment.name !== null && selected.name !== null && segment.name !== selected.name)),
      )) {
        ambiguousMatchesCount += 1;
      }

      const grade = (segment: RoadSegmentRecord) => `${segment.rawTags?.layer ?? "0"}:${segment.rawTags?.bridge ?? "no"}:${segment.rawTags?.tunnel ?? "no"}`;
      if (alignedCandidates.some(({ segment, distance }) =>
        Math.abs(distance - bestDistance) <= 2 && grade(segment) !== grade(selected),
      )) continue; // Route geometry alone cannot resolve vertically separated roads.

      const sourceKey = best.osmWayId === null ? best.segmentHash : `osm:${best.osmWayId}`;
      matched.add(`${sourceKey}:${best.segmentHash}`);
      if (best.surfaceCategory !== "unknown") matchedFeatures.add(sourceKey);

      if (best.surfaceCategory === "confirmed_rough") {
        paveMeters += sampleLength;
        weightedPaveMeters += sampleLength * bestWeight;
        confirmedMeters += sampleLength;
      } else if (best.surfaceCategory === "probable_rough") {
        paveMeters += sampleLength;
        weightedPaveMeters += sampleLength * bestWeight;
        probableMeters += sampleLength;
      } else if (best.surfaceCategory === "confirmed_smooth") {
        smoothMeters += sampleLength;
      } else if (best.surfaceCategory === "unpaved_loose") {
        unpavedMeters += sampleLength;
      }

      if (best.cycling?.value?.hasFacility) {
        cyclewayMeters += sampleLength;
      }
      if (best.embeddedRails) {
        embeddedRailsMeters += sampleLength;
      }
    }
  }

  const roundedTotal = Math.round(totalMeters);
  const roundedPave = Math.min(roundedTotal, Math.round(paveMeters));
  const roundedSmooth = Math.min(roundedTotal - roundedPave, Math.round(smoothMeters));
  const roundedUnpaved = Math.min(roundedTotal - roundedPave - roundedSmooth, Math.round(unpavedMeters));
  const assessedMeters = roundedPave + roundedSmooth + roundedUnpaved;
  const unknownMeters = Math.max(0, roundedTotal - assessedMeters);

  const pavePercent = roundedTotal > 0 ? Math.round((roundedPave / roundedTotal) * 1000) / 10 : 0;
  const smoothPercent = roundedTotal > 0 ? Math.round((roundedSmooth / roundedTotal) * 1000) / 10 : 0;
  const matchedCoveragePercent = roundedTotal > 0 ? Math.round((assessedMeters / roundedTotal) * 1000) / 10 : 0;

  const confidence = paveMeters > 0
    ? Math.max(0, Math.min(1, (confirmedMeters + probableMeters * 0.65) / paveMeters))
    : (roundedSmooth > 0 ? 1.0 : 0.0);

  return {
    totalMeters: roundedTotal,
    paveMeters: roundedPave,
    weightedPaveMeters: Math.round(weightedPaveMeters),
    confirmedMeters: Math.round(confirmedMeters),
    probableMeters: Math.round(probableMeters),
    smoothMeters: roundedSmooth,
    unpavedMeters: roundedUnpaved,
    pavePercent,
    smoothPercent,
    unknownMeters,
    matchedCoveragePercent,
    cyclewayMeters: Math.round(cyclewayMeters),
    embeddedRailsMeters: Math.round(embeddedRailsMeters),
    classificationConfidence: Math.round(confidence * 100) / 100,
    dataConfidence: null,
    matchedSegments: matched.size,
    matchedFeatures: matchedFeatures.size,
    ambiguousMatchesCount,
  };
}
