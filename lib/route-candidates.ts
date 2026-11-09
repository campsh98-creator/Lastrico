import type { EngineRoute } from "./routing-providers";

type Coordinate = [number, number];
type EquivalencePolicy = {
  equivalentDistanceMeters: number;
  equivalentDurationSeconds: number;
  equivalentAverageMeters: number;
};

function distanceToSegment(point: Coordinate, a: Coordinate, b: Coordinate, toleranceMeters?: number) {
  if (toleranceMeters !== undefined) {
    const padLat = toleranceMeters / 110_540;
    const minY = a[1] < b[1] ? a[1] : b[1];
    const maxY = a[1] > b[1] ? a[1] : b[1];
    if (point[1] < minY - padLat || point[1] > maxY + padLat) return Infinity;

    const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const padLon = toleranceMeters / Math.max(1, scale);
    const minX = a[0] < b[0] ? a[0] : b[0];
    const maxX = a[0] > b[0] ? a[0] : b[0];
    if (point[0] < minX - padLon || point[0] > maxX + padLon) return Infinity;

    const dx = (b[0] - a[0]) * scale;
    const dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * scale;
    const py = (point[1] - a[1]) * 110_540;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    return Math.hypot(px - ratio * dx, py - ratio * dy);
  }
  const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * scale;
  const dy = (b[1] - a[1]) * 110_540;
  const px = (point[0] - a[0]) * scale;
  const py = (point[1] - a[1]) * 110_540;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - ratio * dx, py - ratio * dy);
}

function pointDistance(a: Coordinate, b: Coordinate) {
  return distanceToSegment(a, b, b);
}

const DIVERGENCE_SAMPLE_METERS = 25;
const EQUIVALENT_DIVERGENCE_METERS = 60;
const EQUIVALENT_DIVERGENCE_RATIO = 0.03;

// Phase 4.30: route geometries are never mutated after decoding, so results keyed on the
// coordinate arrays are exact and are released with the request's routes.
const lengthCache = new WeakMap<Coordinate[], number>();
function routeLength(coordinates: Coordinate[]) {
  const cached = lengthCache.get(coordinates);
  if (cached !== undefined) return cached;
  const length = coordinates.slice(1).reduce((sum, point, index) => sum + pointDistance(point, coordinates[index]), 0);
  lengthCache.set(coordinates, length);
  return length;
}

/**
 * Phase 4.30: a uniform grid over a route's segments. Each segment is listed in every cell its
 * bounding box, padded by the tolerance, overlaps. The longitude pad uses the smallest metres-
 * per-degree the segment can be compared at, so it is never narrower than the pad the exact
 * check below applies: every segment that can be within tolerance of a point is a candidate.
 * The exact distance test is unchanged, so the answer is identical to a full scan.
 */
type SegmentGrid = { cellLon: number; cellLat: number; cells: Map<number, number[]> };
const gridCache = new WeakMap<Coordinate[], Map<number, SegmentGrid>>();
const GRID_ROW = 4_194_304;

function segmentGrid(other: Coordinate[], toleranceMeters: number): SegmentGrid {
  let byTolerance = gridCache.get(other);
  const cached = byTolerance?.get(toleranceMeters);
  if (cached) return cached;
  const padLat = toleranceMeters / 110_540;
  const cellLat = Math.max(padLat * 2, 1e-5);
  const latitude = other[0][1];
  const cellLon = cellLat * 110_540 / Math.max(1, 111_320 * Math.cos((latitude * Math.PI) / 180));
  const cells = new Map<number, number[]>();
  for (let index = 1; index < other.length; index += 1) {
    const a = other[index - 1];
    const b = other[index];
    const minY = Math.min(a[1], b[1]) - padLat;
    const maxY = Math.max(a[1], b[1]) + padLat;
    const extremeLatitude = Math.max(Math.abs(minY), Math.abs(maxY));
    const padLon = toleranceMeters / Math.max(1, 111_320 * Math.cos((extremeLatitude * Math.PI) / 180));
    const minX = Math.min(a[0], b[0]) - padLon;
    const maxX = Math.max(a[0], b[0]) + padLon;
    for (let cx = Math.floor(minX / cellLon); cx <= Math.floor(maxX / cellLon); cx += 1) {
      for (let cy = Math.floor(minY / cellLat); cy <= Math.floor(maxY / cellLat); cy += 1) {
        const key = cx * GRID_ROW + cy;
        const list = cells.get(key);
        if (list) list.push(index);
        else cells.set(key, [index]);
      }
    }
  }
  const grid = { cellLon, cellLat, cells };
  if (!byTolerance) {
    byTolerance = new Map();
    gridCache.set(other, byTolerance);
  }
  byTolerance.set(toleranceMeters, grid);
  return grid;
}

