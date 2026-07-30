export type SurfaceCoordinate = [number, number];

export type SurfaceFeature = {
  id: number;
  surface: string;
  coordinates: SurfaceCoordinate[];
};

type IndexedSurfaceSegment = {
  id: number;
  surface: string;
  a: SurfaceCoordinate;
  b: SurfaceCoordinate;
};

export type SurfaceScore = {
  paveMeters: number;
  weightedPaveMeters: number;
  confirmedMeters: number;
  probableMeters: number;
  pavePercent: number;
  confidence: number;
  matchedFeatures: number;
};

export type SurfaceIndex = {
  cellSize: number;
  cells: Map<string, IndexedSurfaceSegment[]>;
};

const SURFACE_WEIGHT: Record<string, number> = {
  sett: 1,
  cobblestone: 1,
  unhewn_cobblestone: 1,
  paving_stones: 0.65,
};

function metersPerLongitude(latitude: number) {
  return 111_320 * Math.cos(latitude * Math.PI / 180);
}

export function geographicDistance(a: SurfaceCoordinate, b: SurfaceCoordinate) {
  const latitude = (a[1] + b[1]) / 2;
  return Math.hypot(
    (b[0] - a[0]) * metersPerLongitude(latitude),
    (b[1] - a[1]) * 110_540,
  );
}

function pointToSegmentDistance(
  point: SurfaceCoordinate,
  a: SurfaceCoordinate,
  b: SurfaceCoordinate,
) {
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

function headingsAlign(
  a: SurfaceCoordinate,
  b: SurfaceCoordinate,
  c: SurfaceCoordinate,
  d: SurfaceCoordinate,
) {
  const latitude = (a[1] + b[1] + c[1] + d[1]) / 4;
  const scaleX = metersPerLongitude(latitude);
  const routeX = (b[0] - a[0]) * scaleX;
  const routeY = (b[1] - a[1]) * 110_540;
  const wayX = (d[0] - c[0]) * scaleX;
  const wayY = (d[1] - c[1]) * 110_540;
  const denominator = Math.hypot(routeX, routeY) * Math.hypot(wayX, wayY);
  return denominator > 0
    && Math.abs((routeX * wayX + routeY * wayY) / denominator) >= 0.58;
}

function cellKey(x: number, y: number) {
  return `${x}:${y}`;
}

export function createSurfaceIndex(features: SurfaceFeature[], cellSize = 0.001): SurfaceIndex {
  const cells = new Map<string, IndexedSurfaceSegment[]>();
  for (const feature of features) {
    for (let index = 1; index < feature.coordinates.length; index += 1) {
      const segment = {
        id: feature.id,
        surface: feature.surface,
        a: feature.coordinates[index - 1],
        b: feature.coordinates[index],
      };
      const minX = Math.floor(Math.min(segment.a[0], segment.b[0]) / cellSize);
      const maxX = Math.floor(Math.max(segment.a[0], segment.b[0]) / cellSize);
      const minY = Math.floor(Math.min(segment.a[1], segment.b[1]) / cellSize);
      const maxY = Math.floor(Math.max(segment.a[1], segment.b[1]) / cellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = cellKey(x, y);
          const existing = cells.get(key);
          if (existing) existing.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  return { cellSize, cells };
}

function nearbySegments(
  index: SurfaceIndex,
  point: SurfaceCoordinate,
  matchMeters: number,
) {
  const longitudePadding = matchMeters / Math.max(1, metersPerLongitude(point[1]));
  const latitudePadding = matchMeters / 110_540;
  const minX = Math.floor((point[0] - longitudePadding) / index.cellSize);
  const maxX = Math.floor((point[0] + longitudePadding) / index.cellSize);
  const minY = Math.floor((point[1] - latitudePadding) / index.cellSize);
  const maxY = Math.floor((point[1] + latitudePadding) / index.cellSize);
  const found = new Set<IndexedSurfaceSegment>();
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      index.cells.get(cellKey(x, y))?.forEach((segment) => found.add(segment));
    }
  }
  return found;
}

export function scoreSurfaceExposure(
  coordinates: SurfaceCoordinate[],
  index: SurfaceIndex,
  matchMeters: number,
): SurfaceScore {
  let paveMeters = 0;
  let weightedPaveMeters = 0;
  let confirmedMeters = 0;
  let probableMeters = 0;
  let totalMeters = 0;
  const matched = new Set<number>();
  for (let routeIndex = 1; routeIndex < coordinates.length; routeIndex += 1) {
    const a = coordinates[routeIndex - 1];
    const b = coordinates[routeIndex];
    const length = geographicDistance(a, b);
    totalMeters += length;
    const samples = Math.max(1, Math.ceil(length / 12));
    const sampleLength = length / samples;
    for (let sample = 0; sample < samples; sample += 1) {
      const startRatio = sample / samples;
      const endRatio = (sample + 1) / samples;
      const sampleA: SurfaceCoordinate = [
        a[0] + (b[0] - a[0]) * startRatio,
        a[1] + (b[1] - a[1]) * startRatio,
      ];
      const sampleB: SurfaceCoordinate = [
        a[0] + (b[0] - a[0]) * endRatio,
        a[1] + (b[1] - a[1]) * endRatio,
      ];
      const midpoint: SurfaceCoordinate = [
        (sampleA[0] + sampleB[0]) / 2,
        (sampleA[1] + sampleB[1]) / 2,
      ];
      let best: IndexedSurfaceSegment | null = null;
      let bestWeight = 0;
      for (const candidate of nearbySegments(index, midpoint, matchMeters)) {
        const weight = SURFACE_WEIGHT[candidate.surface] ?? 0;
        if (
          weight > bestWeight
          && headingsAlign(sampleA, sampleB, candidate.a, candidate.b)
          && pointToSegmentDistance(midpoint, candidate.a, candidate.b) <= matchMeters
        ) {
          best = candidate;
          bestWeight = weight;
        }
      }
      if (!best) continue;
      matched.add(best.id);
      paveMeters += sampleLength;
      weightedPaveMeters += sampleLength * bestWeight;
      if (best.surface === "paving_stones") probableMeters += sampleLength;
      else confirmedMeters += sampleLength;
    }
  }
  const confidence = paveMeters > 0
    ? (confirmedMeters + probableMeters * 0.65) / paveMeters
    : 0;
  return {
    paveMeters: Math.min(Math.round(totalMeters), Math.round(paveMeters)),
    weightedPaveMeters: Math.round(weightedPaveMeters),
    confirmedMeters: Math.round(confirmedMeters),
    probableMeters: Math.round(probableMeters),
    pavePercent: totalMeters > 0 ? Math.round((paveMeters / totalMeters) * 1_000) / 10 : 0,
    confidence: Math.round(confidence * 100) / 100,
    matchedFeatures: matched.size,
  };
}

