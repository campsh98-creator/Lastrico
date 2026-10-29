export type Coordinate = [number, number];

export type LinearCostFactor = {
  shape: string;
  factor: number;
};

/**
 * Encode coordinates into Google/Valhalla polyline6 format (6 decimal places).
 */
export function encodePolyline6(coords: Coordinate[]): string {
  const factor = 1e6;
  let str = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const [lng, lat] of coords) {
    const latRound = Math.round(lat * factor);
    const lngRound = Math.round(lng * factor);
    const deltaLat = latRound - prevLat;
    const deltaLng = lngRound - prevLng;
    prevLat = latRound;
    prevLng = lngRound;

    for (const val of [deltaLat, deltaLng]) {
      let num = val < 0 ? ~(val << 1) : (val << 1);
      while (num >= 0x20) {
        str += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
        num >>= 5;
      }
      str += String.fromCharCode(num + 63);
    }
  }
  return str;
}

export function pointDistanceMeters(a: Coordinate, b: Coordinate): number {
  const midLat = (a[1] + b[1]) / 2;
  const dLat = (b[1] - a[1]) * 110_540;
  const dLon = (b[0] - a[0]) * 111_320 * Math.cos(midLat * Math.PI / 180);
  return Math.hypot(dLon, dLat);
}

/**
 * Extracts contiguous rough segments along route coordinates that meet a minimum length threshold.
 * Uses a predicate `isSegmentRough` to evaluate each sub-segment without requiring direct module dependencies.
 */
export function extractRoughSlices(
  coordinates: Coordinate[],
  isSegmentRough: (prev: Coordinate, current: Coordinate) => boolean,
  minMeters = 20,
  mergeGapMeters = 0,
): Coordinate[][] {
  const rawSlices: Coordinate[][] = [];
  let currentSlice: Coordinate[] = [];
  let currentLength = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const pt = coordinates[i];
    let isRough = false;

    if (i > 0) {
      const prev = coordinates[i - 1];
      const segLen = pointDistanceMeters(prev, pt);
      isRough = segLen < 1 && currentSlice.length > 0 ? true : isSegmentRough(prev, pt);
    }

    if (isRough) {
      if (currentSlice.length === 0 && i > 0) {
        currentSlice.push(coordinates[i - 1]);
      }
      currentSlice.push(pt);
      currentLength += pointDistanceMeters(coordinates[i - 1], pt);
    } else {
      if (currentSlice.length >= 2 && currentLength >= minMeters) {
        rawSlices.push(currentSlice);
      }
      currentSlice = [];
      currentLength = 0;
    }
  }

  if (currentSlice.length >= 2 && currentLength >= minMeters) {
    rawSlices.push(currentSlice);
  }

  if (mergeGapMeters <= 0 || rawSlices.length <= 1) return rawSlices;

  const merged: Coordinate[][] = [rawSlices[0]];
  for (let s = 1; s < rawSlices.length; s++) {
    const prev = merged[merged.length - 1];
    const curr = rawSlices[s];
    const gap = pointDistanceMeters(prev[prev.length - 1], curr[0]);
    if (gap <= mergeGapMeters) {
      merged[merged.length - 1] = [...prev, ...curr];
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Builds linear_cost_factors array for Valhalla request from extracted rough slices.
 */
export function buildLinearCostFactors(
  roughSlices: Coordinate[][],
  penaltyFactor = 15.0,
  maxSlices = 8,
): { factors: LinearCostFactor[]; totalPenalizedMeters: number } {
  if (roughSlices.length === 0) return { factors: [], totalPenalizedMeters: 0 };

  const sorted = [...roughSlices].sort((a, b) => {
    const lenA = a.reduce((sum, pt, idx) => idx === 0 ? 0 : sum + pointDistanceMeters(a[idx - 1], pt), 0);
    const lenB = b.reduce((sum, pt, idx) => idx === 0 ? 0 : sum + pointDistanceMeters(b[idx - 1], pt), 0);
    return lenB - lenA;
  });

  const selected = sorted.slice(0, maxSlices);
  const totalPenalizedMeters = selected.reduce((total, slice) =>
    total + slice.reduce((sum, pt, idx) => idx === 0 ? 0 : sum + pointDistanceMeters(slice[idx - 1], pt), 0), 0);

  const factors = selected.map((slice) => ({
    shape: encodePolyline6(slice),
    factor: penaltyFactor,
  }));

  return {
    factors,
    totalPenalizedMeters: Math.round(totalPenalizedMeters),
  };
}