const divergenceCache = new WeakMap<Coordinate[], WeakMap<Coordinate[], Map<number, number>>>();

/**
 * Length of `route` lying farther than `toleranceMeters` from `other`. Samples by distance, not
 * vertex count, so provider simplification cannot change the result. The scan resumes near the
 * last match and stops at the first segment in tolerance, which keeps near-identical routes cheap.
 */
function divergentMeters(route: Coordinate[], other: Coordinate[], toleranceMeters: number) {
  const memo = divergenceCache.get(route)?.get(other)?.get(toleranceMeters);
  if (memo !== undefined) return memo;
  let divergent = 0;
  let lastMatch = 1;
  const grid = segmentGrid(other, toleranceMeters);
  // Whether any segment of `other` is within tolerance; the scan order only affects speed.
  const isNear = (point: Coordinate) => {
    // Near-identical routes match right next to the previous sample: try there first.
    for (const index of [lastMatch, lastMatch + 1, lastMatch - 1, lastMatch + 2]) {
      if (index >= 1 && index < other.length
        && distanceToSegment(point, other[index - 1], other[index], toleranceMeters) <= toleranceMeters) {
        lastMatch = index;
        return true;
      }
    }
    const candidates = grid.cells.get(Math.floor(point[0] / grid.cellLon) * GRID_ROW + Math.floor(point[1] / grid.cellLat));
    if (!candidates) return false;
    for (const index of candidates) {
      if (distanceToSegment(point, other[index - 1], other[index], toleranceMeters) <= toleranceMeters) {
        lastMatch = index;
        return true;
      }
    }
    return false;
  };
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    const length = pointDistance(a, b);
    if (!length) continue;
    const samples = Math.max(1, Math.ceil(length / DIVERGENCE_SAMPLE_METERS));
    for (let sample = 0; sample < samples; sample += 1) {
      const ratio = (sample + 0.5) / samples;
      if (!isNear([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio])) {
        divergent += length / samples;
      }
    }
  }
  let byOther = divergenceCache.get(route);
  if (!byOther) {
    byOther = new WeakMap();
    divergenceCache.set(route, byOther);
  }
  let byTolerance = byOther.get(other);
  if (!byTolerance) {
    byTolerance = new Map();
    byOther.set(other, byTolerance);
  }
  byTolerance.set(toleranceMeters, divergent);
  return divergent;
}

export function routesAreEquivalent(a: EngineRoute, b: EngineRoute, policy: EquivalencePolicy) {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return false;
  if (
    Math.abs(a.distance - b.distance) > policy.equivalentDistanceMeters
    || Math.abs(a.duration - b.duration) > policy.equivalentDurationSeconds
  ) return false;
  return routesShareCorridor(a, b, policy.equivalentAverageMeters);
}

/** Physical diversity must not depend on provider travel-time or distance estimates. */
export function routesShareCorridor(a: EngineRoute, b: EngineRoute, toleranceMeters: number) {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return false;
  // Matching geometry in reverse is not the same journey.
  if (distanceToSegment(a.coordinates[0], b.coordinates[0], b.coordinates[0]) >= toleranceMeters
    || distanceToSegment(a.coordinates[a.coordinates.length - 1], b.coordinates[b.coordinates.length - 1], b.coordinates[b.coordinates.length - 1]) >= toleranceMeters) return false;
  // A mean distance would hide a detour onto a parallel street inside a long shared route, and
  // that detour is often the one that avoids the pave. Both directions matter: one route may
  // cover a subset of the other.
  const allowance = Math.max(
    EQUIVALENT_DIVERGENCE_METERS,
    EQUIVALENT_DIVERGENCE_RATIO * Math.min(routeLength(a.coordinates), routeLength(b.coordinates)),
  );
  return divergentMeters(a.coordinates, b.coordinates, toleranceMeters) <= allowance
    && divergentMeters(b.coordinates, a.coordinates, toleranceMeters) <= allowance;
}

export function deduplicateRoutes<T extends { route: EngineRoute }>(routes: T[], policy: EquivalencePolicy): T[] {
  const result: T[] = [];
  // Preserve the true fastest candidate as the reference for the user's hard time budget.
  for (const candidate of [...routes].sort((a, b) => a.route.duration - b.route.duration)) {
    if (!result.some((existing) => routesAreEquivalent(candidate.route, existing.route, policy))) {
      result.push(candidate);
    }
  }
  return result;
}
